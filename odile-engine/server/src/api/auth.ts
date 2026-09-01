import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { createToken, verifyToken } from '../lib/signedToken.js';

const nanoSession = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
export const SESSION_COOKIE = 'odile_session';
const SESSION_DAYS = 30;

export function issueSession(reply: FastifyReply): void {
  const token = createToken({
    jti: `sess-${nanoSession()}`,
    pid: 0,
    act: 'login',
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.PUBLIC_URL.startsWith('https'),
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export function hasValidSession(request: FastifyRequest): boolean {
  const cookie = request.cookies[SESSION_COOKIE];
  if (!cookie) return false;
  const payload = verifyToken(cookie);
  return payload !== null && payload.act === 'login';
}

export function checkPassword(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hook d'authentification pour toutes les routes /api sauf login. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.url.startsWith('/api/auth/login')) return;
  if (!hasValidSession(request)) {
    await reply.status(401).send({ error: 'Non authentifié' });
  }
}
