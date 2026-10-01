import { useEffect, useState } from 'react';
import { api } from './api';

type LogSummary = {
  id: string;
  seq: number;
  createdAt: number;
  finishedAt: number | null;
  provider: string;
  model: string;
  commentCount: number;
  status: string;
  error: string | null;
};
type LogDetail = LogSummary & {
  endpoint: string | null;
  requestBody: string | null;
  attempts: {
    attempt: number;
    status: number;
    body: string;
    requestId: string | null;
    receivedAt: number;
  }[];
  result: unknown;
};
const statuses: Record<string, string> = {
  pending: 'Đang xử lý',
  completed: 'Đã lưu kết quả',
  error: 'Lỗi',
  interrupted: 'Bị gián đoạn',
};
const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};
export function AILogs({ streamId }: { streamId: string }) {
  const [rows, setRows] = useState<LogSummary[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [section, setSection] = useState<'request' | 'response' | 'result'>('request');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void api<{ items: LogSummary[]; nextBefore: number | null }>(`/streams/${streamId}/ai-logs`)
      .then((result) => {
        if (cancelled) return;
        setRows(result.items);
        setBefore(result.nextBefore);
        setSelected(result.items[0]?.id || '');
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [streamId, revision]);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (!selected) return;
    setDetailLoading(true);
    void api<LogDetail>(`/streams/${streamId}/ai-logs/${selected}`)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [streamId, selected, revision]);
  async function older() {
    if (!before) return;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ items: LogSummary[]; nextBefore: number | null }>(
        `/streams/${streamId}/ai-logs?before=${before}`,
      );
      setRows((current) => [...current, ...result.items]);
      setBefore(result.nextBefore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function download() {
    if (!detail) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-autofill-${detail.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="ai-logs">
      <p>
        Mỗi mục là một chunk AI autofill, mới nhất ở trên. Log lưu trên máy chủ, không lưu API key.
        Chỉ có các lần chạy từ khi bật tính năng này.
      </p>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          Làm mới log
        </button>
        <button className="button secondary" disabled={!detail || detailLoading} onClick={download}>
          Tải log JSON
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {loading && <p role="status">Đang tải log…</p>}
      {!loading && !rows.length && !error && (
        <p>Chưa có log. Bấm AI autofill rồi mở lại Lịch sử gọi AI.</p>
      )}
      <div className="ai-log-list" aria-label="Các lần gọi AI">
        {rows.map((row) => (
          <button
            key={row.id}
            className={`ai-log-entry${row.id === selected ? ' selected' : ''}`}
            aria-pressed={row.id === selected}
            onClick={() => {
              setSelected(row.id);
              setError('');
            }}
          >
            <strong>
              {new Date(row.createdAt).toLocaleString('vi')} · {row.model}
            </strong>
            <span>
              {row.commentCount} comment · {statuses[row.status] || row.status}
            </span>
          </button>
        ))}
      </div>
      {before && (
        <button className="button secondary" disabled={loading} onClick={() => void older()}>
          Xem log cũ hơn
        </button>
      )}
      {detailLoading && <p role="status">Đang tải chi tiết…</p>}
      {detail && (
        <div className="ai-log-detail">
          <p>
            {detail.provider} · {detail.model} · {statuses[detail.status] || detail.status}
            {detail.finishedAt &&
              ` · ${((detail.finishedAt - detail.createdAt) / 1000).toFixed(1)} giây`}
          </p>
          {detail.error && <div className="notice error">{detail.error}</div>}
          <div className="button-row" aria-label="Nội dung log">
            <button
              className="button secondary"
              aria-pressed={section === 'request'}
              onClick={() => setSection('request')}
            >
              Đã gửi (request)
            </button>
            <button
              className="button secondary"
              aria-pressed={section === 'response'}
              onClick={() => setSection('response')}
            >
              API trả về (response)
            </button>
            <button
              className="button secondary"
              aria-pressed={section === 'result'}
              onClick={() => setSection('result')}
            >
              Kết quả đã xử lý
            </button>
          </div>
          {section === 'request' && (
            <>
              <p>{detail.endpoint || 'Chưa gửi API'}</p>
              <pre>
                {detail.requestBody
                  ? pretty(detail.requestBody)
                  : 'Chưa có request gửi đến nhà cung cấp.'}
              </pre>
            </>
          )}
          {section === 'response' && (
            <>
              {!detail.attempts.length && <p>Chưa nhận được phản hồi API.</p>}
              {detail.attempts.map((attempt) => (
                <section key={attempt.attempt}>
                  <h3>
                    Lần {attempt.attempt} · HTTP {attempt.status}
                  </h3>
                  {attempt.requestId && <p>Request ID: {attempt.requestId}</p>}
                  <pre>{pretty(attempt.body)}</pre>
                </section>
              ))}
            </>
          )}
          {section === 'result' && (
            <>
              <p>
                extracted: số sau khi kiểm tra/tách số; saved: các giá trị thực tế đã lưu; skipped:
                comment đã thay đổi nên bỏ qua.
              </p>
              <pre>
                {detail.result
                  ? JSON.stringify(detail.result, null, 2)
                  : 'Chưa có kết quả được lưu.'}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
