import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { createToken, verifyToken } from '../lib/signedToken.js';
import { resultPage } from '../api/pages.js';
import { requireSession } from '../api/auth.js';
import { deleteToken, getStoredToken, storeToken, updateTokenMeta } from './tokens.js';
import { GRAPH } from './instagram.js';
import { API, linkedInHeaders } from './linkedin.js';

const nanoState = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/** state OAuth signé (anti-CSRF), 10 minutes. Le tag mémorise l'option choisie (ex. « org »). */
function makeState(tag = ''): string {
  return createToken({
    jti: `oauth-${tag ? `${tag}-` : ''}${nanoState()}`,
    pid: 0,
    act: 'login',
    exp: Math.floor(Date.now() / 1000) + 600,
  });
}
function readState(state: string | undefined): { ok: boolean; org: boolean } {
  const payload = state ? verifyToken(state) : null;
  if (!payload || !payload.jti.startsWith('oauth-')) return { ok: false, org: false };
  return { ok: true, org: payload.jti.startsWith('oauth-org-') };
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

export const LI_SCOPES = 'openid profile w_member_social';
/** Page entreprise : exige le produit Community Management API sur l'app LinkedIn. */
export const LI_ORG_SCOPES = 'w_organization_social r_organization_social';

export interface LinkedInOrg {
  id: string;
  name: string;
}

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

/** Organisations dont le membre est administrateur (exige r_organization_social). */
export async function listLinkedInOrgs(accessToken: string): Promise<LinkedInOrg[]> {
  const acls = await fetchJson<{ elements?: { organization?: string }[] }>(
    `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=20`,
    { headers: linkedInHeaders(accessToken) },
  );
  const orgs: LinkedInOrg[] = [];
  for (const element of acls.elements ?? []) {
    const id = element.organization?.replace('urn:li:organization:', '');
    if (!id) continue;
    let name = `Organisation ${id}`;
    try {
      const org = await fetchJson<{ localizedName?: string }>(`${API}/rest/organizations/${id}`, {
        headers: linkedInHeaders(accessToken),
      });
      if (org.localizedName) name = org.localizedName;
    } catch {
      /* le nom est cosmétique */
    }
    orgs.push({ id, name });
  }
  return orgs;
}

/** Associe une page entreprise au jeton personnel (même jeton, même renouvellement). */
export function linkLinkedInOrganization(orgId: string): LinkedInOrg {
  const person = getStoredToken('linkedin', 'li_person');
  if (!person) throw new Error('Connecte d’abord le profil LinkedIn personnel');
  const known = (person.meta.orgs as LinkedInOrg[] | undefined)?.find((o) => o.id === orgId);
  const org: LinkedInOrg = { id: orgId, name: known?.name ?? `Organisation ${orgId}` };
  storeToken({
    provider: 'linkedin',
    subject: 'li_org',
    externalId: orgId,
    accessToken: person.accessToken,
    refreshToken: person.refreshToken,
    scopes: person.scopes,
    expiresAt: person.expiresAt,
    meta: {
      name: org.name,
      orgScopes: person.scopes.includes('w_organization_social'),
      note: person.scopes.includes('w_organization_social')
        ? 'Droits page entreprise accordés'
        : 'Reconnecte LinkedIn avec l’option « page entreprise » pour obtenir le droit de publier au nom de la page',
    },
  });
  return org;
}

// ---------------------------------------------------------------------------
// Meta (Facebook Login → Page → compte Instagram professionnel)
// ---------------------------------------------------------------------------

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'instagram_manage_insights',
].join(',');

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}
export interface MetaCandidate {
  pageId: string;
  pageName: string;
  igId: string;
  igUsername: string;
}

/** Pages gérées par l'utilisateur, avec le compte Instagram pro lié (en un appel). */
export async function listMetaPages(userToken: string): Promise<MetaPage[]> {
  const res = await fetchJson<{ data?: MetaPage[] }>(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(userToken)}`,
  );
  return res.data ?? [];
}

export function metaCandidates(pages: MetaPage[]): MetaCandidate[] {
  return pages
    .filter((p) => p.instagram_business_account)
    .map((p) => ({
      pageId: p.id,
      pageName: p.name,
      igId: p.instagram_business_account!.id,
      igUsername: p.instagram_business_account!.username ?? '',
    }));
}

/**
 * Installe l'app sur la Page : indispensable pour recevoir les webhooks Instagram
 * (commentaires → DM). Sans cela, Meta n'envoie rien même si le webhook est configuré.
 */
export async function subscribePageWebhooks(pageId: string, pageToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchJson<{ success?: boolean }>(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subscribed_fields: 'feed', access_token: pageToken }),
    });
    return res.success
      ? { ok: true, detail: 'app installée sur la Page (webhooks actifs)' }
      : { ok: false, detail: 'réponse inattendue de Meta' };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 200) };
  }
}

/**
 * Enregistre la Page choisie et son compte Instagram pro. Les jetons de Page dérivés
 * d'un jeton utilisateur long n'expirent pas : ils sont stockés sans date d'expiration.
 */
export async function deriveMetaPage(
  userToken: string,
  pageId: string,
): Promise<{ pageName: string; igUsername: string; igId: string; webhook: { ok: boolean; detail: string } }> {
  const pages = await listMetaPages(userToken);
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`Page ${pageId} introuvable parmi les Pages gérées par ce compte`);
  const ig = page.instagram_business_account;
  if (!ig) throw new Error(`Aucun compte Instagram professionnel lié à la Page « ${page.name} »`);
  const webhook = await subscribePageWebhooks(page.id, page.access_token);
  const previousIg = getStoredToken('meta', 'ig_user');
  const derivedAt = new Date().toISOString();
  storeToken({
    provider: 'meta',
    subject: 'fb_page',
    externalId: page.id,
    accessToken: page.access_token,
    scopes: META_SCOPES,
    expiresAt: null,
    meta: { pageName: page.name, webhookInstalled: webhook.ok, webhookDetail: webhook.detail, derivedAt },
  });
  storeToken({
    provider: 'meta',
    subject: 'ig_user',
    externalId: ig.id,
    accessToken: page.access_token,
    scopes: META_SCOPES,
    expiresAt: null,
    meta: {
      ...(previousIg?.externalId === ig.id ? previousIg.meta : {}),
      igUsername: ig.username ?? '',
      pageName: page.name,
      pageId: page.id,
      derivedAt,
    },
  });
  return { pageName: page.name, igUsername: ig.username ?? ig.id, igId: ig.id, webhook };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerOauthRoutes(app: FastifyInstance): void {
  // ----- LinkedIn -----------------------------------------------------------
  app.get<{ Querystring: { org?: string } }>('/api/oauth/linkedin/start', { preHandler: requireSession }, async (request, reply) => {
    if (!config.LINKEDIN_CLIENT_ID) return reply.status(400).send({ error: 'LINKEDIN_CLIENT_ID manquant dans .env' });
    const withOrg = request.query.org === '1' || request.query.org === 'true';
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.LINKEDIN_CLIENT_ID);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_URL}/oauth/linkedin/callback`);
    url.searchParams.set('scope', withOrg ? `${LI_SCOPES} ${LI_ORG_SCOPES}` : LI_SCOPES);
    url.searchParams.set('state', makeState(withOrg ? 'org' : ''));
    return { url: url.toString() };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/oauth/linkedin/callback',
    async (request, reply) => {
      const { code, state, error, error_description } = request.query;
      const st = readState(state);
      if (error || !code || !st.ok) {
        const reason = error_description ?? error ?? 'state invalide';
        const hint = /scope/i.test(reason)
          ? ' — les droits « page entreprise » exigent le produit Community Management API sur l’app LinkedIn : reconnecte sans cette option en attendant.'
          : '';
        return reply.type('text/html').send(resultPage(false, `Connexion LinkedIn refusée : ${reason}${hint}`));
      }
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.LINKEDIN_CLIENT_ID ?? '',
          client_secret: config.LINKEDIN_CLIENT_SECRET ?? '',
          redirect_uri: `${config.PUBLIC_URL}/oauth/linkedin/callback`,
        });
        const token = await fetchJson<LinkedInTokenResponse>('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        const userinfo = await fetchJson<{ sub: string; name?: string }>(`${API}/v2/userinfo`, {
          headers: { authorization: `Bearer ${token.access_token}` },
        });
        const granted = token.scope ?? (st.org ? `${LI_SCOPES} ${LI_ORG_SCOPES}` : LI_SCOPES);
        const orgScopes = granted.includes('w_organization_social');
        const meta: Record<string, unknown> = {
          name: userinfo.name ?? '',
          orgScopes,
          orgRequested: st.org,
          refreshExpiresAt: token.refresh_token_expires_in
            ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString()
            : null,
          orgs: [] as LinkedInOrg[],
          orgsError: null as string | null,
          connectedAt: new Date().toISOString(),
        };
        if (orgScopes) {
          try {
            meta.orgs = await listLinkedInOrgs(token.access_token);
          } catch (err) {
            meta.orgsError = String(err).slice(0, 200);
          }
        }
        storeToken({
          provider: 'linkedin',
          subject: 'li_person',
          externalId: userinfo.sub,
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          scopes: granted,
          expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
          meta,
        });
        // Page entreprise déjà liée : elle reçoit le nouveau jeton ; une seule organisation administrée : liaison automatique
        const orgs = meta.orgs as LinkedInOrg[];
        const existingOrg = getStoredToken('linkedin', 'li_org');
        let orgNote = '';
        if (existingOrg) {
          const org = linkLinkedInOrganization(existingOrg.externalId);
          orgNote = ` Page entreprise « ${org.name} » mise à jour.`;
        } else if (orgs.length === 1) {
          const org = linkLinkedInOrganization(orgs[0]!.id);
          orgNote = ` Page entreprise « ${org.name} » liée automatiquement.`;
        } else if (orgs.length > 1) {
          orgNote = ` ${orgs.length} pages entreprise administrées : choisis-en une dans Connexions & santé.`;
        } else if (st.org && !orgScopes) {
          orgNote = ' Les droits « page entreprise » n’ont pas été accordés (Community Management API).';
        }
        logger.info({ sub: userinfo.sub, orgScopes, refresh: Boolean(token.refresh_token) }, 'LinkedIn connecté');
        return reply
          .type('text/html')
          .send(
            resultPage(
              true,
              `LinkedIn connecté (${userinfo.name ?? userinfo.sub}). Jeton valable ~60 jours${
                token.refresh_token ? ', renouvelé automatiquement par le moteur' : ' — le moteur te préviendra 7 jours avant l’expiration'
              }.${orgNote}`,
            ),
          );
      } catch (err) {
        return reply.type('text/html').send(resultPage(false, `Échec de connexion LinkedIn : ${String(err).slice(0, 200)}`));
      }
    },
  );

  /** Organisations administrées (mémorisées à la connexion ; `live=1` les recharge depuis LinkedIn). */
  app.get<{ Querystring: { live?: string } }>('/api/oauth/linkedin/orgs', { preHandler: requireSession }, async (request, reply) => {
    const person = getStoredToken('linkedin', 'li_person');
    if (!person) return reply.status(400).send({ error: 'Profil LinkedIn non connecté' });
    const orgScopes = person.scopes.includes('w_organization_social');
    let orgs = (person.meta.orgs as LinkedInOrg[] | undefined) ?? [];
    let error = (person.meta.orgsError as string | null | undefined) ?? null;
    if (request.query.live === '1' && orgScopes) {
      try {
        orgs = await listLinkedInOrgs(person.accessToken);
        error = null;
      } catch (err) {
        error = String(err).slice(0, 200);
      }
      updateTokenMeta('linkedin', 'li_person', { orgs, orgsError: error });
    }
    const linked = getStoredToken('linkedin', 'li_org');
    return { orgScopes, orgs, error, linkedOrgId: linked?.externalId ?? null };
  });

  app.post<{ Body: { orgId: string } }>('/api/oauth/linkedin/org', { preHandler: requireSession }, async (request, reply) => {
    const orgId = request.body?.orgId?.replace(/\D/g, '');
    if (!orgId) return reply.status(400).send({ error: 'orgId requis (ex: 115786063)' });
    if (!getStoredToken('linkedin', 'li_person')) {
      return reply.status(400).send({ error: 'Connecte d’abord le profil LinkedIn personnel' });
    }
    const org = linkLinkedInOrganization(orgId);
    return { ok: true, org };
  });

  app.delete('/api/oauth/linkedin/org', { preHandler: requireSession }, async () => {
    deleteToken('linkedin', 'li_org');
    return { ok: true };
  });

  // ----- Meta ---------------------------------------------------------------
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
      if (!code || !readState(state).ok) {
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
        // 2. jeton court → jeton utilisateur long (~60 j, renouvelé par le job quotidien)
        const longTok = await fetchJson<{ access_token: string; expires_in?: number }>(
          `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.META_APP_ID}&client_secret=${config.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(
            shortTok.access_token,
          )}`,
        );
        const expiresAt = new Date(Date.now() + (longTok.expires_in ?? 60 * 86400) * 1000).toISOString();
        const me = await fetchJson<{ id: string; name?: string }>(
          `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(longTok.access_token)}`,
        );
        // 3. Pages gérées + comptes Instagram professionnels liés
        const pages = await listMetaPages(longTok.access_token);
        const candidates = metaCandidates(pages);
        storeToken({
          provider: 'meta',
          subject: 'fb_user',
          externalId: me.id,
          accessToken: longTok.access_token,
          scopes: META_SCOPES,
          expiresAt,
          meta: { name: me.name ?? '', candidates, pagesTotal: pages.length, connectedAt: new Date().toISOString() },
        });
        if (pages.length === 0) {
          return reply
            .type('text/html')
            .send(resultPage(false, 'Aucune Page Facebook trouvée. Crée une Page et lie-la au compte Instagram pro (voir guide setup-meta).'));
        }
        if (candidates.length === 0) {
          return reply
            .type('text/html')
            .send(resultPage(false, 'Aucun compte Instagram professionnel lié à tes Pages. Lie le compte dans les paramètres de la Page (guide setup-meta).'));
        }
        // On garde la Page déjà choisie si elle est toujours disponible, sinon la première
        const current = getStoredToken('meta', 'ig_user');
        const chosen = candidates.find((c) => c.pageId === current?.meta.pageId) ?? candidates[0]!;
        const derived = await deriveMetaPage(longTok.access_token, chosen.pageId);
        logger.info({ ig: derived.igUsername, page: derived.pageName, webhook: derived.webhook.ok }, 'Instagram connecté');
        const more = candidates.length > 1 ? ` ${candidates.length} comptes disponibles — tu peux en choisir un autre dans Connexions & santé.` : '';
        const webhook = derived.webhook.ok
          ? ' Webhook commentaires installé sur la Page.'
          : ` Webhook commentaires non installé (${derived.webhook.detail}) — bouton « Réinstaller » dans Connexions & santé.`;
        return reply
          .type('text/html')
          .send(
            resultPage(
              true,
              `Instagram @${derived.igUsername} connecté via la Page « ${derived.pageName} ». Les jetons de Page n’expirent pas ; le jeton utilisateur (60 j) est renouvelé automatiquement.${more}${webhook}`,
            ),
          );
      } catch (err) {
        return reply.type('text/html').send(resultPage(false, `Échec de connexion Meta : ${String(err).slice(0, 250)}`));
      }
    },
  );

  /** Comptes Instagram disponibles (Pages avec un compte pro lié). */
  app.get<{ Querystring: { live?: string } }>('/api/oauth/meta/pages', { preHandler: requireSession }, async (request) => {
    const user = getStoredToken('meta', 'fb_user');
    const ig = getStoredToken('meta', 'ig_user');
    if (!user) return { candidates: [] as MetaCandidate[], selectedPageId: (ig?.meta.pageId as string | undefined) ?? null, userToken: false };
    let candidates = (user.meta.candidates as MetaCandidate[] | undefined) ?? [];
    let error: string | null = null;
    if (request.query.live === '1') {
      try {
        candidates = metaCandidates(await listMetaPages(user.accessToken));
        updateTokenMeta('meta', 'fb_user', { candidates });
      } catch (err) {
        error = String(err).slice(0, 200);
      }
    }
    return { candidates, selectedPageId: (ig?.meta.pageId as string | undefined) ?? null, userToken: true, error };
  });

  app.post<{ Body: { pageId: string } }>('/api/oauth/meta/select', { preHandler: requireSession }, async (request, reply) => {
    const pageId = request.body?.pageId?.replace(/\D/g, '');
    if (!pageId) return reply.status(400).send({ error: 'pageId requis' });
    const user = getStoredToken('meta', 'fb_user');
    if (!user) return reply.status(400).send({ error: 'Reconnecte Instagram : le jeton utilisateur Meta est absent' });
    try {
      const derived = await deriveMetaPage(user.accessToken, pageId);
      return { ok: true, ...derived };
    } catch (err) {
      return reply.status(409).send({ error: String(err).slice(0, 200) });
    }
  });

  /** (Ré)installe l'app sur la Page pour les webhooks commentaires. */
  app.post('/api/oauth/meta/subscribe', { preHandler: requireSession }, async (_request, reply) => {
    const page = getStoredToken('meta', 'fb_page');
    if (!page) return reply.status(400).send({ error: 'Aucune Page Facebook connectée' });
    const result = await subscribePageWebhooks(page.externalId, page.accessToken);
    updateTokenMeta('meta', 'fb_page', { webhookInstalled: result.ok, webhookDetail: result.detail, webhookCheckedAt: new Date().toISOString() });
    if (!result.ok) return reply.status(409).send({ error: `Installation impossible : ${result.detail}` });
    return { ok: true, detail: result.detail };
  });

  /** Déconnexion complète d'un fournisseur (les jetons sont supprimés localement). */
  app.delete<{ Params: { provider: string } }>('/api/oauth/:provider', { preHandler: requireSession }, async (request, reply) => {
    const provider = request.params.provider;
    if (provider === 'linkedin') {
      deleteToken('linkedin', 'li_person');
      deleteToken('linkedin', 'li_org');
    } else if (provider === 'meta') {
      deleteToken('meta', 'fb_user');
      deleteToken('meta', 'fb_page');
      deleteToken('meta', 'ig_user');
    } else {
      return reply.status(404).send({ error: 'Fournisseur inconnu' });
    }
    return { ok: true };
  });
}
