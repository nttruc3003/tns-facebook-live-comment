import { useEffect, useState } from 'react';
import { api, post } from './api';

type Source = {
  id: string;
  name: string;
  title: string;
  videoId: string;
  url: string;
  running: number;
  connected: number;
  pending: number;
  ackSeq: number;
  enabled: number;
  streamId: string | null;
  streamTitle: string | null;
  startedAt: number;
  lastSeen: number;
};
export function CapturePanel({
  initialUrl = '',
  activeOnly = false,
}: {
  initialUrl?: string;
  activeOnly?: boolean;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const visibleSources = activeOnly
    ? sources.filter((source) => source.running && source.connected)
    : sources;
  async function load() {
    const data = await api<{ sources: Source[] }>('/capture/sources');
    setSources(data.sources);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch((e) => setError(e.message)), 3000);
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
      <h2>Chọn nguồn đang Collect</h2>
      <p>
        Mở livestream Facebook trên máy chạy Studio, bấm extension → <b>Collect</b>. Chọn nguồn bên
        dưới để lưu hàng chờ và comment mới vào livestream.
      </p>
      {initialUrl && (
        <p>
          Link bạn đã chọn:{' '}
          <a href={initialUrl} target="_blank" rel="noreferrer">
            {initialUrl}
          </a>
          . Mở link này trong Chrome rồi bấm Collect.
        </p>
      )}
      <button className="button secondary" disabled={busy} onClick={() => action(load)}>
        Làm mới
      </button>
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
      {!visibleSources.length && (
        <div className="notice">
          {activeOnly
            ? 'Chưa có extension đang Collect và còn kết nối. Mở tab livestream, bấm Collect trong extension để nguồn xuất hiện ở đây.'
            : 'Chưa thấy nguồn thu. Extension 0.5.0 trở lên sẽ xuất hiện sau khi bắt đầu Collect. Không cần mã kết nối.'}
        </div>
      )}
      {visibleSources.map((s) => (
        <section className="capture-source-card" key={s.id}>
          <div className="capture-source-heading">
            <h3>{s.name}</h3>
            <span className={`badge ${s.connected ? 'green' : 'neutral'}`}>
              {!s.connected ? 'Ngoại tuyến' : s.running ? 'Đang Collect' : 'Đã dừng thu'}
            </span>
          </div>
          <p>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>{' '}
            · Video {s.videoId}
          </p>
          <p>
            <b>{s.pending.toLocaleString('vi-VN')}</b> đang chờ · {s.ackSeq.toLocaleString('vi-VN')}{' '}
            đã đồng bộ
          </p>
          <small>
            Bắt đầu {new Date(s.startedAt).toLocaleString('vi-VN')} · Liên lạc cuối{' '}
            {new Date(s.lastSeen).toLocaleTimeString('vi-VN')}
          </small>
          {!!s.enabled && (
            <p>
              {s.pending
                ? 'Đang đồng bộ hàng chờ. Kết quả gameshow còn tạm tính.'
                : 'Đã đồng bộ hàng chờ.'}{' '}
              Lưu vào: {s.streamTitle}.
            </p>
          )}
          {!s.enabled && (
            <label>
              Tên livestream
              <input
                value={titles[s.id] ?? ''}
                onChange={(e) => setTitles((current) => ({ ...current, [s.id]: e.target.value }))}
                placeholder={s.streamTitle || s.title}
                maxLength={200}
                disabled={busy}
              />
              <small>
                Để trống để dùng tên hiện tại. Tên này hiển thị trong danh sách livestream.
              </small>
            </label>
          )}
          <div className="button-row settings-actions">
            {s.enabled ? (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await post(`/capture/sources/${s.id}/pause`, {});
                    setNotice(
                      'Đã ngừng lưu vào database. Extension vẫn Collect và giữ hàng chờ trên máy.',
                    );
                  })
                }
              >
                Ngừng lưu
              </button>
            ) : (
              <button
                className="button primary"
                disabled={busy || !s.connected}
                onClick={() =>
                  action(async () => {
                    const title = titles[s.id]?.trim();
                    await post(`/capture/sources/${s.id}/select`, title ? { title } : {});
                    setNotice(
                      'Đã chọn nguồn. Hàng chờ sẽ tự đồng bộ, sau đó tiếp tục lưu comment mới.',
                    );
                  })
                }
              >
                Chọn &amp; lưu
              </button>
            )}
          </div>
        </section>
      ))}
      <p className="muted">
        {activeOnly
          ? 'Chỉ hiển thị extension đang Collect và còn kết nối. Một video dùng chung một lịch sử và một nguồn ghi tại một thời điểm.'
          : 'Một video dùng chung một lịch sử và một nguồn ghi tại một thời điểm. Các lượt đã dừng vẫn có thể được chọn để gửi hàng chờ.'}
      </p>
    </div>
  );
}
