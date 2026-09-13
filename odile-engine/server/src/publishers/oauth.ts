import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { createToken, verifyToken } from '../lib/signedToken.js';
import { escapeHtml, resultPage } from '../api/pages.js';
import { requireSession } from '../api/auth.js';
import { getOauthApps, linkedinAppConfigured, metaAppConfigured } from '../db/oauthApps.js';
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

/**
 * Permissions Meta, en deux niveaux.
 *
 * Le socle suffit à publier sur Instagram. Les permissions avancées (webhooks de
 * Page, commentaires, messages privés, statistiques) ne sont proposées par Meta que
 * si l'app déclare les cas d'utilisation correspondants ; sinon le dialogue affiche
 * « Invalid Scopes » et la connexion est impossible. D'où la connexion minimale :
 * elle permet de publier tout de suite, quitte à élargir plus tard.
 */
export const META_CORE_SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
export const META_EXTRA_SCOPES = ['pages_manage_metadata', 'instagram_manage_comments', 'instagram_manage_messages', 'instagram_manage_insights'];
export const META_SCOPES = [...META_CORE_SCOPES, ...META_EXTRA_SCOPES].join(',');
export const metaScopes = (minimal: boolean): string => (minimal ? META_CORE_SCOPES : [...META_CORE_SCOPES, ...META_EXTRA_SCOPES]).join(',');

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

/**
 * Une Page précise, lue directement par son identifiant.
 *
 * `/me/accounts` ne liste que les Pages où l'utilisateur a un rôle direct : une Page
 * détenue par un portefeuille d'entreprise, à laquelle il accède par ce portefeuille,
 * peut en être absente alors que le jeton y donne accès. On interroge alors la Page
 * elle-même, ce qui rend son jeton et son compte Instagram.
 */
export async function fetchMetaPage(userToken: string, pageId: string): Promise<MetaPage> {
  return fetchJson<MetaPage>(
    `${GRAPH}/${encodeURIComponent(pageId)}?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`,
  );
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
/** Permissions réellement accordées par l'utilisateur (le dialogue Meta permet d'en refuser). */
export async function fetchGrantedScopes(userToken: string): Promise<string[]> {
  try {
    const res = await fetchJson<{ data?: { permission: string; status: string }[] }>(
      `${GRAPH}/me/permissions?access_token=${encodeURIComponent(userToken)}`,
    );
    return (res.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  } catch {
    return [];
  }
}

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
  grantedScopes?: string[],
): Promise<{ pageName: string; igUsername: string; igId: string; webhook: { ok: boolean; detail: string } }> {
  const pages = await listMetaPages(userToken);
  let page = pages.find((p) => p.id === pageId);
  if (!page) {
    // Absente de /me/accounts : on tente la lecture directe (Page d'un portefeuille).
    try {
      page = await fetchMetaPage(userToken, pageId);
    } catch (err) {
      throw new Error(`Page ${pageId} inaccessible avec ce compte Facebook : ${String(err).slice(0, 200)}`);
    }
  }
  if (!page.access_token) throw new Error(`Page « ${page.name} » : aucun jeton de Page accordé à l'application`);
  const ig = page.instagram_business_account;
  if (!ig) throw new Error(`Aucun compte Instagram professionnel lié à la Page « ${page.name} »`);
  const granted = grantedScopes?.length ? grantedScopes : await fetchGrantedScopes(userToken);
  const scopes = granted.length ? granted.join(',') : META_CORE_SCOPES.join(',');
  // L'abonnement aux webhooks exige pages_manage_metadata : en connexion minimale,
  // on ne tente pas l'appel (il échouerait) et on l'annonce clairement.
  const webhook = granted.length && !granted.includes('pages_manage_metadata')
    ? { ok: false, detail: 'permission pages_manage_metadata non accordée — commentaires et réponses privées inactifs' }
    : await subscribePageWebhooks(page.id, page.access_token);
  const previousIg = getStoredToken('meta', 'ig_user');
  const derivedAt = new Date().toISOString();
  storeToken({
    provider: 'meta',
    subject: 'fb_page',
    externalId: page.id,
    accessToken: page.access_token,
    scopes,
    expiresAt: null,
    meta: { pageName: page.name, webhookInstalled: webhook.ok, webhookDetail: webhook.detail, derivedAt },
  });
  storeToken({
    provider: 'meta',
    subject: 'ig_user',
    externalId: ig.id,
    accessToken: page.access_token,
    scopes,
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
    const apps = getOauthApps();
    if (!linkedinAppConfigured(apps)) {
      return reply.status(400).send({ error: 'Clés de l’app LinkedIn manquantes — renseigne Client ID et Client Secret dans Connexions & santé (ou dans .env)' });
    }
    const withOrg = request.query.org === '1' || request.query.org === 'true';
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', apps.linkedinClientId);
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
        const apps = getOauthApps();
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: apps.linkedinClientId,
          client_secret: apps.linkedinClientSecret,
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
  app.get<{ Querystring: { minimal?: string } }>('/api/oauth/meta/start', { preHandler: requireSession }, async (request, reply) => {
    const apps = getOauthApps();
    if (!metaAppConfigured(apps)) {
      return reply.status(400).send({ error: 'Clés de l’app Meta manquantes — renseigne App ID et App Secret dans Connexions & santé (ou dans .env)' });
    }
    const minimal = request.query.minimal === '1' || request.query.minimal === 'true';
    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    url.searchParams.set('client_id', apps.metaAppId);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_URL}/oauth/meta/callback`);
    if (apps.metaConfigId) {
      // Facebook Login for Business : c'est la configuration qui porte les permissions
      // ET les actifs proposés (Page + compte Instagram). Un « scope » en plus serait
      // ignoré, et sans elle Meta ouvre un dialogue sans périmètre d'actifs — l'app
      // obtient les permissions mais aucune Page ne remonte son compte Instagram.
      url.searchParams.set('config_id', apps.metaConfigId);
      url.searchParams.set('response_type', 'code');
    } else {
      url.searchParams.set('scope', metaScopes(minimal));
    }
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
        const apps = getOauthApps();
        // 1. code → jeton court
        const shortTok = await fetchJson<{ access_token: string }>(
          `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(apps.metaAppId)}&client_secret=${encodeURIComponent(apps.metaAppSecret)}&redirect_uri=${encodeURIComponent(
            `${config.PUBLIC_URL}/oauth/meta/callback`,
          )}&code=${encodeURIComponent(code)}`,
        );
        // 2. jeton court → jeton utilisateur long (~60 j, renouvelé par le job quotidien)
        const longTok = await fetchJson<{ access_token: string; expires_in?: number }>(
          `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(apps.metaAppId)}&client_secret=${encodeURIComponent(apps.metaAppSecret)}&fb_exchange_token=${encodeURIComponent(
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
        // Ce que l'utilisateur a réellement accordé : il peut avoir décoché des permissions,
        // ou s'être connecté en mode minimal. Les fonctions dépendantes s'y réfèrent.
        const granted = await fetchGrantedScopes(longTok.access_token);
        storeToken({
          provider: 'meta',
          subject: 'fb_user',
          externalId: me.id,
          accessToken: longTok.access_token,
          scopes: granted.length ? granted.join(',') : META_CORE_SCOPES.join(','),
          expiresAt,
          meta: { name: me.name ?? '', candidates, pagesTotal: pages.length, connectedAt: new Date().toISOString() },
        });
        if (pages.length === 0) {
          return reply.type('text/html').send(
            resultPage(
              false,
              'Aucune Page Facebook autorisée.',
              `<p>Trois causes possibles :</p>
<ul style="color:#aab3c2;font-size:15px;line-height:1.55">
  <li>aucune Page n'a été cochée dans la fenêtre Facebook — reclique sur « Connecter » et coche la Page de la marque ;</li>
  <li>le compte Facebook utilisé n'administre aucune Page — connecte-toi avec le compte administrateur de la Page ;</li>
  <li>la Page appartient à un portefeuille d'entreprise et n'apparaît pas dans la liste automatique :
  dans Connexions &amp; santé, utilise <b>« Saisir l'ID de la Page »</b> — le jeton reste valable, la Page
  est alors lue directement.</li>
</ul>`,
            ),
          );
        }
        if (candidates.length === 0) {
          // Nommer les Pages vues : sans cela, impossible de savoir si la bonne Page
          // a été autorisée ou si c'est le lien avec Instagram qui manque.
          const noms = pages.map((p) => `« ${escapeHtml(p.name)} »`).join(', ');
          return reply.type('text/html').send(
            resultPage(
              false,
              'Aucun compte Instagram professionnel rattaché aux Pages autorisées.',
              `<p>Pages vues par le moteur : ${noms}.</p>
<p>Si la Page de la marque ne figure pas dans cette liste, deux voies : recliquer sur « Connecter » et la cocher
dans la fenêtre Facebook, ou — si elle appartient à un portefeuille d'entreprise et n'y apparaît jamais — utiliser
<b>« Saisir l'ID de la Page »</b> dans Connexions &amp; santé, qui la lit directement par son identifiant.</p>
<p>Si elle y figure, c'est le lien avec Instagram qui manque : ouvre
<a class="accent" href="https://business.facebook.com/settings" target="_blank" rel="noreferrer">Meta Business Suite</a>
→ Paramètres → Comptes → Comptes Instagram → <b>Connecter</b>, et rattache le compte à cette Page. Le compte Instagram
doit être en mode professionnel (Instagram → Paramètres → Type de compte).</p>`,
            ),
          );
        }
        // On garde la Page déjà choisie si elle est toujours disponible, sinon la première
        const current = getStoredToken('meta', 'ig_user');
        const chosen = candidates.find((c) => c.pageId === current?.meta.pageId) ?? candidates[0]!;
        const derived = await deriveMetaPage(longTok.access_token, chosen.pageId, granted);
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

  /**
   * Point de contrôle : ce que le jeton Meta voit réellement. Utile quand la connexion
   * échoue sans que Meta explique pourquoi — permissions accordées, Pages autorisées,
   * comptes Instagram rattachés. Aucun jeton n'est renvoyé.
   */
  app.get('/api/oauth/meta/diagnostic', { preHandler: requireSession }, async (_request, reply) => {
    const user = getStoredToken('meta', 'fb_user');
    if (!user) {
      return reply.status(404).send({ error: 'Aucun jeton Meta enregistré — lance une connexion, même si elle échoue ensuite.' });
    }
    const permissions = await fetchGrantedScopes(user.accessToken);
    const manquantes = META_CORE_SCOPES.filter((s) => !permissions.includes(s));
    let pages: { id: string; nom: string; instagram: string | null }[] = [];
    let pagesErreur: string | null = null;
    try {
      pages = (await listMetaPages(user.accessToken)).map((p) => ({
        id: p.id,
        nom: p.name,
        instagram: p.instagram_business_account ? `@${p.instagram_business_account.username ?? p.instagram_business_account.id}` : null,
      }));
    } catch (err) {
      pagesErreur = String(err).slice(0, 300);
    }
    const apps = getOauthApps();
    return {
      compte: user.meta.name ?? '',
      connecteLe: user.meta.connectedAt ?? null,
      configurationUtilisee: apps.metaConfigId || '(dialogue OAuth classique)',
      permissionsAccordees: permissions,
      permissionsSoclesManquantes: manquantes,
      pagesAutorisees: pages,
      pagesErreur,
      lecture:
        pages.length === 0
          ? 'Aucune Page dans le jeton : la fenêtre Facebook n’en a proposé aucune (la configuration Login for Business doit déclarer l’actif « Pages ») ou aucune n’a été cochée.'
          : pages.every((p) => !p.instagram)
            ? 'Pages autorisées, mais aucun compte Instagram rattaché au jeton : coche aussi le compte Instagram dans la fenêtre Facebook.'
            : 'Page et compte Instagram présents : la connexion peut aboutir.',
    };
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
