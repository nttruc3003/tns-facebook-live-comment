import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { hash } from './security.js';
import { videoUrl, profileIdentity, facebookAvatarUrl } from './capture.js';
import { normalize, sanitizeBrowserComment, type User } from '../shared/types.js';

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const sourceId = z.object({ id: z.string().uuid() });
const comment = z
  .object({
    id: z.string().regex(/^(fb:\d{1,80}|obs:[a-f0-9-]{36})$/),
    authorName: z.string().min(1).max(200),
    authorUrl: z.string().max(1000).nullable(),
    avatarUrl: z.string().max(4000).nullable().optional(),
    message: z.string().trim().min(1).max(8000),
    observedAt: z.number().int().positive(),
    parentId: z.string().max(100).nullable(),
  })
  .strict();
type Source = {
  id: string;
  deviceId: string;
  videoId: string;
  url: string;
  title: string;
  streamId: string | null;
  approvedBy: string | null;
  enabled: number;
  ackSeq: number;
  running: number;
  pending: number;
  lastSeen: number;
};

export function registerCaptureSources(
  app: FastifyInstance,
  db: Store,
  notify: (type?: string, streamId?: string) => void,
  authorize: (req: FastifyRequest) => User,
) {
  function identity(req: FastifyRequest) {
    const credential = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(credential)) throw fail('Thiếu định danh extension.', 401);
    const match = req.headers.origin?.match(/^chrome-extension:\/\/([a-p]{32})$/);
    if (!match) throw fail('Chỉ nhận từ extension.', 403);
    return { secretHash: hash(credential), extensionId: match[1] };
  }
  function source(id: string) {
    const row = db.prepare('SELECT * FROM capture_sources WHERE id=?').get(id) as
      Source | undefined;
    if (!row) throw fail('Không tìm thấy nguồn thu.', 404);
    return row;
  }
  function updateStream(s: Source) {
    if (!s.enabled || !s.streamId) return;
    const connected = s.lastSeen > Date.now() - 75_000;
    const collecting = connected && (!!s.running || s.pending > 0);
    db.prepare('UPDATE streams SET collecting=?,status=?,lastSync=?,error=? WHERE id=?').run(
      collecting ? 1 : 0,
      collecting ? 'OBSERVING' : 'PAUSED',
      s.lastSeen,
      !connected ? 'Mất kết nối nguồn thu. Hàng chờ sẽ đồng bộ khi extension kết nối lại.' : null,
      s.streamId,
    );
  }
  app.post('/api/capture/bridge/announce', async (req) => {
    const ident = identity(req);
    const data = z
      .object({
        id: z.string().uuid(),
        url: z.string().max(2000),
        title: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(100),
        startedAt: z.number().int().positive(),
        firstSeq: z.number().int().positive(),
        running: z.boolean(),
        pending: z.number().int().min(0).max(1000000),
      })
      .strict()
      .parse(req.body);
    const video = videoUrl(data.url);
    const result = db.transaction(() => {
      let device = db
        .prepare('SELECT id,extensionId FROM capture_installations WHERE secretHash=?')
        .get(ident.secretHash) as { id: string; extensionId: string } | undefined;
      if (device && device.extensionId !== ident.extensionId) throw fail('Sai extension.', 403);
      if (!device) {
        // A discovery identity never grants permission to write comments.
        device = { id: randomUUID(), extensionId: ident.extensionId };
        db.prepare('INSERT INTO capture_installations VALUES (?,?,?,?,?)').run(
          device.id,
          ident.extensionId,
          ident.secretHash,
          data.name,
          Date.now(),
        );
      }
      db.prepare('UPDATE capture_installations SET name=? WHERE id=?').run(data.name, device.id);
      const previous = db.prepare('SELECT * FROM capture_sources WHERE id=?').get(data.id) as
        Source | undefined;
      if (previous && (previous.deviceId !== device.id || previous.videoId !== video.id))
        throw fail('Nguồn không khớp thiết bị hoặc video.', 409);
      db.prepare(
        `INSERT INTO capture_sources(id,deviceId,videoId,url,title,startedAt,lastSeen,running,pending,ackSeq)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lastSeen=excluded.lastSeen,running=excluded.running,pending=excluded.pending`,
      ).run(
        data.id,
        device.id,
        video.id,
        video.url,
        data.title,
        data.startedAt,
        Date.now(),
        Number(data.running),
        data.pending,
        data.firstSeq - 1,
      );
      const s = source(data.id);
      const owner = db
        .prepare("SELECT id FROM users WHERE id=? AND role IN ('admin','operator')")
        .get(s.approvedBy);
      if (s.enabled && (!owner || !s.streamId)) {
        db.prepare('UPDATE capture_sources SET enabled=0 WHERE id=?').run(s.id);
        s.enabled = 0;
      }
      updateStream(s);
      return { enabled: !!s.enabled, streamId: s.streamId, ackSeq: s.ackSeq };
    })();
    notify();
    return result;
  });
  app.get('/api/capture/sources', async (req) => {
    authorize(req);
    return {
      sources: db
        .prepare(
          `SELECT s.*,d.name,st.title AS streamTitle,
      CASE WHEN s.lastSeen>? THEN 1 ELSE 0 END AS connected
      FROM capture_sources s JOIN capture_installations d ON d.id=s.deviceId
      LEFT JOIN streams st ON st.id=s.streamId ORDER BY s.running DESC,s.startedAt DESC`,
        )
        .all(Date.now() - 75_000),
    };
  });
  app.post('/api/capture/sources/:id/select', async (req) => {
    const user = authorize(req),
      { id } = sourceId.parse(req.params);
    const { title } = z
      .object({ title: z.string().trim().max(200).optional() })
      .strict()
      .parse(req.body ?? {});
    const result = db.transaction(() => {
      const s = source(id);
      if (s.lastSeen < Date.now() - 75_000)
        throw fail('Nguồn đang ngoại tuyến. Mở Chrome để kết nối lại.', 409);
      let live = db
        .prepare("SELECT id FROM streams WHERE sourceId='browser' AND facebookId=?")
        .get(s.videoId) as { id: string } | undefined;
      if (!live) {
        live = { id: randomUUID() };
        db.prepare(
          "INSERT INTO streams(id,sourceId,facebookId,title,pageName,url,status,kind,createdAt) VALUES (?,'browser',?,?,?,?,'PAUSED','browser',?)",
        ).run(
          live.id,
          s.videoId,
          title || s.title,
          'Tab trình duyệt · Chưa xác minh chủ sở hữu',
          s.url,
          Date.now(),
        );
      }
      const other = db
        .prepare('SELECT id FROM capture_sources WHERE streamId=? AND enabled=1 AND id!=?')
        .get(live.id, s.id);
      const legacy = db
        .prepare(
          'SELECT id FROM capture_devices WHERE streamId=? AND captureId IS NOT NULL AND lastSeen>?',
        )
        .get(live.id, Date.now() - 75_000);
      if (other || legacy)
        throw fail('Video này đã có nguồn được chọn. Ngừng lưu nguồn đó trước.', 409);
      // Fence old, timed-out legacy writers before selecting the new source.
      db.prepare('UPDATE capture_devices SET captureId=NULL,streamId=NULL WHERE streamId=?').run(
        live.id,
      );
      // Never silently recreate a deleted history from a partly acknowledged queue.
      if (!s.streamId && s.ackSeq > 0)
        throw fail(
          'Lịch sử đã bị xóa. Bắt đầu lượt Collect mới; xuất hàng chờ cũ để giữ dữ liệu.',
          409,
        );
      if (title) db.prepare('UPDATE streams SET title=? WHERE id=?').run(title, live.id);
      db.prepare('UPDATE capture_sources SET streamId=?,approvedBy=?,enabled=1 WHERE id=?').run(
        live.id,
        user.id,
        s.id,
      );
      updateStream(source(id));
      return { streamId: live.id };
    })();
    notify();
    return result;
  });
  app.post('/api/capture/sources/:id/pause', async (req) => {
    authorize(req);
    const { id } = sourceId.parse(req.params),
      s = source(id);
    db.transaction(() => {
      db.prepare('UPDATE capture_sources SET enabled=0 WHERE id=?').run(id);
      if (s.enabled && s.streamId)
        db.prepare("UPDATE streams SET collecting=0,status='PAUSED',error=NULL WHERE id=?").run(
          s.streamId,
        );
    })();
    notify();
    return { ok: true };
  });
  app.post('/api/capture/bridge/upload', { bodyLimit: 1_000_000 }, async (req) => {
    const ident = identity(req);
    const data = z
      .object({
        id: z.string().uuid(),
        fromSeq: z.number().int().positive(),
        comments: z.array(comment).min(1).max(20),
      })
      .strict()
      .parse(req.body);
    const result = db.transaction(() => {
      const s = source(data.id);
      const device = db
        .prepare(
          'SELECT id FROM capture_installations WHERE id=? AND secretHash=? AND extensionId=?',
        )
        .get(s.deviceId, ident.secretHash, ident.extensionId);
      if (!device) throw fail('Sai thiết bị.', 403);
      const owner = db
        .prepare("SELECT id FROM users WHERE id=? AND role IN ('admin','operator')")
        .get(s.approvedBy);
      if (!s.enabled || !s.streamId || !owner) throw fail('Chưa được chọn lưu trên website.', 403);
      if (data.fromSeq > s.ackSeq + 1)
        throw fail('Hàng chờ chưa đúng thứ tự. Gửi phần cũ trước.', 409);
      const insert =
        db.prepare(`INSERT INTO comments(id,streamId,authorId,authorName,avatarUrl,message,normalized,createdAt,receivedAt,parentId,isHost,timeBasis,identityBasis,idBasis)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,'observed',?,?) ON CONFLICT(streamId,id) DO NOTHING`);
      let accepted = 0;
      data.comments.forEach((c, i) => {
        if (data.fromSeq + i <= s.ackSeq) return;
        if (c.observedAt > Date.now() + 60_000)
          throw fail('Đồng hồ trình duyệt đang đi trước máy chủ.');
        const clean = sanitizeBrowserComment(c.authorName, c.message),
          author = profileIdentity(c.authorUrl);
        if (clean.message)
          insert.run(
            c.id,
            s.streamId,
            author,
            clean.authorName,
            facebookAvatarUrl(c.avatarUrl),
            clean.message,
            normalize(clean.message),
            c.observedAt,
            Date.now(),
            c.parentId,
            author ? 'profile-url' : 'unknown',
            c.id.startsWith('fb:') ? 'facebook-id' : 'observation',
          );
        accepted++;
      });
      const ackSeq = Math.max(s.ackSeq, data.fromSeq + data.comments.length - 1);
      db.prepare(
        'UPDATE capture_sources SET ackSeq=?,pending=MAX(0,pending-?),lastSeen=? WHERE id=?',
      ).run(ackSeq, accepted, Date.now(), s.id);
      updateStream(source(s.id));
      return { ackSeq, streamId: s.streamId };
    })();
    notify('comments', result.streamId!);
    return { ackSeq: result.ackSeq };
  });
  const timer = setInterval(() => {
    const stale = db
      .prepare('SELECT * FROM capture_sources WHERE enabled=1 AND lastSeen<?')
      .all(Date.now() - 75_000) as Source[];
    for (const s of stale) updateStream(s);
    if (stale.length) notify();
  }, 30_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
