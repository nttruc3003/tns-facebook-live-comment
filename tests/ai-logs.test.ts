import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { AutofillLog } from '../server/ai-logs.js';
import { openStore, seedDemo, deleteStreamData } from '../server/store.js';

test('Autofill logs preserve request, retries, raw response and final saved values without credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-ai-logs-'));
  const secret = 'sk-ant-private-test-secret';
  let responseMode = 'success';
  let attempt = 0;
  let commentId = '';
  let sentBody = '';
  const { app, db, ai } = await createApp({
    directory,
    setupToken: 'setup',
    collector: false,
    request: (async (_url, options) => {
      sentBody = String(options?.body);
      assert.equal(
        (db.prepare('SELECT status FROM ai_call_logs ORDER BY seq DESC LIMIT 1').get() as any)
          .status,
        'pending',
      );
      if (responseMode === 'network') throw new TypeError('fetch failed');
      if (responseMode === 'invalid') return new Response('not json', { status: 200 });
      if (attempt++ === 0) return new Response(`rate limited ${secret}`, { status: 429 });
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    items: [{ id: commentId, numbers: [], needsReview: true }],
                  }),
                },
              ],
            },
          ],
          debug: secret,
        }),
        { headers: { 'x-request-id': 'req-demo' } },
      );
    }) as typeof fetch,
  });
  try {
    const origin = { host: 'localhost:3210', origin: 'http://localhost:3210' };
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: origin,
      payload: {
        username: 'admin',
        name: 'Admin',
        password: 'test-password-123',
        setupToken: 'setup',
      },
    });
    const headers = {
      ...origin,
      cookie: setup.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': setup.json().csrf,
    };
    ai.save({ provider: 'openai', model: 'test-model', apiKey: secret });
    const stream = seedDemo(db);
    commentId = `${stream}-comment-0`;
    db.prepare('UPDATE comments SET message=? WHERE id=?').run('12 15 16', commentId);
    const base = `/api/streams/${stream}/ai-logs`;
    const fill = () =>
      app.inject({
        method: 'POST',
        url: `/api/streams/${stream}/comment-numbers/autofill`,
        headers,
        payload: { items: [{ commentId }] },
      });
    const filled = await fill();
    assert.equal(filled.statusCode, 200, filled.body);
    const logId = filled.json().logId;
    const detail = (await app.inject({ method: 'GET', url: `${base}/${logId}`, headers })).json();
    assert.equal(detail.status, 'completed');
    assert.equal(detail.provider, 'openai');
    assert.equal(detail.model, 'test-model');
    assert.equal(detail.requestBody, sentBody);
    assert.equal(detail.attempts.length, 2);
    assert.equal(detail.attempts[0].status, 429);
    assert.match(detail.attempts[0].body, /REDACTED/);
    assert.equal(detail.attempts[1].requestId, 'req-demo');
    const raw = JSON.parse(detail.attempts[1].body);
    assert.deepEqual(JSON.parse(raw.output[0].content[0].text).items[0].numbers, []);
    assert.deepEqual(detail.result.extracted[0].numbers, ['12', '15', '16']);
    assert.equal(detail.result.saved[0].thirdNumber, '16');
    assert.equal(detail.result.saved[0].aiNumberNote, null);
    assert.ok(!JSON.stringify(detail).includes(secret));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM ai_call_logs').all()).includes(secret));
    for (const mode of ['invalid', 'network']) {
      responseMode = mode;
      assert.ok((await fill()).statusCode >= 400);
      const list = (await app.inject({ method: 'GET', url: base, headers })).json();
      const failed = (
        await app.inject({ method: 'GET', url: `${base}/${list.items[0].id}`, headers })
      ).json();
      assert.equal(failed.status, 'error');
      assert.ok(failed.error);
      assert.equal(failed.result, null);
      if (mode === 'invalid') assert.equal(failed.attempts[0].body, 'not json');
      else assert.equal(failed.attempts.length, 0);
    }
    const anotherStream = seedDemo(db);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/streams/${anotherStream}/ai-logs/${logId}`,
          headers,
        })
      ).statusCode,
      404,
    );
    assert.equal((await app.inject({ method: 'GET', url: base, headers: origin })).statusCode, 401);
    db.prepare("UPDATE users SET role='viewer'").run();
    for (const url of [base, `${base}/${logId}`])
      assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 403);
    db.prepare("UPDATE users SET role='operator'").run();
    assert.equal((await app.inject({ method: 'GET', url: base, headers })).statusCode, 200);
    for (let i = 0; i < 22; i++)
      new AutofillLog(db, stream, 'test-user', ai.config(), 1).complete({ index: i });
    const first = (await app.inject({ method: 'GET', url: base, headers })).json();
    const second = (
      await app.inject({ method: 'GET', url: `${base}?before=${first.nextBefore}`, headers })
    ).json();
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map((r) => r.id)).size, 25);
    deleteStreamData(db, stream);
    assert.equal((db.prepare('SELECT count(*) n FROM ai_call_logs').get() as any).n, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('v7 log migration keeps comments and marks unfinished logs interrupted after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-log-migration-'));
  let db = openStore(directory);
  try {
    const stream = seedDemo(db);
    const count = (db.prepare('SELECT count(*) n FROM comments').get() as any).n;
    db.exec('DROP TABLE ai_call_logs; PRAGMA user_version=7;');
    db.close();
    db = openStore(directory);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal((db.prepare('SELECT count(*) n FROM comments').get() as any).n, count);
    const pending = new AutofillLog(
      db,
      stream,
      'test-user',
      { provider: 'anthropic', model: 'test' },
      1,
    );
    pending.request('https://api.anthropic.com/v1/messages', '{}');
    db.close();
    db = openStore(directory);
    assert.equal(
      (db.prepare('SELECT status FROM ai_call_logs WHERE id=?').get(pending.id) as any).status,
      'interrupted',
    );
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
