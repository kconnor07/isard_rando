import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const key = createHash('sha256').update(config.APP_SECRET).digest();

/** Chiffre une chaîne (tokens OAuth) en AES-256-GCM → base64url(iv|tag|data). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Hash d'IP salé par jour — comptage de clics sans stocker l'IP (RGPD). */
export function dailyIpHash(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${config.APP_SECRET}|${day}|${ip}`).digest('hex').slice(0, 24);
}
