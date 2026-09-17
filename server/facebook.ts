import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { setSetting, setting, saveComments, type Store, type IncomingComment } from './store.js';
import type { Vault } from './security.js';

export const facebookConfigSchema = z.object({
  appId: z.string().regex(/^\d+$/),
  appSecret: z.string().min(8).max(500).optional(),
  version: z.string().regex(/^v\d+\.0$/),
  redirectUri: z.string().url(),
  enableProfile: z.boolean().default(false),
});
type FBConfig = z.infer<typeof facebookConfigSchema>;
type Source = { id: string; name: string; token: string; kind: 'page' | 'profile' };
type GraphVideo = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  live_status?: string;
  creation_time?: string;
  created_time?: string;
  permalink_url?: string;
  video?: { id: string };
  from?: { id: string; name?: string };
};
type GraphComment = {
  id: string;
  message?: string;
  from?: { id?: string; name?: string };
  created_time: string;
  parent?: { id: string };
};
export class FacebookError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}
export function parseFacebookVideo(input: string): string {
  if (/^\d{5,40}$/.test(input.trim())) return input.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Nhập URL video Facebook hoặc ID video.');
  }
  if (
    url.protocol !== 'https:' ||
    !(url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))
  )
    throw new Error('Chỉ hỗ trợ link HTTPS thuộc facebook.com.');
  const id = url.searchParams.get('v') ?? url.pathname.match(/\/(?:videos|reel)\/(\d+)/)?.[1];
  if (!id || !/^\d{5,40}$/.test(id))
    throw new Error(
      'Link chia sẻ/rút gọn chưa được hỗ trợ. Mở video trên Facebook rồi lấy link /videos/ID hoặc watch?v=ID.',
    );
  return id;
}
export class Facebook {
  constructor(
    private db: Store,
    private vault: Vault,
    private request: typeof fetch = fetch,
  ) {}
  config(): FBConfig | null {
    const saved = setting(this.db, 'facebook');
    if (saved) {
      const value = JSON.parse(saved);
      return { ...value, appSecret: this.vault.decrypt(value.appSecret) };
    }
    if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)
      return {
        appId: process.env.FACEBOOK_APP_ID,
        appSecret: process.env.FACEBOOK_APP_SECRET,
        version: process.env.FACEBOOK_GRAPH_VERSION || 'v26.0',
        redirectUri:
          process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3210/api/facebook/callback',
        enableProfile: false,
      };
    return null;
  }
  saveConfig(raw: unknown) {
    const data = facebookConfigSchema.parse(raw);
    const uri = new URL(data.redirectUri);
    if (
      uri.pathname !== '/api/facebook/callback' ||
      uri.search ||
      uri.hash ||
      uri.username ||
      uri.password
    )
      throw new Error(
        'Callback phải kết thúc bằng /api/facebook/callback, không có query, fragment hoặc thông tin đăng nhập.',
      );
    if (!['http:', 'https:'].includes(uri.protocol))
      throw new Error('Callback phải dùng HTTP hoặc HTTPS.');
    const old = this.config();
    const secret = data.appSecret || old?.appSecret;
    if (!secret) throw new Error('Cần nhập Meta App Secret.');
    setSetting(
      this.db,
      'facebook',
      JSON.stringify({ ...data, appSecret: this.vault.encrypt(secret) }),
    );
    // A new app or permission set requires a fresh, explicitly authorized connection.
    this.disconnect();
  }
  sources(): Omit<Source, 'token'>[] {
    return this.db.prepare('SELECT id,name,kind FROM sources ORDER BY name').all() as Omit<
      Source,
      'token'
    >[];
  }
  source(id: string): Source {
    const row = this.db.prepare('SELECT * FROM sources WHERE id=?').get(id) as Source | undefined;
    if (!row) throw new Error('Nguồn chưa được kết nối hoặc đã bị ngắt.');
    return { ...row, token: this.vault.decrypt(row.token) };
  }
  async graph<T>(
    path: string,
    accessToken: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const config = this.config();
    if (!config) throw new Error('Chưa cấu hình Meta App.');
    if (!/^[\w/-]+$/.test(path)) throw new Error('Graph path không hợp lệ.');
    const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const body = (await response.json()) as { error?: { code?: number; message?: string } };
    if (!response.ok || body.error) {
      const code = body.error?.code;
      const label =
        code === 190
          ? 'Phiên Facebook hết hạn hoặc bị thu hồi. Kết nối lại trong Cài đặt.'
          : [10, 200].includes(code ?? 0)
            ? 'Facebook chưa cấp quyền đọc nguồn này. Kiểm tra quyền và trạng thái Meta App.'
            : `Facebook từ chối yêu cầu (mã ${code ?? response.status}). Kiểm tra API version, quyền và loại video.`;
      throw new FacebookError(label, code);
    }
    return body as T;
  }
  async exchangeCode(code: string) {
    const cfg = this.config();
    if (!cfg?.appSecret) throw new Error('Chưa cấu hình Meta App.');
    const url = new URL(`https://graph.facebook.com/${cfg.version}/oauth/access_token`);
    url.search = new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      redirect_uri: cfg.redirectUri,
      code,
    }).toString();
    const response = await this.request(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const result = (await response.json()) as { access_token?: string };
    if (!response.ok || !result.access_token)
      throw new Error(
        'Facebook không chấp nhận callback. Kiểm tra Redirect URI và cấu hình Meta App.',
      );
    const userToken = result.access_token;
    const me = await this.graph<{ id: string; name: string }>('me', userToken, {
      fields: 'id,name',
    });
    const sources: Source[] = [];
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = await this.graph<{
        data: { id: string; name: string; access_token?: string }[];
        paging?: { next?: string; cursors?: { after?: string } };
      }>('me/accounts', userToken, {
        fields: 'id,name,access_token,tasks',
        limit: '100',
        ...(after ? { after } : {}),
      });
      for (const item of data.data)
        if (item.access_token)
          sources.push({ id: item.id, name: item.name, token: item.access_token, kind: 'page' });
      if (!data.paging?.next) break;
      after = data.paging.cursors?.after;
      if (!after || page === 99) throw new Error('Danh sách Page chưa tải xong. Kết nối lại.');
    }
    if (cfg.enableProfile)
      sources.push({
        id: me.id,
        name: `${me.name} · Profile thử nghiệm`,
        token: userToken,
        kind: 'profile',
      });
    if (!sources.length)
      throw new Error(
        'Facebook chưa trả Page có quyền truy cập. Kiểm tra Page đã chọn và các quyền của app.',
      );
    this.db.transaction(() => {
      this.disconnect();
      for (const item of sources)
        this.db
          .prepare('INSERT INTO sources(id,name,token,kind) VALUES (?,?,?,?)')
          .run(item.id, item.name, this.vault.encrypt(item.token), item.kind);
      setSetting(
        this.db,
        'facebookUser',
        JSON.stringify({ id: me.id, name: me.name, connectedAt: Date.now() }),
      );
    })();
  }
  disconnect() {
    this.db
      .prepare(
        "UPDATE streams SET collecting=0,error='Nguồn đã ngắt kết nối. Lịch sử vẫn được giữ.' WHERE kind='facebook'",
      )
      .run();
    this.db.prepare('DELETE FROM sources').run();
    this.db.prepare("DELETE FROM settings WHERE key='facebookUser'").run();
    this.db.prepare('DELETE FROM oauth_states').run();
  }
  private saveVideo(source: Source, video: GraphVideo) {
    const facebookId = video.video?.id ?? video.id;
    const existing = this.db
      .prepare('SELECT id FROM streams WHERE sourceId=? AND facebookId=?')
      .get(source.id, facebookId) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const status = ['LIVE', 'LIVE_NOW'].includes(video.status ?? video.live_status ?? '')
      ? 'LIVE'
      : (video.status ?? video.live_status ?? 'UNKNOWN').includes('SCHEDULED')
        ? 'SCHEDULED'
        : 'ENDED';
    const timestamp = Date.parse(video.creation_time ?? video.created_time ?? '');
    this.db
      .prepare(
        `INSERT INTO streams(id,sourceId,facebookId,title,pageName,url,status,kind,createdAt) VALUES (?,?,?,?,?,?,?,'facebook',?)
      ON CONFLICT(sourceId,facebookId) DO UPDATE SET title=excluded.title,pageName=excluded.pageName,url=excluded.url,status=excluded.status`,
      )
      .run(
        id,
        source.id,
        facebookId,
        video.title || video.description?.slice(0, 120) || 'Facebook livestream',
        source.name,
        video.permalink_url || `https://www.facebook.com/watch/?v=${facebookId}`,
        status,
        Number.isFinite(timestamp) ? timestamp : Date.now(),
      );
    return id;
  }
  async discover(sourceId: string) {
    const source = this.source(sourceId);
    let after: string | undefined;
    let imported = 0;
    // Bounded discovery; direct URL import remains available for older broadcasts.
    for (let page = 0; page < 5; page++) {
      const data = await this.graph<{
        data: GraphVideo[];
        paging?: { next?: string; cursors?: { after?: string } };
      }>(`${source.id}/${source.kind === 'page' ? 'live_videos' : 'videos'}`, source.token, {
        fields:
          source.kind === 'page'
            ? 'id,title,status,creation_time,permalink_url,video'
            : 'id,title,created_time,from,permalink_url,live_status',
        limit: '50',
        ...(source.kind === 'profile' ? { type: 'uploaded' } : {}),
        ...(after ? { after } : {}),
      });
      for (const video of data.data) {
        if (source.kind === 'profile' && (video.from?.id !== source.id || !video.live_status))
          continue;
        this.saveVideo(source, video);
        imported++;
      }
      if (!data.paging?.next) return { imported, moreAvailable: false };
      after = data.paging.cursors?.after;
      if (!after) return { imported, moreAvailable: true };
    }
    return { imported, moreAvailable: true };
  }
  async importVideo(sourceId: string, input: string) {
    const source = this.source(sourceId);
    const videoId = parseFacebookVideo(input);
    const video = await this.graph<GraphVideo>(videoId, source.token, {
      fields: 'id,title,from,created_time,permalink_url,live_status',
    });
    if (video.from?.id !== source.id)
      throw new Error(
        'Không xác minh được video thuộc nguồn đã kết nối. Chỉ nhận video do Page/profile đã chọn sở hữu.',
      );
    if (!video.live_status)
      throw new Error('API chưa xác nhận đây là livestream hoặc video phát lại livestream.');
    return this.saveVideo(source, video);
  }
  async readComments(streamId: string) {
    const live = this.db.prepare('SELECT * FROM streams WHERE id=?').get(streamId) as
      | { sourceId: string; facebookId: string; cursor: string | null; collecting: number }
      | undefined;
    if (!live?.collecting) return;
    const source = this.source(live.sourceId);
    const data = await this.graph<{
      data: GraphComment[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(`${live.facebookId}/comments`, source.token, {
      fields: 'id,message,from,created_time,parent',
      filter: 'stream',
      order: 'chronological',
      live_filter: 'no_filter',
      limit: '100',
      ...(live.cursor ? { after: live.cursor } : {}),
    });
    // A stop/disconnect during an in-flight request must not advance the collector.
    if (
      !(
        this.db.prepare('SELECT collecting FROM streams WHERE id=?').get(streamId) as {
          collecting: number;
        }
      )?.collecting
    )
      return;
    const rows: IncomingComment[] = [];
    for (const item of data.data) {
      const time = Date.parse(item.created_time);
      if (!item.id || !Number.isFinite(time))
        throw new Error('Facebook trả comment không đủ ID/thời gian. Chưa cập nhật checkpoint.');
      rows.push({
        id: item.id,
        streamId,
        authorId: item.from?.id || null,
        authorName: item.from?.name || 'Người xem chưa có ID',
        message: item.message || '',
        createdAt: time,
        parentId: item.parent?.id || null,
        isHost: item.from?.id === source.id ? 1 : 0,
      });
    }
    const next = data.paging?.next ? data.paging.cursors?.after : null;
    if (data.paging?.next && !next)
      throw new Error('Facebook trả phân trang không có cursor. Chưa cập nhật checkpoint.');
    this.db.transaction(() => {
      saveComments(this.db, rows);
      this.db
        .prepare(
          'UPDATE streams SET cursor=?,lastSync=?,error=NULL,failures=0,nextPoll=? WHERE id=?',
        )
        .run(next || null, Date.now(), Date.now() + (next ? 1000 : 8000), streamId);
    })();
  }
}
