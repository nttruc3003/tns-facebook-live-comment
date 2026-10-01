import {
  Fragment,
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Radio,
  LayoutDashboard,
  MessageSquare,
  Trophy,
  History,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ListFilter,
  ChevronLeft,
  Download,
  Play,
  Pause,
  Check,
  CheckCircle2,
  X,
  Users,
  CircleHelp,
  LogOut,
  Wifi,
  Link2,
  Sparkles,
  ShieldCheck,
  Database,
  Circle,
  Zap,
  SlidersHorizontal,
  Facebook,
  Loader2,
  Copy,
  Monitor,
  RefreshCw,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { api, post, setCsrf, downloadBackup } from './api';
import { CapturePanel } from './CapturePanel';
import { AILogs } from './AILogs';
import { autofillInChunks } from './autofill';
import { aiModelOptions } from '../shared/ai-models';
import {
  defaultFilter,
  numberFields,
  type NumberField,
  type NumberDraft,
  type User,
  type Stream,
  type Comment,
  type Filter,
  type Analysis,
} from '../shared/types';

type View = 'overview' | 'studio' | 'history' | 'settings';
type Source = { id: string; name: string; kind: string };
type CommentColumn = 'author' | 'message' | 'time' | NumberField;
const numberLabels = ['1st number', '2nd number', '3rd number'];
const emptyColumnFilters: Record<CommentColumn, string> = {
  author: '',
  message: '',
  time: '',
  firstNumber: '',
  secondNumber: '',
  thirdNumber: '',
};
const date = (n: number) =>
  new Date(n).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const time = (n: number) =>
  new Date(n).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const number = (n: number) => n.toLocaleString('vi-VN');
const roleName = { admin: 'Quản trị viên', operator: 'Điều hành', viewer: 'Người xem' };
const initials = (name: string) =>
  name
    .split(' ')
    .slice(-2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
function IconButton({
  children,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Avatar({
  name,
  url,
  className = '',
}: {
  name: string;
  url?: string | null;
  className?: string;
}) {
  return (
    <span className={`avatar ${className}`}>
      <span className="avatar-initials">{initials(name)}</span>
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
        ) || []),
      ];
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
        event.preventDefault();
        elements[0].focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <IconButton label="Đóng" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function Auth({ setup, onReady }: { setup: boolean; onReady: (u: User) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await post(setup ? '/auth/setup' : '/auth/login', data);
      setCsrf(result.csrf);
      onReady(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand light">
          <span className="brand-icon">
            <Radio size={23} />
          </span>
          <span>
            TNS <strong>Live Studio</strong>
          </span>
        </div>
        <div className="auth-story-content">
          <span className="eyebrow">MADE FOR YOUR LIVE MOMENTS</span>
          <h1>
            Kết nối thật.
            <br />
            Khoảnh khắc
            <br />
            <em>đáng nhớ.</em>
          </h1>
          <p>Một không gian cho bình luận, mini game và những buổi live đầy cảm hứng.</p>
          <div className="auth-comments">
            <div className="floating-comment">
              <span className="avatar lavender">LA</span>
              <div>
                <b>Linh Anh</b>
                <p>Em chọn số 5 nha! 💜</p>
              </div>
              <span className="little-heart">♡</span>
            </div>
            <div className="floating-comment second">
              <span className="avatar peach">MT</span>
              <div>
                <b>Mai Trần</b>
                <p>Hóng mini game của shop ✨</p>
              </div>
              <span className="little-heart">♡</span>
            </div>
          </div>
        </div>
        <div className="auth-footer">
          <ShieldCheck size={16} /> Dữ liệu trên máy bạn. Trải nghiệm của cả team.
        </div>
      </section>
      <main className="auth-form-area">
        <div className="auth-form">
          <Badge tone="purple">
            <Radio size={12} /> LOCAL-FIRST · OPEN SOURCE
          </Badge>
          <h2>{setup ? 'Chào mừng đến Studio.' : 'Chào mừng trở lại.'}</h2>
          <p>
            {setup
              ? 'Thiết lập tài khoản đầu tiên để bắt đầu buổi live của bạn.'
              : 'Đăng nhập vào không gian livestream của team.'}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <>
                <label>
                  Tên hiển thị
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Tên của bạn"
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  Mã thiết lập máy chủ
                  <input
                    name="setupToken"
                    placeholder="Mã hiển thị trong terminal"
                    required
                    autoComplete="off"
                  />
                  <small>Chỉ người có mã trên máy chủ mới tạo được admin.</small>
                </label>
              </>
            )}
            <label>
              Tên đăng nhập
              <input
                name="username"
                autoComplete="username"
                placeholder="vd: admin.tns"
                pattern="[a-zA-Z0-9_.\-]{3,40}"
                minLength={3}
                maxLength={40}
                required
              />
            </label>
            <label>
              Mật khẩu
              <input
                name="password"
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                placeholder="Tối thiểu 10 ký tự"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {error && <div className="notice error">{error}</div>}
            <button className="button primary full" disabled={busy}>
              {busy ? <Loader2 className="spin" size={17} /> : null}
              {setup ? 'Tạo không gian của bạn' : 'Đăng nhập'}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-note">
            <Wifi size={16} />
            <span>Truy cập cùng máy chủ để dùng chung dữ liệu qua LAN.</span>
          </div>
        </div>
        <footer>
          TEAM NAIL SUPPLY <span>Live Studio v0.1</span>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('overview');
  const [list, setList] = useState<Stream[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [realtime, setRealtime] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [help, setHelp] = useState(false);
  const editable = user?.role !== 'viewer';
  const refresh = useCallback(async () => {
    const rows = await api<Stream[]>('/streams');
    setList(rows);
  }, []);
  const say = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const run = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      try {
        await fn();
      } catch (e) {
        say((e as Error).message, true);
      } finally {
        setBusy('');
      }
    },
    [say],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api('/auth/status');
        if (cancelled) return;
        setSetup(status.needsSetup);
        if (!status.needsSetup) {
          try {
            const session = await api('/auth/session');
            if (!cancelled) {
              setCsrf(session.csrf);
              setUser(session.user);
            }
          } catch {}
        }
      } catch (e) {
        if (!cancelled) say((e as Error).message, true);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [say]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    void refresh().catch((e) => say(e.message, true));
    const events = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setRevision((v) => v + 1);
        void refresh().catch((e) => say(e.message, true));
      }, 400);
    };
    events.addEventListener('ready', () => {
      setRealtime(true);
      update();
    });
    events.onerror = () => {
      setRealtime(false);
      void api('/auth/session').catch((error) => {
        if (error.status === 401) {
          setCsrf('');
          setUser(null);
          say('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.', true);
        }
      });
    };
    events.addEventListener('refresh', update);
    const focus = () => update();
    window.addEventListener('focus', focus);
    return () => {
      events.close();
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
      setRealtime(false);
    };
  }, [user, refresh, say]);
  const open = (id: string) => {
    setSelected(id);
    setView('studio');
  };
  const live = list.find((s) => s.id === selected);
  const demo = () =>
    run('demo', async () => {
      const { id } = await post('/demo');
      await refresh();
      open(id);
      say('Phiên demo đã sẵn sàng. Đây là dữ liệu mẫu, không phải Facebook live.');
    });
  const removeStream = (stream: Stream) => {
    const confirmed = window.confirm(
      `Xóa livestream “${stream.title}”?\n\nToàn bộ ${number(stream.commentCount)} bình luận, kết quả gameshow, mã ghép nối và kết nối extension của livestream này sẽ bị xóa vĩnh viễn. Thao tác này không thể hoàn tác.`,
    );
    if (!confirmed) return;
    void run(`delete-stream-${stream.id}`, async () => {
      await api(`/streams/${stream.id}`, { method: 'DELETE' });
      if (selected === stream.id) setSelected(null);
      await refresh();
      setRevision((value) => value + 1);
      say(`Đã xóa livestream “${stream.title}” và toàn bộ dữ liệu liên kết.`);
    });
  };
  if (!ready)
    return (
      <div className="loading-screen">
        <Radio className="pulse" size={36} />
        <span>Đang mở Studio…</span>
      </div>
    );
  if (!user)
    return (
      <>
        <Auth
          setup={setup}
          onReady={(u) => {
            setUser(u);
            setSetup(false);
          }}
        />
        {toast && <div className="toast error">{toast.text}</div>}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('overview');
          }}
        >
          <span className="brand-icon">
            <Radio size={22} />
          </span>
          <span>
            TNS <strong>Live Studio</strong>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-avatar">TN</div>
          <div>
            <b>Team Nail Supply</b>
            <span>Không gian của bạn</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">KHÔNG GIAN LÀM VIỆC</span>
        <nav>
          <button
            className={view === 'overview' ? 'active' : ''}
            onClick={() => setView('overview')}
          >
            <LayoutDashboard size={19} />
            Tổng quan
          </button>
          <button
            className={view === 'studio' ? 'active' : ''}
            onClick={() => (selected ? setView('studio') : setView('overview'))}
          >
            <Radio size={19} />
            Livestream
            {list.filter((s) => s.collecting).length > 0 && (
              <span className="nav-count">{list.filter((s) => s.collecting).length}</span>
            )}
          </button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            <History size={19} />
            Lịch sử kết quả
          </button>
          {user.role === 'admin' && (
            <button
              className={view === 'settings' ? 'active' : ''}
              onClick={() => setView('settings')}
            >
              <Settings size={19} />
              Cài đặt
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <ShieldCheck size={20} />
            </span>
            <b>Ở đây, dữ liệu là của bạn.</b>
            <p>Comment được lưu trực tiếp trên máy chủ của team.</p>
            <span>
              <span className="status-dot green" /> Local storage
            </span>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={18} /> Hướng dẫn sử dụng <ArrowUpRight size={15} />
          </button>
          <div className="user-block">
            <span className="avatar purple-avatar">{initials(user.name)}</span>
            <div>
              <b>{user.name}</b>
              <small>{roleName[user.role]}</small>
            </div>
            <IconButton
              label="Đăng xuất"
              onClick={() =>
                run('logout', async () => {
                  await post('/auth/logout');
                  setCsrf('');
                  setUser(null);
                })
              }
            >
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{' '}
            <b>
              {
                {
                  overview: 'Tổng quan',
                  studio: 'Livestream',
                  history: 'Lịch sử kết quả',
                  settings: 'Cài đặt',
                }[view]
              }
            </b>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span className={`status-dot ${realtime ? 'green' : 'amber'}`} />
              {realtime ? 'Đã kết nối máy chủ' : 'Đang kết nối lại'}
            </span>
            <span className="topbar-divider" />
            <span className="local-address">
              <Wifi size={15} />
              {window.location.host}
            </span>
          </div>
        </header>
        <main className={`content ${view === 'studio' ? 'studio-content' : ''}`}>
          {view === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow muted">YOUR LIVE, ALL IN ONE PLACE</span>
                  <h1>Không gian livestream</h1>
                  <p>Kết nối với khán giả. Lưu từng tương tác. Tạo những cuộc chơi vui.</p>
                </div>
                {editable && (
                  <button className="button primary" onClick={() => setImportOpen(true)}>
                    <Plus size={17} />
                    Thêm livestream
                  </button>
                )}
              </div>
              <section className="welcome-banner">
                <div>
                  <Badge tone="purple">
                    <Sparkles size={12} /> MỘT BUỔI LIVE, NHIỀU KHẢ NĂNG
                  </Badge>
                  <h2>
                    Để mỗi bình luận
                    <br />
                    đều được <em>ghi nhận.</em>
                  </h2>
                  <p>
                    Từ tương tác đầu tiên đến kết quả mini game,
                    <br className="desktop-only" /> tất cả trong một không gian của riêng bạn.
                  </p>
                  <button
                    className="text-link"
                    onClick={editable ? demo : () => setHelp(true)}
                    disabled={busy === 'demo'}
                  >
                    {busy === 'demo' ? <Loader2 className="spin" size={16} /> : <Play size={15} />}{' '}
                    {editable ? 'Khám phá với dữ liệu demo' : 'Khám phá cách Studio hoạt động'}{' '}
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="orbit one" />
                  <div className="orbit two" />
                  <div className="art-chat">
                    <span className="avatar peach">LA</span>
                    <span>
                      <b>Linh Anh</b>
                      <small>Em chọn số 5 nha 💜</small>
                    </span>
                    <span className="art-time">vừa xong</span>
                  </div>
                  <div className="art-result">
                    <span className="trophy-icon">
                      <Trophy size={23} />
                    </span>
                    <span>
                      <small>MỖI TƯƠNG TÁC ĐỀU CÓ Ý NGHĨA</small>
                      <b>Cuộc chơi của cả nhà.</b>
                    </span>
                    <Sparkles size={19} />
                  </div>
                  <div className="art-label">
                    <ShieldCheck size={15} /> Được lưu trên máy bạn
                  </div>
                </div>
              </section>
              <div className="stats-grid">
                <Stat
                  icon={<Radio size={20} />}
                  label="Đang thu thập"
                  value={list.filter((s) => s.collecting).length}
                  note="Phiên đang được đồng bộ"
                  color="purple"
                />
                <Stat
                  icon={<MessageSquare size={20} />}
                  label="Bình luận đã lưu"
                  value={list.reduce((n, s) => n + s.commentCount, 0)}
                  note="Sẵn sàng để xem lại"
                  color="blue"
                />
                <Stat
                  icon={<Users size={20} />}
                  label="Lượt tham gia"
                  value={list.reduce((n, s) => n + s.participantCount, 0)}
                  note="Tổng người có ID theo từng phiên"
                  color="orange"
                />
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Livestream của bạn <span className="count-pill">{list.length}</span>
                  </h2>
                  <p>Ưu tiên phiên đang thu thập và đang phát trực tiếp.</p>
                </div>
                <button className="button secondary small" onClick={() => run('refresh', refresh)}>
                  <RefreshCw size={14} className={busy === 'refresh' ? 'spin' : ''} /> Làm mới
                </button>
              </div>
              {list.length ? (
                <div className="stream-list">
                  {list.map((s) => (
                    <StreamListItem
                      key={s.id}
                      stream={s}
                      editable={editable}
                      deleting={busy === `delete-stream-${s.id}`}
                      onOpen={() => open(s.id)}
                      onDelete={() => removeStream(s)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Radio size={30} />
                  </div>
                  <h3>Sân khấu đã sẵn sàng.</h3>
                  <p>
                    Chọn tab livestream bằng extension đã ghép nối,
                    <br />
                    hoặc thử một mini game với dữ liệu demo.
                  </p>
                  {editable && (
                    <div className="button-row">
                      <button className="button primary" onClick={() => setImportOpen(true)}>
                        <Plus size={16} />
                        Thêm livestream
                      </button>
                      <button
                        className="button secondary"
                        onClick={demo}
                        disabled={busy === 'demo'}
                      >
                        Thử bản demo <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              )}
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} /> Dữ liệu được lưu trên máy chủ · Không cần cloud database
                </span>
                <span>
                  TNS Live Studio <span className="footer-dot">·</span> v0.1.0
                </span>
              </footer>
            </>
          )}
          {view === 'studio' &&
            (live ? (
              <Studio
                key={live.id}
                live={live}
                editable={editable}
                revision={revision}
                busy={busy}
                run={run}
                say={say}
                onBack={() => setView('overview')}
                onConnect={() => setImportOpen(true)}
                onResult={setResult}
              />
            ) : (
              <div className="empty-state">
                <Radio size={32} />
                <h3>Chọn một livestream để bắt đầu</h3>
                <button className="button primary" onClick={() => setView('overview')}>
                  Về tổng quan
                </button>
              </div>
            ))}
          {view === 'history' && (
            <HistoryView revision={revision} run={run} onResult={setResult} onOpen={open} />
          )}
          {view === 'settings' && user.role === 'admin' && (
            <SettingsView user={user} run={run} busy={busy} say={say} />
          )}
        </main>
      </div>
      {importOpen && (
        <ImportModal
          initialUrl={view === 'studio' && live?.kind === 'browser' ? live.url : undefined}
          onClose={() => setImportOpen(false)}
        />
      )}
      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {help && (
        <Modal title="Một vòng chơi trong Studio" onClose={() => setHelp(false)}>
          <div className="help-steps">
            <p>
              <b>01 · Kết nối nguồn</b> Lấy mã riêng của livestream, ghép nối extension trên máy
              chủ, chọn tab và vùng comment cần ghi.
            </p>
            <p>
              <b>02 · Theo dõi livestream</b> Chọn phiên, bật thu thập và giữ máy chủ hoạt động. Mọi
              thiết bị LAN dùng chung dữ liệu.
            </p>
            <p>
              <b>03 · Chọn luật chơi</b> Chọn hai comment mốc cùng tác giả, nhập số cần tìm và chọn
              đếm người hoặc comment.
            </p>
            <p>
              <b>04 · Kiểm tra kết quả</b> Mỗi lần tính lưu một bản kết quả và các comment làm bằng
              chứng. Comment thiếu ID không được tính là người duy nhất.
            </p>
            <div className="notice">
              Hai mốc được loại khỏi kết quả. Nguồn trình duyệt tính theo thứ tự ghi nhận, không
              phải thứ tự gửi thật. Dữ liệu có thể thiếu/trùng; app không xác nhận thu đủ mọi
              comment.
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div role="status" className={`toast ${toast.error ? 'error' : ''}`}>
          {toast.error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.text}</span>
          <IconButton label="Đóng thông báo" onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  note,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  note: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <strong>{number(value)}</strong>
      <small>{note}</small>
    </div>
  );
}
function StreamListItem({
  stream: s,
  editable,
  deleting,
  onOpen,
  onDelete,
}: {
  stream: Stream;
  editable: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const status = s.collecting
    ? 'Đang thu thập'
    : s.kind === 'demo'
      ? 'Dữ liệu demo'
      : s.status === 'LIVE'
        ? 'Đang live'
        : s.status === 'SCHEDULED'
          ? 'Sắp live'
          : 'Đã lưu';
  return (
    <article className="stream-list-item">
      <button className="stream-list-main" onClick={onOpen}>
        <span className={`stream-list-icon ${s.collecting ? 'active' : ''}`}>
          <Radio size={20} />
        </span>
        <span className="stream-list-title">
          <span className="stream-list-heading">
            <strong>{s.title}</strong>
            <Badge tone={s.collecting ? 'green' : s.kind === 'demo' ? 'purple' : 'neutral'}>
              {s.collecting && <span className="status-dot green" />}
              {status}
            </Badge>
          </span>
          <small>{s.pageName}</small>
          {s.kind === 'browser' && <small>Video Facebook · {s.facebookId}</small>}
          {s.error && <small className="text-danger">Cần kiểm tra kết nối</small>}
        </span>
        <span className="stream-list-metric">
          <MessageSquare size={15} />
          <span>
            <strong>{number(s.commentCount)}</strong>
            <small>Bình luận</small>
          </span>
        </span>
        <span className="stream-list-metric participants">
          <Users size={15} />
          <span>
            <strong>{number(s.participantCount)}</strong>
            <small>Người tham gia</small>
          </span>
        </span>
        <span className="stream-list-date">
          <small>Ngày tạo</small>
          <strong>{date(s.createdAt)}</strong>
        </span>
        <span className="stream-list-open" aria-hidden="true">
          <ArrowUpRight size={19} />
        </span>
      </button>
      {editable && (
        <div className="stream-list-actions">
          <button
            className="icon-button stream-delete"
            type="button"
            title={`Xóa ${s.title}`}
            aria-label={`Xóa livestream ${s.title}`}
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
          </button>
        </div>
      )}
    </article>
  );
}

type Run = (name: string, fn: () => Promise<void>) => Promise<void>;
function Studio({
  live,
  editable,
  revision,
  busy,
  run,
  say,
  onBack,
  onConnect,
  onResult,
}: {
  live: Stream;
  editable: boolean;
  revision: number;
  busy: string;
  run: Run;
  say: (s: string, e?: boolean) => void;
  onBack: () => void;
  onConnect: () => void;
  onResult: (a: Analysis) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [markers, setMarkers] = useState<Comment[]>([]);
  const [rangeComments, setRangeComments] = useState<Comment[]>([]);
  const [commentTab, setCommentTab] = useState<'live' | 'filter'>('live');
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState('');
  const [rangeStartId, setRangeStartId] = useState<string | null>(null);
  const [rangeEndId, setRangeEndId] = useState<string | null>(null);
  const [rangeNumbers, setRangeNumbers] = useState<Record<string, NumberDraft>>({});
  const [savingNumbers, setSavingNumbers] = useState(false);
  const [clearingNumbers, setClearingNumbers] = useState(false);
  const [activeColumnFilter, setActiveColumnFilter] = useState<CommentColumn | null>(null);
  const [columnFilters, setColumnFilters] = useState(emptyColumnFilters);
  const [chunkSize, setChunkSize] = useState<10 | 20>(20);
  const [autofilling, setAutofilling] = useState(false);
  const [showAILogs, setShowAILogs] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState('');
  const [autofillError, setAutofillError] = useState('');
  const [retryIds, setRetryIds] = useState<string[]>([]);
  const autofillJob = useRef<{ stopped: boolean } | null>(null);
  const draftsRef = useRef(rangeNumbers);
  draftsRef.current = rangeNumbers;
  useEffect(
    () => () => {
      if (autofillJob.current) autofillJob.current.stopped = true;
      autofillJob.current = null;
    },
    [live.id],
  );
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>({
    ...defaultFilter,
    excludeHost: live.kind !== 'browser',
  });
  const [title, setTitle] = useState('Vòng chơi 01');
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const commentContext = useRef('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    setFilter({ ...defaultFilter, excludeHost: live.kind !== 'browser' });
    setComments([]);
    setMarkers([]);
    setRangeComments([]);
    setCommentTab('live');
    setRangeError('');
    setRangeStartId(null);
    setRangeEndId(null);
    setRangeNumbers({});
    setSavingNumbers(false);
    setActiveColumnFilter(null);
    setColumnFilters(emptyColumnFilters);
    setAutofilling(false);
    setAutofillStatus('');
    setAutofillError('');
    setRetryIds([]);
    setTitle('Vòng chơi 01');
  }, [live.id]);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    void Promise.all([
      api(`/streams/${live.id}/comments?q=${encodeURIComponent(search)}`),
      api<Comment[]>(`/streams/${live.id}/markers`),
    ])
      .then(([data, marks]) => {
        if (!cancel) {
          const context = `${live.id}:${search}`;
          const sameContext = commentContext.current === context;
          commentContext.current = context;
          setComments((previous) =>
            sameContext
              ? [
                  ...new Map(
                    [...previous, ...(data.items as Comment[])].map((c) => [c.id, c]),
                  ).values(),
                ].sort((a, b) => b.seq - a.seq)
              : data.items,
          );
          if (!sameContext) setMore(data.nextBefore);
          setMarkers((previous) => [
            ...new Map(
              [...previous.filter((c) => c.streamId === live.id), ...marks].map((c) => [c.id, c]),
            ).values(),
          ]);
        }
      })
      .catch((e) => {
        if (!cancel) say(e.message, true);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [live.id, search, revision, say]);
  useEffect(() => {
    if (commentTab !== 'filter') return;
    if (!rangeStartId || !rangeEndId) {
      setRangeComments([]);
      setRangeError('');
      return;
    }
    let cancel = false;
    setRangeLoading(true);
    setRangeError('');
    void api<Comment[]>(
      `/streams/${live.id}/comments/range?start=${encodeURIComponent(rangeStartId)}&end=${encodeURIComponent(rangeEndId)}`,
    )
      .then((rows) => {
        if (!cancel) setRangeComments(rows);
      })
      .catch((e) => {
        if (!cancel) {
          setRangeComments([]);
          setRangeError(e.message);
        }
      })
      .finally(() => {
        if (!cancel) setRangeLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [commentTab, rangeStartId, rangeEndId, live.id, revision]);
  const field = <K extends keyof Filter>(key: K, value: Filter[K]) =>
    setFilter((p) => ({ ...p, [key]: value }));
  const pickMarker = (c: Comment, edge: 'startCommentId' | 'endCommentId') => {
    field(edge, c.id);
    if (edge === 'startCommentId') setRangeStartId(c.id);
    else setRangeEndId(c.id);
    if (!markers.some((m) => m.id === c.id)) setMarkers((m) => [...m, c]);
    say(edge === 'startCommentId' ? 'Đã chọn mốc bắt đầu.' : 'Đã chọn mốc kết thúc.');
  };
  const saveRangeNumbers = async () => {
    const drafts = rangeNumbers;
    const items = Object.entries(drafts).map(([commentId, numbers]) => ({
      commentId,
      ...numbers,
    }));
    if (!items.length) return;
    setSavingNumbers(true);
    try {
      await post(`/streams/${live.id}/comment-numbers`, { items });
      setRangeComments((current) =>
        current.map((comment) => {
          const numbers = drafts[comment.id];
          return numbers
            ? {
                ...comment,
                ...Object.fromEntries(
                  Object.entries(numbers).map(([field, value]) => [field, value.trim() || null]),
                ),
              }
            : comment;
        }),
      );
      setRangeNumbers((current) => {
        const next = { ...current };
        for (const commentId of Object.keys(drafts)) {
          if (current[commentId] === drafts[commentId]) delete next[commentId];
        }
        return next;
      });
      say(`Đã lưu số cho ${items.length} comment.`);
    } catch (error) {
      say(`Không lưu được các số: ${(error as Error).message}`, true);
    } finally {
      setSavingNumbers(false);
    }
  };
  const normalizedColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).map(([key, value]) => [
      key,
      value.trim().toLocaleLowerCase('vi'),
    ]),
  ) as Record<CommentColumn, string>;
  const visibleRangeComments = rangeComments.filter((comment) => {
    const values = {
      author: comment.authorName,
      message: comment.message,
      time: time(comment.createdAt),
      ...Object.fromEntries(
        numberFields.map((field) => [
          field,
          rangeNumbers[comment.id]?.[field] ?? comment[field] ?? '',
        ]),
      ),
    } as Record<CommentColumn, string>;
    return (Object.keys(values) as CommentColumn[]).every(
      (key) =>
        !normalizedColumnFilters[key] ||
        values[key].toLocaleLowerCase('vi').includes(normalizedColumnFilters[key]),
    );
  });
  const emptyNumberIds = visibleRangeComments
    .filter((comment) =>
      numberFields.every(
        (field) => !(rangeNumbers[comment.id]?.[field] ?? comment[field] ?? '').trim(),
      ),
    )
    .map((comment) => comment.id);
  const clearFilteredNumbers = async () => {
    if (clearingNumbers || savingNumbers || autofillJob.current) return;
    const ids = new Set(visibleRangeComments.map((comment) => comment.id));
    if (!ids.size) return;
    setClearingNumbers(true);
    try {
      await post(`/streams/${live.id}/comment-numbers/clear`, { commentIds: [...ids] });
      setRangeComments((current) =>
        current.map((comment) =>
          ids.has(comment.id)
            ? {
                ...comment,
                firstNumber: null,
                secondNumber: null,
                thirdNumber: null,
                aiNumberNote: null,
              }
            : comment,
        ),
      );
      const next = { ...draftsRef.current };
      for (const id of ids) delete next[id];
      draftsRef.current = next;
      setRangeNumbers(next);
      setRetryIds([]);
      setAutofillStatus('');
      setAutofillError('');
      say(
        `Đã xóa số và cảnh báo AI của ${ids.size} comment trong vùng lọc. Có thể chạy AI autofill lại.`,
      );
    } catch (error) {
      say(`Không xóa được số: ${(error as Error).message}`, true);
    } finally {
      setClearingNumbers(false);
    }
  };
  const startAutofill = async (ids = visibleRangeComments.map((comment) => comment.id)) => {
    if (autofillJob.current || !ids.length) return;
    const job = { stopped: false };
    autofillJob.current = job;
    setAutofilling(true);
    setAutofillError('');
    setRetryIds([]);
    setAutofillStatus(`Đã xử lý 0/${ids.length} comment`);
    let skipped = 0;
    const outcome = await autofillInChunks({
      ids,
      size: chunkSize,
      stopped: () => job.stopped,
      request: (chunk) =>
        post<{ items: Comment[]; skipped: string[] }>(
          `/streams/${live.id}/comment-numbers/autofill`,
          {
            items: chunk.map((commentId) => ({
              commentId,
              protectedFields: Object.keys(draftsRef.current[commentId] || {}),
            })),
          },
        ),
      apply: (result) => {
        if (autofillJob.current !== job) return;
        skipped += result.skipped.length;
        const updated = new Map(result.items.map((comment) => [comment.id, comment]));
        setRangeComments((current) => current.map((comment) => updated.get(comment.id) || comment));
      },
      progress: (done) => {
        if (autofillJob.current === job)
          setAutofillStatus(`Đã xử lý ${done}/${ids.length} comment · Đã tự lưu`);
      },
    });
    if (autofillJob.current !== job) return;
    autofillJob.current = null;
    setAutofilling(false);
    setRetryIds(outcome.remaining);
    setAutofillError(outcome.error);
    setAutofillStatus(
      `${outcome.remaining.length ? 'Đã dừng' : 'Hoàn tất'}: ${outcome.done}/${ids.length} comment · Đã tự lưu${skipped ? ` · Bỏ qua ${skipped} comment vừa thay đổi` : ''}`,
    );
  };
  const hasColumnFilters = Object.values(columnFilters).some((value) => value.trim());
  const columnHeader = (key: CommentColumn, label: string, placeholder: string) => (
    <th className={activeColumnFilter === key || columnFilters[key] ? 'filter-active' : ''}>
      <button
        className="column-filter-trigger"
        aria-expanded={activeColumnFilter === key}
        onClick={() => setActiveColumnFilter((current) => (current === key ? null : key))}
      >
        {label}
        <ListFilter size={12} aria-label={`Filter ${label}`} />
      </button>
      {activeColumnFilter === key && (
        <span className="column-filter-input">
          <input
            autoFocus
            aria-label={`Lọc theo ${label}`}
            placeholder={placeholder}
            value={columnFilters[key]}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              setColumnFilters((current) => ({ ...current, [key]: event.target.value }))
            }
          />
          {columnFilters[key] && (
            <button
              aria-label={`Xóa lọc ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                setColumnFilters((current) => ({ ...current, [key]: '' }));
              }}
            >
              <X size={11} />
            </button>
          )}
        </span>
      )}
    </th>
  );
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ChevronLeft size={16} />
        Tất cả livestream
      </button>
      <div className="studio-heading">
        <div>
          <div className="button-row">
            <Badge tone={live.kind === 'demo' ? 'purple' : live.collecting ? 'green' : 'neutral'}>
              {live.kind === 'demo'
                ? 'DEMO'
                : live.collecting
                  ? 'ĐANG THU THẬP'
                  : live.kind === 'browser'
                    ? 'ĐÃ DỪNG · DỮ LIỆU QUAN SÁT'
                    : 'ĐÃ LƯU'}
            </Badge>
            <span className="muted small-text">{live.pageName}</span>
          </div>
          <h1>{live.title}</h1>
          {live.kind === 'browser' && (
            <p>
              Video Facebook · {live.facebookId} · {number(live.commentCount)} comment đã lưu riêng
              cho video này
            </p>
          )}
          <p>
            {live.kind === 'demo'
              ? 'Dữ liệu mẫu để thử các chức năng. Không phải livestream đang phát.'
              : live.lastSync
                ? `Đồng bộ lần cuối ${time(live.lastSync)} · ${date(live.lastSync)}`
                : 'Chưa bắt đầu đồng bộ comment.'}
          </p>
        </div>
        <div className="button-row">
          <a className="button secondary" href={`/api/streams/${live.id}/export`}>
            <Download size={16} />
            Xuất CSV
          </a>
          {editable && live.kind === 'browser' && (
            <button className="button primary" onClick={onConnect}>
              Mã kết nối
            </button>
          )}
          {editable &&
            (live.kind === 'facebook' || (live.kind === 'browser' && !!live.collecting)) && (
              <button
                className={`button ${live.collecting ? 'secondary' : 'primary'}`}
                disabled={!!busy}
                onClick={() =>
                  run('collect', async () => {
                    await post(`/streams/${live.id}/collect`, { enabled: !live.collecting });
                  })
                }
              >
                {live.collecting ? <Pause size={16} /> : <Play size={16} />}{' '}
                {live.collecting ? 'Tạm dừng' : 'Thu thập'}
              </button>
            )}
        </div>
      </div>
      {live.kind === 'browser' && (
        <div className="notice">
          Nguồn trình duyệt · Thời gian là lúc quan sát, không phải lúc gửi. Không cam kết đủ
          comment; danh tính dựa trên link profile. Host/replies có thể chưa xác định. Bắt đầu hoặc
          tiếp tục từ extension.
        </div>
      )}
      {live.error && (
        <div className="notice error">
          <AlertTriangle size={16} />
          {live.error}
        </div>
      )}
      <div className={`studio-grid${commentTab === 'filter' ? ' filter-mode' : ''}`}>
        <section className="comments-panel">
          <header className="panel-heading">
            <div>
              <MessageSquare size={19} />
              <h2>{commentTab === 'live' ? 'Live comments' : 'Filter comments'}</h2>
              <span className="count-pill">{number(live.commentCount)}</span>
            </div>
            <span className="small-text muted">
              {commentTab === 'live'
                ? 'Mới nhận trước'
                : `${number(visibleRangeComments.length)}/${number(rangeComments.length)} ở giữa`}
            </span>
          </header>
          <div className="comment-tabs" role="tablist" aria-label="Chế độ xem bình luận">
            <button
              role="tab"
              aria-selected={commentTab === 'live'}
              className={commentTab === 'live' ? 'active' : ''}
              onClick={() => setCommentTab('live')}
            >
              Live comments
            </button>
            <button
              role="tab"
              aria-selected={commentTab === 'filter'}
              className={commentTab === 'filter' ? 'active' : ''}
              onClick={() => {
                setCommentTab('filter');
                setRangeStartId((current) => current || filter.startCommentId);
                setRangeEndId((current) => current || filter.endCommentId);
              }}
            >
              Filter
            </button>
          </div>
          {commentTab === 'live' ? (
            <>
              <div className="comment-search">
                <Search size={17} />
                <input
                  aria-label="Tìm bình luận"
                  placeholder="Tìm bình luận hoặc tên người xem…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <IconButton label="Xóa tìm kiếm" onClick={() => setQ('')}>
                    <X size={15} />
                  </IconButton>
                )}
              </div>
              <div className="comments-list">
                {loading && !comments.length ? (
                  <div className="inline-empty">
                    <Loader2 className="spin" />
                    Đang tải bình luận…
                  </div>
                ) : !comments.length ? (
                  <div className="inline-empty">
                    <MessageSquare size={26} />
                    <b>Chưa có bình luận phù hợp</b>
                    <span>
                      {search ? 'Thử một từ khóa khác.' : 'Bật thu thập để bắt đầu lưu comment.'}
                    </span>
                  </div>
                ) : (
                  comments.map((c) => (
                    <article
                      className={`comment ${c.isHost ? 'host-comment' : ''} ${filter.startCommentId === c.id || filter.endCommentId === c.id ? 'selected-comment' : ''}`}
                      key={c.id}
                    >
                      <Avatar
                        name={c.authorName}
                        url={c.avatarUrl}
                        className={
                          c.isHost
                            ? 'purple-avatar'
                            : ['lavender', 'peach', 'mint', 'blue-avatar'][c.seq % 4]
                        }
                      />
                      <div className="comment-body">
                        <div className="comment-author">
                          <b>{c.authorName}</b>
                          {!!c.isHost && <Badge tone="purple">CHỦ LIVE</Badge>}
                          {!c.authorId && (
                            <span title="Không thể đếm tác giả duy nhất" className="unknown-label">
                              Thiếu ID
                            </span>
                          )}
                          <time
                            title={
                              c.timeBasis === 'observed'
                                ? 'Lúc extension quan sát, không phải thời gian gửi'
                                : 'Thời gian Facebook'
                            }
                          >
                            {c.timeBasis === 'observed' ? 'Nhận ' : ''}
                            {time(c.createdAt)}
                          </time>
                        </div>
                        <p>{c.message || '(Bình luận không có văn bản)'}</p>
                        {c.idBasis === 'observation' && (
                          <span className="small-text muted">
                            Không có ID comment · có thể trùng khi trang tải lại
                          </span>
                        )}
                        {c.parentId && (
                          <span className="small-text muted">↳ Trả lời bình luận</span>
                        )}
                        {editable && (
                          <div className="comment-actions">
                            <button onClick={() => pickMarker(c, 'startCommentId')}>
                              {filter.startCommentId === c.id ? (
                                <Check size={12} />
                              ) : (
                                <Play size={11} />
                              )}
                              Mốc bắt đầu
                            </button>
                            <button onClick={() => pickMarker(c, 'endCommentId')}>
                              {filter.endCommentId === c.id ? (
                                <Check size={12} />
                              ) : (
                                <Circle size={11} />
                              )}
                              Mốc kết thúc
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
                {more && (
                  <button
                    className="load-more"
                    disabled={busy === 'more'}
                    onClick={() =>
                      run('more', async () => {
                        const data = await api(
                          `/streams/${live.id}/comments?q=${encodeURIComponent(search)}&before=${more}`,
                        );
                        setComments((rows) => [...rows, ...data.items]);
                        setMore(data.nextBefore);
                      })
                    }
                  >
                    Tải bình luận cũ hơn <ChevronLeft className="rotate-down" size={14} />
                  </button>
                )}
              </div>
              <footer className="comments-footer">
                <Database size={13} /> Đã lưu tất cả comment trên máy chủ
                <span>Thời gian hiển thị theo thiết bị của bạn</span>
              </footer>
            </>
          ) : (
            <div className="filter-comments-view">
              <div className="range-controls">
                <label>
                  Comment bắt đầu
                  <select
                    value={rangeStartId || ''}
                    onChange={(e) => setRangeStartId(e.target.value || null)}
                  >
                    <option value="">Chọn comment bắt đầu</option>
                    {markers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {time(c.createdAt)} · {c.authorName}: {c.message.slice(0, 70)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Comment kết thúc
                  <select
                    value={rangeEndId || ''}
                    onChange={(e) => setRangeEndId(e.target.value || null)}
                  >
                    <option value="">Chọn comment kết thúc</option>
                    {markers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {time(c.createdAt)} · {c.authorName}: {c.message.slice(0, 70)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  onClick={() => {
                    setRangeStartId(null);
                    setRangeEndId(null);
                    setRangeComments([]);
                  }}
                >
                  Xóa mốc
                </button>
              </div>
              <div className="range-help">
                <span>
                  Dropdown chỉ hiện comment đã đánh dấu mốc trong tab Live comments. Click tiêu đề
                  cột để mở Filter. AI tự điền và lưu; sửa tay xong bấm Save ở cuối danh sách.
                </span>
                {hasColumnFilters && (
                  <button onClick={() => setColumnFilters(emptyColumnFilters)}>
                    Xóa bộ lọc cột
                  </button>
                )}
              </div>
              {editable && (
                <div className="autofill-controls">
                  <div className="autofill-actions">
                    <label>
                      Comment mỗi nhóm
                      <select
                        aria-label="Comment mỗi nhóm"
                        value={chunkSize}
                        disabled={autofilling}
                        onChange={(event) => setChunkSize(Number(event.target.value) as 10 | 20)}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                      </select>
                    </label>
                    <button
                      className="button primary"
                      disabled={
                        autofilling ||
                        savingNumbers ||
                        clearingNumbers ||
                        rangeLoading ||
                        !!rangeError ||
                        !rangeStartId ||
                        !rangeEndId ||
                        !visibleRangeComments.length
                      }
                      onClick={() => void startAutofill()}
                    >
                      {autofilling ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Sparkles size={15} />
                      )}{' '}
                      AI autofill
                    </button>
                    <button
                      className="button secondary"
                      disabled={
                        autofilling ||
                        savingNumbers ||
                        clearingNumbers ||
                        rangeLoading ||
                        !!rangeError ||
                        !rangeStartId ||
                        !rangeEndId ||
                        !emptyNumberIds.length
                      }
                      title="Chỉ gửi comment đang lọc có cả 3 ô số trống, tính cả phần sửa tay chưa lưu. Dòng có 1 hoặc 2 số cũng được giữ nguyên."
                      onClick={() => void startAutofill(emptyNumberIds)}
                    >
                      <Sparkles size={15} /> AI điền dòng còn trống ({emptyNumberIds.length})
                    </button>
                    <button
                      className="button secondary"
                      disabled={
                        autofilling ||
                        savingNumbers ||
                        clearingNumbers ||
                        rangeLoading ||
                        !!rangeError ||
                        !rangeStartId ||
                        !rangeEndId ||
                        !visibleRangeComments.length
                      }
                      title="Xóa số ở 3 cột và cảnh báo AI của comment đang khớp bộ lọc; giữ nội dung comment và lịch sử gọi AI"
                      onClick={() => void clearFilteredNumbers()}
                    >
                      {clearingNumbers ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      Xóa số trong vùng lọc ({visibleRangeComments.length})
                    </button>
                    <button className="button secondary" onClick={() => setShowAILogs(true)}>
                      <History size={15} /> Lịch sử gọi AI
                    </button>
                    {showAILogs && (
                      <Modal
                        title="Lịch sử gọi AI autofill"
                        wide
                        onClose={() => setShowAILogs(false)}
                      >
                        <AILogs streamId={live.id} />
                      </Modal>
                    )}
                    {autofilling && (
                      <button
                        className="button secondary"
                        onClick={() => {
                          if (autofillJob.current) autofillJob.current.stopped = true;
                          setAutofillStatus('Đang dừng sau nhóm hiện tại…');
                        }}
                      >
                        Dừng
                      </button>
                    )}
                    {!autofilling && retryIds.length > 0 && (
                      <button
                        className="button secondary"
                        disabled={savingNumbers || clearingNumbers}
                        onClick={() => void startAutofill(retryIds)}
                      >
                        Tiếp tục {retryIds.length} comment còn lại
                      </button>
                    )}
                  </div>
                  <small>
                    AI autofill gửi toàn bộ {visibleRangeComments.length} comment đang lọc; AI điền
                    dòng còn trống chỉ gửi {emptyNumberIds.length} comment chưa có số. Gửi đến nhà
                    cung cấp AI đã lưu (OpenAI hoặc Claude). Điền tối đa 3 số theo thứ tự; có 2 số
                    thì chỉ điền 2 cột. Giữ ô đã nhập. Số mơ hồ để bạn kiểm tra.
                  </small>
                  {autofillStatus && (
                    <div role="status" aria-live="polite">
                      {autofillStatus}
                    </div>
                  )}
                  {autofillError && (
                    <div className="notice error" role="alert">
                      {autofillError}
                    </div>
                  )}
                </div>
              )}
              {rangeError && (
                <div className="notice error" role="alert">
                  {rangeError}
                </div>
              )}
              <div className="filter-table-wrap">
                <table className="filter-comments-table">
                  <thead>
                    <tr>
                      {columnHeader('author', 'Tên người comment', 'Nhập tên…')}
                      {columnHeader('message', 'Comment', 'Nhập nội dung…')}
                      {columnHeader('time', 'Thời gian comment', 'Ví dụ 14:30…')}
                      {numberFields.map((field, index) => (
                        <Fragment key={field}>
                          {columnHeader(field, numberLabels[index], 'Nhập số…')}
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRangeComments.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className="table-author">
                            <Avatar
                              name={c.authorName}
                              url={c.avatarUrl}
                              className={['lavender', 'peach', 'mint', 'blue-avatar'][c.seq % 4]}
                            />
                            <b>{c.authorName}</b>
                          </span>
                        </td>
                        <td>
                          {c.message || '(Bình luận không có văn bản)'}
                          {c.aiNumberNote && (
                            <small className="ai-number-note">{c.aiNumberNote}</small>
                          )}
                        </td>
                        <td>
                          <time>{time(c.createdAt)}</time>
                        </td>
                        {numberFields.map((field, index) => (
                          <td className="number-cell" key={field}>
                            <input
                              aria-label={`${numberLabels[index]} của ${c.authorName}`}
                              inputMode="decimal"
                              maxLength={30}
                              placeholder="—"
                              disabled={!editable || clearingNumbers}
                              value={rangeNumbers[c.id]?.[field] ?? c[field] ?? ''}
                              onChange={(event) => {
                                const next = {
                                  ...draftsRef.current,
                                  [c.id]: {
                                    ...draftsRef.current[c.id],
                                    [field]: event.target.value,
                                  },
                                };
                                draftsRef.current = next;
                                setRangeNumbers(next);
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rangeLoading ? (
                  <div className="inline-empty">
                    <Loader2 className="spin" /> Đang lọc comment…
                  </div>
                ) : !rangeStartId || !rangeEndId ? (
                  <div className="inline-empty">Chọn đủ comment bắt đầu và kết thúc.</div>
                ) : !rangeError && !rangeComments.length ? (
                  <div className="inline-empty">Không có comment nào nằm giữa hai mốc này.</div>
                ) : !rangeError && !visibleRangeComments.length ? (
                  <div className="inline-empty">Không có comment khớp bộ lọc cột.</div>
                ) : null}
                {editable && rangeComments.length > 0 && (
                  <div className="filter-save-row">
                    <span>
                      {Object.keys(rangeNumbers).length
                        ? `${Object.keys(rangeNumbers).length} hàng chưa lưu`
                        : 'Không có thay đổi chưa lưu'}
                    </span>
                    <button
                      className="button primary"
                      disabled={
                        savingNumbers || clearingNumbers || !Object.keys(rangeNumbers).length
                      }
                      onClick={() => void saveRangeNumbers()}
                    >
                      {savingNumbers ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Database size={14} />
                      )}
                      {savingNumbers ? 'Đang lưu…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        <aside className="game-panel">
          <header className="panel-heading">
            <div>
              <span className="game-icon">
                <Trophy size={18} />
              </span>
              <h2>Góc mini game</h2>
            </div>
            <Sparkles size={16} className="purple-text" />
          </header>
          <div className="game-body">
            <p className="game-intro">Chọn luật chơi. Tìm đúng tương tác.</p>
            <div className="segmented">
              <button
                className={mode === 'manual' ? 'selected' : ''}
                onClick={() => setMode('manual')}
              >
                <SlidersHorizontal size={14} />
                Thủ công
              </button>
              <button className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>
                <Sparkles size={14} />
                Trợ lý AI
              </button>
            </div>
            {mode === 'ai' && (
              <div className="ai-prompt">
                <label>
                  Bạn muốn tìm điều gì?
                  <textarea
                    placeholder={
                      'Ví dụ: Giữa Bắt Đầu và Kết Thúc của Team Nail Supply, có bao nhiêu người comment đúng số 5?'
                    }
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    maxLength={2000}
                  />
                </label>
                <small>
                  Gửi câu hỏi và tối đa 80 comment mốc/chủ live tới AI đã cấu hình. Kiểm tra bộ lọc
                  trước khi tính.
                </small>
                <button
                  className="button secondary full"
                  disabled={!editable || !!busy || prompt.trim().length < 3}
                  onClick={() =>
                    run('ai', async () => {
                      const data = await post(`/streams/${live.id}/ai-plan`, { prompt });
                      setFilter(data.filter);
                      say('AI đã đề xuất bộ lọc. Kiểm tra điều kiện bên dưới trước khi tính.');
                    })
                  }
                >
                  {busy === 'ai' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                  Tạo bộ lọc
                </button>
              </div>
            )}
            <label>
              Tên vòng chơi
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                disabled={!editable}
              />
            </label>
            <div className="round-label">
              <span>01</span> Khoảng bình luận{' '}
              <button
                onClick={() =>
                  setFilter((p) => ({ ...p, startCommentId: null, endCommentId: null }))
                }
                disabled={!editable}
              >
                Toàn phiên
              </button>
            </div>
            <div className="marker-fields">
              <label>
                <span className="marker-dot start" />
                Bắt đầu
                <select
                  aria-label="Mốc bắt đầu"
                  value={filter.startCommentId || ''}
                  onChange={(e) => field('startCommentId', e.target.value || null)}
                  disabled={!editable}
                >
                  <option value="">Chọn bình luận bắt đầu</option>
                  {markers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {time(c.createdAt)} · {c.authorName}: {c.message.slice(0, 45)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="marker-dot end" />
                Kết thúc
                <select
                  aria-label="Mốc kết thúc"
                  value={filter.endCommentId || ''}
                  onChange={(e) => field('endCommentId', e.target.value || null)}
                  disabled={!editable}
                >
                  <option value="">Chọn bình luận kết thúc</option>
                  {markers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {time(c.createdAt)} · {c.authorName}: {c.message.slice(0, 45)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="field-help">Chọn hai mốc cùng tác giả, hoặc để trống cả hai.</small>
            <div className="round-label">
              <span>02</span> Điều kiện tham gia
            </div>
            <div className="filter-row">
              <select
                aria-label="Kiểu so khớp"
                value={filter.match}
                onChange={(e) => field('match', e.target.value as Filter['match'])}
                disabled={!editable}
              >
                <option value="exact">Đúng bằng</option>
                <option value="contains">Có chứa</option>
              </select>
              <input
                aria-label="Nội dung cần tìm"
                value={filter.text}
                onChange={(e) => field('text', e.target.value)}
                maxLength={200}
                disabled={!editable}
              />
            </div>
            <div className="check-list">
              <label>
                <input
                  type="checkbox"
                  checked={filter.distinctUsers}
                  onChange={(e) => field('distinctUsers', e.target.checked)}
                  disabled={!editable}
                />
                <span>Mỗi người chỉ tính một lần</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filter.excludeHost}
                  onChange={(e) => field('excludeHost', e.target.checked)}
                  disabled={!editable}
                />
                <span>
                  {live.kind === 'browser'
                    ? 'Bỏ tác giả của hai comment mốc'
                    : 'Bỏ qua bình luận của chủ live'}
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filter.includeReplies}
                  onChange={(e) => field('includeReplies', e.target.checked)}
                  disabled={!editable}
                />
                <span>Tính cả câu trả lời đã thu được</span>
              </label>
            </div>
            <button
              className="button primary full calculate"
              disabled={!editable || !!busy || !filter.text.trim() || !title.trim()}
              onClick={() =>
                run('analyze', async () => {
                  const result = await post(`/streams/${live.id}/analyze`, { filter, title });
                  onResult(result);
                })
              }
            >
              {busy === 'analyze' ? <Loader2 className="spin" size={17} /> : <Trophy size={17} />}
              Tính & lưu kết quả
              <ArrowRight size={16} />
            </button>
            <div className="game-footnote">
              <ShieldCheck size={14} />
              <span>Đếm bằng dữ liệu đã lưu. Mỗi kết quả đều có danh sách comment đối chiếu.</span>
            </div>
            {!editable && (
              <div className="notice">
                Bạn có quyền xem. Nhờ admin cấp quyền điều hành để chạy mini game.
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function ResultModal({ result: r, onClose }: { result: Analysis; onClose: () => void }) {
  return (
    <Modal title={r.title} onClose={onClose} wide>
      <div className="result-summary">
        <div className="result-trophy">
          <Trophy size={30} />
        </div>
        <span className="eyebrow">KẾT QUẢ TỪ DỮ LIỆU ĐÃ LƯU</span>
        <strong>{number(r.count)}</strong>
        <p>
          {r.filter.distinctUsers ? 'người có ID hợp lệ' : 'bình luận phù hợp'} · {r.commentCount}{' '}
          bình luận khớp điều kiện
        </p>
        <Badge tone={r.provisional ? 'amber' : 'green'}>
          {r.provisional ? 'TẠM TÍNH · PHIÊN ĐANG THU THẬP' : 'BẢN KẾT QUẢ ĐÃ LƯU'}
        </Badge>
      </div>
      <div className="result-rules">
        <span>
          {r.filter.match === 'exact' ? 'Đúng bằng' : 'Có chứa'} “{r.filter.text}”
        </span>
        <span>{r.filter.startCommentId ? 'Giữa hai mốc đã chọn' : 'Toàn phiên'}</span>
        <span>{r.filter.distinctUsers ? 'Mỗi ID một lần' : 'Đếm mọi comment khớp'}</span>
      </div>
      {r.unknownAuthors > 0 && (
        <div className="notice amber">
          {r.unknownAuthors} bình luận khớp bị thiếu ID tác giả.{' '}
          {r.filter.distinctUsers ? 'Không được tính vào số người.' : 'Được tính vào số comment.'}
        </div>
      )}
      {r.boundaryTies > 0 && (
        <div className="notice amber">
          Có {r.boundaryTies} bình luận cùng timestamp với mốc và bị loại khỏi khoảng chơi.
        </div>
      )}
      {r.warning && <div className="notice error">{r.warning}</div>}
      <p className="small-text muted">
        {date(r.createdAt)} · {time(r.createdAt)} · {r.createdBy}. Kết quả không tự đổi khi dữ liệu
        đến muộn; chạy lại để tạo bản mới.
      </p>
      <div className="result-list">
        {r.matches.length ? (
          r.matches.map((c) => (
            <div key={c.id}>
              <Avatar name={c.authorName} url={c.avatarUrl} className="lavender" />
              <span>
                <b>{c.authorName}</b>
                <small>{c.message}</small>
              </span>
              <time>{time(c.createdAt)}</time>
            </div>
          ))
        ) : (
          <div className="inline-empty">Không có comment khớp điều kiện.</div>
        )}
      </div>
      <footer className="modal-actions">
        <small className="muted">Snapshot bằng chứng · Facebook có thể không trả đủ dữ liệu.</small>
        <a className="button primary" href={`/api/analyses/${r.id}/export`}>
          <Download size={15} />
          Xuất bằng chứng
        </a>
      </footer>
    </Modal>
  );
}

function HistoryView({
  revision,
  run,
  onResult,
  onOpen,
}: {
  revision: number;
  run: Run;
  onResult: (r: Analysis) => void;
  onOpen: (s: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void run('history', async () => setRows(await api('/analyses')));
  }, [revision, run]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow muted">EVERY RESULT HAS A STORY</span>
          <h1>Lịch sử kết quả</h1>
          <p>Các vòng chơi đã lưu, cùng từng bình luận làm bằng chứng.</p>
        </div>
        <span className="heading-icon">
          <History size={25} />
        </span>
      </div>
      <section className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Vòng chơi</th>
              <th>Kết quả</th>
              <th>Người thực hiện</th>
              <th>Thời gian</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.title}</b>
                  <small>
                    {r.provisional ? 'Tạm tính khi đang thu thập' : 'Bản kết quả đã lưu'}
                  </small>
                </td>
                <td>
                  <span className="result-count">{number(r.count)}</span>
                </td>
                <td>{r.createdBy}</td>
                <td>
                  {date(r.createdAt)}
                  <small>{time(r.createdAt)}</small>
                </td>
                <td>
                  <div className="button-row">
                    <button
                      className="button secondary small"
                      onClick={() =>
                        run('result', async () => onResult(await api(`/analyses/${r.id}`)))
                      }
                    >
                      Xem kết quả
                      <ArrowUpRight size={13} />
                    </button>
                    <IconButton label="Mở livestream" onClick={() => onOpen(r.streamId)}>
                      <Radio size={17} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <Trophy size={32} />
            <h3>Vòng chơi đầu tiên đang chờ bạn.</h3>
            <p>Kết quả sẽ xuất hiện ở đây sau khi bạn tính và lưu một vòng chơi.</p>
          </div>
        )}
      </section>
    </>
  );
}

function ImportModal({ onClose, initialUrl }: { onClose: () => void; initialUrl?: string }) {
  return (
    <Modal title="Thêm livestream từ trình duyệt" onClose={onClose}>
      <CapturePanel initialUrl={initialUrl} />
    </Modal>
  );
}

function SettingsView({
  user,
  run,
  busy,
  say,
}: {
  user: User;
  run: Run;
  busy: string;
  say: (s: string, e?: boolean) => void;
}) {
  const [ai, setAi] = useState<any>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [system, setSystem] = useState<any>(null);
  const [tab, setTab] = useState<'facebook' | 'ai' | 'team' | 'system'>('facebook');
  const load = useCallback(async () => {
    const [a, u, s] = await Promise.all([
      api('/settings/ai'),
      api<User[]>('/users'),
      api('/system'),
    ]);
    setAi(a);
    setPeople(u);
    setSystem(s);
  }, []);
  useEffect(() => {
    void run('settings', load);
  }, [load, run]);
  async function saveAI(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    await run('saveai', async () => {
      await api('/settings/ai', {
        method: 'PUT',
        body: JSON.stringify({
          ...data,
          model: ai.model,
          baseUrl: data.baseUrl || undefined,
          apiKey: data.apiKey || undefined,
          persist: data.persist === 'on',
        }),
      });
      (form.elements.namedItem('apiKey') as HTMLInputElement).value = '';
      await load();
      say('Đã lưu cấu hình AI. Key không được trả về trình duyệt.');
    });
  }
  if (!ai || !system)
    return (
      <div className="inline-empty">
        <Loader2 className="spin" />
        Đang tải cài đặt…
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow muted">YOUR STUDIO, YOUR RULES</span>
          <h1>Cài đặt không gian</h1>
          <p>Kết nối nguồn, chọn AI và đưa cả team vào cùng một nhịp.</p>
        </div>
        <Badge tone="purple">
          <ShieldCheck size={13} />
          Chỉ admin
        </Badge>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {(
            [
              { key: 'facebook', icon: Facebook, label: 'Extension trình duyệt' },
              { key: 'ai', icon: Sparkles, label: 'Nhà cung cấp AI' },
              { key: 'team', icon: Users, label: 'Thành viên' },
              { key: 'system', icon: Monitor, label: 'Máy chủ & dữ liệu' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={17} />
              {t.label}
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          {tab === 'facebook' && <CapturePanel />}
          {tab === 'ai' && (
            <>
              <div className="settings-title">
                <span className="settings-icon purple">
                  <Sparkles size={24} />
                </span>
                <div>
                  <h2>Trợ lý AI của bạn</h2>
                  <p>Dùng API key riêng. Trả phí trực tiếp cho nhà cung cấp.</p>
                </div>
                <Badge tone={ai.hasKey ? 'green' : 'neutral'}>
                  {ai.hasKey ? 'Đã có key' : 'Chưa có key'}
                </Badge>
              </div>
              <div className="notice">
                Nhà cung cấp và model đã lưu được dùng cho Trợ lý AI và AI autofill. Khi bấm AI
                autofill, nội dung comment đang lọc sẽ được gửi theo từng nhóm đến nhà cung cấp đã
                chọn.
              </div>
              <form onSubmit={saveAI}>
                <div className="form-grid">
                  <label>
                    Nhà cung cấp
                    <select
                      name="provider"
                      value={ai.provider}
                      onChange={(e) => {
                        const keyInput = e.currentTarget.form?.elements.namedItem(
                          'apiKey',
                        ) as HTMLInputElement | null;
                        if (keyInput) keyInput.value = '';
                        setAi({
                          ...ai,
                          provider: e.target.value,
                          model: aiModelOptions[e.target.value]?.[0]?.id || '',
                          baseUrl: '',
                          hasKey: false,
                        });
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic / Claude</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="compatible">OpenAI-compatible</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <select
                      value={
                        (aiModelOptions[ai.provider] || []).some((model) => model.id === ai.model)
                          ? ai.model
                          : '__custom'
                      }
                      onChange={(event) =>
                        setAi({
                          ...ai,
                          model: event.target.value === '__custom' ? '' : event.target.value,
                        })
                      }
                    >
                      {(aiModelOptions[ai.provider] || []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                      <option value="__custom">Model khác — nhập tên</option>
                    </select>
                  </label>
                </div>
                {!(aiModelOptions[ai.provider] || []).some((model) => model.id === ai.model) && (
                  <label>
                    Tên model tùy chỉnh
                    <input
                      required
                      value={ai.model}
                      placeholder="Nhập chính xác model ID"
                      onChange={(event) => setAi({ ...ai, model: event.target.value })}
                    />
                  </label>
                )}
                <small className="field-help">
                  Chọn model mà API key của bạn có quyền sử dụng. AI autofill hỗ trợ OpenAI và
                  Claude; model cần hỗ trợ kết quả JSON có cấu trúc.
                </small>
                {ai.provider === 'compatible' && (
                  <label>
                    Base URL
                    <input
                      name="baseUrl"
                      type="url"
                      placeholder="https://your-provider.com/v1"
                      required
                      value={ai.baseUrl || ''}
                      onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                    />
                    <small>
                      Nhà cung cấp cần hỗ trợ Chat Completions và JSON Schema. Thay endpoint/nhà
                      cung cấp sẽ xóa key cũ nếu không nhập key mới.
                    </small>
                  </label>
                )}
                <label>
                  API key
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Nhập key mới hoặc để trống để giữ key hiện tại"
                  />
                </label>
                <label className="checkbox-label">
                  <input name="persist" type="checkbox" defaultChecked={ai.persist} />
                  <span>Ghi nhớ key trên máy chủ bằng mã hóa</span>
                </label>
                <small className="field-help">
                  Mặc định key chỉ ở bộ nhớ và mất khi khởi động lại. Nếu ghi nhớ, khóa mã hóa nằm
                  trong thư mục data của máy chủ; không bảo vệ được khi toàn bộ thư mục bị lấy cắp.
                </small>
                <div className="button-row settings-actions">
                  <button className="button primary" disabled={!!busy}>
                    <Check size={16} />
                    Lưu cấu hình AI
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={!!busy}
                    onClick={() =>
                      run('clearkey', async () => {
                        await api('/settings/ai/key', { method: 'DELETE' });
                        await load();
                        say('Đã xóa API key khỏi bộ nhớ và dữ liệu lưu.');
                      })
                    }
                  >
                    Xóa key
                  </button>
                </div>
              </form>
              <div className="model-note">
                <Zap size={18} />
                <div>
                  <b>Chọn model cho phiên làm việc</b>
                  <p>
                    Chọn OpenAI hoặc Anthropic / Claude, chọn model, nhập API key tương ứng rồi bấm
                    Lưu cấu hình AI. Đổi nhà cung cấp cần nhập key của nhà cung cấp mới.
                  </p>
                </div>
              </div>
            </>
          )}
          {tab === 'team' && (
            <>
              <div className="settings-title">
                <span className="settings-icon purple">
                  <Users size={24} />
                </span>
                <div>
                  <h2>Cùng team điều hành</h2>
                  <p>Mọi tài khoản trong máy chủ dùng chung lịch sử livestream.</p>
                </div>
              </div>
              <div className="members-list">
                {people.map((p) => (
                  <div key={p.id}>
                    <span className="avatar lavender">{initials(p.name)}</span>
                    <span>
                      <b>
                        {p.name}
                        {p.id === user.id ? ' (bạn)' : ''}
                      </b>
                      <small>@{p.username}</small>
                    </span>
                    <Badge>{roleName[p.role]}</Badge>
                    {p.id !== user.id && (
                      <IconButton
                        label={`Xóa tài khoản ${p.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Xóa tài khoản ${p.name}? Phiên đăng nhập của tài khoản này sẽ bị thu hồi.`,
                            )
                          )
                            void run('deleteuser', async () => {
                              await api(`/users/${p.id}`, { method: 'DELETE' });
                              await load();
                            });
                        }}
                      >
                        <X size={16} />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>
              <h3>Thêm thành viên</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = Object.fromEntries(new FormData(form));
                  void run('adduser', async () => {
                    await post('/users', data);
                    form.reset();
                    await load();
                    say('Đã tạo tài khoản thành viên.');
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Tên hiển thị
                    <input name="name" required maxLength={80} />
                  </label>
                  <label>
                    Tên đăng nhập
                    <input
                      name="username"
                      required
                      pattern="[a-zA-Z0-9_.\-]{3,40}"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Mật khẩu ban đầu
                    <input
                      name="password"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Vai trò
                    <select name="role" defaultValue="viewer">
                      <option value="viewer">Người xem — chỉ đọc</option>
                      <option value="operator">Điều hành — thu thập & gameshow</option>
                      <option value="admin">Admin — toàn quyền</option>
                    </select>
                  </label>
                </div>
                <button className="button primary" disabled={!!busy}>
                  <Plus size={16} />
                  Thêm thành viên
                </button>
              </form>
            </>
          )}
          {tab === 'system' && (
            <>
              <div className="settings-title">
                <span className="settings-icon mint">
                  <Monitor size={24} />
                </span>
                <div>
                  <h2>Máy chủ & dữ liệu</h2>
                  <p>Một cổng. Một database. Cả team cùng truy cập.</p>
                </div>
              </div>
              <div className="system-grid">
                <div>
                  <small>Database</small>
                  <b>{system.database}</b>
                </div>
                <div>
                  <small>Kết nối</small>
                  <b>{system.secure ? 'HTTPS · mã hóa' : 'HTTP · LAN tin cậy'}</b>
                </div>
                <div>
                  <small>Cổng ứng dụng</small>
                  <b>{system.port}</b>
                </div>
                <div>
                  <small>Phiên bản</small>
                  <b>{system.version}</b>
                </div>
              </div>
              <h3>Địa chỉ truy cập</h3>
              {system.urls
                .filter((u: string) => !u.includes('['))
                .map((u: string) => (
                  <div className="address-row" key={u}>
                    <Wifi size={16} />
                    <code>{u}</code>
                    <IconButton
                      label="Sao chép địa chỉ"
                      onClick={() =>
                        run('copy', async () => {
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(u);
                            say('Đã sao chép địa chỉ.');
                          } else say(`Địa chỉ truy cập: ${u}`);
                        })
                      }
                    >
                      <Copy size={15} />
                    </IconButton>
                  </div>
                ))}
              {!system.secure && (
                <div className="notice amber">
                  HTTP không mã hóa mật khẩu và dữ liệu qua LAN. Với Wi-Fi dùng chung, cấu hình
                  TLS_CERT_FILE và TLS_KEY_FILE để chạy HTTPS ngay trên cùng cổng.
                </div>
              )}
              <div className="backup-card">
                <Database size={24} />
                <div>
                  <h3>Sao lưu database</h3>
                  <p>
                    Bản sao SQLite nhất quán, gồm comment, kết quả và tài khoản. Xem README để khôi
                    phục khi app đã dừng. Sau restore, đăng nhập lại, ghép nối extension và cấu hình
                    AI mới.
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() =>
                    run('backup', async () => {
                      await downloadBackup();
                      say('Đã tải bản sao database. Bảo quản file như dữ liệu riêng tư của team.');
                    })
                  }
                >
                  <Download size={16} />
                  Tải backup
                </button>
              </div>
              <p className="small-text muted">
                Đóng tab livestream sẽ dừng ghi. Máy chủ sleep, mất mạng hoặc tắt ứng dụng có thể
                làm mất comment chưa nhận. Extension không khôi phục được dữ liệu chưa tải vào
                trang.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
