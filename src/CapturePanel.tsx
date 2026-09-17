import { useEffect, useState } from 'react';
import { api, post } from './api';

type Session = {
  streamId: string;
  videoId: string;
  title: string;
  url: string;
  updatedAt: number | null;
  deviceCount: number;
  onlineDeviceCount: number;
  collecting: number;
};
type Pair = { code: string; updatedAt: number; session: Session };
type Device = {
  id: string;
  name: string;
  expires: number;
  pairedStreamId: string | null;
  streamTitle: string | null;
  collecting: number;
  connected: number;
};

export function CapturePanel({ initialUrl = '' }: { initialUrl?: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<Pair | null>(null);
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const data = await api<{ devices: Device[]; sessions: Session[] }>('/capture');
    setDevices(data.devices);
    setSessions(data.sessions);
    setPair((current) =>
      !current ||
      data.sessions.some(
        (s) => s.streamId === current.session.streamId && s.updatedAt === current.updatedAt,
      )
        ? current
        : null,
    );
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="capture-panel">
      <h2>Mỗi livestream, một mã kết nối</h2>
      <p>
        Mã được giữ nguyên sau khi ghép nối, đóng trình duyệt hoặc khởi động lại Studio. Chỉ thay
        khi bạn chọn <b>Đổi mã</b>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            setPair(
              await post<Pair>('/capture/pair-code', { url: url.trim(), title: title.trim() }),
            );
            setNotice('Đã mở mã của livestream. Nếu phiên đã có mã, mã cũ được giữ nguyên.');
          });
        }}
      >
        <label>
          Link livestream Facebook
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/watch/?v=…"
          />
        </label>
        <label>
          Tên phiên (không bắt buộc khi tạo mới)
          <input
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Mini game tối thứ Sáu"
          />
        </label>
        <div className="button-row settings-actions">
          <button className="button primary" disabled={busy}>
            Lấy mã livestream
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => action(load)}
          >
            Làm mới
          </button>
        </div>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {pair && (
        <section className="notice">
          <h3>
            {pair.session.title} · Video {pair.session.videoId}
          </h3>
          <label>
            Mã duy nhất của phiên
            <input
              readOnly
              value={pair.code}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Mã kết nối livestream"
            />
          </label>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  if (!navigator.clipboard)
                    throw new Error('Hãy bấm vào ô mã, chọn toàn bộ rồi sao chép.');
                  await navigator.clipboard.writeText(pair.code);
                  setNotice('Đã sao chép. Mở extension TNS trong Chrome, dán mã và bấm Ghép nối.');
                })
              }
            >
              Sao chép mã
            </button>
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  if (
                    !window.confirm(
                      'Đổi mã phiên này? Mã cũ và các kết nối của phiên sẽ mất hiệu lực; comment đã lưu vẫn được giữ. Gửi hết hàng chờ trước khi đổi.',
                    )
                  )
                    return;
                  setPair(
                    await post<Pair>('/capture/sessions/' + pair.session.streamId + '/rotate'),
                  );
                  setNotice('Đã đổi mã. Ghép nối lại extension bằng mã mới để tiếp tục phiên này.');
                })
              }
            >
              Đổi mã
            </button>
          </div>
          <p>
            Giữ mã riêng tư. Ai có mã và truy cập được máy chủ local có thể ghép nối để ghi vào
            phiên này. Thu hồi một thiết bị không vô hiệu mã; hãy đổi mã nếu cần chặn ghép nối lại.
          </p>
        </section>
      )}
      <h3>Livestream đã tạo</h3>
      {!sessions.length && <p className="muted">Nhập link bên trên để tạo phiên đầu tiên.</p>}
      {sessions.map((s) => (
        <div className="source-row" key={s.streamId}>
          <span>
            <b>{s.title}</b>
            <small>
              {' '}
              · Video {s.videoId} ·{' '}
              {s.collecting
                ? 'Đang ghi'
                : s.onlineDeviceCount
                  ? 'Đang kết nối'
                  : s.deviceCount
                    ? 'Đã ghép nối · Ngoại tuyến'
                    : 'Chưa ghép nối'}{' '}
              · {s.onlineDeviceCount}/{s.deviceCount} thiết bị online
            </small>
          </span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                setPair(await post<Pair>('/capture/pair-code', { url: s.url }));
              })
            }
          >
            {s.updatedAt ? 'Xem mã' : 'Lấy mã'}
          </button>
        </div>
      ))}
      <details>
        <summary>Thiết bị đã kết nối ({devices.length})</summary>
        {devices.map((d) => (
          <div className="source-row" key={d.id}>
            <span>
              <b>{d.name}</b>
              <small>
                {' '}
                · {d.id.slice(0, 8)} ·{' '}
                {d.pairedStreamId ? d.streamTitle : 'Kết nối cũ — cần mã riêng của phiên'} ·{' '}
                {d.expires < Date.now()
                  ? 'Đã hết hạn'
                  : d.collecting
                    ? 'Đang ghi'
                    : d.connected
                      ? 'Đang kết nối'
                      : 'Ngoại tuyến'}
              </small>
            </span>
            <button
              className="text-button danger"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  if (
                    !window.confirm(
                      'Thu hồi thiết bị ' + d.id.slice(0, 8) + '? Comment đã lưu không bị xóa.',
                    )
                  )
                    return;
                  await api('/capture/devices/' + d.id, { method: 'DELETE' });
                  setNotice('Đã thu hồi thiết bị. Mã của phiên và comment đã lưu vẫn được giữ.');
                })
              }
            >
              Thu hồi
            </button>
          </div>
        ))}
      </details>
      <details>
        <summary>Cách ghép nối và bắt đầu ghi</summary>
        <ol>
          <li>
            Cài thư mục <code>extension</code> qua Chrome → Extensions → Developer mode → Load
            unpacked, trên cùng máy chạy Studio.
          </li>
          <li>
            Lấy mã livestream ở trên, bấm biểu tượng TNS trên thanh công cụ Chrome, dán mã và bấm{' '}
            <b>Ghép nối</b>. Extension sẽ thông báo thành công và tên phiên.
          </li>
          <li>
            Mở đúng video Facebook, bấm extension → <b>Chọn tab này &amp; vùng comment</b>, chọn một
            comment mẫu rồi xác nhận bắt đầu.
          </li>
        </ol>
        <p>
          Không mở trực tiếp file popup.html. Máy LAN có thể xem Studio, nhưng extension phải chạy
          cùng máy chủ. Mỗi video có lịch sử riêng; dừng rồi ghi lại tiếp tục lịch sử đó. Chỉ thu
          thập khi có quyền phù hợp; comment chưa tải hoặc bị ẩn có thể bị thiếu.
        </p>
      </details>
    </div>
  );
}
