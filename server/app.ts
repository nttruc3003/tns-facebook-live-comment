import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  openStore,
  seedDemo,
  streams,
  stream,
  deleteStreamData,
  setting,
  type Store,
} from './store.js';
import { Vault, hash, token, passwordHash, passwordMatches } from './security.js';
import { Facebook, FacebookError } from './facebook.js';
import { AI } from './ai.js';
import { captureBridgeRequest, registerCapture } from './capture.js';
import { evaluate, recordAnalysis, commentsCsv } from './games.js';
import {
  filterSchema,
  type User,
  type Comment,
  type Analysis,
  type Role,
} from '../shared/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    studioUser: User | null;
    studioSession: { id: string; csrf: string; expires: number } | null;
  }
}
export type AppOptions = {
  directory: string;
  setupToken: string;
  port?: number;
  host?: string;
  allowedHosts?: string[];
  tls?: { cert: Buffer; key: Buffer };
  collector?: boolean;
  legacyFacebook?: boolean;
  request?: typeof fetch;
  clientDir?: string;
};
const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,40}$/),
  password: z.string().min(10).max(128),
});
const profile = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(['admin', 'operator', 'viewer']),
});
const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
function requireRole(req: FastifyRequest, ...roles: Role[]) {
  if (!req.studioUser) throw fail('Bạn cần đăng nhập.', 401);
  if (!roles.includes(req.studioUser.role))
    throw fail('Tài khoản không có quyền thực hiện thao tác này.', 403);
  return req.studioUser;
}
const parseId = (req: FastifyRequest) =>
  z.object({ id: z.string().min(1).max(200) }).parse(req.params).id;
const expectedError = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ZodError) throw e;
    throw fail(e instanceof Error ? e.message : 'Thao tác không thành công.');
  }
};

export async function createApp(options: AppOptions) {
  const db = openStore(options.directory);
  const vault = new Vault(options.directory);
  const fb = new Facebook(db, vault, options.request);
  if (!options.legacyFacebook)
    db.prepare("UPDATE streams SET collecting=0 WHERE kind='facebook'").run();
  const ai = new AI(db, vault, options.request);
  const app = Fastify({
    logger: false,
    bodyLimit: 32_768,
    ...(options.tls ? { https: options.tls } : {}),
  });
  const clients = new Set<{ output: PassThrough; sessionId: string }>();
  const notify = (kind = 'refresh', streamId?: string) => {
    for (const client of clients) {
      if (client.output.writableLength > 256_000) {
        client.output.destroy();
        clients.delete(client);
      } else client.output.write(`event: refresh\ndata: ${JSON.stringify({ kind, streamId })}\n\n`);
    }
  };
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(options.allowedHosts || [])]);
  for (const list of Object.values(networkInterfaces()))
    for (const item of list || [])
      hosts.add(item.family === 'IPv6' ? `[${item.address}]` : item.address);
  const sessionAge = 12 * 60 * 60 * 1000;
  const dummyPassword = await passwordHash(token());
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest('studioUser', null);
  app.decorateRequest('studioSession', null);
  app.addHook('onRequest', async (req, reply) => {
    const rawPath = req.url.split('?')[0];
    if (
      rawPath.includes('%') ||
      rawPath.includes('\\') ||
      rawPath.includes('//') ||
      rawPath.split('/').some((part) => part === '.' || part === '..')
    )
      throw fail('URL không hợp lệ.', 400);
    let host: URL;
    try {
      host = new URL(`http://${req.headers.host}`);
    } catch {
      throw fail('Host không hợp lệ.', 403);
    }
    if (!hosts.has(host.hostname))
      throw fail(
        'Hostname chưa được cho phép. Dùng IP LAN của máy chủ hoặc cấu hình ALLOWED_HOSTS.',
        403,
      );
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.fbcdn.net https://*.fbsbx.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (captureBridgeRequest(req)) {
      if (req.headers.origin)
        reply.header('Access-Control-Allow-Origin', req.headers.origin).header('Vary', 'Origin');
      if (req.method === 'OPTIONS')
        return reply
          .header('Access-Control-Allow-Methods', 'POST')
          .header('Access-Control-Allow-Headers', 'content-type,authorization')
          .code(204)
          .send();
      return;
    }
    if (req.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        throw fail('Origin không hợp lệ.', 403);
      }
      if (
        origin.host !== req.headers.host ||
        origin.protocol !== (options.tls ? 'https:' : 'http:')
      )
        throw fail('Yêu cầu khác nguồn bị từ chối.', 403);
    }
    if (
      req.headers['sec-fetch-site'] === 'cross-site' &&
      !req.url.startsWith('/api/facebook/callback')
    )
      throw fail('Yêu cầu khác nguồn bị từ chối.', 403);
    const sessionToken = req.cookies.tns_session;
    if (sessionToken && /^[a-f0-9]{64}$/.test(sessionToken)) {
      const session = db
        .prepare(
          'SELECT s.id,s.csrf,s.expires,u.id userId,u.username,u.name,u.role FROM sessions s JOIN users u ON s.userId=u.id WHERE s.id=? AND s.expires>?',
        )
        .get(hash(sessionToken), Date.now()) as
        | {
            id: string;
            csrf: string;
            expires: number;
            userId: string;
            username: string;
            name: string;
            role: Role;
          }
        | undefined;
      if (session) {
        req.studioSession = { id: session.id, csrf: session.csrf, expires: session.expires };
        req.studioUser = {
          id: session.userId,
          name: session.name,
          username: session.username,
          role: session.role,
        };
      }
    }
    const path = req.url.split('?')[0];
    if (
      !['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup'].includes(path) &&
      !req.studioUser
    )
      throw fail('Phiên đăng nhập đã hết hạn.', 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.headers.origin) throw fail('Thiếu Origin cho thao tác thay đổi dữ liệu.', 403);
      if (req.studioSession && req.headers['x-csrf-token'] !== req.studioSession.csrf)
        throw fail('Phiên bảo vệ đã đổi. Tải lại trang rồi thử lại.', 403);
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Dữ liệu không hợp lệ.',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const issue = error as { statusCode?: number; code?: string; message: string };
    const status = issue.statusCode || 500;
    if (status >= 500) app.log.error({ message: 'Internal server error', code: issue.code });
    return reply.code(status).send({
      error:
        status >= 500
          ? 'Có lỗi máy chủ. Thử lại hoặc kiểm tra dữ liệu/cấu hình trên máy chủ.'
          : issue.message,
    });
  });
  const sessionFor = (user: User, reply: any) => {
    const key = token(),
      csrf = token();
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions(id,userId,csrf,expires) VALUES (?,?,?,?)').run(
      hash(key),
      user.id,
      csrf,
      Date.now() + sessionAge,
    );
    reply.setCookie('tns_session', key, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: !!options.tls,
      maxAge: sessionAge / 1000,
    });
    return { user, csrf };
  };
  registerCapture(app, db, vault, notify, (req) => requireRole(req, 'admin', 'operator'));
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/auth/status', async () => ({
    needsSetup: !db.prepare('SELECT 1 FROM users LIMIT 1').get(),
  }));
  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (db.prepare('SELECT 1 FROM users LIMIT 1').get())
        throw fail('Máy chủ đã được thiết lập.', 409);
      const data = credentials
        .extend({ name: profile.shape.name, setupToken: z.string() })
        .parse(req.body);
      if (hash(data.setupToken) !== hash(options.setupToken))
        throw fail('Mã thiết lập không đúng. Xem terminal trên máy chủ.', 403);
      const password = await passwordHash(data.password);
      const user: User = {
        id: randomUUID(),
        username: data.username,
        name: data.name,
        role: 'admin',
      };
      db.transaction(() => {
        if (db.prepare('SELECT 1 FROM users LIMIT 1').get())
          throw fail('Máy chủ vừa được thiết lập.', 409);
        db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(
          user.id,
          user.username,
          user.name,
          user.role,
          password,
        );
      })();
      return sessionFor(user, reply);
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const data = credentials.parse(req.body);
      const row = db.prepare('SELECT * FROM users WHERE username=?').get(data.username) as
        (User & { password: string }) | undefined;
      const matches = await passwordMatches(data.password, row?.password ?? dummyPassword);
      if (!row || !matches) throw fail('Tên đăng nhập hoặc mật khẩu không đúng.', 401);
      return sessionFor(
        { id: row.id, name: row.name, username: row.username, role: row.role },
        reply,
      );
    },
  );
  app.get('/api/auth/session', async (req) => ({
    user: req.studioUser,
    csrf: req.studioSession!.csrf,
  }));
  app.post('/api/auth/logout', async (req, reply) => {
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.studioSession!.id);
    for (const client of clients)
      if (client.sessionId === req.studioSession!.id) client.output.end();
    reply.clearCookie('tns_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/users', async (req) => {
    requireRole(req, 'admin');
    return db.prepare('SELECT id,name,username,role FROM users ORDER BY name').all();
  });
  app.post('/api/users', async (req) => {
    requireRole(req, 'admin');
    const data = credentials.merge(profile).parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(data.username))
      throw fail('Tên đăng nhập đã tồn tại.', 409);
    const id = randomUUID();
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(
      id,
      data.username,
      data.name,
      data.role,
      await passwordHash(data.password),
    );
    return { id };
  });
  app.delete('/api/users/:id', async (req) => {
    const user = requireRole(req, 'admin');
    const id = parseId(req);
    if (id === user.id) throw fail('Không thể xóa tài khoản đang sử dụng.');
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    notify();
    return { ok: true };
  });
  app.get('/api/system', async (req) => {
    requireRole(req, 'admin');
    return {
      port: options.port || 3210,
      secure: !!options.tls,
      urls: [...hosts]
        .filter((h) => h !== '[::1]' && !h.includes('%'))
        .map((h) => `${options.tls ? 'https' : 'http'}://${h}:${options.port || 3210}`),
      database: 'SQLite · WAL',
      version: '0.1.0',
    };
  });
  app.get('/api/streams', async () => streams(db));
  app.delete('/api/streams/:id', async (req) => {
    requireRole(req, 'admin', 'operator');
    const id = parseId(req);
    if (!stream(db, id)) throw fail('Không tìm thấy livestream.', 404);
    if (!deleteStreamData(db, id)) throw fail('Không thể xóa livestream.', 409);
    notify('stream-deleted', id);
    return { ok: true };
  });
  app.post('/api/demo', async (req) => {
    requireRole(req, 'admin', 'operator');
    const id = seedDemo(db);
    notify();
    return { id };
  });
  app.get('/api/streams/:id/comments', async (req) => {
    const id = parseId(req);
    if (!stream(db, id)) throw fail('Không tìm thấy livestream.', 404);
    const query = z
      .object({
        q: z.string().max(200).default(''),
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(80),
      })
      .parse(req.query);
    const clauses = ['streamId=@id', 'deleted=0'];
    const params: Record<string, string | number> = { id, limit: query.limit + 1 };
    if (query.before) {
      clauses.push('seq<@before');
      params.before = query.before;
    }
    if (query.q) {
      clauses.push('(instr(lower(message),lower(@q))>0 OR instr(lower(authorName),lower(@q))>0)');
      params.q = query.q;
    }
    const rows = db
      .prepare(
        `SELECT * FROM comments WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT @limit`,
      )
      .all(params) as Comment[];
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, more, nextBefore: more ? items.at(-1)?.seq : null };
  });
  app.get('/api/streams/:id/comments/range', async (req) => {
    const id = parseId(req);
    const live = stream(db, id);
    if (!live) throw fail('Không tìm thấy livestream.', 404);
    const query = z
      .object({ start: z.string().min(1).max(200), end: z.string().min(1).max(200) })
      .parse(req.query);
    const boundary = db.prepare(
      'SELECT id,seq,createdAt FROM comments WHERE streamId=? AND id=? AND deleted=0',
    );
    const start = boundary.get(id, query.start) as
      { id: string; seq: number; createdAt: number } | undefined;
    const end = boundary.get(id, query.end) as
      { id: string; seq: number; createdAt: number } | undefined;
    if (!start || !end) throw fail('Mốc không thuộc livestream này hoặc đã bị xóa.');
    const browser = live.kind === 'browser';
    const ordered = browser
      ? start.seq < end.seq
      : start.createdAt < end.createdAt ||
        (start.createdAt === end.createdAt && start.seq < end.seq);
    if (!ordered) throw fail('Comment bắt đầu phải nằm trước comment kết thúc.');
    return db
      .prepare(
        browser
          ? `SELECT * FROM comments WHERE streamId=? AND deleted=0 AND seq>? AND seq<? ORDER BY seq`
          : `SELECT * FROM comments WHERE streamId=? AND deleted=0
             AND (createdAt>? OR (createdAt=? AND seq>?))
             AND (createdAt<? OR (createdAt=? AND seq<?)) ORDER BY createdAt,seq`,
      )
      .all(
        ...(browser
          ? [id, start.seq, end.seq]
          : [
              id,
              start.createdAt,
              start.createdAt,
              start.seq,
              end.createdAt,
              end.createdAt,
              end.seq,
            ]),
      );
  });
  app.post('/api/streams/:id/comment-number', async (req) => {
    requireRole(req, 'admin', 'operator');
    const id = parseId(req);
    if (!stream(db, id)) throw fail('Không tìm thấy livestream.', 404);
    const data = z
      .object({
        commentId: z.string().min(1).max(200),
        field: z.enum(['firstNumber', 'secondNumber']),
        value: z.string().trim().max(30),
      })
      .strict()
      .parse(req.body);
    const result = db
      .prepare(`UPDATE comments SET ${data.field}=? WHERE streamId=? AND id=? AND deleted=0`)
      .run(data.value || null, id, data.commentId);
    if (result.changes !== 1) throw fail('Comment không tồn tại hoặc đã bị xóa.', 404);
    notify('comments', id);
    return { ok: true, value: data.value || null };
  });
  app.get('/api/streams/:id/markers', async (req) =>
    db
      .prepare(
        "SELECT * FROM comments WHERE streamId=? AND deleted=0 AND (isHost=1 OR normalized IN ('bắt đầu','kết thúc','bat dau','ket thuc')) ORDER BY createdAt,seq LIMIT 500",
      )
      .all(parseId(req)),
  );
  app.post('/api/streams/:id/collect', async (req) => {
    requireRole(req, 'admin', 'operator');
    const id = parseId(req);
    const data = z.object({ enabled: z.boolean() }).parse(req.body);
    const live = stream(db, id);
    if (!live) throw fail('Không tìm thấy livestream.', 404);
    if (live.kind === 'demo')
      throw fail('Phiên demo là dữ liệu mẫu đã lưu, không phải kết nối Facebook.');
    if (live.kind === 'facebook' && data.enabled && !options.legacyFacebook)
      throw fail('Luồng Graph API cũ đã tắt. Dùng extension để chọn tab livestream.');
    if (live.kind === 'browser' && data.enabled)
      throw fail('Bắt đầu ghi từ extension trên tab livestream.');
    if (data.enabled) await expectedError(() => fb.source(live.sourceId!));
    db.prepare('UPDATE streams SET collecting=?,nextPoll=0,failures=0,error=NULL WHERE id=?').run(
      data.enabled ? 1 : 0,
      id,
    );
    notify();
    return { ok: true };
  });
  app.get('/api/streams/:id/export', async (req, reply) => {
    const id = parseId(req);
    if (!stream(db, id)) throw fail('Không tìm thấy phiên.', 404);
    const rows = db
      .prepare('SELECT * FROM comments WHERE streamId=? ORDER BY createdAt,seq')
      .all(id) as Comment[];
    return reply
      .header('Content-Disposition', `attachment; filename="comments-${id}.csv"`)
      .type('text/csv; charset=utf-8')
      .send(commentsCsv(rows));
  });
  app.post('/api/streams/:id/analyze', async (req) => {
    const user = requireRole(req, 'admin', 'operator');
    const id = parseId(req);
    const data = z
      .object({ filter: filterSchema, title: z.string().trim().min(1).max(120) })
      .parse(req.body);
    const result = await expectedError(() => evaluate(db, id, data.filter, user.name, data.title));
    recordAnalysis(db, result);
    notify('analysis', id);
    return result;
  });
  app.get('/api/analyses', async () =>
    db
      .prepare(
        "SELECT id,streamId,title,createdAt,createdBy,json_extract(result,'$.count') count,json_extract(result,'$.provisional') provisional FROM analysis_runs ORDER BY createdAt DESC LIMIT 200",
      )
      .all(),
  );
  app.get('/api/analyses/:id', async (req) => {
    const row = db.prepare('SELECT result FROM analysis_runs WHERE id=?').get(parseId(req)) as
      { result: string } | undefined;
    if (!row) throw fail('Không tìm thấy kết quả.', 404);
    return JSON.parse(row.result);
  });
  app.get('/api/analyses/:id/export', async (req, reply) => {
    const row = db.prepare('SELECT result FROM analysis_runs WHERE id=?').get(parseId(req)) as
      { result: string } | undefined;
    if (!row) throw fail('Không tìm thấy kết quả.', 404);
    const result = JSON.parse(row.result) as Analysis;
    return reply
      .header('Content-Disposition', `attachment; filename="result-${result.id}.csv"`)
      .type('text/csv; charset=utf-8')
      .send(commentsCsv(result.matches));
  });
  app.get('/api/settings/ai', async (req) => {
    requireRole(req, 'admin');
    return ai.config();
  });
  app.put('/api/settings/ai', async (req) => {
    requireRole(req, 'admin');
    await expectedError(() => ai.save(req.body));
    return ai.config();
  });
  app.delete('/api/settings/ai/key', async (req) => {
    requireRole(req, 'admin');
    ai.clear();
    return { ok: true };
  });
  const aiBusy = new Set<string>();
  app.post(
    '/api/streams/:id/ai-plan',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireRole(req, 'admin', 'operator');
      const id = parseId(req);
      if (!stream(db, id)) throw fail('Không tìm thấy livestream.', 404);
      const { prompt } = z.object({ prompt: z.string().trim().min(3).max(2000) }).parse(req.body);
      if (aiBusy.has(user.id)) throw fail('Yêu cầu AI trước đang xử lý.', 409);
      aiBusy.add(user.id);
      try {
        return { filter: await expectedError(() => ai.plan(prompt, id)) };
      } finally {
        aiBusy.delete(user.id);
      }
    },
  );
  app.get('/api/facebook', async (req) => {
    requireRole(req, 'admin');
    const config = fb.config();
    const user = setting(db, 'facebookUser');
    return {
      configured: !!config,
      config: config
        ? {
            appId: config.appId,
            version: config.version,
            redirectUri: config.redirectUri,
            enableProfile: config.enableProfile,
          }
        : null,
      user: user ? JSON.parse(user) : null,
      sources: fb.sources(),
    };
  });
  app.put('/api/facebook/config', async (req) => {
    requireRole(req, 'admin');
    await expectedError(() => fb.saveConfig(req.body));
    notify();
    return { ok: true };
  });
  app.post('/api/facebook/connect', async (req) => {
    requireRole(req, 'admin');
    const cfg = fb.config();
    if (!cfg) throw fail('Cấu hình Meta App trước khi kết nối.');
    if (new URL(cfg.redirectUri).host !== req.headers.host)
      throw fail(
        `Hãy mở app trên máy chủ tại ${new URL(cfg.redirectUri).origin}, đăng nhập và kết nối Facebook ở đó để callback dùng đúng phiên.`,
      );
    const state = token();
    db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO oauth_states VALUES (?,?,?)').run(
      hash(state),
      req.studioSession!.id,
      Date.now() + 10 * 60_000,
    );
    const url = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: cfg.appId,
      redirect_uri: cfg.redirectUri,
      state,
      response_type: 'code',
      scope: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        ...(cfg.enableProfile ? ['user_videos', 'user_posts'] : []),
      ].join(','),
    }).toString();
    return { url: url.toString() };
  });
  app.get('/api/facebook/callback', async (req, reply) => {
    requireRole(req, 'admin');
    const query = z
      .object({
        state: z.string().min(32).max(200),
        code: z.string().max(4096).optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const state = db
      .prepare('SELECT * FROM oauth_states WHERE state=? AND sessionId=? AND expires>?')
      .get(hash(query.state), req.studioSession!.id, Date.now());
    if (!state)
      throw fail('Phiên kết nối không hợp lệ hoặc hết hạn. Bắt đầu lại trong Cài đặt.', 403);
    db.prepare('DELETE FROM oauth_states WHERE state=?').run(hash(query.state));
    if (query.error || !query.code) return reply.redirect('/?facebook=cancelled');
    await expectedError(() => fb.exchangeCode(query.code!));
    notify();
    return reply.redirect('/?facebook=connected');
  });
  app.delete('/api/facebook', async (req) => {
    requireRole(req, 'admin');
    fb.disconnect();
    notify();
    return { ok: true };
  });
  app.get('/api/sources', async () => fb.sources());
  app.post('/api/sources/:id/discover', async (req) => {
    requireRole(req, 'admin', 'operator');
    const result = await expectedError(() => fb.discover(parseId(req)));
    notify();
    return result;
  });
  app.post('/api/streams/import', async (req) => {
    requireRole(req, 'admin', 'operator');
    const { sourceId, url } = z
      .object({ sourceId: z.string().min(1).max(100), url: z.string().min(1).max(2000) })
      .parse(req.body);
    const id = await expectedError(() => fb.importVideo(sourceId, url));
    notify();
    return { id };
  });
  app.post('/api/backup', async (req, reply) => {
    requireRole(req, 'admin');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { createReadStream } = await import('node:fs');
    const folder = await mkdtemp(join(tmpdir(), 'tns-backup-'));
    const file = join(folder, 'studio.sqlite');
    try {
      await db.backup(file);
      const output = createReadStream(file);
      output.on('close', () => {
        void rm(folder, { recursive: true, force: true });
      });
      return reply
        .header('Content-Disposition', 'attachment; filename="tns-studio-backup.sqlite"')
        .type('application/octet-stream')
        .send(output);
    } catch (e) {
      await rm(folder, { recursive: true, force: true });
      throw e;
    }
  });
  app.get('/api/events', async (req, reply) => {
    if (clients.size >= 100) throw fail('Máy chủ đã đạt giới hạn 100 kết nối realtime.', 429);
    const output = new PassThrough();
    const client = { output, sessionId: req.studioSession!.id };
    clients.add(client);
    reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('Connection', 'keep-alive')
      .header('X-Accel-Buffering', 'no');
    output.write('retry: 2500\nevent: ready\ndata: {}\n\n');
    const heartbeat = setInterval(() => {
      if (
        !db
          .prepare('SELECT 1 FROM sessions WHERE id=? AND expires>?')
          .get(client.sessionId, Date.now())
      ) {
        output.end();
        return;
      }
      output.write(': heartbeat\n\n');
    }, 15_000);
    const close = () => {
      clearInterval(heartbeat);
      clients.delete(client);
      output.destroy();
    };
    req.raw.on('close', close);
    output.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
    return reply.send(output);
  });
  const clientDir = options.clientDir ?? resolve('dist/client');
  if (existsSync(join(clientDir, 'index.html'))) {
    await app.register(staticFiles, { root: clientDir, prefix: '/', index: 'index.html' });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Không tìm thấy API.' })
        : reply.type('text/html').send(readFileSync(join(clientDir, 'index.html'))),
    );
  }
  let closing = false;
  let current: Promise<void> | undefined;
  const tick = async () => {
    if (!options.legacyFacebook) return;
    const rows = db
      .prepare(
        "SELECT id FROM streams WHERE collecting=1 AND kind='facebook' AND nextPoll<=? LIMIT 4",
      )
      .all(Date.now()) as { id: string }[];
    for (const row of rows) {
      if (closing) break;
      try {
        await fb.readComments(row.id);
        notify('comments', row.id);
      } catch (error) {
        if (closing) break;
        const failures =
          (
            db.prepare('SELECT failures FROM streams WHERE id=?').get(row.id) as {
              failures: number;
            }
          ).failures + 1;
        const revoked = error instanceof FacebookError && error.code === 190;
        const cursorInvalid = error instanceof FacebookError && error.code === 100;
        const message =
          error instanceof FacebookError
            ? error.message
            : 'Đồng bộ bị gián đoạn. App sẽ thử lại; dữ liệu hiện tại có thể thiếu.';
        db.prepare(
          'UPDATE streams SET error=?,failures=?,nextPoll=?,collecting=CASE WHEN ? THEN 0 ELSE collecting END,cursor=CASE WHEN ? THEN NULL ELSE cursor END WHERE id=?',
        ).run(
          message,
          failures,
          Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures, 6)),
          revoked ? 1 : 0,
          cursorInvalid ? 1 : 0,
          row.id,
        );
        notify('error', row.id);
      }
    }
  };
  const timer =
    options.collector === false
      ? undefined
      : setInterval(() => {
          if (!current && !closing) {
            current = tick().finally(() => {
              current = undefined;
            });
          }
        }, 1000);
  timer?.unref();
  app.addHook('preClose', async () => {
    closing = true;
    if (timer) clearInterval(timer);
    for (const client of clients) client.output.end();
    await current;
  });
  app.addHook('onClose', async () => {
    db.close();
  });
  return { app, db, fb, ai, notify };
}
