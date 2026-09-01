import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface TokenPayload {
  v: 1;
  /** identifiant unique du lot de liens — usage unique vérifié en base */
  jti: string;
  /** post id (0 pour les tokens de login) */
  pid: number;
  act: 'approve' | 'reject' | 'edit' | 'login';
  /** expiration epoch secondes */
  exp: number;
}

const b64u = (buf: Buffer) => buf.toString('base64url');

function sign(data: string): string {
  return b64u(createHmac('sha256', config.APP_SECRET).update(data).digest());
}

export function createToken(payload: Omit<TokenPayload, 'v'>): string {
  const body = b64u(Buffer.from(JSON.stringify({ v: 1, ...payload })));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (payload.v !== 1) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
