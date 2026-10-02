import 'dotenv/config';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock } from './lock.js';

const source = process.argv[2];
if (!source)
  throw new Error('Cách dùng: npm run restore -- /đường/dẫn/backup.sqlite (dừng app trước).');
const directory = resolve(process.env.DATA_DIR || 'data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = join(directory, 'studio.sqlite');
if (resolve(source) === target)
  throw new Error('Backup nguồn phải là file khác database đang sử dụng.');
const release = acquireLock(directory);
let staging = '';
try {
  const check = new Database(resolve(source), { readonly: true, fileMustExist: true });
  try {
    if (
      ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(
        check.pragma('user_version', { simple: true }) as number,
      ) ||
      check.pragma('integrity_check', { simple: true }) !== 'ok'
    )
      throw new Error('Backup không đúng phiên bản hoặc lỗi integrity.');
    for (const table of [
      'users',
      'sessions',
      'settings',
      'oauth_states',
      'sources',
      'streams',
      'comments',
      'analysis_runs',
    ])
      if (!check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        throw new Error(`Backup thiếu bảng ${table}.`);
    staging = join(directory, `restore-${randomUUID()}.sqlite`);
    await check.backup(staging);
  } finally {
    check.close();
  }
  const restored = new Database(staging);
  try {
    restored.transaction(() => {
      if ((restored.pragma('user_version', { simple: true }) as number) >= 9)
        restored.prepare('DELETE FROM capture_installations').run();
      restored.prepare('DELETE FROM sessions').run();
      restored.prepare('DELETE FROM oauth_states').run();
      restored.prepare('DELETE FROM sources').run();
      if ((restored.pragma('user_version', { simple: true }) as number) >= 2)
        restored.prepare('DELETE FROM capture_devices').run();
      if ((restored.pragma('user_version', { simple: true }) as number) >= 3)
        restored.prepare('DELETE FROM capture_pairings').run();
      restored
        .prepare("DELETE FROM settings WHERE key IN ('facebook','facebookUser','aiKey')")
        .run();
      restored
        .prepare(
          "UPDATE streams SET collecting=0,cursor=NULL,nextPoll=0,failures=0,error=CASE WHEN kind='facebook' THEN 'Đã khôi phục. Kết nối Facebook lại trước khi thu thập.' ELSE NULL END",
        )
        .run();
    })();
    restored.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    restored.close();
  }
  chmodSync(staging, 0o600);
  const archive = join(
    directory,
    `restore-before-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 6)}`,
  );
  mkdirSync(archive, { mode: 0o700 });
  for (const name of ['studio.sqlite', 'studio.sqlite-wal', 'studio.sqlite-shm', 'master.key'])
    if (existsSync(join(directory, name))) copyFileSync(join(directory, name), join(archive, name));
  // Only after a verified backup and a saved copy of existing data, replace the exact database.
  for (const suffix of ['-wal', '-shm'])
    if (existsSync(target + suffix)) unlinkSync(target + suffix);
  renameSync(staging, target);
  staging = '';
  console.log(
    `Đã khôi phục comment, tài khoản và kết quả. Dữ liệu cũ được giữ ở ${archive}.\nPhiên đăng nhập và token được xóa khỏi bản khôi phục. Đăng nhập lại, cấu hình Facebook/AI rồi bật thu thập khi cần.`,
  );
} finally {
  if (staging && existsSync(staging)) unlinkSync(staging);
  release();
}
