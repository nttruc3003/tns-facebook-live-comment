import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { openStore, seedDemo } from '../server/store.js';
import { commentsCsv } from '../server/games.js';
import { numberFields, type Comment } from '../shared/types.js';
import { autofillInChunks } from '../src/autofill.js';

test('Autofill uses OpenAI, persists 2 or 3 numbers, rejects bad output, and protects edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-autofill-'));
  let output: unknown;
  let status = 'completed';
  let calls = 0;
  let onRequest = () => {};
  const { app, db, ai } = await createApp({
    directory,
    setupToken: 'setup',
    collector: false,
    request: (async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      for (const c of JSON.parse(body.input).comments)
        assert.deepEqual(Object.keys(c).sort(), ['id', 'message']);
      onRequest();
      return new Response(
        JSON.stringify({
          status,
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        }),
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
    const stream = seedDemo(db);
    const ids = ['comment-0', 'comment-1', 'comment-2'].map((suffix) => `${stream}-${suffix}`);
    for (const [i, message] of ['Em chọn 05 và 27', '1 2 3 4 5 6', 'Chào shop'].entries())
      db.prepare('UPDATE comments SET message=? WHERE id=?').run(message, ids[i]);
    const url = `/api/streams/${stream}/comment-numbers/autofill`;
    const call = (items = ids.map((commentId) => ({ commentId })), customHeaders = headers) =>
      app.inject({ method: 'POST', url, headers: customHeaders, payload: { items } });
    const read = (id: string) => db.prepare('SELECT * FROM comments WHERE id=?').get(id) as Comment;
    assert.equal((await call()).statusCode, 400); // missing key
    assert.equal(calls, 0);
    ai.save({ provider: 'gemini', model: 'test-model', apiKey: 'test-key' });
    assert.equal((await call()).statusCode, 400); // explicitly OpenAI only
    ai.save({ provider: 'openai', model: 'test-model', apiKey: 'test-key' });
    output = {
      items: [
        { id: ids[2], numbers: [], needsReview: false },
        { id: ids[0], numbers: ['05', '27'], needsReview: false },
        { id: ids[1], numbers: ['1', '2', '3'], needsReview: true },
      ],
    };
    const response = await call();
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      numberFields.map((field) => read(ids[0])[field]),
      ['05', '27', null],
    );
    assert.deepEqual(
      numberFields.map((field) => read(ids[1])[field]),
      ['1', '2', '3'],
    );
    assert.match(read(ids[1]).aiNumberNote!, /Cần kiểm tra/);
    assert.ok(numberFields.every((field) => read(ids[2])[field] === null));
    assert.match(commentsCsv([read(ids[1])]), /"1st number","2nd number","3rd number"/);
    assert.doesNotMatch(commentsCsv([read(ids[1])]), /4th number|5th number/);
    const manual = await app.inject({
      method: 'POST',
      url: `/api/streams/${stream}/comment-numbers`,
      headers,
      payload: { items: [{ commentId: ids[0], firstNumber: '99', thirdNumber: '88' }] },
    });
    assert.equal(manual.statusCode, 200, manual.body);
    const removedColumn = await app.inject({
      method: 'POST',
      url: `/api/streams/${stream}/comment-numbers`,
      headers,
      payload: { items: [{ commentId: ids[0], fourthNumber: '44' }] },
    });
    assert.equal(removedColumn.statusCode, 400);
    const tooMany = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { items: [{ commentId: ids[0], protectedFields: ['fourthNumber'] }] },
    });
    assert.equal(tooMany.statusCode, 400);
    await call();
    assert.deepEqual(
      numberFields.map((field) => read(ids[0])[field]),
      ['99', '27', '88'],
    );

    // Edits saved while the API is in flight invalidate that row's old snapshot.
    onRequest = () =>
      db
        .prepare(
          'UPDATE comments SET secondNumber=NULL,numbersRevision=numbersRevision+1 WHERE id=?',
        )
        .run(ids[0]);
    const edited = await call();
    assert.ok(edited.json().skipped.includes(ids[0]));
    assert.equal(read(ids[0]).secondNumber, null);
    onRequest = () => {};
    const protectedResult = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        items: ids.map((commentId) => ({ commentId, protectedFields: ['secondNumber'] })),
      },
    });
    assert.equal(protectedResult.statusCode, 200);
    assert.equal(read(ids[0]).secondNumber, null);

    const before = calls;
    assert.equal((await call([{ commentId: 'missing' }])).statusCode, 404);
    assert.equal((await call([{ commentId: ids[0] }, { commentId: ids[0] }])).statusCode, 400);
    assert.equal(
      (await call(Array.from({ length: 21 }, (_, i) => ({ commentId: String(i) })))).statusCode,
      400,
    );
    const anotherStream = seedDemo(db);
    assert.equal((await call([{ commentId: `${anotherStream}-comment-0` }])).statusCode, 404);
    assert.equal((await call(undefined, { ...headers, 'x-csrf-token': 'wrong' })).statusCode, 403);
    db.prepare("UPDATE users SET role='viewer'").run();
    assert.equal((await call()).statusCode, 403);
    db.prepare("UPDATE users SET role='admin'").run();
    assert.equal(calls, before);

    // Invalid numbers are isolated to that row; manual values stay protected.
    for (const numbers of [['999'], ['27', '05']]) {
      output = { items: [{ id: ids[0], numbers, needsReview: false }] };
      assert.equal((await call([{ commentId: ids[0] }])).statusCode, 200);
      assert.equal(read(ids[0]).secondNumber, null);
      assert.equal(read(ids[0]).firstNumber, '99');
      assert.match(read(ids[0]).aiNumberNote!, /không khớp/);
    }
    for (const items of [
      [{ id: 'invented', numbers: ['05'], needsReview: false }],
      [
        { id: ids[0], numbers: ['05'], needsReview: false },
        { id: ids[0], numbers: ['05'], needsReview: false },
      ],
      [],
    ]) {
      output = { items };
      assert.equal((await call([{ commentId: ids[0] }])).statusCode, 400);
      assert.equal(read(ids[0]).secondNumber, null);
    }
    status = 'incomplete';
    output = { items: [{ id: ids[0], numbers: ['05', '27'], needsReview: false }] };
    assert.equal((await call([{ commentId: ids[0] }])).statusCode, 400);
    status = 'completed';
    onRequest = () =>
      db.prepare('UPDATE comments SET message=? WHERE id=?').run('Changed 42', ids[0]);
    assert.deepEqual((await call([{ commentId: ids[0] }])).json().skipped, [ids[0]]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('v6 migration preserves existing numbers and adds three empty columns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-autofill-migration-'));
  let db = openStore(directory);
  try {
    const id = `${seedDemo(db)}-comment-0`;
    db.prepare('UPDATE comments SET firstNumber=?,secondNumber=? WHERE id=?').run('05', '27', id);
    db.exec(
      'ALTER TABLE comments DROP COLUMN thirdNumber; ALTER TABLE comments DROP COLUMN fourthNumber; ALTER TABLE comments DROP COLUMN fifthNumber; ALTER TABLE comments DROP COLUMN aiNumberNote; ALTER TABLE comments DROP COLUMN numbersRevision; DROP TABLE ai_call_logs; PRAGMA user_version=6;',
    );
    db.close();
    db = openStore(directory);
    const row = db.prepare('SELECT * FROM comments WHERE id=?').get(id) as Comment;
    assert.deepEqual(
      numberFields.map((field) => row[field]),
      ['05', '27', null],
    );
    assert.equal(db.pragma('user_version', { simple: true }), 8);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Chunk runner handles 10/20, applies progressively, retries only remaining and stops after current chunk', async () => {
  const ids = Array.from({ length: 45 }, (_, i) => String(i));
  for (const size of [10, 20] as const) {
    const batches: string[][] = [];
    const progress: number[] = [];
    const outcome = await autofillInChunks({
      ids,
      size,
      stopped: () => false,
      request: async (chunk) => chunk,
      apply: (chunk) => batches.push(chunk),
      progress: (done) => progress.push(done),
    });
    assert.deepEqual(batches.flat(), ids);
    assert.ok(batches.every((chunk) => chunk.length <= size));
    assert.equal(progress.at(-1), 45);
    assert.deepEqual(outcome.remaining, []);
  }
  let calls = 0;
  const failed = await autofillInChunks({
    ids,
    size: 20,
    stopped: () => false,
    request: async () => {
      if (++calls === 2) throw new Error('Temporary failure');
    },
    apply: () => {},
    progress: () => {},
  });
  assert.equal(failed.done, 20);
  assert.deepEqual(failed.remaining, ids.slice(20));
  let stopped = false;
  const partial = await autofillInChunks({
    ids: failed.remaining,
    size: 10,
    stopped: () => stopped,
    request: async () => {
      stopped = true;
    },
    apply: () => {},
    progress: () => {},
  });
  assert.equal(partial.done, 10);
  assert.deepEqual(partial.remaining, ids.slice(30));
});

test('OpenAI transient retries are bounded and refusals never become saved numbers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-autofill-retry-'));
  let attempts = 0;
  let response: () => Response = () => new Response('{}', { status: 429 });
  const { app, ai } = await createApp({
    directory,
    setupToken: 'test',
    collector: false,
    request: (async () => {
      attempts++;
      return response();
    }) as typeof fetch,
  });
  try {
    ai.save({ provider: 'openai', model: 'test-model', apiKey: 'test' });
    await assert.rejects(() => ai.extractNumbers([{ id: 'a', message: '05 27' }]), /429/);
    assert.equal(attempts, 3);
    attempts = 0;
    response = () => new Response('{}', { status: 401 });
    await assert.rejects(() => ai.extractNumbers([{ id: 'a', message: '05 27' }]), /401/);
    assert.equal(attempts, 1);
    response = () =>
      new Response(
        JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }),
      );
    await assert.rejects(() => ai.extractNumbers([{ id: 'a', message: '05 27' }]), /từ chối/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
