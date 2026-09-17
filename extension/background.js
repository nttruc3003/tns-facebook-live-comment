const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
// Serialize storage mutations and uploads, including service-worker wakeups.
let chain = Promise.resolve();
const run = (fn) => {
  const next = chain.then(() => ready).then(fn);
  chain = next.catch(() => {});
  return next;
};
async function state() {
  return chrome.storage.local.get([
    'server',
    'credential',
    'expires',
    'queue',
    'capture',
    'saved',
    'error',
    'lastCapture',
    'deviceId',
    'linkedSession',
  ]);
}
function serverOrigin(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('Chỉ dùng http://localhost:3210 hoặc http://127.0.0.1:3210 trên cùng máy.');
  return u.origin;
}
function video(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      !['www.facebook.com', 'facebook.com', 'm.facebook.com'].includes(u.hostname)
    )
      return null;
    return (
      u.searchParams.get('v')?.match(/^\d+$/)?.[0] ||
      u.pathname.match(/\/videos\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}
async function request(path, body, credential, server) {
  const response = await fetch(`${serverOrigin(server)}/api/capture/bridge/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Server từ chối dữ liệu.'), {
      status: response.status,
    });
  return result;
}
async function heartbeat() {
  const s = await state();
  if (!s.credential || s.expires <= Date.now()) return;
  try {
    const remote = await request('status', {}, s.credential, s.server);
    await chrome.storage.local.set({
      deviceId: remote.deviceId,
      linkedSession: remote.session,
    });
  } catch {
    // Popup status handles expiry and presents the actionable error to the user.
  }
}
chrome.alarms.create('tns-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tns-heartbeat') void run(heartbeat);
});
async function flush() {
  let s = await state();
  if (!s.capture) return;
  try {
    const queue = s.queue || [];
    const batch = queue.slice(0, 20);
    const res = await request(
      'batch',
      { captureId: s.capture.captureId, url: s.capture.url, comments: batch },
      s.credential,
      s.server,
    );
    await chrome.storage.local.set({
      queue: queue.slice(batch.length),
      saved: (s.saved || 0) + res.inserted,
      error: '',
    });
  } catch (e) {
    await chrome.storage.local.set({ error: e.message });
    if ([401, 403, 409].includes(e.status)) {
      await chrome.storage.session.remove('active');
      try {
        await chrome.tabs.sendMessage(s.capture.tabId, { type: 'halt', reason: e.message });
      } catch {}
    }
    throw e;
  }
}
async function stop() {
  await chrome.storage.session.remove('selection');
  const { active } = await chrome.storage.session.get('active');
  if (active)
    try {
      await chrome.tabs.sendMessage(active.tabId, {
        type: 'halt',
        reason: 'Bạn đã dừng ghi. Dữ liệu đã lưu vẫn còn trong Studio.',
      });
    } catch {}
  await chrome.storage.session.remove('active');
  let s = await state();
  // Keep unsent data and show it in popup. Never silently clear a queue on stop.
  while (s.capture && (s.queue || []).length) {
    await flush();
    s = await state();
  }
  if (s.capture) await request('stop', { captureId: s.capture.captureId }, s.credential, s.server);
  await chrome.storage.local.remove('capture');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  run(async () => {
    const popup = !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (sender.id !== chrome.runtime.id) throw new Error('Nguồn không hợp lệ.');
    if (popup) {
      if (message.type === 'status') {
        const s = await state();
        let { active } = await chrome.storage.session.get('active');
        let paired = !!s.credential && s.expires > Date.now(),
          error = s.error;
        if (paired) {
          try {
            const remote = await request('status', {}, s.credential, s.server);
            s.deviceId = remote.deviceId;
            s.linkedSession = remote.session;
            if (active && active.captureId !== remote.captureId) {
              await chrome.storage.session.remove('active');
              try {
                await chrome.tabs.sendMessage(active.tabId, {
                  type: 'halt',
                  reason: 'Phiên đã dừng trên Studio.',
                });
              } catch {}
              active = null;
              error =
                'Phiên đã dừng trên Studio. Dữ liệu chờ vẫn được giữ; xuất JSON trước khi bỏ hàng chờ.';
              if (!(s.queue || []).length) {
                await chrome.storage.local.remove('capture');
                error = 'Phiên đã dừng trên Studio. Có thể chọn video và bắt đầu lại.';
              }
              await chrome.storage.local.set({ error });
            }
          } catch (e) {
            error = e.message;
            if ([401, 403].includes(e.status)) {
              paired = false;
              await chrome.storage.local.remove(['credential', 'expires']);
              if (!(s.queue || []).length) await chrome.storage.local.remove('capture');
              await chrome.storage.local.set({ error });
              await chrome.storage.session.remove('active');
              if (active)
                try {
                  await chrome.tabs.sendMessage(active.tabId, { type: 'halt', reason: error });
                } catch {}
              active = null;
            }
          }
        }
        return {
          paired,
          deviceId: s.deviceId,
          session: s.linkedSession,
          capture: s.capture || s.lastCapture,
          server: s.server,
          pending: (s.queue || []).length,
          saved: s.saved,
          error,
          active: !!active,
        };
      }
      if (message.type === 'pair') {
        const s = await state();
        const server = serverOrigin(message.server);
        if (s.capture || (s.queue || []).length) {
          if (!s.credential || s.server !== server)
            throw new Error('Dừng và gửi hết dữ liệu chờ trước khi ghép nối lại.');
          const current = await request(
            'pair',
            {
              code: message.code,
              extensionId: chrome.runtime.id,
              name: 'Chrome · TNS Live Comments',
              previousCredential: s.credential,
              verifyOnly: true,
            },
            null,
            server,
          );
          await chrome.storage.local.set({
            deviceId: current.deviceId,
            linkedSession: current.session,
            error: '',
          });
          return { session: current.session, alreadyPaired: true };
        }
        const r = await request(
          'pair',
          {
            code: message.code,
            extensionId: chrome.runtime.id,
            name: 'Chrome · TNS Live Comments',
            ...(s.credential && s.server === server ? { previousCredential: s.credential } : {}),
          },
          null,
          server,
        );
        await chrome.storage.local.set({
          server,
          credential: r.credential,
          expires: r.expires,
          deviceId: r.deviceId,
          linkedSession: r.session,
          saved: 0,
          error: '',
        });
        await chrome.storage.local.remove('lastCapture');
        return { session: r.session };
      }
      if (message.type === 'retry') {
        await flush();
        return {};
      }
      if (message.type === 'export-pending') {
        const s = await state();
        return {
          data: {
            video: s.capture?.url,
            comments: s.queue || [],
            warning: 'Dữ liệu quan sát chưa được server xác nhận; có thể trùng dữ liệu đã lưu.',
          },
        };
      }
      if (message.type === 'clear-pending') {
        await chrome.storage.session.remove(['active', 'selection']);
        const s = await state();
        if (s.capture)
          try {
            await chrome.tabs.sendMessage(s.capture.tabId, {
              type: 'halt',
              reason: 'Đã bỏ hàng chờ theo yêu cầu.',
            });
            await request('stop', { captureId: s.capture.captureId }, s.credential, s.server);
          } catch {}
        await chrome.storage.local.remove(['queue', 'capture', 'error']);
        return {};
      }
      if (message.type === 'stop') {
        await stop();
        return {};
      }
      if (message.type === 'select') {
        const s = await state();
        if (!s.credential || s.expires < Date.now()) throw new Error('Ghép nối extension trước.');
        if ((s.queue || []).length)
          throw new Error('Còn dữ liệu chờ. Bấm gửi lại trước khi chọn phiên mới.');
        const tab = await chrome.tabs.get(message.tabId);
        if (video(tab.url) && (!s.linkedSession || s.linkedSession.videoId !== video(tab.url)))
          throw new Error(
            'Mã đang ghép nối thuộc video khác. Mở đúng livestream hoặc ghép nối bằng mã của phiên này.',
          );
        if (!video(tab.url))
          throw new Error(
            'Mở tab /videos/ID hoặc watch?v=ID trước; không chọn news feed/link share.',
          );
        await stop();
        await chrome.storage.session.set({
          selection: {
            tabId: tab.id,
            videoId: video(tab.url),
            url: tab.url,
            title: (tab.title || 'Livestream từ trình duyệt').slice(0, 200),
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
      const { selection } = await chrome.storage.session.get('selection');
      if (
        !selection ||
        selection.tabId !== sender.tab.id ||
        selection.videoId !== video(sender.url)
      )
        throw new Error('Tab không khớp với tab bạn chọn.');
      const s = await state();
      if (s.capture || (s.queue || []).length)
        throw new Error('Phiên trước chưa kết thúc. Dừng và xử lý hàng chờ trước.');
      const c = await request(
        'start',
        { url: selection.url, title: selection.title },
        s.credential,
        s.server,
      );
      const capture = { ...c, ...selection };
      await chrome.storage.local.set({
        capture,
        lastCapture: capture,
        queue: [],
        saved: 0,
        error: '',
      });
      await chrome.storage.session.set({ active: capture });
      await chrome.storage.session.remove('selection');
      return { captureId: c.captureId };
    }
    const { active } = await chrome.storage.session.get('active');
    if (
      !active ||
      message.captureId !== active.captureId ||
      active.tabId !== sender.tab.id ||
      active.videoId !== video(sender.url) ||
      active.videoId !== video(message.url)
    )
      throw new Error('Tab đổi hoặc phiên không còn hoạt động. Bắt đầu lại từ extension.');
    if (message.type === 'end') {
      await stop();
      return {};
    }
    if (message.type === 'batch') {
      const s = await state(),
        queue = s.queue || [];
      if (!Array.isArray(message.comments) || message.comments.length > 20)
        throw new Error('Batch không hợp lệ.');
      // Sender is isolated extension code; server independently validates every field.
      const ids = new Set(queue.map((c) => c.id));
      const fresh = message.comments.filter((c) => !ids.has(c.id));
      if (queue.length + fresh.length > 300)
        throw new Error('Hàng chờ đã đầy (300). Giữ tab mở, khôi phục server rồi gửi lại.');
      await chrome.storage.local.set({ queue: [...queue, ...fresh] });
      try {
        await flush();
      } catch {
        /* Persisted queue is acknowledged, upload error remains visible. */
      }
      const after = await state();
      return { pending: after.queue?.length || 0, saved: after.saved || 0, error: after.error };
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
    if (active?.tabId === tabId) await stop();
  }).catch(async (e) => {
    await chrome.storage.local.set({ error: `Tab đã đóng: ${e.message}` });
  });
});
