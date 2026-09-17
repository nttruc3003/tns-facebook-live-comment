import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Extension worker requires explicit tab selection, persists failed uploads and exposes no credential to tab', async () => {
  const id = 'a'.repeat(32),
    local: Record<string, any> = {},
    session: Record<string, any> = {};
  const area = (state: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async (keys: string[] | string) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter((k) => k in state)
          .map((k) => [k, structuredClone(state[k])]),
      ),
    set: async (data: Record<string, any>) => Object.assign(state, structuredClone(data)),
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
    },
  });
  let listener: any,
    offline = false,
    revoked = false,
    starts = 0;
  const messages: any[] = [],
    requests: any[] = [];
  const chrome = {
    storage: { local: area(local), session: area(session) },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      id,
      getURL: (path: string) => `chrome-extension://${id}/${path}`,
      onMessage: { addListener: (fn: any) => (listener = fn) },
    },
    tabs: {
      get: async (tabId: number) => ({
        id: tabId,
        url: 'https://www.facebook.com/watch/?v=42',
        title: 'Test Live',
      }),
      sendMessage: async (_id: number, m: any) => {
        messages.push(m);
        return { ok: true };
      },
      onRemoved: { addListener: () => {} },
    },
    scripting: { executeScript: async () => {} },
  };
  const context = vm.createContext({
    chrome,
    URL,
    AbortSignal,
    console,
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      const path = url.split('/').at(-1),
        body = JSON.parse(options.body);
      if (path === 'batch' && offline) throw new Error('offline');
      if (path === 'status' && revoked)
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Ghép nối hết hạn hoặc đã thu hồi.' }),
        };
      return {
        ok: true,
        json: async () =>
          path === 'pair'
            ? {
                credential: 'c'.repeat(64),
                expires: Date.now() + 100000,
                session: { streamId: 'stream-id', videoId: '42', title: 'Test Live' },
              }
            : path === 'start'
              ? { captureId: `capture-id-${++starts}`, streamId: 'stream-id' }
              : path === 'status'
                ? {
                    deviceId: 'device-id',
                    captureId: `capture-id-${starts}`,
                    session: { streamId: 'stream-id', videoId: '42', title: 'Test Live' },
                  }
                : path === 'batch'
                  ? { inserted: body.comments.length, accepted: body.comments.length }
                  : { ok: true },
      };
    },
  });
  vm.runInContext(
    await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'),
    context,
  );
  const popup = { id, url: `chrome-extension://${id}/popup.html` };
  const tab = { id, url: 'https://www.facebook.com/watch/?v=42', tab: { id: 8 }, frameId: 0 };
  const send = (message: any, sender: any = popup) =>
    new Promise<any>((resolve) => listener(message, sender, resolve));
  assert.equal((await send({ type: 'begin' }, tab)).ok, false);
  assert.equal((await send({ type: 'pair', server: 'https://evil.example', code: 'x' })).ok, false);
  assert.equal(
    (await send({ type: 'pair', server: 'http://localhost:3210', code: 'b'.repeat(64) })).ok,
    true,
  );
  assert.equal((await send({ type: 'status' }, tab)).ok, false);
  assert.equal((await send({ type: 'select', tabId: 8 })).ok, true);
  const begun = await send({ type: 'begin' }, tab);
  assert.equal(begun.ok, true);
  assert.ok(!JSON.stringify(begun).includes('c'.repeat(64)));
  const pairedAgain = await send({
    type: 'pair',
    server: 'http://localhost:3210',
    code: 'b'.repeat(64),
  });
  assert.equal(pairedAgain.ok, true);
  assert.equal(pairedAgain.alreadyPaired, true);
  assert.equal(JSON.parse(requests.at(-1).options.body).verifyOnly, true);
  offline = true;
  const batch = {
    type: 'batch',
    captureId: begun.captureId,
    url: tab.url,
    comments: [{ id: 'fb:1', message: '5' }],
  };
  assert.equal((await send({ ...batch, captureId: 'previous-capture' }, tab)).ok, false);
  assert.equal(local.queue.length, 0);
  const queued = await send(batch, tab);
  assert.equal(queued.ok, true);
  assert.equal(queued.pending, 1);
  assert.equal(local.queue.length, 1);
  const exported = await send({ type: 'export-pending' });
  assert.equal(exported.data.comments.length, 1);
  assert.ok(!JSON.stringify(exported).includes('c'.repeat(64)));
  assert.equal((await send(batch, { ...tab, tab: { id: 9 } })).ok, false);
  offline = false;
  assert.equal((await send({ type: 'retry' })).ok, true);
  assert.equal(local.queue.length, 0);
  assert.equal((await send({ type: 'stop' })).ok, true);
  assert.equal(session.active, undefined);
  assert.equal(local.capture, undefined);
  // The same tab/video can start a new session; late messages from the old reader are rejected.
  assert.equal((await send({ type: 'select', tabId: 8 })).ok, true);
  const second = await send({ type: 'begin' }, tab);
  assert.notEqual(second.captureId, begun.captureId);
  assert.equal((await send(batch, tab)).ok, false);
  assert.equal(
    (await send({ type: 'end', url: tab.url, captureId: begun.captureId }, tab)).ok,
    false,
  );
  assert.equal((await chrome.storage.session.get('active')).active.captureId, second.captureId);
  assert.equal((await send({ type: 'status' })).capture.videoId, '42');
  revoked = true;
  const status = await send({ type: 'status' });
  assert.equal(status.paired, false);
  assert.equal(status.active, false);
  assert.equal(local.credential, undefined);
  assert.equal(local.capture, undefined);
  assert.match(status.error, /thu hồi/);
  assert.ok(messages.every((m) => !JSON.stringify(m).includes('c'.repeat(64))));
  assert.ok(
    requests.every(
      (r) =>
        r.url.startsWith('http://localhost:3210/api/capture/bridge/') &&
        r.options.credentials === 'omit',
    ),
  );
});
