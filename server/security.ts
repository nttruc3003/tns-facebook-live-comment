import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('hex');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(':');
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const compare = Buffer.from(expected, 'hex');
  return actual.length === compare.length && timingSafeEqual(actual, compare);
}
export class Vault {
  private key: Buffer;
  constructor(directory: string) {
    const file = join(directory, 'master.key');
    if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(file);
    if (this.key.length !== 32)
      throw new Error('Khóa mã hóa không hợp lệ. Khôi phục master.key từ bản sao an toàn.');
  }
  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  decrypt(value: string) {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}
