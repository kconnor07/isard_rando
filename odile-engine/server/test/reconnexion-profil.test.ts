import { describe, expect, it } from 'vitest';

// Avant tout import : la configuration lit l'environnement au chargement.
process.env.DATA_DIR = `${process.cwd()}/var-test-reconnexion-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'z'.repeat(48);

describe('reconnexion d’un profil LinkedIn : le state sait qui on attend', async () => {
  const { makeState, readState } = await import('../src/publishers/oauth.js');
  const { createToken } = await import('../src/lib/signedToken.js');

  it('sans profil visé, le state se lit comme avant', () => {
    const lu = readState(makeState());
    expect(lu).toEqual({ ok: true, org: false, attendu: '' });
  });

  it('le profil visé revient intact, y compris les « sub » LinkedIn à tirets et soulignés', () => {
    const sub = 'aBc-12_XyZ~é';
    expect(readState(makeState('', sub))).toEqual({ ok: true, org: false, attendu: sub });
  });

  it('l’option « page entreprise » et le profil visé cohabitent', () => {
    const lu = readState(makeState('org', 'sub-du-collegue'));
    expect(lu.org).toBe(true);
    expect(lu.attendu).toBe('sub-du-collegue');
  });

  it('un state absent, trafiqué ou d’une autre origine est refusé', () => {
    expect(readState(undefined).ok).toBe(false);
    expect(readState(`${makeState('', 'sub')}x`).ok).toBe(false);
    const ailleurs = createToken({ jti: 'login-abc', pid: 0, act: 'login', exp: Math.floor(Date.now() / 1000) + 600 });
    expect(readState(ailleurs).ok).toBe(false);
  });

  it('le profil qui revient se compare à celui qu’on attendait', () => {
    const attendu = readState(makeState('', 'sub-alexis')).attendu;
    expect(attendu && attendu !== 'sub-khaled').toBe(true);
    expect(attendu && attendu !== 'sub-alexis').toBe(false);
  });
});
