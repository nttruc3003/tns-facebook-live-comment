import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

test('Collect discovery requires dashboard approval; ordered durable uploads survive pause, retry and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-sources-'));
  let { app, db } = await createApp({ directory, setupToken: 'test', collector: false });
  const origin = { host: 'localhost:3210', origin: 'http://localhost:3210' };
  const ext = {
    host: 'localhost:3210',
    origin: `chrome-extension://${'a'.repeat(32)}`,
    authorization: `Bearer ${'b'.repeat(64)}`,
  };
  const id = randomUUID();
  const announcement = {
    id,
    url: 'https://www.facebook.com/watch/?v=42',
    title: 'Test live',
    name: 'Chrome Main',
    startedAt: Date.now(),
    running: true,
    pending: 3,
    firstSeq: 1,
  };
  const announce = (body = announcement, headers = ext) =>
    app.inject({ method: 'POST', url: '/api/capture/bridge/announce', headers, payload: body });
  const comments = [1, 2, 3].map((n) => ({
    id: `fb:${n}`,
    authorName: 'Test',
    authorUrl: 'https://www.facebook.com/test.user',
    message: n === 1 ? 'Bắt đầu' : n === 3 ? 'Kết thúc' : '05',
    observedAt: Date.now() - 3 * 86400_000 + n,
    parentId: null,
  }));
  const upload = (fromSeq = 1, data = comments, headers = ext) =>
    app.inject({
      method: 'POST',
      url: '/api/capture/bridge/upload',
      headers,
      payload: { id, fromSeq, comments: data },
    });
  try {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: origin,
      payload: {
        username: 'admin',
        name: 'Admin',
        password: 'test-password-123',
        setupToken: 'test',
      },
    });
    const admin = {
      ...origin,
      cookie: setup.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': setup.json().csrf,
    };
    const select = (source = id, headers: Record<string, string> = admin, title?: string) =>
      app.inject({
        method: 'POST',
        url: `/api/capture/sources/${source}/select`,
        headers,
        payload: title === undefined ? {} : { title },
      });
    assert.equal(
      (await announce(announcement, { ...ext, origin: 'https://evil.example' })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/announce',
          headers: ext,
          remoteAddress: '192.168.1.2',
          payload: announcement,
        })
      ).statusCode,
      403,
    );
    const discovered = await announce();
    assert.equal(discovered.statusCode, 200, discovered.body);
    assert.equal(discovered.json().enabled, false);
    assert.equal((await upload()).statusCode, 403);
    assert.equal((db.prepare('SELECT count(*) n FROM streams').get() as any).n, 0);
    const listed = await app.inject({ method: 'GET', url: '/api/capture/sources', headers: admin });
    assert.equal(listed.json().sources[0].pending, 3);
    assert.ok(!listed.body.includes('secretHash'));
    assert.equal((await select(id, origin)).statusCode, 401);
    assert.equal((await select(id, admin, 'x'.repeat(201))).statusCode, 400);
    const selected = await select(id, admin, '  Live bán hàng tối thứ Sáu  ');
    assert.equal(selected.statusCode, 200, selected.body);
    const streamId = selected.json().streamId;
    const details = await app.inject({ method: 'GET', url: '/api/streams', headers: admin });
    assert.equal(details.json()[0].capturePending, 3);
    assert.equal(details.json()[0].error, null);
    assert.equal(details.json()[0].title, 'Live bán hàng tối thứ Sáu');
    assert.equal((await announce()).json().enabled, true);
    assert.equal((await upload(2, [comments[1]])).statusCode, 409);
    assert.equal(
      (await upload(1, comments, { ...ext, authorization: `Bearer ${'c'.repeat(64)}` })).statusCode,
      403,
    );
    const uploaded = await upload();
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    assert.equal(uploaded.json().ackSeq, 3);
    assert.equal((await upload()).json().ackSeq, 3);
    const rows = db.prepare('SELECT * FROM comments ORDER BY seq').all() as any[];
    assert.deepEqual(
      rows.map((c) => c.id),
      ['fb:1', 'fb:2', 'fb:3'],
    );
    assert.equal(
      (await announce({ ...announcement, url: 'https://www.facebook.com/watch/?v=99' })).statusCode,
      409,
    );
    const second = { ...announcement, id: randomUUID() };
    await announce(second);
    assert.equal((await select(second.id)).statusCode, 409);
    await app.close();
    ({ app, db } = await createApp({ directory, setupToken: 'test', collector: false }));
    assert.equal((await announce()).json().enabled, true);
    assert.equal((await announce()).json().ackSeq, 3);
    // Stopping collection does not revoke permission to drain a durable outbox.
    await announce({ ...announcement, running: false, pending: 1 });
    assert.equal((await upload(4, [{ ...comments[0], id: 'fb:4' }])).json().ackSeq, 4);
    const pause = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/collect`,
      headers: admin,
      payload: { enabled: false },
    });
    assert.equal(pause.statusCode, 200, pause.body);
    assert.equal((await upload(5, [{ ...comments[0], id: 'fb:5' }])).statusCode, 403);
    assert.equal((await announce()).json().enabled, false);
    assert.equal((await select()).json().streamId, streamId);
    const resumed = await app.inject({ method: 'GET', url: '/api/streams', headers: admin });
    assert.equal(resumed.json()[0].title, 'Live bán hàng tối thứ Sáu');
    assert.equal((await upload(5, [{ ...comments[0], id: 'fb:5' }])).json().ackSeq, 5);
    // Viewer cannot approve a source even when discovery is visible on the machine.
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: {
        username: 'viewer',
        name: 'Viewer',
        password: 'test-password-123',
        role: 'viewer',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { username: 'viewer', password: 'test-password-123' },
    });
    const viewer = {
      ...origin,
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': login.json().csrf,
    };
    assert.equal((await select(second.id, viewer)).statusCode, 403);
    // Deleting a history must not silently recreate it from an approved collector.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/streams/${streamId}`,
      headers: admin,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal((await announce()).json().enabled, false);
    assert.equal((await select()).statusCode, 409);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
