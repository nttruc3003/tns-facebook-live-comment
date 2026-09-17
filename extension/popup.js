const $ = (id) => document.getElementById(id);
async function init() {
  if (!globalThis.chrome?.runtime?.id || !chrome.tabs) {
    $('status').textContent =
      'Đây chỉ là file giao diện, không phải extension đang chạy. Hãy cài thư mục extension qua Chrome → Extensions → Load unpacked, sau đó bấm biểu tượng TNS trên thanh công cụ Chrome. Không mở file popup.html trực tiếp.';
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('tab').textContent = tab?.title || 'Chọn tab livestream Facebook trước.';
  async function send(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Extension chưa sẵn sàng.');
    return response;
  }
  async function status() {
    const s = await send('status');
    if (s.server) $('server').value = s.server;
    $('status').textContent =
      `${s.paired ? 'Đã ghép nối' : 'Cần ghép nối'}${s.deviceId ? ' · Thiết bị ' + s.deviceId.slice(0, 8) : ''} · ${s.active ? 'Đang ghi' : 'Đã dừng'}\n${s.session ? 'Phiên: ' + s.session.title + '\nVideo: ' + s.session.videoId + '\n' : ''}Đã lưu trong lượt ghi gần nhất: ${s.saved || 0} · Đang chờ: ${s.pending || 0}${s.error ? '\n' + s.error : ''}`;
    if (s.paired && s.session && !s.error) {
      $('pair-result').textContent =
        `✓ Đã ghép nối\n${s.session.title}\nVideo: ${s.session.videoId}\n${s.active ? 'Đang ghi comment.' : 'Extension đang kết nối và sẵn sàng ghi.'}`;
      $('pair-result').hidden = false;
    } else $('pair-result').hidden = true;
  }
  async function action(fn) {
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    try {
      await fn();
      await status();
    } catch (e) {
      $('status').textContent = e.message;
    } finally {
      for (const b of document.querySelectorAll('button')) b.disabled = false;
    }
  }
  $('pair').onclick = () =>
    action(async () => {
      $('pair-result').hidden = true;
      const result = await send('pair', {
        server: $('server').value,
        code: $('code').value.trim(),
      });
      $('code').value = '';
      $('pair-result').textContent =
        `✓ ${result.alreadyPaired ? 'Đã ghép nối' : 'Ghép nối thành công!'}\n${result.session.title}\nVideo: ${result.session.videoId}\nMở đúng video và chọn vùng comment để bắt đầu ghi.`;
      $('pair-result').hidden = false;
    });
  $('start').onclick = () =>
    action(async () => {
      if (!$('consent').checked) throw new Error('Xác nhận quyền thu thập trước khi tiếp tục.');
      if (!tab?.id) throw new Error('Không tìm thấy tab.');
      await send('select', { tabId: tab.id });
      window.close();
    });
  $('stop').onclick = () => action(() => send('stop'));
  $('retry').onclick = () => action(() => send('retry'));
  $('export').onclick = () =>
    action(async () => {
      const r = await send('export-pending');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tns-pending-comments.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  $('clear').onclick = () => {
    if (
      confirm(
        'Xóa các comment CHƯA GỬI trong extension? Hãy xuất JSON trước nếu cần giữ. Comment đã lưu trong Studio không bị xóa.',
      )
    )
      void action(() => send('clear-pending'));
  };
  await status().catch((e) => ($('status').textContent = e.message));
}
await init().catch((e) => ($('status').textContent = e.message));
