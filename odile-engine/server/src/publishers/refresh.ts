import { db, schema } from '../db/client.js';
import { getOauthApps } from '../db/oauthApps.js';
import { fetchJson, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { resumerErreurMeta } from './metaErrors.js';
import { GRAPH } from './instagram.js';
import { API, linkedInHeaders } from './linkedin.js';
import { deriveMetaPage, nomDOrganisation } from './oauth.js';
import { comptesLinkedIn, controleEnPanne, type DernierControle } from './linkedinAccounts.js';
import { getStoredToken, listStoredTokens, storeToken, updateTokenMeta, type StoredToken, type TokenSubject } from './tokens.js';

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

/**
 * Pourquoi un contrôle a échoué : la plateforme refuse le jeton ou le droit (le
 * compte ne publiera pas tant qu'on ne le reconnecte pas), ou bien elle n'a pas
 * répondu (délai, 5xx, coupure) — et le compte, lui, est probablement intact.
 * Seule la première famille met un compte « en panne » ; la seconde se signale
 * sans rien bloquer, sinon un hoquet de LinkedIn suffisait à refuser les
 * validations et à sortir un profil de la rotation.
 */
export function causeDeLEchec(err: unknown): 'auth' | 'reseau' {
  if (err instanceof HttpError) return err.status === 401 || err.status === 403 ? 'auth' : 'reseau';
  const texte = err instanceof Error ? err.message : String(err);
  return /jeton|expir|r[ée]voqu|droit|permission|invalide|scope/i.test(texte) ? 'auth' : 'reseau';
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

/**
 * Renouvelle chaque profil LinkedIn connecté, puis les pages entreprise adossées.
 *
 * Un compte à court de jeton ne doit pas empêcher les autres de se renouveler :
 * chaque profil est traité pour lui-même et le compte rendu les résume tous.
 */
async function refreshLinkedIn(now: Date): Promise<string> {
  const comptes = comptesLinkedIn('li_person');
  if (comptes.length === 0) return 'non connecté';
  const rendus: string[] = [];
  for (const compte of comptes) {
    const etat = await refreshCompteLinkedIn(compte.key, now);
    rendus.push(comptes.length > 1 ? `${compte.name} : ${etat}` : etat);
  }
  return rendus.join(' · ');
}

async function refreshCompteLinkedIn(accountKey: string, now: Date): Promise<string> {
  const person = getStoredToken('linkedin', 'li_person', accountKey);
  if (!person) return 'non connecté';
  const left = daysLeft(person.expiresAt, now.getTime());
  if (left === null) return 'jeton sans expiration';
  if (left > 10) return `ok (${Math.floor(left)} j restants)`;
  if (!person.refreshToken) {
    return left > 0 ? `expire dans ${Math.ceil(left)} j — pas de refresh token, reconnexion manuelle requise` : 'expiré — reconnexion manuelle requise';
  }
  try {
    const apps = getOauthApps();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: person.refreshToken,
      client_id: apps.linkedinClientId,
      client_secret: apps.linkedinClientSecret,
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
      accountKey: person.accountKey,
      externalId: person.externalId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? person.refreshToken,
      scopes: person.scopes,
      expiresAt,
      meta,
    });
    // Les pages entreprise adossées à CE profil suivent son jeton ; celles d'un
    // autre profil attendent le renouvellement du leur.
    for (const org of listStoredTokens('linkedin', 'li_org')) {
      const via = (org.meta.viaCompte as string | undefined) ?? person.accountKey;
      if (via !== person.accountKey) continue;
      storeToken({
        provider: 'linkedin',
        subject: 'li_org',
        accountKey: org.accountKey,
        externalId: org.externalId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? person.refreshToken,
        scopes: person.scopes,
        expiresAt,
        meta: org.meta,
      });
    }
    logger.info({ expiresAt, compte: person.accountKey }, 'jeton LinkedIn renouvelé');
    return 'renouvelé';
  } catch (err) {
    const detail = errorHint(err);
    updateTokenMeta('linkedin', 'li_person', { refreshError: detail, refreshErrorAt: now.toISOString() }, person.accountKey);
    logger.warn({ err: detail, compte: person.accountKey }, 'renouvellement LinkedIn impossible');
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
    const apps = getOauthApps();
    const longTok = await fetchJson<{ access_token: string; expires_in?: number }>(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(apps.metaAppId)}&client_secret=${encodeURIComponent(apps.metaAppSecret)}&fb_exchange_token=${encodeURIComponent(
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
  /** Quelle connexion, quand il y en a plusieurs du même type (profils LinkedIn). */
  accountKey?: string;
  label: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
}

async function check(
  provider: 'linkedin' | 'meta',
  subject: TokenSubject,
  label: string,
  fn: (token: StoredToken) => Promise<{ detail: string; meta?: Record<string, unknown> }>,
  accountKey?: string,
): Promise<ConnectionCheck | null> {
  const token = getStoredToken(provider, subject, accountKey);
  if (!token) return null;
  const checkedAt = new Date().toISOString();
  try {
    const result = await fn(token);
    updateTokenMeta(provider, subject, { ...(result.meta ?? {}), lastCheck: { at: checkedAt, ok: true, detail: result.detail } }, accountKey);
    return { provider, subject, accountKey, label, ok: true, detail: result.detail, checkedAt };
  } catch (err) {
    // Le détail est stocké tel qu'il sera lu : une phrase, pas un JSON de Graph.
    const detail = provider === 'meta' ? resumerErreurMeta(errorHint(err)) : errorHint(err);
    const cause = causeDeLEchec(err);
    const status = err instanceof HttpError ? err.status : null;
    updateTokenMeta(provider, subject, { lastCheck: { at: checkedAt, ok: false, detail, cause, status } }, accountKey);
    return { provider, subject, accountKey, label, ok: false, detail, checkedAt };
  }
}

/** Appelle chaque plateforme avec le jeton stocké : la vérité du terrain, pas la date d'expiration théorique. */
export async function checkConnections(): Promise<ConnectionCheck[]> {
  const results: (ConnectionCheck | null)[] = [];
  // Chaque profil LinkedIn connecté est interrogé pour lui-même : un jeton grillé
  // chez l'un ne doit pas passer pour une panne générale.
  for (const compte of comptesLinkedIn('li_person')) {
    results.push(
      await check(
        'linkedin',
        'li_person',
        `LinkedIn — ${compte.name}`,
        async (token) => {
          const me = await fetchJson<{ name?: string; sub: string }>(`${API}/v2/userinfo`, {
            headers: { authorization: `Bearer ${token.accessToken}` },
          });
          return { detail: `profil ${me.name ?? me.sub} joignable`, meta: me.name ? { name: me.name } : {} };
        },
        compte.key,
      ),
    );
  }
  for (const compte of comptesLinkedIn('li_org')) {
    results.push(
      await check(
        'linkedin',
        'li_org',
        `LinkedIn — page ${compte.name}`,
        async (token) => {
          if (!token.scopes.includes('w_organization_social')) {
            throw new Error('droit w_organization_social absent — reconnecte LinkedIn avec l’option « page entreprise »');
          }
          // Le jeton est celui du profil qui administre la page : s'il répond, la page
          // publie. Le nom, lui, n'est pas toujours lisible (droit de lecture à part) :
          // on le prend quand LinkedIn le donne, sinon on garde celui déjà connu ou
          // saisi dans Connexions — sans déclarer la page en panne pour un nom.
          const me = await fetchJson<{ sub: string }>(`${API}/v2/userinfo`, { headers: { authorization: `Bearer ${token.accessToken}` } });
          if (!me.sub) throw new Error('jeton du profil administrateur invalide');
          const nom = await nomDOrganisation(token.accessToken, token.externalId);
          const connu = typeof token.meta.name === 'string' && !/^Organisation \d+$/.test(token.meta.name) ? token.meta.name : null;
          return {
            detail: nom
              ? `page « ${nom} » joignable`
              : connu
                ? `page « ${connu} » joignable (nom saisi à la main : LinkedIn ne le donne pas à cette app)`
                : `page ${token.externalId} joignable — son nom n'est pas lisible : saisis-le (bouton « Renommer ») pour qu'elle soit nommée et mentionnable`,
            meta: nom ? { name: nom } : {},
          };
        },
        compte.key,
      ),
    );
  }
  results.push(
    await check('meta', 'fb_user', 'Meta — utilisateur', async (token) => {
      const me = await fetchJson<{ id: string; name?: string }>(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token.accessToken)}`);
      return { detail: `compte ${me.name ?? me.id} joignable` };
    }),
  );
  results.push(
    await check('meta', 'fb_page', 'Facebook — Page', async (token) => {
      const page = await fetchJson<{ name?: string }>(`${GRAPH}/${token.externalId}?fields=name&access_token=${encodeURIComponent(token.accessToken)}`);
      let webhookInstalled: boolean | null = null;
      try {
        const apps = await fetchJson<{ data?: { id: string }[] }>(
          `${GRAPH}/${token.externalId}/subscribed_apps?access_token=${encodeURIComponent(token.accessToken)}`,
        );
        webhookInstalled = (apps.data ?? []).some((a) => a.id === getOauthApps().metaAppId);
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
    await check('meta', 'ig_user', 'Instagram — compte pro', async (token) => {
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
    const nom = typeof meta.name === 'string' && meta.name ? ` ${meta.name}` : '';
    const lastCheck = meta.lastCheck as DernierControle | undefined;
    if (lastCheck && lastCheck.ok === false) {
      // Un refus de la plateforme est une erreur à corriger ; un délai réseau au
      // dernier test se signale seulement — le compte reste utilisé.
      const panne = controleEnPanne(lastCheck);
      warnings.push({
        provider: row.provider,
        subject: row.subject,
        level: panne ? 'error' : 'warn',
        message: panne
          ? `${label}${nom} : ${lastCheck.detail ?? 'connexion en échec'}`
          : `${label}${nom} : la plateforme n’a pas répondu au dernier test (${lastCheck.detail ?? 'erreur passagère'}) — le compte reste utilisé, « Tester » pour vérifier`,
      });
      continue;
    }
    // Lecture des commentaires refusée : le tunnel commentaire → ressource est muet
    // sur ce compte, sans que rien ne le signale ailleurs.
    const lecture = meta.lectureCommentaires as { ok?: boolean; detail?: string } | undefined;
    if (lecture && lecture.ok === false) {
      warnings.push({
        provider: row.provider,
        subject: row.subject,
        level: 'warn',
        message: `${label}${nom} : commentaires illisibles (${lecture.detail ?? 'refus de LinkedIn'}) — aucune réponse automatique ne partira sur ce compte`,
      });
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
