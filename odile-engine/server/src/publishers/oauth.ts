import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { createToken, verifyToken } from '../lib/signedToken.js';
import { resultPage } from '../api/pages.js';
import { requireSession } from '../api/auth.js';
import { getStoredToken, storeToken } from './tokens.js';
import { GRAPH } from './instagram.js';

const nanoState = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/** state OAuth signé (anti-CSRF), 10 minutes. */
function makeState(): string {
  return createToken({
    jti: `oauth-${nanoState()}`,
    pid: 0,
    act: 'login',
    exp: Math.floor(Date.now() / 1000) + 600,
  });
}
function checkState(state: string | undefined): boolean {
  return Boolean(state && verifyToken(state));
}

const LI_SCOPES = 'openid profile w_member_social';

export function registerOauthRoutes(app: FastifyInstance): void {
  // ----- LinkedIn -----------------------------------------------------------
  app.get('/api/oauth/linkedin/start', { preHandler: requireSession }, async (_request, reply) => {
    if (!config.LINKEDIN_CLIENT_ID) return reply.status(400).send({ error: 'LINKEDIN_CLIENT_ID manquant dans .env' });
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.LINKEDIN_CLIENT_ID);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_URL}/oauth/linkedin/callback`);
    url.searchParams.set('scope', LI_SCOPES);
    url.searchParams.set('state', makeState());
    return { url: url.toString() };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/oauth/linkedin/callback',
    async (request, reply) => {
      const { code, state, error, error_description } = request.query;
      if (error || !code || !checkState(state)) {
        return reply
          .type('text/html')
          .send(resultPage(false, `Connexion LinkedIn refusée : ${error_description ?? error ?? 'state invalide'}`));
      }
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.LINKEDIN_CLIENT_ID ?? '',
          client_secret: config.LINKEDIN_CLIENT_SECRET ?? '',
          redirect_uri: `${config.PUBLIC_URL}/oauth/linkedin/callback`,
        });
        const token = await fetchJson<{ access_token: string; expires_in: number; scope?: string }>(
          'https://www.linkedin.com/oauth/v2/accessToken',
          { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
        );
        const userinfo = await fetchJson<{ sub: string; name?: string }>(
          'https://api.linkedin.com/v2/userinfo',
          { headers: { authorization: `Bearer ${token.access_token}` } },
        );
        storeToken({
          provider: 'linkedin',
          subject: 'li_person',
          externalId: userinfo.sub,
          accessToken: token.access_token,
          scopes: token.scope ?? LI_SCOPES,
          expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
          meta: { name: userinfo.name ?? '' },
        });
        logger.info({ sub: userinfo.sub }, 'LinkedIn connecté');
        return reply
          .type('text/html')
          .send(resultPage(true, `LinkedIn connecté (${userinfo.name ?? userinfo.sub}). Jeton valable ~60 jours.`));
      } catch (err) {
        return reply.type('text/html').send(resultPage(false, `Échec de connexion LinkedIn : ${String(err).slice(0, 200)}`));
      }
    },
  );

  // Page entreprise : nécessite l'accès Community Management (dossier LinkedIn).
  // Une fois accordé, on associe l'ID d'organisation au jeton personnel.
  app.post<{ Body: { orgId: string } }>(
    '/api/oauth/linkedin/org',
    { preHandler: requireSession },
    async (request, reply) => {
      const orgId = request.body?.orgId?.replace(/\D/g, '');
      if (!orgId) return reply.status(400).send({ error: 'orgId requis (ex: 115786063)' });
      const person = getStoredToken('linkedin', 'li_person');
      if (!person) return reply.status(400).send({ error: 'Connecte d’abord le profil LinkedIn personnel' });
      storeToken({
        provider: 'linkedin',
        subject: 'li_org',
        externalId: orgId,
        accessToken: person.accessToken,
        scopes: 'w_organization_social (si accordé)',
        expiresAt: person.expiresAt,
        meta: { note: 'Réutilise le jeton personnel — exige l’accès Community Management API' },
      });
      return { ok: true };
    },
  );

  // ----- Meta (Facebook Login → Page → compte Instagram pro) ----------------
  const META_SCOPES = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_messages',
  ].join(',');

  app.get('/api/oauth/meta/start', { preHandler: requireSession }, async (_request, reply) => {
    if (!config.META_APP_ID) return reply.status(400).send({ error: 'META_APP_ID manquant dans .env' });
    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    url.searchParams.set('client_id', config.META_APP_ID);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_URL}/oauth/meta/callback`);
    url.searchParams.set('scope', META_SCOPES);
    url.searchParams.set('state', makeState());
    return { url: url.toString() };
  });

  app.get<{ Querystring: { code?: string; state?: string; error_description?: string } }>(
    '/oauth/meta/callback',
    async (request, reply) => {
      const { code, state, error_description } = request.query;
      if (!code || !checkState(state)) {
        return reply
          .type('text/html')
          .send(resultPage(false, `Connexion Meta refusée : ${error_description ?? 'state invalide'}`));
      }
      try {
        // 1. code → jeton court
        const shortTok = await fetchJson<{ access_token: string }>(
          `${GRAPH}/oauth/access_token?client_id=${config.META_APP_ID}&client_secret=${config.META_APP_SECRET}&redirect_uri=${encodeURIComponent(
            `${config.PUBLIC_URL}/oauth/meta/callback`,
          )}&code=${encodeURIComponent(code)}`,
        );
        // 2. jeton court → jeton long (~60 j)
        const longTok = await fetchJson<{ access_token: string; expires_in?: number }>(
          `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.META_APP_ID}&client_secret=${config.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(
            shortTok.access_token,
          )}`,
        );
        const expiresAt = new Date(Date.now() + (longTok.expires_in ?? 60 * 86400) * 1000).toISOString();
        // 3. Pages gérées + compte Instagram professionnel lié
        const pages = await fetchJson<{
          data: { id: string; name: string; access_token: string }[];
        }>(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(longTok.access_token)}`);
        if (!pages.data?.length) {
          return reply
            .type('text/html')
            .send(resultPage(false, 'Aucune Page Facebook trouvée. Crée une Page et lie-la au compte Instagram pro (voir guide setup-meta).'));
        }
        let connected: string | null = null;
        for (const page of pages.data) {
          const detail = await fetchJson<{ instagram_business_account?: { id: string; username?: string } }>(
            `${GRAPH}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(page.access_token)}`,
          );
          if (detail.instagram_business_account) {
            storeToken({
              provider: 'meta',
              subject: 'fb_page',
              externalId: page.id,
              accessToken: page.access_token,
              scopes: META_SCOPES,
              expiresAt,
              meta: { pageName: page.name },
            });
            storeToken({
              provider: 'meta',
              subject: 'ig_user',
              externalId: detail.instagram_business_account.id,
              accessToken: page.access_token,
              scopes: META_SCOPES,
              expiresAt,
              meta: { igUsername: detail.instagram_business_account.username ?? '', pageName: page.name },
            });
            connected = detail.instagram_business_account.username ?? detail.instagram_business_account.id;
            break;
          }
        }
        if (!connected) {
          return reply
            .type('text/html')
            .send(resultPage(false, 'Aucun compte Instagram professionnel lié à tes Pages. Lie le compte dans les paramètres de la Page (guide setup-meta).'));
        }
        logger.info({ ig: connected }, 'Instagram connecté');
        return reply.type('text/html').send(resultPage(true, `Instagram @${connected} connecté. Jeton valable ~60 jours.`));
      } catch (err) {
        return reply.type('text/html').send(resultPage(false, `Échec de connexion Meta : ${String(err).slice(0, 250)}`));
      }
    },
  );
}
