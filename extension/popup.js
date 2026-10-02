const $ = (id) => document.getElementById(id);
async function init() {
  if (!globalThis.chrome?.runtime?.id || !chrome.tabs) {
    $('status').textContent =
      'Mở extension bằng biểu tượng TNS trên Chrome. Không mở file popup.html trực tiếp.';
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  $('tab').textContent = tab?.title || 'Mở tab livestream Facebook trước.';
  let active = false,
    busy = false;
  async function send(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Extension chưa sẵn sàng.');
    return response;
  }
  async function refresh() {
    const s = await send('status');
    active = s.active;
    $('collect').textContent = active ? 'Dừng thu' : 'Collect';
    const r = s.capture;
    $('status').textContent =
      `${active ? 'Đang Collect' : 'Đã dừng thu'}${r ? '\nVideo: ' + r.videoId : ''}\nĐang chờ lưu: ${s.pending || 0} · Đã đồng bộ: ${s.saved || 0}\n${r?.error || (r?.enabled ? 'Đã chọn lưu vào Studio.' : 'Chưa được chọn lưu trên website 3210.')}${s.warning ? '\n' + s.warning : ''}`;
    $('runs').textContent = (s.runs || [])
      .map(
        (run) =>
          `${run.title}: ${run.pending} chờ · ${run.saved} đã đồng bộ${run.error ? ' · ' + run.error : ''}`,
      )
      .join('\n');
  }
  async function action(fn) {
    busy = true;
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    try {
      await fn();
      await refresh();
    } catch (e) {
      $('status').textContent = e.message;
    } finally {
      busy = false;
      for (const b of document.querySelectorAll('button')) b.disabled = false;
    }
  }
  $('collect').onclick = () =>
    action(async () => {
      if (active) {
        await send('stop');
        return;
      }
      if (!tab?.id) throw new Error('Không tìm thấy tab livestream.');
      await send('select', { tabId: tab.id });
      window.close();
    });
  $('retry').onclick = () => action(() => send('retry'));
  $('rename').onclick = () => action(() => send('rename', { name: $('name').value }));
  $('export').onclick = () =>
    action(async () => {
      // Read in the popup context so a large export never crosses Chrome's message-size limit.
      const { createQueue } = await import('./queue.js');
      const data = await createQueue(indexedDB, IDBKeyRange).export();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tns-pending-comments.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  const { collectorName } = await chrome.storage.local.get('collectorName');
  $('name').value = collectorName || '';
  await refresh();
  setInterval(() => {
    if (!busy) void refresh().catch(() => {});
  }, 2000);
}
await init().catch((e) => ($('status').textContent = e.message));
