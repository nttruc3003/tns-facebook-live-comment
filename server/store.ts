import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalize, sanitizeBrowserComment, type Comment, type Stream } from '../shared/types.js';

export function openStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'studio.sqlite');
  const db = new Database(filename);
  chmodSync(filename, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 8) throw new Error('Database mới hơn phiên bản ứng dụng. Hãy nâng cấp app.');
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')), password TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE oauth_states (state TEXT PRIMARY KEY, sessionId TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'page');
      CREATE TABLE streams (id TEXT PRIMARY KEY, sourceId TEXT, facebookId TEXT, title TEXT NOT NULL, pageName TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, kind TEXT NOT NULL, createdAt INTEGER NOT NULL, collecting INTEGER NOT NULL DEFAULT 0, lastSync INTEGER, error TEXT, cursor TEXT, nextPoll INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, UNIQUE(sourceId,facebookId));
      CREATE TABLE comments (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, streamId TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE, authorId TEXT, authorName TEXT NOT NULL, message TEXT NOT NULL, normalized TEXT NOT NULL, createdAt INTEGER NOT NULL, receivedAt INTEGER NOT NULL, parentId TEXT, isHost INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(streamId,id));
      CREATE INDEX comments_time ON comments(streamId,createdAt,seq);
      CREATE INDEX comments_author ON comments(streamId,authorId);
      CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, streamId TEXT NOT NULL REFERENCES streams(id), title TEXT NOT NULL, createdAt INTEGER NOT NULL, createdBy TEXT NOT NULL, result TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    })();
  if (version < 2)
    db.transaction(() => {
      db.exec(`
      ALTER TABLE comments ADD COLUMN timeBasis TEXT NOT NULL DEFAULT 'facebook';
      ALTER TABLE comments ADD COLUMN identityBasis TEXT NOT NULL DEFAULT 'facebook-id';
      ALTER TABLE comments ADD COLUMN idBasis TEXT NOT NULL DEFAULT 'facebook-id';
      CREATE TABLE capture_devices (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        extensionId TEXT NOT NULL, name TEXT NOT NULL, secretHash TEXT NOT NULL UNIQUE,
        expires INTEGER NOT NULL, createdAt INTEGER NOT NULL, lastSeen INTEGER,
        streamId TEXT REFERENCES streams(id), captureId TEXT
      );
      PRAGMA user_version = 2;
    `);
    })();
  if (version < 3)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE capture_pairings (
        streamId TEXT PRIMARY KEY REFERENCES streams(id) ON DELETE CASCADE,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        codeHash TEXT NOT NULL UNIQUE, encryptedCode TEXT NOT NULL, updatedAt INTEGER NOT NULL
      );
      ALTER TABLE capture_devices ADD COLUMN pairedStreamId TEXT REFERENCES streams(id);
      CREATE INDEX capture_devices_pairing ON capture_devices(pairedStreamId);
      PRAGMA user_version = 3;
      `);
    })();
  if (version < 4)
    db.transaction(() => {
      const rows = db
        .prepare(
          "SELECT c.seq,c.authorName,c.message FROM comments c JOIN streams s ON s.id=c.streamId WHERE s.kind='browser' AND c.deleted=0",
        )
        .all() as { seq: number; authorName: string; message: string }[];
      const update = db.prepare(
        'UPDATE comments SET authorName=?,message=?,normalized=?,deleted=? WHERE seq=?',
      );
      for (const row of rows) {
        const clean = sanitizeBrowserComment(row.authorName, row.message);
        if (clean.authorName !== row.authorName || clean.message !== row.message)
          update.run(
            clean.authorName,
            clean.message || row.message,
            normalize(clean.message || row.message),
            clean.message ? 0 : 1,
            row.seq,
          );
      }
      db.pragma('user_version = 4');
    })();
  if (version < 5)
    db.transaction(() => {
      db.exec('ALTER TABLE comments ADD COLUMN avatarUrl TEXT; PRAGMA user_version = 5;');
    })();
  if (version < 6)
    db.transaction(() => {
      db.exec(`
        ALTER TABLE comments ADD COLUMN firstNumber TEXT;
        ALTER TABLE comments ADD COLUMN secondNumber TEXT;
        PRAGMA user_version = 6;
      `);
    })();
  if (version < 7)
    db.transaction(() => {
      db.exec(`
        ALTER TABLE comments ADD COLUMN thirdNumber TEXT;
        ALTER TABLE comments ADD COLUMN fourthNumber TEXT;
        ALTER TABLE comments ADD COLUMN fifthNumber TEXT;
        ALTER TABLE comments ADD COLUMN aiNumberNote TEXT;
        ALTER TABLE comments ADD COLUMN numbersRevision INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 7;
      `);
    })();
  if (version < 8)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE ai_call_logs (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          streamId TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
          userId TEXT NOT NULL, createdAt INTEGER NOT NULL, finishedAt INTEGER,
          provider TEXT NOT NULL, model TEXT NOT NULL, commentCount INTEGER NOT NULL,
          status TEXT NOT NULL, endpoint TEXT, requestBody TEXT, attempts TEXT NOT NULL,
          result TEXT, error TEXT
        );
        CREATE INDEX ai_call_logs_stream ON ai_call_logs(streamId,seq);
        PRAGMA user_version = 8;
      `);
    })();
  // A stopped process cannot finish requests left pending in its previous run.
  db.prepare(
    "UPDATE ai_call_logs SET status='interrupted',finishedAt=?,error='Ứng dụng đã dừng trước khi ghi nhận kết quả cuối cùng.' WHERE status='pending'",
  ).run(Date.now());
  return db;
}
export type Store = ReturnType<typeof openStore>;
export function setting(db: Store, key: string): string | undefined {
  return (
    db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  )?.value;
}
export function setSetting(db: Store, key: string, value: string) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, value);
}
const streamSelect = `SELECT s.*, (SELECT count(*) FROM comments c WHERE c.streamId=s.id AND c.deleted=0) commentCount, (SELECT count(DISTINCT authorId) FROM comments c WHERE c.streamId=s.id AND c.deleted=0) participantCount FROM streams s`;
export function streams(db: Store): Stream[] {
  return db
    .prepare(
      `${streamSelect} ORDER BY collecting DESC, CASE WHEN status='LIVE' THEN 0 ELSE 1 END, createdAt DESC`,
    )
    .all() as Stream[];
}
export function stream(db: Store, id: string): Stream | undefined {
  return db.prepare(`${streamSelect} WHERE s.id=?`).get(id) as Stream | undefined;
}
export function deleteStreamData(db: Store, id: string) {
  return db.transaction(() => {
    // A capture device is a credential for one paired livestream. Removing it also
    // makes any extension still holding that credential fail closed on its next request.
    db.prepare('DELETE FROM capture_devices WHERE streamId=? OR pairedStreamId=?').run(id, id);
    db.prepare('DELETE FROM analysis_runs WHERE streamId=?').run(id);
    const result = db.prepare('DELETE FROM streams WHERE id=?').run(id);
    return result.changes === 1;
  })();
}
export type IncomingComment = Omit<Comment, 'seq' | 'normalized' | 'receivedAt' | 'deleted'>;
export function saveComments(db: Store, incoming: IncomingComment[]) {
  const insert =
    db.prepare(`INSERT INTO comments(id,streamId,authorId,authorName,avatarUrl,message,normalized,createdAt,receivedAt,parentId,isHost)
    VALUES (@id,@streamId,@authorId,@authorName,@avatarUrl,@message,@normalized,@createdAt,@receivedAt,@parentId,@isHost)
    ON CONFLICT(streamId,id) DO UPDATE SET authorId=COALESCE(excluded.authorId,comments.authorId), authorName=excluded.authorName,avatarUrl=COALESCE(excluded.avatarUrl,comments.avatarUrl),message=excluded.message,normalized=excluded.normalized,parentId=excluded.parentId,isHost=excluded.isHost`);
  db.transaction(() => {
    for (const item of incoming)
      insert.run({
        ...item,
        avatarUrl: item.avatarUrl ?? null,
        normalized: normalize(item.message),
        receivedAt: Date.now(),
      });
  })();
}
export function seedDemo(db: Store) {
  const id = randomUUID();
  const start = Date.now() - 24 * 60_000;
  db.prepare(
    'INSERT INTO streams(id,title,pageName,status,kind,createdAt,lastSync) VALUES (?,?,?,?,?,?,?)',
  ).run(
    id,
    'Nail & Chill · Mini game cùng TNS',
    'Team Nail Supply · Demo',
    'ENDED',
    'demo',
    start,
    Date.now(),
  );
  const rows: IncomingComment[] = [];
  const add = (
    suffix: string,
    authorId: string | null,
    authorName: string,
    message: string,
    seconds: number,
    isHost = 0,
    parentId: string | null = null,
  ) =>
    rows.push({
      id: `${id}-${suffix}`,
      streamId: id,
      authorId,
      authorName,
      message,
      createdAt: start + seconds * 1000,
      parentId,
      isHost,
    });
  add('welcome', 'host', 'Team Nail Supply', 'Chào cả nhà! Chuẩn bị chơi mini game nhé 💜', 0, 1);
  add('before', 'customer-0', 'Hà Nguyễn', '5', 10);
  add('start', 'host', 'Team Nail Supply', 'Bắt Đầu', 20, 1);
  const names = [
    'Linh Nguyễn',
    'Mai Trần',
    'Thảo Phạm',
    'Kim Anh',
    'Ngọc Lê',
    'Hương Võ',
    'Anna Nguyễn',
    'Minh Châu',
    'Bảo Trân',
    'Mỹ Duyên',
    'Thanh Tâm',
    'Tú Anh',
  ];
  for (let i = 0; i < 36; i++)
    add(
      `comment-${i}`,
      `customer-${(i % 12) + 1}`,
      names[i % 12],
      [
        '5',
        'Em chọn 5 nha 💅',
        '5',
        'Màu này xinh quá!',
        ' 5 ',
        '15',
        '5',
        'Có ship không shop?',
        '5',
      ][i % 9],
      30 + i * 9,
    );
  add('missing-id', null, 'Người xem chưa có ID', '5', 365);
  add('reply', 'customer-13', 'Lan Anh', '5', 370, 0, `${id}-comment-0`);
  add('end', 'host', 'Team Nail Supply', 'Kết Thúc', 390, 1);
  add('late', 'customer-14', 'Jenny Trần', '5', 410);
  add(
    'thanks',
    'host',
    'Team Nail Supply',
    'Cảm ơn cả nhà! Kết quả sẽ được chốt trong Live Studio ✨',
    430,
    1,
  );
  saveComments(db, rows);
  return id;
}
