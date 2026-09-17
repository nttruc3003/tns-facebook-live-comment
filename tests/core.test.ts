import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import { createApp } from '../server/app.js';
import {
  openStore,
  seedDemo,
  saveComments,
  streams,
  deleteStreamData,
  setting,
} from '../server/store.js';
import { Vault } from '../server/security.js';
import { evaluate, recordAnalysis, csvCell } from '../server/games.js';
import { defaultFilter, type Comment } from '../shared/types.js';
import { Facebook, parseFacebookVideo } from '../server/facebook.js';
import { AI } from '../server/ai.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tns-test-'));
  const db = openStore(directory);
  return {
    directory,
    db,
    close: async () => {
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('Single-port server serves the frontend root, assets and SPA routes without exposing protected APIs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-static-'));
  const clientDir = join(directory, 'client');
  await mkdir(clientDir);
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>TNS Studio</title>');
  await writeFile(join(clientDir, 'app.js'), 'window.studio=true;');
  const { app } = await createApp({
    directory: join(directory, 'data'),
    setupToken: 'static-test',
    collector: false,
    clientDir,
  });
  try {
    for (const url of ['/', '/history', '/app.js']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { host: 'localhost:3210' },
      });
      assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    }
    assert.equal(
      (await app.inject({ method: 'HEAD', url: '/', headers: { host: 'localhost:3210' } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/streams',
          headers: { host: 'localhost:3210' },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Gameshow counts distinct identities, excludes boundaries, replies, duplicates and missing identities', async () => {
  const f = await fixture();
  try {
    const id = seedDemo(f.db);
    const filter = { ...defaultFilter, startCommentId: `${id}-start`, endCommentId: `${id}-end` };
    const result = evaluate(f.db, id, filter, 'Admin', 'Round 1');
    assert.equal(result.commentCount, 21);
    assert.equal(result.count, 12);
    assert.equal(result.unknownAuthors, 1);
    assert.ok(
      result.matches.every(
        (c) =>
          c.createdAt >
          (f.db.prepare('SELECT createdAt FROM comments WHERE id=?').get(`${id}-start`) as Comment)
            .createdAt,
      ),
    );
    const rawCount = evaluate(f.db, id, { ...filter, distinctUsers: false }, 'Admin', 'Comments');
    assert.equal(rawCount.count, 21);
    const replies = evaluate(f.db, id, { ...filter, includeReplies: true }, 'Admin', 'Replies');
    assert.equal(replies.count, 13);
    const contains = evaluate(f.db, id, { ...filter, match: 'contains' }, 'Admin', 'Contains');
    assert.ok(contains.commentCount > result.commentCount);
    recordAnalysis(f.db, result);
    f.db
      .prepare("UPDATE comments SET message='changed',normalized='changed' WHERE streamId=?")
      .run(id);
    const snapshot = JSON.parse(
      (
        f.db.prepare('SELECT result FROM analysis_runs WHERE id=?').get(result.id) as {
          result: string;
        }
      ).result,
    );
    assert.equal(snapshot.matches[0].message.trim(), '5');
    assert.equal(snapshot.count, 12);
  } finally {
    await f.close();
  }
});
test('Markers must belong to same stream, same identified author, and increasing timestamps; ties reported', async () => {
  const f = await fixture();
  try {
    const id = seedDemo(f.db),
      other = seedDemo(f.db);
    const filter = { ...defaultFilter, startCommentId: `${id}-start`, endCommentId: `${id}-end` };
    assert.throws(
      () => evaluate(f.db, id, { ...filter, endCommentId: `${other}-end` }, 'A', 'R'),
      /không thuộc/,
    );
    assert.throws(
      () => evaluate(f.db, id, { ...filter, endCommentId: `${id}-late` }, 'A', 'R'),
      /cùng ID/,
    );
    assert.throws(
      () => evaluate(f.db, id, { ...filter, endCommentId: null }, 'A', 'R'),
      /đủ hai mốc/,
    );
    assert.throws(
      () =>
        evaluate(
          f.db,
          id,
          { ...filter, startCommentId: `${id}-end`, endCommentId: `${id}-start` },
          'A',
          'R',
        ),
      /phải trước/,
    );
    const c = f.db.prepare('SELECT * FROM comments WHERE id=?').get(`${id}-start`) as Comment;
    saveComments(f.db, [{ ...c, id: 'tie', authorId: 'other', isHost: 0, message: '5' }]);
    const result = evaluate(f.db, id, filter, 'A', 'R');
    assert.equal(result.boundaryTies, 1);
    assert.equal(result.count, 12);
  } finally {
    await f.close();
  }
});
test('Comment upserts are idempotent and survive database reopen', async () => {
  const f = await fixture();
  const id = seedDemo(f.db);
  const count = streams(f.db)[0].commentCount;
  const c = f.db.prepare('SELECT * FROM comments WHERE streamId=? LIMIT 1').get(id) as Comment;
  saveComments(f.db, [{ ...c, message: 'Edited' }]);
  assert.equal(streams(f.db)[0].commentCount, count);
  f.db.close();
  const reopened = openStore(f.directory);
  assert.equal(streams(reopened)[0].commentCount, count);
  assert.equal(
    (reopened.prepare('SELECT message FROM comments WHERE id=?').get(c.id) as Comment).message,
    'Edited',
  );
  reopened.close();
  await rm(f.directory, { recursive: true, force: true });
});
test('Deleting a livestream removes comments, analyses, pairings and capture credentials', async () => {
  const f = await fixture();
  try {
    const id = seedDemo(f.db);
    f.db
      .prepare('INSERT INTO users(id,username,name,role,password) VALUES (?,?,?,?,?)')
      .run('owner', 'owner', 'Owner', 'admin', 'test-password-hash');
    f.db
      .prepare(
        'INSERT INTO capture_pairings(streamId,userId,codeHash,encryptedCode,updatedAt) VALUES (?,?,?,?,?)',
      )
      .run(id, 'owner', 'code-hash', 'encrypted-code', Date.now());
    f.db
      .prepare(
        'INSERT INTO capture_devices(id,userId,extensionId,name,secretHash,expires,createdAt,streamId,captureId,pairedStreamId) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'device',
        'owner',
        'a'.repeat(32),
        'Chrome',
        'secret-hash',
        Date.now() + 10_000,
        Date.now(),
        id,
        'capture',
        id,
      );
    recordAnalysis(f.db, evaluate(f.db, id, defaultFilter, 'Owner', 'Kết quả'));

    assert.equal(deleteStreamData(f.db, id), true);
    for (const table of [
      'streams',
      'comments',
      'analysis_runs',
      'capture_pairings',
      'capture_devices',
    ]) {
      const count = (f.db.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number })
        .count;
      assert.equal(count, 0, table);
    }
    assert.equal(deleteStreamData(f.db, id), false);
  } finally {
    await f.close();
  }
});
test('Auth, bootstrap, CSRF, host checks and role permissions are enforced by backend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-auth-'));
  const { app } = await createApp({ directory, setupToken: 'test-setup-code', collector: false });
  const origin = { host: 'localhost:3210', origin: 'http://localhost:3210' };
  try {
    const setup = {
      username: 'admin',
      name: 'Admin',
      password: 'a-good-password-123',
      setupToken: 'test-setup-code',
    };
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/streams', headers: origin })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/setup',
          headers: origin,
          payload: { ...setup, setupToken: 'wrong' },
        })
      ).statusCode,
      403,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: origin,
      payload: setup,
    });
    assert.equal(res.statusCode, 200, res.body);
    const admin = {
      ...origin,
      cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': res.json().csrf,
    };
    assert.ok(res.headers['set-cookie']?.toString().includes('HttpOnly'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/demo',
          headers: { ...admin, 'x-csrf-token': 'wrong' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/demo',
          headers: { ...admin, origin: 'https://attacker.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/streams',
          headers: { ...admin, host: 'rebind.example:3210' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/%61pi/streams', headers: origin })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/demo', headers: admin })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/users',
          headers: admin,
          payload: {
            username: 'viewer',
            name: 'Viewer',
            password: 'viewer-password-123',
            role: 'viewer',
          },
        })
      ).statusCode,
      200,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { username: 'viewer', password: 'viewer-password-123' },
    });
    assert.equal(login.statusCode, 200, login.body);
    const viewer = {
      ...origin,
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': login.json().csrf,
    };
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/streams', headers: viewer })).statusCode,
      200,
    );
    for (const url of ['/api/settings/ai', '/api/facebook', '/api/users', '/api/system'])
      assert.equal(
        (await app.inject({ method: 'GET', url, headers: viewer })).statusCode,
        403,
        url,
      );
    for (const url of ['/api/demo', '/api/backup', '/api/facebook/connect'])
      assert.equal(
        (await app.inject({ method: 'POST', url, headers: viewer })).statusCode,
        403,
        url,
      );
    const streamId = (
      await app.inject({ method: 'GET', url: '/api/streams', headers: viewer })
    ).json()[0].id;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/streams/${streamId}/analyze`,
          headers: viewer,
          payload: { filter: defaultFilter, title: 'R' },
        })
      ).statusCode,
      403,
    );
    const analysis = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/analyze`,
      headers: admin,
      payload: { filter: defaultFilter, title: 'R' },
    });
    assert.equal(analysis.statusCode, 200, analysis.body);
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/streams/${streamId}`,
          headers: viewer,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/streams/${streamId}`,
          headers: admin,
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(
      (await app.inject({ method: 'GET', url: '/api/streams', headers: admin })).json(),
      [],
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/analyses/${analysis.json().id}`,
          headers: admin,
        })
      ).statusCode,
      404,
    );
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: viewer });
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/streams', headers: viewer })).statusCode,
      401,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('Facebook URL parsing does not fetch arbitrary hosts or silently accept share links', () => {
  assert.equal(parseFacebookVideo('https://www.facebook.com/tns/videos/123456789/'), '123456789');
  assert.equal(parseFacebookVideo('https://m.facebook.com/watch/?v=987654321'), '987654321');
  assert.throws(() => parseFacebookVideo('https://facebook.com.attacker.example/watch?v=1234567'));
  assert.throws(() => parseFacebookVideo('http://127.0.0.1/watch?v=1234567'));
  assert.throws(() => parseFacebookVideo('https://www.facebook.com/share/v/xyz'), /rút gọn/);
});
test('Facebook OAuth tokens stay encrypted; ownership verified; pagination retries deduplicate', async () => {
  const f = await fixture();
  try {
    let phase = 'oauth';
    let page = 0;
    const mock: typeof fetch = async (input) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith('/oauth/access_token'))
        return Response.json({ access_token: 'private-user-token' });
      if (u.pathname.endsWith('/me')) return Response.json({ id: '1234567', name: 'Owner' });
      if (u.pathname.endsWith('/me/accounts'))
        return Response.json({
          data: [{ id: '1111111', name: 'TNS', access_token: 'private-page-token' }],
        });
      if (u.pathname.endsWith('/comments')) {
        assert.equal(u.searchParams.get('live_filter'), 'no_filter');
        page++;
        return Response.json({
          data: [
            {
              id: 'c1',
              message: '5',
              created_time: '2026-09-10T10:00:00Z',
              from: { id: 'fan1', name: 'Fan' },
            },
          ],
          ...(page === 1
            ? {
                paging: {
                  next: 'https://graph.facebook.com/next?access_token=do-not-fetch-this',
                  cursors: { after: 'cursor-next' },
                },
              }
            : {}),
        });
      }
      return Response.json({
        id: '2222222',
        from: { id: phase === 'foreign' ? '9999999' : '1111111' },
        title: 'Live',
        live_status: 'LIVE',
        created_time: '2026-09-10T09:00:00Z',
      });
    };
    const fb = new Facebook(f.db, new Vault(f.directory), mock);
    fb.saveConfig({
      appId: '12345',
      appSecret: 'app-secret-123',
      version: 'v26.0',
      redirectUri: 'http://localhost:3210/api/facebook/callback',
      enableProfile: false,
    });
    await fb.exchangeCode('code');
    const stored = f.db.prepare('SELECT token FROM sources').get() as { token: string };
    assert.ok(!stored.token.includes('private-page-token'));
    phase = 'foreign';
    await assert.rejects(() => fb.importVideo('1111111', '2222222'), /Không xác minh/);
    phase = 'owned';
    const id = await fb.importVideo('1111111', '2222222');
    f.db.prepare('UPDATE streams SET collecting=1 WHERE id=?').run(id);
    await fb.readComments(id);
    assert.equal(
      (f.db.prepare('SELECT cursor FROM streams WHERE id=?').get(id) as { cursor: string }).cursor,
      'cursor-next',
    );
    await fb.readComments(id);
    assert.equal(streams(f.db)[0].commentCount, 1);
    assert.equal(
      (f.db.prepare('SELECT cursor FROM streams WHERE id=?').get(id) as { cursor: null }).cursor,
      null,
    );
    fb.disconnect();
    assert.equal(streams(f.db)[0].collecting, 0);
    assert.equal(streams(f.db)[0].commentCount, 1);
  } finally {
    await f.close();
  }
});
test('AI sends only request and marker context; validates JSON and clears credentials on provider changes', async () => {
  const f = await fixture();
  try {
    const id = seedDemo(f.db);
    let payload: any;
    let invalid = false;
    const mock: typeof fetch = async (_url, opts) => {
      payload = JSON.parse(String(opts?.body));
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(
                  invalid ? { ...defaultFilter, sql: 'DROP TABLE comments' } : defaultFilter,
                ),
              },
            ],
          },
        ],
      });
    };
    const ai = new AI(f.db, new Vault(f.directory), mock);
    ai.save({
      provider: 'openai',
      model: 'gpt-5.4-nano',
      apiKey: 'secret-key-123',
      persist: false,
    });
    assert.equal(setting(f.db, 'aiKey'), undefined);
    const plan = await ai.plan('Đếm người comment số 5', id);
    assert.equal(plan.text, '5');
    assert.equal(payload.store, false);
    assert.ok(!payload.input.includes('Có ship không shop'));
    invalid = true;
    await assert.rejects(() => ai.plan('Count', id), /hợp lệ/);
    ai.save({ provider: 'gemini', model: 'gemini-3.1-flash-lite', persist: false });
    assert.equal(ai.config().hasKey, false);
    ai.save({ provider: 'openai', model: 'gpt-5.4-nano', apiKey: 'secret-key-123', persist: true });
    assert.ok(!setting(f.db, 'aiKey')!.includes('secret-key-123'));
    ai.clear();
    assert.equal(ai.config().hasKey, false);
  } finally {
    await f.close();
  }
});
test('CSV export protects spreadsheet formula cells', () => {
  assert.equal(csvCell('=WEBSERVICE("bad")'), '"\'=WEBSERVICE(""bad"")"');
  assert.equal(csvCell('5'), '"5"');
  assert.equal(csvCell('Hi, TNS'), '"Hi, TNS"');
});

test('SSE stays open, delivers changes and closes when logout revokes the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-sse-'));
  const { app } = await createApp({ directory, setupToken: 'sse-setup', collector: false });
  const abort = new AbortController();
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const setup = await fetch(origin + '/api/auth/setup', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'test-password-123',
        name: 'Admin',
        setupToken: 'sse-setup',
      }),
    });
    const session = (await setup.json()) as { csrf: string };
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const headers = {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': session.csrf,
      'Content-Type': 'application/json',
    };
    const events = await fetch(origin + '/api/events', { headers, signal: abort.signal });
    assert.equal(events.status, 200);
    const reader = events.body!.getReader();
    const first = await reader.read();
    assert.ok(new TextDecoder().decode(first.value).includes('event: ready'));
    await fetch(origin + '/api/demo', { method: 'POST', headers, body: '{}' });
    const event = await reader.read();
    assert.ok(new TextDecoder().decode(event.value).includes('event: refresh'));
    await fetch(origin + '/api/auth/logout', { method: 'POST', headers, body: '{}' });
    assert.equal((await reader.read()).done, true);
  } finally {
    abort.abort();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Restore keeps prior data recoverable, restores comments and invalidates sensitive sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-restore-'));
  const sourceDir = join(directory, 'source');
  const targetDir = join(directory, 'target');
  const source = openStore(sourceDir);
  const id = seedDemo(source);
  source
    .prepare('INSERT INTO users(id,username,name,role,password) VALUES (?,?,?,?,?)')
    .run('restore-user', 'restore-user', 'Restore User', 'admin', 'not-a-real-password');
  source
    .prepare(
      'INSERT INTO capture_pairings(streamId,userId,codeHash,encryptedCode,updatedAt) VALUES (?,?,?,?,?)',
    )
    .run(id, 'restore-user', 'test-code-hash', 'test-encrypted-code', Date.now());
  source
    .prepare(
      'INSERT INTO capture_devices(id,userId,extensionId,name,secretHash,expires,createdAt,pairedStreamId) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'restore-device',
      'restore-user',
      'a'.repeat(32),
      'Restore Device',
      'test-device-hash',
      Date.now() + 10000,
      Date.now(),
      id,
    );
  const backup = join(directory, 'backup.sqlite');
  await source.backup(backup);
  source.close();
  const old = openStore(targetDir);
  seedDemo(old);
  old.close();
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/restore.ts', backup], {
      env: { ...process.env, DATA_DIR: targetDir },
    });
    const restored = openStore(targetDir);
    assert.equal(streams(restored)[0].id, id);
    assert.equal((restored.prepare('SELECT count(*) n FROM sessions').get() as { n: number }).n, 0);
    assert.equal(
      (restored.prepare('SELECT count(*) n FROM capture_pairings').get() as { n: number }).n,
      0,
    );
    assert.equal(
      (restored.prepare('SELECT count(*) n FROM capture_devices').get() as { n: number }).n,
      0,
    );
    restored.close();
    const archive = readdirSync(targetDir).find((n) => n.startsWith('restore-before-'))!;
    assert.ok(existsSync(join(targetDir, archive, 'studio.sqlite')));
    assert.ok(!existsSync(join(targetDir, 'studio.lock')));
    await assert.rejects(() =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'server/restore.ts', join(directory, 'not-a-backup')],
        { env: { ...process.env, DATA_DIR: targetDir } },
      ),
    );
    const unchanged = openStore(targetDir);
    assert.equal(streams(unchanged)[0].id, id);
    unchanged.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
