import { describe, expect, it } from 'vitest';
import { createToken, verifyToken } from '../src/lib/signedToken.js';

describe('signedToken', () => {
  const base = { jti: 'abc123', pid: 42, act: 'approve' as const };

  it('signe et vérifie un token valide', () => {
    const token = createToken({ ...base, exp: Math.floor(Date.now() / 1000) + 3600 });
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.pid).toBe(42);
    expect(payload?.act).toBe('approve');
  });

  it('rejette un token expiré', () => {
    const token = createToken({ ...base, exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyToken(token)).toBeNull();
  });

  it('rejette une signature altérée', () => {
    const token = createToken({ ...base, exp: Math.floor(Date.now() / 1000) + 3600 });
    const forged = token.slice(0, -4) + 'AAAA';
    expect(verifyToken(forged)).toBeNull();
  });

  it('rejette un payload altéré', () => {
    const token = createToken({ ...base, exp: Math.floor(Date.now() / 1000) + 3600 });
    const [body, sig] = token.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), pid: 999 }),
    ).toString('base64url');
    expect(verifyToken(`${tampered}.${sig}`)).toBeNull();
  });
});
