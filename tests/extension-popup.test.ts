import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Popup confirms pairing with the bound livestream and never shows success on failure', async () => {
  const elements: Record<string, any> = Object.fromEntries(
    [
      'tab',
      'server',
      'status',
      'pair-result',
      'code',
      'pair',
      'start',
      'stop',
      'retry',
      'export',
      'clear',
      'consent',
    ].map((id) => [id, { textContent: '', value: '', hidden: true, disabled: false }]),
  );
  let rejected = false;
  const session = { streamId: 'session-a', videoId: '123', title: 'Mini game tối thứ Sáu' };
  const chrome = {
    runtime: {
      id: 'a'.repeat(32),
      sendMessage: async ({ type }: { type: string }) => {
        if (type === 'pair')
          return rejected ? { ok: false, error: 'Mã phiên không đúng.' } : { ok: true, session };
        return { ok: true, paired: true, session, server: 'http://localhost:3210' };
      },
    },
    tabs: { query: async () => [{ id: 1, title: 'Facebook' }] },
  };
  const document = {
    getElementById: (id: string) => elements[id],
    querySelectorAll: () => [elements.pair, elements.start],
  };
  const source = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
  await vm.runInNewContext(`(async () => {${source}})()`, { chrome, document });
  assert.equal(elements['pair-result'].hidden, false);
  assert.match(elements['pair-result'].textContent, /Đã ghép nối/);
  elements.code.value = 'secret-not-to-display';
  await elements.pair.onclick();
  assert.equal(elements['pair-result'].hidden, false);
  assert.match(elements['pair-result'].textContent, /Đã ghép nối/);
  assert.ok(elements['pair-result'].textContent.includes(session.title));
  assert.ok(elements['pair-result'].textContent.includes(session.videoId));
  assert.equal(elements.code.value, '');
  assert.ok(!elements['pair-result'].textContent.includes('secret-not-to-display'));
  rejected = true;
  await elements.pair.onclick();
  assert.equal(elements['pair-result'].hidden, true);
  assert.match(elements.status.textContent, /không đúng/);
  await vm.runInNewContext(`(async () => {${source}})()`, { document });
  assert.match(elements.status.textContent, /Không mở file popup.html trực tiếp/);
  assert.equal(elements.pair.disabled, true);
});
