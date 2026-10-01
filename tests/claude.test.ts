import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { seedDemo, setting } from '../server/store.js';
import { AI } from '../server/ai.js';
import { Vault } from '../server/security.js';
import { defaultFilter, numberFields, type Comment } from '../shared/types.js';

test('Claude settings, autofill and planner use Anthropic headers, selected model and validated output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-claude-'));
  let answer: unknown;
  let stopReason = 'end_turn';
  let model = 'claude-haiku-4-5-20251001';
  let calls = 0;
  const request = (async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('x-api-key'), 'claude-test-key');
    assert.equal(headers.get('anthropic-version'), '2023-06-01');
    assert.equal(headers.get('Authorization'), null);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, model);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.equal(body.messages[0].role, 'user');
    assert.equal(typeof body.system, 'string');
    assert.equal(body.store, undefined);
    const input = JSON.parse(body.messages[0].content);
    if (input.comments) {
      assert.equal(body.max_tokens, 4000);
      assert.deepEqual(Object.keys(input.comments[0]).sort(), ['id', 'message']);
      assert.equal(
        body.output_config.format.schema.properties.items.items.properties.numbers.maxItems,
        undefined,
      );
    } else assert.equal(body.max_tokens, 1800);
    return new Response(
      JSON.stringify({
        stop_reason: stopReason,
        content: [{ type: 'text', text: JSON.stringify(answer) }],
      }),
    );
  }) as typeof fetch;
  const { app, ai, db } = await createApp({
    directory,
    setupToken: 'setup',
    collector: false,
    request,
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
    const settings = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      headers,
      payload: { provider: 'anthropic', model, apiKey: 'claude-test-key', persist: true },
    });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal(settings.json().hasKey, true);
    assert.equal(settings.json().apiKey, undefined);
    assert.ok(!setting(db, 'aiKey')!.includes('claude-test-key'));
    const stream = seedDemo(db);
    const id = `${stream}-comment-0`;
    db.prepare('UPDATE comments SET message=? WHERE id=?').run('Em chọn 05 và 27', id);
    answer = { items: [{ id, numbers: ['05', '27'], needsReview: false }] };
    const autofill = () =>
      app.inject({
        method: 'POST',
        url: `/api/streams/${stream}/comment-numbers/autofill`,
        headers,
        payload: { items: [{ commentId: id }] },
      });
    const filled = await autofill();
    assert.equal(filled.statusCode, 200, filled.body);
    assert.deepEqual(
      numberFields.map((field) => filled.json().items[0][field]),
      ['05', '27', null],
    );
    model = 'claude-sonnet-5-5';
    ai.save({ provider: 'anthropic', model, persist: true });
    const restarted = new AI(db, new Vault(directory), request);
    assert.equal(restarted.config().hasKey, true);
    await restarted.extractNumbers([{ id, message: 'Em chọn 05 và 27' }]);
    answer = { ...defaultFilter, startCommentId: null, endCommentId: null };
    assert.deepEqual(await ai.plan('Đếm số 5', stream), answer);
    for (const reason of ['max_tokens', 'refusal', 'pause_turn']) {
      stopReason = reason;
      assert.equal((await autofill()).statusCode, 400);
    }
    stopReason = 'end_turn';
    for (const numbers of [['999'], ['05', '27', '3', '4', '5', '6'], ['wrong']]) {
      answer = { items: [{ id, numbers, needsReview: false }] };
      const reviewed = await autofill();
      assert.equal(reviewed.statusCode, 200);
      assert.match(reviewed.json().items[0].aiNumberNote, /Cần kiểm tra/);
    }
    const row = db.prepare('SELECT * FROM comments WHERE id=?').get(id) as Comment;
    assert.deepEqual(
      numberFields.map((field) => row[field]),
      ['05', '27', null],
    );
    // Switching providers must never send the previous provider's credential.
    ai.save({ provider: 'openai', model: 'gpt-5.4-nano', persist: true });
    assert.equal(ai.config().hasKey, false);
    const before = calls;
    await assert.rejects(() => ai.extractNumbers([{ id, message: '05 27' }]), /API key/);
    assert.equal(calls, before);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
