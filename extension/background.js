import { createQueue, MAX_BYTES } from './queue.js';
const queue = createQueue(indexedDB, IDBKeyRange);
const DEFAULT_SERVER = 'http://localhost:3210';
const ready = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  const s = await chrome.storage.local.get([
    'collectorCredential',
    'queue',
    'capture',
    'lastCapture',
  ]);
  if (!s.collectorCredential) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await chrome.storage.local.set({
      collectorCredential: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
    });
  }
  // Upgrade the old single outbox before removing its storage. Safe across interrupted upgrades.
  if (s.queue?.length) {
    const old = s.capture || s.lastCapture;
    if (!old?.captureId || !video(old.url))
      throw new Error(
        'Hàng chờ cũ thiếu thông tin video. Cần giữ bản dữ liệu extension trước khi nâng cấp.',
      );
    if (!(await queue.list()).some((r) => r.id === old.captureId))
      await queue.create({
        ...old,
        id: old.captureId,
        startedAt: Date.now(),
        lastPulse: 0,
        title: old.title || 'Hàng chờ trước nâng cấp',
      });
    await queue.append(old.captureId, s.queue);
    await chrome.storage.local.remove(['queue', 'capture']);
  }
})();
let chain = Promise.resolve();
const run = (fn) => {
  const next = chain.then(() => ready).then(fn);
  chain = next.catch(() => {});
  return next;
};
function video(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(u.hostname)
    )
      return null;
    return (
      u.searchParams.get('v')?.match(/^\d{1,40}$/)?.[0] ||
      u.pathname.match(/\/videos\/(?:[^/]+\/)?(\d{1,40})(?:\/|$)/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}
async function request(path, body) {
  const { collectorCredential } = await chrome.storage.local.get('collectorCredential');
  const response = await fetch(`${DEFAULT_SERVER}/api/capture/bridge/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${collectorCredential}` },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Server chưa kết nối.'), {
      status: response.status,
    });
  return result;
}
let syncing = false;
async function sync() {
  await ready;
  if (syncing) return;
  syncing = true;
  let more = false;
  try {
    const { active } = await chrome.storage.session.get('active');
    const { collectorName } = await chrome.storage.local.get('collectorName');
    for (const item of await queue.list()) {
      try {
        const remote = await request('announce', {
          id: item.id,
          url: item.url,
          title: item.title,
          name: collectorName || 'Chrome · TNS',
          startedAt: item.startedAt,
          firstSeq: item.ackSeq + 1,
          running: active?.captureId === item.id && item.lastPulse > Date.now() - 20_000,
          pending: item.nextSeq - item.ackSeq - 1,
        });
        await queue.update(item.id, {
          enabled: remote.enabled,
          streamId: remote.streamId,
          error: '',
          connected: true,
        });
        // An ACK may arrive via discovery after the upload response was lost.
        if (remote.ackSeq >= item.ackSeq) await queue.acknowledge(item.id, remote.ackSeq);
        if (!remote.enabled) continue;
        // Bounded work leaves opportunities for new captures and other outboxes.
        for (let i = 0; i < 10; i++) {
          const batch = await queue.batch(item.id);
          if (!batch.length) break;
          const ack = await request('upload', {
            id: item.id,
            fromSeq: batch[0].seq,
            comments: batch.map((c) => c.comment),
          });
          if (ack.ackSeq < batch.at(-1).seq) throw new Error('Server chưa xác nhận hết dữ liệu.');
          await queue.acknowledge(item.id, ack.ackSeq);
        }
        if ((await queue.batch(item.id)).length) more = true;
      } catch (e) {
        await queue.update(item.id, {
          error: e.status ? e.message : 'Server chưa kết nối. Comment tiếp tục được giữ trên máy.',
          connected: !!e.status,
          ...(e.status === 403 ? { enabled: false } : {}),
        });
        // One offline request is enough; do not delay every outbox by a network timeout.
        if (!e.status) break;
      }
    }
  } finally {
    syncing = false;
    if (more) setTimeout(kick, 250);
  }
}
const kick = () => {
  void sync().catch(() => {});
};
chrome.alarms.create('tns-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tns-heartbeat') kick();
});
async function status() {
  const runs = (await queue.list()).sort((a, b) => a.startedAt - b.startedAt),
    { active } = await chrome.storage.session.get('active');
  const current = runs.find((r) => r.id === active?.captureId) || runs.at(-1);
  return {
    runs: runs.map((r) => ({ ...r, pending: r.nextSeq - r.ackSeq - 1 })),
    capture: current,
    active: !!active && !!current && current.lastPulse > Date.now() - 20_000,
    pending: runs.reduce((n, r) => n + r.nextSeq - r.ackSeq - 1, 0),
    saved: runs.reduce((n, r) => n + r.saved, 0),
    warning:
      runs.reduce((n, r) => n + r.bytes, 0) > MAX_BYTES * 0.8
        ? 'Hàng chờ gần đầy. Hãy mở Studio để lưu hoặc xuất JSON.'
        : '',
  };
}
async function stopLocal(captureId) {
  const { active } = await chrome.storage.session.get('active');
  if (active?.captureId === captureId) await chrome.storage.session.remove('active');
  await queue.update(captureId, { lastPulse: 0 });
  kick();
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Capture persistence never waits for an upload. A sleeping/offline server cannot block Collect.
  run(async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Nguồn không hợp lệ.');
    const popup = !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (popup) {
      if (message.type === 'status') {
        kick();
        return status();
      }
      if (message.type === 'retry') {
        kick();
        return {};
      }
      if (message.type === 'rename') {
        const name = String(message.name || '')
          .trim()
          .slice(0, 100);
        if (!name) throw new Error('Nhập tên để nhận diện Chrome này.');
        await chrome.storage.local.set({ collectorName: name });
        kick();
        return {};
      }
      if (message.type === 'export-pending') return { data: await queue.export() };
      if (message.type === 'stop') {
        const { active } = await chrome.storage.session.get('active');
        if (active) {
          try {
            await chrome.tabs.sendMessage(active.tabId, { type: 'stop-request' });
          } catch {
            await stopLocal(active.captureId);
          }
        }
        return {};
      }
      if (message.type === 'select') {
        const { active } = await chrome.storage.session.get('active');
        if (active) {
          // Avoid disposing a tab reader that still owns an unacknowledged buffer.
          let alive = false;
          try {
            alive = !!(await chrome.tabs.sendMessage(active.tabId, { type: 'ping' }))?.active;
          } catch {}
          if (alive) throw new Error('Đang Collect. Dừng thu trước khi chọn tab khác.');
          await stopLocal(active.captureId);
        }
        const tab = await chrome.tabs.get(message.tabId);
        if (!video(tab.url))
          throw new Error('Mở video Facebook bằng /videos/ID hoặc watch?v=ID trước.');
        await chrome.storage.session.set({
          selection: {
            tabId: tab.id,
            videoId: video(tab.url),
            url: tab.url,
            title: (tab.title || 'Livestream Facebook').slice(0, 200),
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['parser.js', 'content.js'],
        });
        return {};
      }
      throw new Error('Thao tác không hợp lệ.');
    }
    if (!sender.tab || sender.frameId !== 0) throw new Error('Chỉ nhận từ tab đã chọn.');
    if (message.type === 'begin') {
      const { selection, active } = await chrome.storage.session.get(['selection', 'active']);
      if (
        !selection ||
        selection.tabId !== sender.tab.id ||
        selection.videoId !== video(sender.url)
      )
        throw new Error('Chọn lại đúng tab livestream từ extension.');
      if (active) throw new Error('Lượt Collect đang hoạt động.');
      const captureId = crypto.randomUUID();
      await queue.create({
        ...selection,
        id: captureId,
        startedAt: Date.now(),
        lastPulse: Date.now(),
      });
      await chrome.storage.session.set({ active: { ...selection, captureId } });
      await chrome.storage.session.remove('selection');
      kick();
      return { captureId };
    }
    const { active } = await chrome.storage.session.get('active');
    if (
      !active ||
      message.captureId !== active.captureId ||
      active.tabId !== sender.tab.id ||
      active.videoId !== video(sender.url) ||
      active.videoId !== video(message.url)
    )
      throw new Error('Tab hoặc lượt Collect đã thay đổi.');
    if (message.type === 'end') {
      await stopLocal(active.captureId);
      return {};
    }
    if (message.type === 'batch') {
      if (!Array.isArray(message.comments) || message.comments.length > 20)
        throw new Error('Batch không hợp lệ.');
      for (const c of message.comments) {
        if (
          typeof c.id !== 'string' ||
          !/^(fb:\d{1,80}|obs:[a-f0-9-]{36})$/.test(c.id) ||
          typeof c.message !== 'string' ||
          c.message.length > 8000 ||
          typeof c.authorName !== 'string' ||
          c.authorName.length > 200 ||
          !Number.isSafeInteger(c.observedAt)
        )
          throw new Error('Comment không hợp lệ.');
      }
      const saved = await queue.append(active.captureId, message.comments);
      kick();
      return {
        pending: saved.nextSeq - saved.ackSeq - 1,
        saved: saved.saved,
        error:
          saved.error ||
          (!saved.enabled ? 'Chưa được chọn lưu trên website 3210.' : 'Đang đồng bộ với Studio.'),
      };
    }
    throw new Error('Thao tác không hợp lệ.');
  }).then(
    (result) => respond({ ok: true, ...result }),
    (e) => respond({ ok: false, error: e.message }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void run(async () => {
    const { active } = await chrome.storage.session.get('active');
    if (active?.tabId === tabId) await stopLocal(active.captureId);
  }).catch(() => {});
});
kick();
