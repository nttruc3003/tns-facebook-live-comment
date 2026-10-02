import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Popup offers Collect without pairing and toggles to stop while collecting', async () => {
  const elements: Record<string, any> = Object.fromEntries(
    ['tab', 'status', 'collect', 'runs', 'name', 'rename', 'retry', 'export'].map((id) => [
      id,
      { textContent: '', value: '', disabled: false },
    ]),
  );
  const messages: any[] = [];
  let active = false,
    closed = false;
  const chrome = {
    runtime: {
      id: 'a'.repeat(32),
      sendMessage: async (m: any) => {
        messages.push(m);
        if (m.type === 'status') return { ok: true, active, pending: 2, saved: 0, runs: [] };
        if (m.type === 'stop') active = false;
        return { ok: true };
      },
    },
    storage: { local: { get: async () => ({ collectorName: 'Main' }) } },
    tabs: { query: async () => [{ id: 1, title: 'Facebook' }] },
  };
  const document = {
    getElementById: (id: string) => elements[id],
    querySelectorAll: () => [elements.collect, elements.export],
  };
  let timer: any;
  const source = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
  await vm.runInNewContext(`(async () => {${source}})()`, {
    chrome,
    document,
    window: {
      close: () => {
        closed = true;
      },
    },
    setInterval: (fn: any) => {
      timer = fn;
    },
  });
  assert.equal(elements.collect.textContent, 'Collect');
  assert.equal(elements.name.value, 'Main');
  await elements.collect.onclick();
  assert.equal(messages.find((m) => m.type === 'select').tabId, 1);
  assert.equal(closed, true);
  active = true;
  timer();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.collect.textContent, 'Dừng thu');
  await elements.collect.onclick();
  assert.ok(messages.some((m) => m.type === 'stop'));
  assert.ok(!messages.some((m) => m.type === 'pair'));
  await vm.runInNewContext(`(async () => {${source}})()`, { document });
  assert.match(elements.status.textContent, /Không mở file popup.html trực tiếp/);
  assert.equal(elements.collect.disabled, true);
});
