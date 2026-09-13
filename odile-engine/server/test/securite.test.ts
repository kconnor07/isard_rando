import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');

describe('secrets en production', async () => {
  const { checkProductionSecrets } = await import('../src/config.js');
  const ok = { APP_SECRET: 'Kp8/2vQx1mNz+Rd4TfWc9YbA6HgJ3LsE7uOiPqZxVn0=', ADMIN_PASSWORD: 'Tournesol-42-Bleu' };

  it('laisse passer des secrets personnels', () => {
    expect(checkProductionSecrets(ok)).toEqual([]);
  });
  it('refuse les valeurs d’exemple du dépôt', () => {
    const problems = checkProductionSecrets({ APP_SECRET: 'dev-secret-change-me-in-production!', ADMIN_PASSWORD: 'odile' });
    expect(problems.filter((p) => p.level === 'erreur').map((p) => p.key)).toEqual(['APP_SECRET', 'ADMIN_PASSWORD']);
  });
  it('refuse tout secret qui contient « change-me »', () => {
    const problems = checkProductionSecrets({ ...ok, APP_SECRET: 'change-me-openssl-rand-base64-32' });
    expect(problems.some((p) => p.key === 'APP_SECRET' && p.level === 'erreur')).toBe(true);
  });
  it('avertit sans bloquer sur un secret personnel trop court', () => {
    const problems = checkProductionSecrets({ APP_SECRET: 'bF7-tQ2mXs9Lp4Rv', ADMIN_PASSWORD: 'Odile0702!' });
    expect(problems.every((p) => p.level === 'avertissement')).toBe(true);
    expect(problems.map((p) => p.key).sort()).toEqual(['ADMIN_PASSWORD', 'APP_SECRET']);
  });
});

describe('lecture du .env', () => {
  /** Le vrai module de configuration, chargé dans un sous-processus avec un environnement choisi. */
  const load = (env: Record<string, string>) =>
    JSON.parse(
      execFileSync(
        'npx',
        ['tsx', '-e', "import {config} from './src/config.ts'; process.stdout.write(JSON.stringify({secure: config.SMTP_SECURE, sched: config.DISABLE_SCHEDULER, mailTo: config.APPROVAL_EMAIL_TO ?? null}))"],
        { cwd: serverDir, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', ...env } },
      ),
    ) as { secure: boolean; sched: boolean; mailTo: string | null };

  it('« false » et « 0 » valent bien false', () => {
    expect(load({ SMTP_SECURE: 'false', DISABLE_SCHEDULER: '0' })).toMatchObject({ secure: false, sched: false });
  }, 60_000);

  it('« true » et « 1 » valent bien true', () => {
    expect(load({ SMTP_SECURE: 'true', DISABLE_SCHEDULER: '1' })).toMatchObject({ secure: true, sched: true });
  }, 60_000);

  it('une variable laissée vide dans .env n’empêche pas le démarrage', () => {
    expect(load({ APPROVAL_EMAIL_TO: '', PUBLIC_URL: '' }).mailTo).toBeNull();
  }, 60_000);
});

describe('jetons de session', async () => {
  const { isSessionToken } = await import('../src/api/auth.js');
  const { createToken } = await import('../src/lib/signedToken.js');
  const exp = () => Math.floor(Date.now() / 1000) + 600;

  it('accepte un jeton émis par issueSession', () => {
    expect(isSessionToken(createToken({ jti: 'sess-abc123', pid: 0, act: 'login', exp: exp() }))).toBe(true);
  });
  it('refuse un state OAuth, pourtant signé et act=login', () => {
    // Ce jeton transite en clair dans l'URL LinkedIn/Meta : il ne doit jamais ouvrir de session.
    expect(isSessionToken(createToken({ jti: 'oauth-abc123', pid: 0, act: 'login', exp: exp() }))).toBe(false);
    expect(isSessionToken(createToken({ jti: 'oauth-org-abc123', pid: 0, act: 'login', exp: exp() }))).toBe(false);
  });
  it('refuse un jeton d’approbation et un jeton expiré', () => {
    expect(isSessionToken(createToken({ jti: 'sess-abc123', pid: 4, act: 'approve', exp: exp() }))).toBe(false);
    expect(isSessionToken(createToken({ jti: 'sess-abc123', pid: 0, act: 'login', exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(false);
  });
  it('refuse une signature invalide', () => {
    const token = createToken({ jti: 'sess-abc123', pid: 0, act: 'login', exp: exp() });
    expect(isSessionToken(`${token.slice(0, -2)}xx`)).toBe(false);
  });
});

describe('limitation des tentatives de connexion', async () => {
  const { RateLimiter } = await import('../src/api/rateLimit.js');

  it('bloque à la 6e tentative et rouvre après la fenêtre', () => {
    const rl = new RateLimiter({ max: 5, windowMs: 60_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rl.fail('1.2.3.4', t0 + i).allowed).toBe(i < 4);
    const blocked = rl.check('1.2.3.4', t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(rl.check('1.2.3.4', t0 + 61_000).allowed).toBe(true);
  });
  it('isole les adresses IP les unes des autres', () => {
    const rl = new RateLimiter({ max: 2, windowMs: 60_000 });
    rl.fail('1.1.1.1');
    rl.fail('1.1.1.1');
    expect(rl.check('1.1.1.1').allowed).toBe(false);
    expect(rl.check('2.2.2.2').allowed).toBe(true);
  });
  it('une connexion réussie efface le compteur', () => {
    const rl = new RateLimiter({ max: 2, windowMs: 60_000 });
    rl.fail('9.9.9.9');
    rl.reset('9.9.9.9');
    expect(rl.check('9.9.9.9').remaining).toBe(2);
  });
});

describe('erreurs HTTP : aucun secret recopié', async () => {
  const { HttpError, redactSecrets, redactUrl } = await import('../src/lib/http.js');

  it('masque le jeton passé en query string (Graph API)', () => {
    const err = new HttpError(400, 'https://graph.facebook.com/v21.0/17841400000/media?access_token=EAAGm0PX4ZCpsBO1234567890abcdef&fields=id', '{"error":{"message":"Invalid parameter"}}');
    expect(err.message).not.toContain('EAAGm0PX4ZCpsBO1234567890abcdef');
    expect(err.message).toContain('access_token=***');
    expect(err.message).toContain('fields=id');
    expect(err.url).not.toContain('EAAGm0');
  });
  it('masque client_secret et code sur l’échange de jeton', () => {
    const url = 'https://graph.facebook.com/v21.0/oauth/access_token?client_id=123&client_secret=abcdef0123456789&code=AQD9xyz';
    expect(redactUrl(url)).toBe('https://graph.facebook.com/v21.0/oauth/access_token?client_id=123&client_secret=***&code=***');
  });
  it('masque un jeton recopié par la plateforme dans son message', () => {
    expect(redactSecrets('{"access_token":"EAAGm0PX4ZCpsBO1234567890","expires_in":5184000}')).not.toContain('EAAGm0PX4ZCpsBO1234567890');
    expect(redactSecrets('access_token=EAAGm0PX4ZCpsBO1234567890 expiré')).toContain('***');
  });
  it('reste lisible pour un diagnostic', () => {
    const err = new HttpError(401, 'https://api.linkedin.com/rest/posts', '{"message":"Empty oauth2 access token"}');
    expect(err.message).toContain('HTTP 401');
    expect(err.message).toContain('api.linkedin.com/rest/posts');
    expect(err.message).toContain('Empty oauth2 access token');
  });
  it('ne casse pas sur une URL invalide', () => {
    expect(redactUrl('pas-une-url?access_token=secret')).toBe('pas-une-url');
  });
});
