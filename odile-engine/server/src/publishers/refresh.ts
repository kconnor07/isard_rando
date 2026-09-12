import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { fetchJson, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from './instagram.js';
import { API, linkedInHeaders } from './linkedin.js';
import { deriveMetaPage } from './oauth.js';
import { getStoredToken, storeToken, updateTokenMeta, type TokenSubject } from './tokens.js';

const DAY = 86400000;

/** Jours restants avant expiration (null = jeton sans expiration). */
export function daysLeft(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return (new Date(expiresAt).getTime() - now) / DAY;
}

function errorHint(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401) return 'jeton expiré ou révoqué — reconnecter';
    if (err.status === 403) return 'permission manquante (droit non accordé par la plateforme)';
    return `HTTP ${err.status} : ${err.body.slice(0, 160)}`;
  }
  return String(err).slice(0, 200);
}

export interface RefreshSummary {
  linkedin: string;
  meta: string;
}

/**
 * Renouvellement quotidien des jetons :
 *  - LinkedIn : `refresh_token` (fourni aux apps du programme partenaire) à moins de 10 jours de l'expiration ;
 *  - Meta : le jeton utilisateur long (60 j) est ré-échangé à moins de 20 jours, puis les jetons de Page
 *    (sans expiration) sont re-dérivés pour rester cohérents.
 */
export async function refreshTokens(now = new Date()): Promise<RefreshSummary> {
  return { linkedin: await refreshLinkedIn(now), meta: await refreshMeta(now) };
}

async function refreshLinkedIn(now: Date): Promise<string> {
  const person = getStoredToken('linkedin', 'li_person');
  if (!person) return 'non connecté';
  const left = daysLeft(person.expiresAt, now.getTime());
  if (left === null) return 'jeton sans expiration';
  if (left > 10) return `ok (${Math.floor(left)} j restants)`;
  if (!person.refreshToken) {
    return left > 0 ? `expire dans ${Math.ceil(left)} j — pas de refresh token, reconnexion manuelle requise` : 'expiré — reconnexion manuelle requise';
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: person.refreshToken,
      client_id: config.LINKEDIN_CLIENT_ID ?? '',
      client_secret: config.LINKEDIN_CLIENT_SECRET ?? '',
    });
    const token = await fetchJson<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
      'https://www.linkedin.com/oauth/v2/accessToken',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
    );
    const expiresAt = new Date(now.getTime() + token.expires_in * 1000).toISOString();
    const meta = {
      ...person.meta,
      refreshedAt: now.toISOString(),
      refreshError: null,
      refreshExpiresAt: token.refresh_token_expires_in
        ? new Date(now.getTime() + token.refresh_token_expires_in * 1000).toISOString()
        : (person.meta.refreshExpiresAt ?? null),
    };
    storeToken({
      provider: 'linkedin',
      subject: 'li_person',
      externalId: person.externalId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? person.refreshToken,
      scopes: person.scopes,
      expiresAt,
      meta,
    });
    const org = getStoredToken('linkedin', 'li_org');
    if (org) {
      storeToken({
        provider: 'linkedin',
        subject: 'li_org',
        externalId: org.externalId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? person.refreshToken,
        scopes: person.scopes,
        expiresAt,
        meta: org.meta,
      });
    }
    logger.info({ expiresAt }, 'jeton LinkedIn renouvelé');
    return 'renouvelé';
  } catch (err) {
    const detail = errorHint(err);
    updateTokenMeta('linkedin', 'li_person', { refreshError: detail, refreshErrorAt: now.toISOString() });
    logger.warn({ err: detail }, 'renouvellement LinkedIn impossible');
    return `échec : ${detail}`;
  }
}

async function refreshMeta(now: Date): Promise<string> {
  const user = getStoredToken('meta', 'fb_user');
  if (!user) {
    return getStoredToken('meta', 'ig_user')
      ? 'jeton utilisateur absent — reconnecte Instagram une fois pour activer le renouvellement automatique'
      : 'non connecté';
  }
  const left = daysLeft(user.expiresAt, now.getTime());
  if (left !== null && left > 20) return `ok (${Math.floor(left)} j restants)`;
  try {
    const longTok = await fetchJson<{ access_token: string; expires_in?: number }>(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.META_APP_ID}&client_secret=${config.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(
        user.accessToken,
      )}`,
    );
    const expiresAt = new Date(now.getTime() + (longTok.expires_in ?? 60 * 86400) * 1000).toISOString();
    storeToken({
      provider: 'meta',
      subject: 'fb_user',
      externalId: user.externalId,
      accessToken: longTok.access_token,
      scopes: user.scopes,
      expiresAt,
      meta: { ...user.meta, refreshedAt: now.toISOString(), refreshError: null },
    });
    const ig = getStoredToken('meta', 'ig_user');
    const pageId = (ig?.meta.pageId as string | undefined) ?? getStoredToken('meta', 'fb_page')?.externalId;
    if (pageId) await deriveMetaPage(longTok.access_token, pageId);
    logger.info({ expiresAt }, 'jeton Meta renouvelé');
    return 'renouvelé';
  } catch (err) {
    const detail = errorHint(err);
    updateTokenMeta('meta', 'fb_user', { refreshError: detail, refreshErrorAt: now.toISOString() });
    logger.warn({ err: detail }, 'renouvellement Meta impossible');
    return `échec : ${detail}`;
  }
}

// ---------------------------------------------------------------------------
// Vérification des connexions (bouton « Tester » du dashboard)
// ---------------------------------------------------------------------------

export interface ConnectionCheck {
  provider: 'linkedin' | 'meta';
  subject: TokenSubject;
  label: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
}

async function check(
  provider: 'linkedin' | 'meta',
  subject: TokenSubject,
  label: string,
  fn: () => Promise<{ detail: string; meta?: Record<string, unknown> }>,
): Promise<ConnectionCheck | null> {
  if (!getStoredToken(provider, subject)) return null;
  const checkedAt = new Date().toISOString();
  try {
    const result = await fn();
    updateTokenMeta(provider, subject, { ...(result.meta ?? {}), lastCheck: { at: checkedAt, ok: true, detail: result.detail } });
    return { provider, subject, label, ok: true, detail: result.detail, checkedAt };
  } catch (err) {
    const detail = errorHint(err);
    updateTokenMeta(provider, subject, { lastCheck: { at: checkedAt, ok: false, detail } });
    return { provider, subject, label, ok: false, detail, checkedAt };
  }
}

/** Appelle chaque plateforme avec le jeton stocké : la vérité du terrain, pas la date d'expiration théorique. */
export async function checkConnections(): Promise<ConnectionCheck[]> {
  const results: (ConnectionCheck | null)[] = [];
  results.push(
    await check('linkedin', 'li_person', 'LinkedIn — profil', async () => {
      const token = getStoredToken('linkedin', 'li_person')!;
      const me = await fetchJson<{ name?: string; sub: string }>(`${API}/v2/userinfo`, {
        headers: { authorization: `Bearer ${token.accessToken}` },
      });
      return { detail: `profil ${me.name ?? me.sub} joignable`, meta: me.name ? { name: me.name } : {} };
    }),
  );
  results.push(
    await check('linkedin', 'li_org', 'LinkedIn — page entreprise', async () => {
      const token = getStoredToken('linkedin', 'li_org')!;
      if (!token.scopes.includes('w_organization_social')) {
        throw new Error('droit w_organization_social absent — reconnecte LinkedIn avec l’option « page entreprise »');
      }
      const org = await fetchJson<{ localizedName?: string }>(`${API}/rest/organizations/${token.externalId}`, {
        headers: linkedInHeaders(token.accessToken),
      });
      return { detail: `page « ${org.localizedName ?? token.externalId} » joignable`, meta: org.localizedName ? { name: org.localizedName } : {} };
    }),
  );
  results.push(
    await check('meta', 'fb_user', 'Meta — utilisateur', async () => {
      const token = getStoredToken('meta', 'fb_user')!;
      const me = await fetchJson<{ id: string; name?: string }>(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token.accessToken)}`);
      return { detail: `compte ${me.name ?? me.id} joignable` };
    }),
  );
  results.push(
    await check('meta', 'fb_page', 'Facebook — Page', async () => {
      const token = getStoredToken('meta', 'fb_page')!;
      const page = await fetchJson<{ name?: string }>(`${GRAPH}/${token.externalId}?fields=name&access_token=${encodeURIComponent(token.accessToken)}`);
      let webhookInstalled: boolean | null = null;
      try {
        const apps = await fetchJson<{ data?: { id: string }[] }>(
          `${GRAPH}/${token.externalId}/subscribed_apps?access_token=${encodeURIComponent(token.accessToken)}`,
        );
        webhookInstalled = (apps.data ?? []).some((a) => a.id === config.META_APP_ID);
      } catch {
        /* la lecture des abonnements peut être refusée : on garde l'état connu */
      }
      return {
        detail: `Page « ${page.name ?? token.externalId} » joignable${webhookInstalled === null ? '' : webhookInstalled ? ', webhooks installés' : ', webhooks NON installés'}`,
        meta: webhookInstalled === null ? {} : { webhookInstalled, webhookCheckedAt: new Date().toISOString() },
      };
    }),
  );
  results.push(
    await check('meta', 'ig_user', 'Instagram — compte pro', async () => {
      const token = getStoredToken('meta', 'ig_user')!;
      const ig = await fetchJson<{ username?: string; followers_count?: number; media_count?: number }>(
        `${GRAPH}/${token.externalId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token.accessToken)}`,
      );
      return {
        detail: `@${ig.username ?? token.externalId} joignable${ig.followers_count != null ? ` · ${ig.followers_count} abonnés` : ''}`,
        meta: { igUsername: ig.username ?? token.meta.igUsername, followers: ig.followers_count ?? null, mediaCount: ig.media_count ?? null },
      };
    }),
  );
  return results.filter((r): r is ConnectionCheck => r !== null);
}

// ---------------------------------------------------------------------------
// Alertes de connexion (dashboard, résumé)
// ---------------------------------------------------------------------------

export interface ConnectionWarning {
  provider: 'linkedin' | 'meta';
  subject: string;
  level: 'warn' | 'error';
  message: string;
}

/** Jetons qui expirent sans renouvellement possible, ou dont le dernier test a échoué. */
export function connectionWarnings(now = Date.now()): ConnectionWarning[] {
  const warnings: ConnectionWarning[] = [];
  const labels: Record<string, string> = {
    li_person: 'LinkedIn (profil)',
    li_org: 'LinkedIn (page entreprise)',
    fb_user: 'Meta (utilisateur)',
    fb_page: 'Facebook (Page)',
    ig_user: 'Instagram',
  };
  for (const row of db.select().from(schema.oauthTokens).all()) {
    const meta = row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {};
    const label = labels[row.subject] ?? row.subject;
    const lastCheck = meta.lastCheck as { ok?: boolean; detail?: string } | undefined;
    if (lastCheck && lastCheck.ok === false) {
      warnings.push({ provider: row.provider, subject: row.subject, level: 'error', message: `${label} : ${lastCheck.detail ?? 'connexion en échec'}` });
      continue;
    }
    const left = daysLeft(row.expiresAt, now);
    if (left === null) continue;
    const refreshable = row.provider === 'meta' ? row.subject === 'fb_user' : Boolean(row.refreshTokenEnc);
    const refreshError = typeof meta.refreshError === 'string' ? meta.refreshError : null;
    if (left <= 0) {
      warnings.push({ provider: row.provider, subject: row.subject, level: 'error', message: `${label} : jeton expiré — reconnecter` });
    } else if (left <= 10 && (!refreshable || refreshError)) {
      warnings.push({
        provider: row.provider,
        subject: row.subject,
        level: left <= 3 ? 'error' : 'warn',
        message: `${label} : expire dans ${Math.ceil(left)} j${refreshError ? ` (renouvellement automatique en échec : ${refreshError})` : ' — reconnecter'}`,
      });
    }
  }
  return warnings;
}
