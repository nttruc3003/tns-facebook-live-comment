import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { hash, token, type Vault } from './security.js';
import { normalize, sanitizeBrowserComment, type User } from '../shared/types.js';

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const extensionId = z.string().regex(/^[a-p]{32}$/);
const secret = z.string().regex(/^[a-f0-9]{64}$/);
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const bridgePaths = new Set([
  '/api/capture/bridge/announce',
  '/api/capture/bridge/upload',
  '/api/capture/bridge/pair',
  '/api/capture/bridge/start',
  '/api/capture/bridge/batch',
  '/api/capture/bridge/stop',
  '/api/capture/bridge/status',
]);

export function videoUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw fail('URL video không hợp lệ.');
  }
  if (
    url.protocol !== 'https:' ||
    !['www.facebook.com', 'facebook.com', 'm.facebook.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw fail('Chỉ chọn tab video trên facebook.com.');
  const id =
    url.searchParams.get('v') || url.pathname.match(/\/videos\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1];
  if (!id || !/^\d{1,40}$/.test(id))
    throw fail(
      'Mở link video đầy đủ (/videos/ID hoặc watch?v=ID), không chọn news feed hoặc link share.',
    );
  return { id, url: `https://www.facebook.com/watch/?v=${id}` };
}
export function profileIdentity(input: string | null) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      !['www.facebook.com', 'facebook.com', 'm.facebook.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (url.pathname === '/profile.php' && /^\d+$/.test(url.searchParams.get('id') || ''))
      return `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
    if (/^\/people\/[^/]+\/\d+\/?$/.test(url.pathname))
      return `https://www.facebook.com${url.pathname.replace(/\/$/, '')}`;
    const slug = url.pathname.replace(/^\/|\/$/g, '');
    if (
      /^[a-zA-Z0-9.]{2,100}$/.test(slug) &&
      ![
        'watch',
        'videos',
        'reels',
        'groups',
        'photo',
        'photos',
        'stories',
        'share',
        'login',
        'help',
        'settings',
        'marketplace',
      ].includes(slug.toLowerCase())
    )
      return `https://www.facebook.com/${slug.toLowerCase()}`;
  } catch {
    /* A display name is not an identity. */
  }
  return null;
}

export function facebookAvatarUrl(input: string | null | undefined) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['fbcdn.net', 'fbsbx.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function registerCapture(
  app: FastifyInstance,
  db: Store,
  vault: Vault,
  notify: (kind?: string, id?: string) => void,
  authorize: (req: FastifyRequest) => User,
) {
  type Pairing = { streamId: string; userId: string; encryptedCode: string; updatedAt: number };
  function session(id: string) {
    return db
      .prepare(
        "SELECT id AS streamId,facebookId AS videoId,title,url FROM streams WHERE id=? AND kind='browser'",
      )
      .get(id) as { streamId: string; videoId: string; title: string; url: string } | undefined;
  }
  function requirePairOwner(user: User, pairing: Pairing) {
    if (pairing.userId !== user.id && user.role !== 'admin')
      throw fail('Mã phiên này do tài khoản khác quản lý.', 403);
  }
  const warning =
    'Đã mất kết nối extension. Mở lại tab và bấm bắt đầu; không thể khôi phục comment chưa quan sát.';
  db.prepare(
    "UPDATE streams SET collecting=0,status='PAUSED',error=? WHERE kind='browser' AND collecting=1",
  ).run(warning);
  db.prepare('UPDATE capture_devices SET captureId=NULL,streamId=NULL').run();
  function checkDevice(req: FastifyRequest) {
    const raw = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(raw)) throw fail('Cần ghép nối extension.', 401);
    const device = db
      .prepare(
        `SELECT d.*,u.role FROM capture_devices d JOIN users u ON u.id=d.userId
      WHERE d.secretHash=? AND d.expires>?`,
      )
      .get(hash(raw), Date.now()) as
      | {
          id: string;
          userId: string;
          extensionId: string;
          role: string;
          streamId: string | null;
          captureId: string | null;
          pairedStreamId: string | null;
        }
      | undefined;
    if (!device || !['admin', 'operator'].includes(device.role))
      throw fail('Ghép nối hết hạn hoặc đã thu hồi.', 401);
    if (!device.pairedStreamId)
      throw fail(
        'Kết nối cũ chưa gắn livestream. Lấy mã của phiên trong Studio và ghép nối lại.',
        401,
      );
    if (req.headers.origin && req.headers.origin !== `chrome-extension://${device.extensionId}`)
      throw fail('Sai extension.', 403);
    return device;
  }
  app.get('/api/capture', async (req) => {
    const user = authorize(req);
    const now = Date.now();
    const onlineSince = now - 75_000;
    return {
      sessions: db
        .prepare(
          `SELECT s.id AS streamId,s.facebookId AS videoId,s.title,s.url,s.collecting,p.updatedAt,
        (SELECT count(*) FROM capture_devices d WHERE d.pairedStreamId=s.id AND d.expires>?) AS deviceCount,
        (SELECT count(*) FROM capture_devices d WHERE d.pairedStreamId=s.id AND d.expires>? AND d.lastSeen>?) AS onlineDeviceCount
        FROM streams s LEFT JOIN capture_pairings p ON p.streamId=s.id
        WHERE s.kind='browser' AND (p.userId=? OR p.streamId IS NULL OR ?='admin') ORDER BY s.createdAt DESC`,
        )
        .all(now, now, onlineSince, user.id, user.role),
      devices: db
        .prepare(
          `SELECT d.id,d.name,d.createdAt,d.lastSeen,d.expires,d.streamId,d.pairedStreamId,s.title AS streamTitle,s.facebookId,
           CASE WHEN d.streamId=s.id AND d.captureId IS NOT NULL THEN s.collecting ELSE 0 END AS collecting,
           CASE WHEN d.expires>? AND d.lastSeen>? THEN 1 ELSE 0 END AS connected
           FROM capture_devices d LEFT JOIN streams s ON s.id=d.pairedStreamId WHERE d.userId=? ORDER BY d.createdAt DESC`,
        )
        .all(now, onlineSince, user.id),
    };
  });
  app.post('/api/capture/pair-code', async (req) => {
    const user = authorize(req);
    const data = z
      .object({ url: z.string().max(2000), title: z.string().trim().max(200).optional() })
      .strict()
      .parse(req.body);
    const video = videoUrl(data.url);
    const result = db.transaction(() => {
      let live = db
        .prepare("SELECT id FROM streams WHERE sourceId='browser' AND facebookId=?")
        .get(video.id) as { id: string } | undefined;
      if (!live) {
        live = { id: randomUUID() };
        db.prepare(
          "INSERT INTO streams(id,sourceId,facebookId,title,pageName,url,status,kind,createdAt) VALUES (?,'browser',?,?,?,?,'PAUSED','browser',?)",
        ).run(
          live.id,
          video.id,
          data.title || `Livestream ${video.id}`,
          'Tab trình duyệt · Chưa xác minh chủ sở hữu',
          video.url,
          Date.now(),
        );
      }
      const pairing = db.prepare('SELECT * FROM capture_pairings WHERE streamId=?').get(live.id) as
        Pairing | undefined;
      if (pairing) {
        requirePairOwner(user, pairing);
        return {
          code: vault.decrypt(pairing.encryptedCode),
          updatedAt: pairing.updatedAt,
          session: session(live.id),
        };
      }
      const code = token(),
        updatedAt = Date.now();
      db.prepare(
        'INSERT INTO capture_pairings(streamId,userId,codeHash,encryptedCode,updatedAt) VALUES (?,?,?,?,?)',
      ).run(live.id, user.id, hash(code), vault.encrypt(code), updatedAt);
      return { code, updatedAt, session: session(live.id) };
    })();
    notify();
    return result;
  });
  app.post('/api/capture/sessions/:id/rotate', async (req) => {
    const user = authorize(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const pairing = db.prepare('SELECT * FROM capture_pairings WHERE streamId=?').get(id) as
      Pairing | undefined;
    if (!pairing) throw fail('Phiên chưa có mã kết nối.', 404);
    requirePairOwner(user, pairing);
    const code = token(),
      updatedAt = Math.max(Date.now(), pairing.updatedAt + 1);
    db.transaction(() => {
      db.prepare(
        'UPDATE capture_pairings SET codeHash=?,encryptedCode=?,updatedAt=? WHERE streamId=?',
      ).run(hash(code), vault.encrypt(code), updatedAt, id);
      db.prepare(
        "UPDATE streams SET collecting=0,status='PAUSED',error='Mã phiên đã đổi. Ghép nối bằng mã mới để tiếp tục.' WHERE id=?",
      ).run(id);
      db.prepare('DELETE FROM capture_devices WHERE pairedStreamId=?').run(id);
    })();
    notify();
    return { code, updatedAt, session: session(id) };
  });
  app.delete('/api/capture/devices/:id', async (req) => {
    const user = authorize(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = db
      .prepare('SELECT streamId FROM capture_devices WHERE id=? AND userId=?')
      .get(id, user.id) as { streamId: string } | undefined;
    if (d?.streamId)
      db.prepare(
        "UPDATE streams SET collecting=0,status='PAUSED',error='Extension đã bị thu hồi.' WHERE id=?",
      ).run(d.streamId);
    db.prepare('DELETE FROM capture_devices WHERE id=? AND userId=?').run(id, user.id);
    notify();
    return { ok: true };
  });
  app.post(
    '/api/capture/bridge/pair',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req) => {
      const data = z
        .object({
          code: secret,
          extensionId,
          name: z.string().trim().min(1).max(80),
          previousCredential: secret.optional(),
          verifyOnly: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      if (req.headers.origin && req.headers.origin !== `chrome-extension://${data.extensionId}`)
        throw fail('Sai extension.', 403);
      const grant = db
        .prepare('SELECT * FROM capture_pairings WHERE codeHash=?')
        .get(hash(data.code)) as Pairing | undefined;
      if (!grant)
        throw fail('Mã phiên không đúng hoặc đã được đổi. Lấy mã hiện tại trong Studio.', 401);
      const user = db.prepare('SELECT role FROM users WHERE id=?').get(grant.userId) as
        User | undefined;
      if (!user || !['admin', 'operator'].includes(user.role))
        throw fail('Không có quyền ghép nối.', 403);
      // Only possession of this installation's old secret permits replacing its pairing.
      // Extension IDs are shared across Chrome profiles, so never deduplicate by ID alone.
      const previous = data.previousCredential
        ? (db
            .prepare(
              'SELECT id,captureId,pairedStreamId,expires FROM capture_devices WHERE secretHash=? AND userId=? AND extensionId=?',
            )
            .get(hash(data.previousCredential), grant.userId, data.extensionId) as
            | {
                id: string;
                captureId: string | null;
                pairedStreamId: string | null;
                expires: number;
              }
            | undefined)
        : undefined;
      if (data.verifyOnly) {
        if (!previous || previous.expires <= Date.now())
          throw fail('Kết nối hiện tại đã hết hạn. Hãy dừng phiên rồi ghép nối lại.', 401);
        if (previous.pairedStreamId !== grant.streamId)
          throw fail('Mã này thuộc livestream khác. Hãy dừng phiên hiện tại trước.', 409);
        db.prepare('UPDATE capture_devices SET lastSeen=? WHERE id=?').run(Date.now(), previous.id);
        notify();
        return {
          alreadyPaired: true,
          expires: previous.expires,
          deviceId: previous.id,
          session: session(grant.streamId),
        };
      }
      if (previous?.captureId) throw fail('Dừng phiên ghi trước khi ghép nối lại.', 409);
      const credential = token(),
        id = previous?.id ?? randomUUID(),
        expires = Date.now() + 7 * 86400_000;
      db.prepare(
        `INSERT INTO capture_devices(id,userId,extensionId,name,secretHash,expires,createdAt,lastSeen,pairedStreamId) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,secretHash=excluded.secretHash,expires=excluded.expires,lastSeen=excluded.lastSeen,pairedStreamId=excluded.pairedStreamId,streamId=NULL,captureId=NULL`,
      ).run(
        id,
        grant.userId,
        data.extensionId,
        data.name,
        hash(credential),
        expires,
        Date.now(),
        Date.now(),
        grant.streamId,
      );
      notify();
      return { credential, expires, deviceId: id, session: session(grant.streamId) };
    },
  );
  app.post('/api/capture/bridge/status', async (req) => {
    const device = checkDevice(req);
    db.prepare('UPDATE capture_devices SET lastSeen=? WHERE id=?').run(Date.now(), device.id);
    const live = device.streamId
      ? (db.prepare('SELECT collecting FROM streams WHERE id=?').get(device.streamId) as
          { collecting: number } | undefined)
      : undefined;
    return {
      deviceId: device.id,
      captureId: live?.collecting ? device.captureId : null,
      session: session(device.pairedStreamId!),
    };
  });
  app.post('/api/capture/bridge/start', async (req) => {
    const device = checkDevice(req);
    const data = z
      .object({ url: z.string().max(2000), title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(req.body);
    const video = videoUrl(data.url);
    const result = db.transaction(() => {
      const bound = session(device.pairedStreamId!);
      if (!bound || bound.videoId !== video.id)
        throw fail(
          'Mã đang kết nối thuộc livestream khác. Dùng mã của video này trong Studio.',
          403,
        );
      const live = { id: bound.streamId };
      const selectedSource = db
        .prepare('SELECT id FROM capture_sources WHERE streamId=? AND enabled=1')
        .get(live.id);
      if (selectedSource) throw fail('Nguồn Collect khác đang được chọn cho video này.', 409);
      const other = db
        .prepare(
          'SELECT id FROM capture_devices WHERE streamId=? AND captureId IS NOT NULL AND id!=? AND lastSeen>?',
        )
        .get(live.id, device.id, Date.now() - 30_000);
      if (other) throw fail('Tab khác đang ghi video này. Dừng tab đó trước.', 409);
      if (device.streamId && device.streamId !== live.id)
        db.prepare("UPDATE streams SET collecting=0,status='PAUSED' WHERE id=?").run(
          device.streamId,
        );
      db.prepare('UPDATE capture_devices SET captureId=NULL,streamId=NULL WHERE streamId=?').run(
        live.id,
      );
      const captureId = randomUUID();
      db.prepare('UPDATE capture_devices SET streamId=?,captureId=?,lastSeen=? WHERE id=?').run(
        live.id,
        captureId,
        Date.now(),
        device.id,
      );
      db.prepare(
        "UPDATE streams SET collecting=1,status='OBSERVING',lastSync=?,error=NULL WHERE id=?",
      ).run(Date.now(), live.id);
      return { streamId: live.id, captureId };
    })();
    notify();
    return result;
  });
  app.post('/api/capture/bridge/batch', { bodyLimit: 256_000 }, async (req) => {
    const device = checkDevice(req);
    const data = z
      .object({
        captureId: z.string().uuid(),
        url: z.string().max(2000),
        comments: z
          .array(
            z
              .object({
                id: z.string().regex(/^(fb:\d{1,80}|obs:[a-f0-9-]{36})$/),
                authorName: z.string().min(1).max(200),
                authorUrl: z.string().max(1000).nullable(),
                avatarUrl: z.string().max(4000).nullable().optional(),
                message: z.string().trim().min(1).max(8000),
                observedAt: z.number().int().positive(),
                parentId: z.string().max(100).nullable(),
              })
              .strict(),
          )
          .max(20),
      })
      .strict()
      .parse(req.body);
    if (!device.streamId || device.captureId !== data.captureId)
      throw fail('Phiên ghi đã dừng. Bắt đầu lại từ extension.', 409);
    const live = db
      .prepare('SELECT facebookId,collecting FROM streams WHERE id=?')
      .get(device.streamId) as { facebookId: string; collecting: number };
    if (!live?.collecting || live.facebookId !== videoUrl(data.url).id)
      throw fail('Tab đã đổi video hoặc phiên đã dừng.', 409);
    const insert =
      db.prepare(`INSERT INTO comments(id,streamId,authorId,authorName,avatarUrl,message,normalized,createdAt,receivedAt,parentId,isHost,timeBasis,identityBasis,idBasis)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,'observed',?,?)
      ON CONFLICT(streamId,id) DO UPDATE SET avatarUrl=excluded.avatarUrl
      WHERE comments.avatarUrl IS NULL AND excluded.avatarUrl IS NOT NULL`);
    let inserted = 0;
    db.transaction(() => {
      for (const c of data.comments) {
        if (c.observedAt > Date.now() + 60_000 || c.observedAt < Date.now() - 86400_000)
          throw fail('Đồng hồ trình duyệt lệch hoặc dữ liệu chờ quá 24 giờ.');
        const identity = profileIdentity(c.authorUrl);
        const avatar = facebookAvatarUrl(c.avatarUrl);
        const clean = sanitizeBrowserComment(c.authorName, c.message);
        if (!clean.message) continue;
        inserted += insert.run(
          c.id,
          device.streamId,
          identity,
          clean.authorName,
          avatar,
          clean.message,
          normalize(clean.message),
          c.observedAt,
          Date.now(),
          c.parentId,
          identity ? 'profile-url' : 'unknown',
          c.id.startsWith('fb:') ? 'facebook-id' : 'observation',
        ).changes;
        if (identity && avatar)
          db.prepare(
            'UPDATE comments SET avatarUrl=? WHERE streamId=? AND authorId=? AND avatarUrl IS NULL',
          ).run(avatar, device.streamId, identity);
      }
      db.prepare('UPDATE capture_devices SET lastSeen=? WHERE id=?').run(Date.now(), device.id);
      db.prepare('UPDATE streams SET lastSync=? WHERE id=?').run(Date.now(), device.streamId);
    })();
    notify('comments', device.streamId);
    return { accepted: data.comments.length, inserted };
  });
  app.post('/api/capture/bridge/stop', async (req) => {
    const device = checkDevice(req);
    const { captureId } = z.object({ captureId: z.string().uuid() }).parse(req.body);
    if (device.captureId === captureId && device.streamId) {
      db.prepare("UPDATE streams SET collecting=0,status='PAUSED' WHERE id=?").run(device.streamId);
      db.prepare('UPDATE capture_devices SET captureId=NULL,streamId=NULL WHERE id=?').run(
        device.id,
      );
      notify();
    }
    return { ok: true };
  });
  const timer = setInterval(() => {
    const changed = db
      .prepare(
        "UPDATE streams SET collecting=0,status='PAUSED',error=? WHERE kind='browser' AND collecting=1 AND lastSync<? AND id NOT IN (SELECT streamId FROM capture_sources WHERE enabled=1 AND streamId IS NOT NULL)",
      )
      .run(warning, Date.now() - 30_000).changes;
    if (changed) notify();
  }, 5000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

// Only these explicit capability-authenticated endpoints bypass browser cookie/CSRF auth.
// The bridge is loopback-only even though the dashboard is accessible over LAN.
export function captureBridgeRequest(req: FastifyRequest) {
  if (!bridgePaths.has(req.url)) return false;
  if (
    !loopbacks.has(req.ip) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)
  )
    throw fail('Extension phải chạy trên cùng máy với server.', 403);
  if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin))
    throw fail('Chỉ nhận từ extension.', 403);
  if (!['POST', 'OPTIONS'].includes(req.method)) throw fail('Phương thức không hợp lệ.', 405);
  if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json'))
    throw fail('Cần JSON.', 415);
  return true;
}
