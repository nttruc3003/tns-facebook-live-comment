(() => {
  // Reinjection is explicit user action; clean up only our previous reader.
  globalThis.TNSCapture?.dispose();
  const parser = globalThis.TNSParser,
    videoId = parser.video(location.href);
  let root = null,
    observer = null,
    timer = null,
    active = false,
    disposed = false,
    busy = false,
    scheduled = false,
    ending = false;
  const seen = new Map(),
    nodeIds = new WeakMap();
  let pending = [],
    captureId = null;
  const shell = document.createElement('div');
  shell.style.cssText =
    'position:fixed;z-index:2147483647;left:18px;top:18px;width:370px;max-width:90vw;';
  const shadow = shell.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    ':host{all:initial}section{font:14px/1.5 system-ui;background:#fff;color:#20243a;border:2px solid #6746d9;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0005}h3{margin:0 0 8px;font-size:18px}p{white-space:pre-wrap;max-height:200px;overflow:auto}button{font:inherit;border:1px solid #bbb;border-radius:6px;background:#f5f4fc;padding:8px;margin:5px 5px 0 0;cursor:pointer}button:disabled{opacity:.5}small{display:block;color:#555}';
  const box = document.createElement('section'),
    heading = document.createElement('h3'),
    info = document.createElement('p'),
    note = document.createElement('small');
  heading.textContent = 'TNS · Collect';
  info.textContent =
    'Bấm vào một bình luận trong livestream. Extension sẽ đề xuất vùng đọc để bạn kiểm tra trước khi bắt đầu.';
  note.textContent =
    'Chỉ dùng khi có quyền thu thập phù hợp. Không lấy cookie, không tự tải comment ẩn.';
  const begin = document.createElement('button'),
    cancel = document.createElement('button'),
    include = document.createElement('input'),
    label = document.createElement('label');
  begin.textContent = 'Collect vùng đã chọn';
  begin.disabled = true;
  cancel.textContent = 'Dừng thu / đóng';
  include.type = 'checkbox';
  include.checked = true;
  label.append(include, document.createTextNode(' Ghi cả comment đang có trong vùng'));
  box.append(heading, info, label, begin, cancel, note);
  shadow.append(style, box);
  document.documentElement.append(shell);
  let oldOutline = '';
  function articles() {
    return root ? [...root.querySelectorAll('[role="article"]')] : [];
  }
  function restoreOutline() {
    if (root) root.style.outline = oldOutline;
  }
  function stop(reason) {
    active = false;
    observer?.disconnect();
    clearInterval(timer);
    document.removeEventListener('click', pick, true);
    restoreOutline();
    heading.textContent = 'TNS · Đã dừng';
    info.textContent = reason;
    begin.disabled = true;
  }
  function dispose() {
    disposed = true;
    stop('');
    shell.remove();
    chrome.runtime.onMessage.removeListener(onMessage);
  }
  function candidateFor(article) {
    let candidate = article.parentElement;
    const fallback = candidate;
    for (let i = 0; candidate && i < 5; i++, candidate = candidate.parentElement) {
      if (
        ['BODY', 'HTML', 'MAIN'].includes(candidate.tagName) ||
        candidate.getAttribute('role') === 'main'
      )
        break;
      if (candidate.querySelectorAll('[role="article"]').length >= 2) return candidate;
    }
    return fallback &&
      !['BODY', 'HTML', 'MAIN'].includes(fallback.tagName) &&
      fallback.getAttribute('role') !== 'main'
      ? fallback
      : null;
  }
  function pick(event) {
    if (event.composedPath().includes(shell)) return;
    const article =
      event.target instanceof Element ? event.target.closest('[role="article"]') : null;
    if (!article) {
      info.textContent =
        'Chưa nhận diện được comment. Hãy bấm trực tiếp vào phần nội dung một bình luận (giao diện cần có role=article).';
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const candidate = candidateFor(article);
    if (
      !candidate ||
      ['BODY', 'HTML', 'MAIN'].includes(candidate.tagName) ||
      candidate.getAttribute('role') === 'main'
    ) {
      info.textContent =
        'Không xác định được vùng comment riêng. Mở khung bình luận của video rồi chọn lại.';
      return;
    }
    restoreOutline();
    root = candidate;
    oldOutline = root.style.outline;
    root.style.outline = '3px solid #7855ed';
    const samples = articles().map(parser.read).filter(Boolean);
    begin.disabled = !samples.length;
    info.textContent = `Vùng viền tím: nhận diện ${samples.length} comment đang tải. Kiểm tra mẫu bên dưới, chỉ xác nhận nếu KHÔNG chứa bài viết/gợi ý khác.\n\n${
      samples
        .slice(0, 3)
        .map((c) => c.authorName + ': ' + c.message.slice(0, 160))
        .join('\n\n') || 'Không đọc được nội dung. Chưa có dữ liệu nào gửi đi.'
    }`;
  }
  async function send(type, extra = {}) {
    const r = await chrome.runtime.sendMessage({ type, url: location.href, captureId, ...extra });
    if (!r?.ok) throw new Error(r?.error || 'Extension không phản hồi.');
    return r;
  }
  function scan() {
    if (!active || disposed || ending) return;
    if (parser.video(location.href) !== videoId || !root?.isConnected) {
      stop('Tab đổi video hoặc vùng comment bị thay thế. Mở extension để chọn lại.');
      return;
    }
    for (const article of articles()) {
      if (pending.length >= 100) {
        info.textContent = 'Đang chờ lưu dữ liệu. Không đóng tab; có thể bỏ lỡ comment mới.';
        break;
      }
      const c = parser.read(article);
      if (!c) continue;
      if (!c.id) {
        const signature = JSON.stringify([c.authorUrl, c.message]);
        let local = nodeIds.get(article);
        if (!local || local.signature !== signature) {
          local = { signature, id: 'obs:' + crypto.randomUUID() };
          nodeIds.set(article, local);
        }
        c.id = local.id;
      }
      if (seen.has(c.id)) continue;
      seen.set(c.id, true);
      if (seen.size > 20000) seen.delete(seen.keys().next().value);
      pending.push({ ...c, observedAt: Date.now() });
    }
  }
  async function pump() {
    if (!active || busy || disposed) return;
    busy = true;
    try {
      scan();
      if (!active) return;
      const batch = pending.slice(0, 20),
        r = await send('batch', { comments: batch });
      pending.splice(0, batch.length);
      info.textContent = `Đã lưu: ${r.saved} · Chờ gửi: ${r.pending + pending.length}\n${r.error || 'Chỉ ghi những comment được tải trong vùng đã chọn.'}\nThời gian là lúc quan sát; không đảm bảo đủ/trùng hoặc đúng thứ tự gửi.`;
    } catch (e) {
      stop(
        `${e.message}\nCòn ${pending.length} comment trong tab chưa được xác nhận. Không đóng tab; xem hàng chờ trong extension.`,
      );
    } finally {
      busy = false;
    }
  }
  function changed() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (active) {
        scan();
        void pump();
      }
    }, 350);
  }
  begin.onclick = async () => {
    begin.disabled = true;
    try {
      if (!root || parser.video(location.href) !== videoId)
        throw new Error('Chọn lại tab/vùng comment.');
      const started = await send('begin');
      captureId = started.captureId;
      document.removeEventListener('click', pick, true);
      active = true;
      heading.textContent = 'TNS · Đang Collect';
      begin.hidden = true;
      label.hidden = true;
      scan();
      if (!include.checked) pending = [];
      observer = new MutationObserver(changed);
      observer.observe(root, { subtree: true, childList: true, characterData: true });
      timer = setInterval(() => void pump(), 5000);
      void pump();
    } catch (e) {
      info.textContent = e.message;
      begin.disabled = false;
    }
  };
  // Stop UI locally immediately. Server also times out without heartbeats.
  cancel.onclick = async () => {
    if (!active && !pending.length) {
      dispose();
      return;
    }
    ending = true;
    cancel.disabled = true;
    observer?.disconnect();
    clearInterval(timer);
    try {
      // Let the in-flight durable handoff finish, then drain our short tab buffer.
      while (busy) await new Promise((resolve) => setTimeout(resolve, 50));
      while (pending.length) {
        const batch = pending.slice(0, 20);
        await send('batch', { comments: batch });
        pending.splice(0, batch.length);
      }
      await send('end');
      stop(
        'Đã dừng thu. Hàng chờ trên máy vẫn được giữ và sẽ lưu khi được chọn trên website 3210.',
      );
    } catch (e) {
      stop(`${e.message}\nCòn ${pending.length} comment chưa giao; giữ tab này mở.`);
    } finally {
      cancel.disabled = false;
    }
  };
  function onMessage(m, _sender, respond) {
    if (m.type === 'ping') respond({ active: active || busy || pending.length > 0 });
    if (m.type === 'stop-request') {
      respond({ ok: true });
      void cancel.onclick();
    }
    if (m.type === 'halt') {
      stop(m.reason);
      respond({ ok: true });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener('click', pick, true);
  globalThis.TNSCapture = { dispose };
  // Only auto-start one unambiguous cluster of real comment permalinks for this video.
  // Ambiguous/no-permalink layouts retain the manual sample selection fallback.
  const candidates = new Set();
  for (const article of document.querySelectorAll('[role="article"]')) {
    const parsed = parser.read(article);
    if (!parsed?.id?.startsWith('fb:')) continue;
    const candidate = candidateFor(article);
    if (!candidate) continue;
    const children = [...candidate.querySelectorAll('[role="article"]')];
    if (
      children.length < 2 ||
      !children.every((child) => {
        if (!parser.read(child)?.id?.startsWith('fb:')) return false;
        return [...child.querySelectorAll('a[href]')].some(
          (a) => parser.video(a.href) === videoId && parser.commentKey([a.href]).id,
        );
      })
    )
      continue;
    candidates.add(candidate);
  }
  const regions = [...candidates].filter(
    (c) => ![...candidates].some((other) => other !== c && other.contains(c)),
  );
  if (regions.length === 1) {
    root = regions[0];
    oldOutline = root.style.outline;
    root.style.outline = '3px solid #7855ed';
    void begin.onclick();
  } else {
    info.textContent =
      'Bấm vào một comment mẫu để chọn vùng thu, rồi bấm Collect vùng đã chọn. Chưa có dữ liệu nào được thu.';
  }
})();
