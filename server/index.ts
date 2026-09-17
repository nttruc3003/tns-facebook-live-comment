import 'dotenv/config';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { token } from './security.js';
import { acquireLock } from './lock.js';

const directory = resolve(process.env.DATA_DIR || 'data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
if (!existsSync(resolve('dist/client/index.html')))
  throw new Error('Chạy npm run build trước khi khởi động app.');
const setupToken = process.env.SETUP_TOKEN || token().slice(0, 12);
if (!!process.env.TLS_CERT_FILE !== !!process.env.TLS_KEY_FILE)
  throw new Error('Cần cả TLS_CERT_FILE và TLS_KEY_FILE.');
const tls =
  process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
    ? { cert: readFileSync(process.env.TLS_CERT_FILE), key: readFileSync(process.env.TLS_KEY_FILE) }
    : undefined;
const releaseLock = acquireLock(directory);
process.on('exit', releaseLock);
const { app, db } = await createApp({
  directory,
  setupToken,
  port,
  host,
  tls,
  allowedHosts: (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
try {
  await app.listen({ port, host });
} catch (error) {
  await app.close();
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
    console.error(`Cổng ${port} đang được sử dụng. Dừng bản app cũ hoặc đổi PORT trong .env.`);
  else console.error('Không khởi động được máy chủ:', (error as Error).message);
  process.exit(1);
}
const scheme = tls ? 'https' : 'http';
console.log(`\n  TNS LIVE STUDIO · v0.1.0\n  Máy này: ${scheme}://localhost:${port}`);
if (host === '0.0.0.0')
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries || [])
      if (entry.family === 'IPv4' && !entry.internal)
        console.log(`  Mạng LAN: ${scheme}://${entry.address}:${port}`);
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get())
  console.log(
    `\n  Mã thiết lập admin: ${setupToken}\n  Nhập mã này trong màn hình thiết lập đầu tiên.`,
  );
console.log(
  `\n  Dữ liệu: ${join(directory, 'studio.sqlite')}\n  Giữ ứng dụng và máy chủ hoạt động trong buổi live.\n`,
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  });
