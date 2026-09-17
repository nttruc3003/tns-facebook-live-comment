import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function acquireLock(directory: string) {
  const path = join(directory, 'studio.lock');
  if (existsSync(path)) {
    let pid: number;
    try {
      pid = JSON.parse(readFileSync(path, 'utf8')).pid;
    } catch {
      throw new Error(
        'Không đọc được studio.lock. Xác nhận app đã dừng trước khi kiểm tra file khóa.',
      );
    }
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error('File khóa không hợp lệ. Xác nhận app đã dừng trước khi kiểm tra.');
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive)
      throw new Error(
        `Dữ liệu đang được khóa bởi tiến trình ${pid}. Dừng instance đó trước khi tiếp tục.`,
      );
    unlinkSync(path);
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  return () => {
    if (existsSync(path)) {
      const lock = JSON.parse(readFileSync(path, 'utf8'));
      if (lock.pid === process.pid) unlinkSync(path);
    }
  };
}
