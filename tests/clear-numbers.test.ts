import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/store.js';
import { AutofillLog } from '../server/ai-logs.js';

test('Clearing filtered numbers resets only selected comments, preserves logs, and enforces scope and permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-clear-numbers-'));
  const { app, db } = await createApp({ directory, setupToken: 'setup', collector: false });
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
    const stream = seedDemo(db);
    const otherStream = seedDemo(db);
    const selected = `${stream}-comment-0`,
      outside = `${stream}-comment-1`,
      other = `${otherStream}-comment-0`;
    const read = (id: string) => db.prepare('SELECT * FROM comments WHERE id=?').get(id) as any;
    for (const id of [selected, outside, other])
      db.prepare(
        "UPDATE comments SET firstNumber='12',secondNumber='15',thirdNumber='16',fourthNumber='17',fifthNumber='18',aiNumberNote='Cần kiểm tra' WHERE id=?",
      ).run(id);
    const old = read(selected),
      untouched = read(outside),
      foreign = read(other);
    const log = new AutofillLog(db, stream, 'test-user', { provider: 'openai', model: 'test' }, 1);
    log.complete({ saved: [{ commentId: selected, firstNumber: '12' }] });
    const clear = (commentIds: string[], h = headers) =>
      app.inject({
        method: 'POST',
        url: `/api/streams/${stream}/comment-numbers/clear`,
        headers: h,
        payload: { commentIds },
      });
    assert.equal(
      (await clear([selected], { ...headers, 'x-csrf-token': 'wrong' })).statusCode,
      403,
    );
    db.prepare("UPDATE users SET role='viewer'").run();
    assert.equal((await clear([selected])).statusCode, 403);
    db.prepare("UPDATE users SET role='operator'").run();
    assert.equal((await clear([])).statusCode, 400);
    // Both failure cases must roll back even the first valid ID.
    assert.equal((await clear([selected, other])).statusCode, 404);
    assert.deepEqual(read(selected), old);
    assert.equal((await clear([selected, 'missing'])).statusCode, 404);
    assert.deepEqual(read(selected), old);
    const result = await clear([selected, selected]);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().updated, 1);
    const now = read(selected);
    for (const field of [
      'firstNumber',
      'secondNumber',
      'thirdNumber',
      'fourthNumber',
      'fifthNumber',
      'aiNumberNote',
    ])
      assert.equal(now[field], null);
    assert.equal(now.numbersRevision, old.numbersRevision + 1);
    assert.equal(now.message, old.message);
    assert.deepEqual(read(outside), untouched);
    assert.deepEqual(read(other), foreign);
    assert.equal(
      (db.prepare('SELECT status FROM ai_call_logs WHERE id=?').get(log.id) as any).status,
      'completed',
    );
    assert.equal((await clear([selected])).statusCode, 200);
    assert.equal(read(selected).numbersRevision, old.numbersRevision + 2);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
