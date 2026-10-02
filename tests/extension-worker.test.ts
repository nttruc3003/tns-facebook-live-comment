import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
// @ts-expect-error Native extension module also runs unchanged inside Chrome.
import { createQueue, MAX_BYTES } from '../extension/queue.js';
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(fn: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await delay();
  }
  throw new Error('Timed out waiting for sync');
}

test('IndexedDB outbox persists, deduplicates tab retries, preserves ordering and only removes acknowledged data', async () => {
  const idb = new IDBFactory(),
    q = createQueue(idb, IDBKeyRange);
  await q.create({ id: 'run1', title: 'One' });
  await q.append('run1', [
    { id: 'fb:1', message: 'First' },
    { id: 'fb:2', message: 'Second' },
  ]);
  await q.append('run1', [{ id: 'fb:1', message: 'First' }]);
  assert.equal((await q.list())[0].nextSeq, 3);
  // A new worker accesses the same persistent database.
  const reopened = createQueue(idb, IDBKeyRange);
  assert.deepEqual(
    (await reopened.batch('run1')).map((c: any) => c.seq),
    [1, 2],
  );
  await reopened.acknowledge('run1', 1);
  assert.equal((await reopened.batch('run1'))[0].comment.id, 'fb:2');
  await assert.rejects(reopened.acknowledge('run1', 3), /không hợp lệ/);
  await reopened.append('run1', [{ id: 'fb:1', message: 'Retry after ACK' }]);
  assert.equal((await reopened.list())[0].nextSeq, 3);
  await q.create({ id: 'run2', title: 'Two' });
  await q.append('run2', [{ id: 'fb:1', message: 'Other video' }]);
  assert.equal((await q.batch('run2')).length, 1);
  // Simulate a full outbox without allocating 100 MB. Failed writes roll back dedup records.
  await q.update('run1', { bytes: MAX_BYTES });
  await assert.rejects(q.append('run2', [{ id: 'fb:3', message: 'Full' }]), /đầy/);
  await q.update('run1', { bytes: 0 });
  await q.append('run2', [{ id: 'fb:3', message: 'Recovered' }]);
  assert.equal((await q.batch('run2')).length, 2);
});

test('Collect works before server, survives failed ACKs and stops without draining or exposing credentials', async () => {
  const id = 'a'.repeat(32),
    local: Record<string, any> = {},
    session: Record<string, any> = {};
  const indexedDB = new IDBFactory(),
    q = createQueue(indexedDB, IDBKeyRange);
  const area = (s: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async (keys: string[] | string) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((k) => k in s)
          .map((k) => [k, structuredClone(s[k])]),
      ),
    set: async (data: any) => Object.assign(s, structuredClone(data)),
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete s[k];
    },
  });
  let listener: any,
    alarm: any,
    offline = true,
    enabled = false,
    loseResponse = false,
    ackSeq = 0;
  const requests: any[] = [],
    delivered: any[] = [];
  const tab = { id: 8, url: 'https://www.facebook.com/watch/?v=42', title: 'Test live' };
  const chrome = {
    storage: { local: area(local), session: area(session) },
    alarms: {
      create: () => {},
      onAlarm: {
        addListener: (fn: any) => {
          alarm = fn;
        },
      },
    },
    runtime: {
      id,
      getURL: (path: string) => `chrome-extension://${id}/${path}`,
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
    },
    tabs: {
      get: async () => tab,
      sendMessage: async (_id: number, m: any) => {
        delivered.push(m);
        return { active: false };
      },
      onRemoved: { addListener: () => {} },
    },
    scripting: { executeScript: async () => {} },
  };
  const source = (
    await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
  ).replace("import { createQueue, MAX_BYTES } from './queue.js';", '');
  const context = vm.createContext({
    chrome,
    createQueue,
    MAX_BYTES,
    indexedDB,
    IDBKeyRange,
    TextEncoder,
    crypto: webcrypto,
    Uint8Array,
    URL,
    AbortSignal,
    setTimeout,
    fetch: async (url: string, options: any) => {
      const body = JSON.parse(options.body),
        path = url.split('/').at(-1);
      requests.push({ path, body, options });
      if (offline) throw new Error('offline');
      if (path === 'announce')
        return {
          ok: true,
          json: async () => ({ enabled, ackSeq, streamId: enabled ? 'stream' : null }),
        };
      assert.equal(enabled, true);
      ackSeq = Math.max(ackSeq, body.fromSeq + body.comments.length - 1);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('response lost');
      }
      return { ok: true, json: async () => ({ ackSeq }) };
    },
  });
  vm.runInContext(source, context);
  const popup = { id, url: `chrome-extension://${id}/popup.html` };
  const sender = { id, url: tab.url, tab: { id: tab.id }, frameId: 0 };
  const send = (message: any, who: any = popup) =>
    new Promise<any>((resolve) => listener(message, who, resolve));
  assert.equal((await send({ type: 'begin' }, sender)).ok, false);
  assert.equal((await send({ type: 'select', tabId: 8 })).ok, true);
  const begun = await send({ type: 'begin' }, sender);
  assert.equal(begun.ok, true);
  const comment = {
    id: 'fb:1',
    message: '05',
    authorName: 'Name',
    authorUrl: null,
    parentId: null,
    observedAt: Date.now(),
  };
  const batch = { type: 'batch', captureId: begun.captureId, url: tab.url, comments: [comment] };
  assert.equal((await send({ ...batch, captureId: 'old' }, sender)).ok, false);
  assert.equal((await send(batch, { ...sender, tab: { id: 9 } })).ok, false);
  assert.equal((await send(batch, sender)).pending, 1);
  await until(async () => !!(await q.list())[0].error);
  assert.equal((await send(batch, sender)).pending, 1);
  assert.equal((await send({ type: 'status' }, sender)).ok, false);
  assert.equal(session.active.captureId, begun.captureId);
  offline = false;
  alarm({ name: 'tns-heartbeat' });
  await until(async () => (await q.list())[0].connected === true);
  assert.equal(requests.filter((r) => r.path === 'upload').length, 0);
  enabled = true;
  loseResponse = true;
  await delay();
  alarm({ name: 'tns-heartbeat' });
  await until(async () => ackSeq === 1);
  assert.equal((await q.batch(begun.captureId)).length, 1);
  await delay();
  alarm({ name: 'tns-heartbeat' });
  await until(async () => (await q.batch(begun.captureId)).length === 0);
  assert.equal((await q.list())[0].saved, 1);
  enabled = false;
  await delay();
  alarm({ name: 'tns-heartbeat' });
  await until(async () => !(await q.list())[0].enabled);
  const second = await send({ ...batch, comments: [{ ...comment, id: 'fb:2' }] }, sender);
  assert.equal(second.pending, 1);
  assert.equal(session.active.captureId, begun.captureId);
  assert.equal(
    (await send({ type: 'end', captureId: begun.captureId, url: tab.url }, sender)).ok,
    true,
  );
  assert.equal(session.active, undefined);
  assert.equal((await q.batch(begun.captureId)).length, 1);
  const exported = await send({ type: 'export-pending' });
  assert.equal(exported.data.comments.length, 1);
  assert.ok(!JSON.stringify(exported).includes(local.collectorCredential));
  assert.ok(!JSON.stringify(delivered).includes(local.collectorCredential));
  assert.equal((await send({ type: 'select', tabId: 8 })).ok, true);
  const next = await send({ type: 'begin' }, sender);
  assert.notEqual(next.captureId, begun.captureId);
  assert.equal((await q.list()).length, 2);
  assert.equal((await send(batch, sender)).ok, false);
  await delay();
});

test('Upgrade migrates the legacy pending queue once before clearing old storage', async () => {
  const indexedDB = new IDBFactory(),
    q = createQueue(indexedDB, IDBKeyRange);
  const capture = {
    captureId: '12345678-1234-4234-8234-123456789abc',
    tabId: 8,
    url: 'https://www.facebook.com/watch/?v=42',
    videoId: '42',
    title: 'Old capture',
  };
  const original = [{ id: 'fb:9', message: 'Keep me', authorName: 'Test', observedAt: Date.now() }];
  const local: Record<string, any> = { capture, queue: original };
  const session: Record<string, any> = {};
  const area = (data: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async (keys: string[] | string) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(data[k])]),
      ),
    set: async (values: any) => Object.assign(data, structuredClone(values)),
    remove: async (keys: string[]) => {
      for (const key of keys) delete data[key];
    },
  });
  const source = (
    await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')
  ).replace("import { createQueue, MAX_BYTES } from './queue.js';", '');
  async function boot() {
    let listener: any;
    const id = 'a'.repeat(32);
    const chrome = {
      storage: { local: area(local), session: area(session) },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      runtime: {
        id,
        getURL: (p: string) => `chrome-extension://${id}/${p}`,
        onMessage: {
          addListener: (fn: any) => {
            listener = fn;
          },
        },
      },
      tabs: { onRemoved: { addListener: () => {} } },
    };
    vm.runInNewContext(source, {
      createQueue,
      MAX_BYTES,
      indexedDB,
      IDBKeyRange,
      chrome,
      crypto: webcrypto,
      Uint8Array,
      URL,
      AbortSignal,
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const status = await new Promise<any>((resolve) =>
      listener({ type: 'status' }, { id, url: `chrome-extension://${id}/popup.html` }, resolve),
    );
    assert.equal(status.ok, true, status.error);
    await delay();
  }
  await boot();
  assert.equal(local.queue, undefined);
  assert.equal((await q.batch(capture.captureId))[0].comment.message, 'Keep me');
  // Simulate a crash after the IndexedDB commit but before chrome.storage was cleared.
  local.capture = capture;
  local.queue = original;
  await boot();
  assert.equal((await q.list()).length, 1);
  assert.equal((await q.batch(capture.captureId)).length, 1);
});
