import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { createToken, verifyToken } from '../lib/signedToken.js';

const nanoSession = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
export const SESSION_COOKIE = 'odile_session';
const SESSION_DAYS = 30;
/** Session ouverte depuis un lien d'email : volontairement courte. */
const EMAIL_SESSION_HOURS = 2;
/**
 * Préfixe des jetons de session. Les jetons `state` de l'OAuth portent eux aussi
 * `act: 'login'` mais un jti `oauth-…` et transitent en clair dans l'URL LinkedIn/Meta :
 * sans ce contrôle, un state intercepté ouvrirait une session d'administration.
 */
const SESSION_JTI_PREFIX = 'sess-';

/** Ouvre une session d'administration. `fromEmail` : session de 2 h au lieu de 30 jours. */
export function issueSession(reply: FastifyReply, opts: { fromEmail?: boolean } = {}): void {
  const seconds = opts.fromEmail ? EMAIL_SESSION_HOURS * 3600 : SESSION_DAYS * 24 * 3600;
  const token = createToken({
    jti: `${SESSION_JTI_PREFIX}${nanoSession()}`,
    pid: 0,
    act: 'login',
    exp: Math.floor(Date.now() / 1000) + seconds,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.PUBLIC_URL.startsWith('https'),
    maxAge: seconds,
  });
}

/** Un jeton signé n'est une session que s'il a été émis par issueSession (jti « sess-… »). */
export function isSessionToken(token: string): boolean {
  const payload = verifyToken(token);
  return payload !== null && payload.act === 'login' && payload.jti.startsWith(SESSION_JTI_PREFIX);
}

export function hasValidSession(request: FastifyRequest): boolean {
  const cookie = request.cookies[SESSION_COOKIE];
  return cookie ? isSessionToken(cookie) : false;
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
