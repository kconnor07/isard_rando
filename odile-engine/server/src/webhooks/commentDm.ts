import { and, desc, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getDmTriggers } from '../db/settingsRepo.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from '../publishers/instagram.js';
import { getStoredToken } from '../publishers/tokens.js';

/** Limite Meta : 200 DM/h par compte. Marge de sécurité. */
const HOURLY_DM_LIMIT = 190;

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

export function matchKeyword(text: string, keywords: string[]): string | null {
  const norm = normalize(text);
  for (const kw of keywords) {
    const normKw = normalize(kw);
    if (normKw && new RegExp(`(^|\\W)${normKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(norm)) {
      return kw.toUpperCase();
    }
  }
  return null;
}

/**
 * Est-ce que cette personne suit le compte ?
 *
 * Meta ne prévient d'aucun nouvel abonné et n'expose pas la liste des abonnés :
 * `is_user_follow_business` n'est lisible que pour une personne déjà en
 * conversation avec le compte. `null` = indéterminé, jamais « non ».
 */
export async function estAbonne(igsid: string): Promise<boolean | null> {
  const igToken = getStoredToken('meta', 'ig_user');
  if (!igToken || !igsid) return null;
  try {
    const res = await fetchJson<{ is_user_follow_business?: boolean }>(
      `${GRAPH}/${encodeURIComponent(igsid)}?fields=is_user_follow_business&access_token=${encodeURIComponent(igToken.accessToken)}`,
    );
    return typeof res.is_user_follow_business === 'boolean' ? res.is_user_follow_business : null;
  } catch {
    return null;
  }
}

/** Envoi d'un message privé à une personne, hors réponse à un commentaire. */
async function envoyerMessage(igsid: string, texte: string): Promise<void> {
  const igToken = getStoredToken('meta', 'ig_user');
  if (!igToken) throw new Error('Aucun compte Instagram connecté');
  await fetchJson(`${GRAPH}/${igToken.externalId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: texte }, access_token: igToken.accessToken }),
  });
}

/**
 * Réponse publique sous le commentaire.
 *
 * Elle ne dépend que de `instagram_manage_comments` : elle part même quand la
 * messagerie de l'app Meta n'est pas ouverte. Le texte dépend du sort du message
 * privé — promettre un DM qui n'arrivera pas serait pire que se taire, donc le
 * lien est donné publiquement quand l'envoi privé a échoué.
 */
export async function repondreEnPublic(commentId: number, dmParti: boolean, lien: string): Promise<void> {
  const comment = db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!comment || comment.publicReplyStatus === 'sent' || !comment.externalId) return;
  const settings = getDmTriggers();
  if (!settings.publicReply) return;
  const modele = dmParti ? settings.publicReplyTemplate : settings.publicReplyFallback;
  if (!modele.trim()) return;
  const texte = buildReply(modele, lien);

  const igToken = getStoredToken('meta', 'ig_user');
  if (config.PUBLISH_MODE === 'dry' || !igToken) {
    db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, texte }, 'réponse publique simulée (mode dry)');
    return;
  }
  try {
    await fetchJson(`${GRAPH}/${encodeURIComponent(comment.externalId)}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: texte, access_token: igToken.accessToken }),
    });
    db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, dmParti }, 'réponse publique postée');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.update(schema.comments)
      .set({ publicReplyStatus: 'failed', publicReplyError: detail.slice(0, 500) })
      .where(eq(schema.comments.id, commentId))
      .run();
    logger.error({ commentId, err: detail }, 'échec de la réponse publique');
  }
}

/** Lien de valeur à envoyer : le lien court tracké du post, sinon le site. */
function linkForPost(postId: number | null): string {
  if (postId) {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
    if (post?.linkId) {
      const link = db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get();
      if (link) return `${config.PUBLIC_URL}/r/${link.code}`;
    }
  }
  return 'https://odileai.com';
}

export function buildReply(template: string, link: string): string {
  return template.replaceAll('{{link}}', link);
}

/**
 * Traite un commentaire Instagram fraîchement reçu : si un mot-clé déclencheur
 * correspond, envoie UNE private reply avec le lien tracké (règles Meta :
 * 1 réponse privée par commentaire, sous 7 jours, ≤ 200 DM/h).
 */
export async function handleInstagramComment(commentId: number): Promise<void> {
  const comment = db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!comment || comment.dmStatus !== 'none') return;

  const settings = getDmTriggers();
  if (!settings.enabled) return;

  const post = comment.postId
    ? db.select().from(schema.posts).where(eq(schema.posts.id, comment.postId)).get()
    : null;
  const keywords = [
    ...(post?.commentTriggerKeyword ? [post.commentTriggerKeyword] : []),
    ...settings.keywords,
  ];
  const matched = matchKeyword(comment.text, keywords);
  if (!matched) return;

  // Ne jamais répondre à soi-même
  const igToken = getStoredToken('meta', 'ig_user');
  if (igToken && comment.authorExternalId === igToken.externalId) return;

  db.update(schema.comments)
    .set({ matchedKeyword: matched, dmStatus: 'pending' })
    .where(eq(schema.comments.id, commentId))
    .run();

  // Garde-fou 200 DM/h
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const sentLastHour = db
    .select({ id: schema.dmEvents.id })
    .from(schema.dmEvents)
    .where(gte(schema.dmEvents.sentAt, oneHourAgo))
    .all().length;
  if (sentLastHour >= HOURLY_DM_LIMIT) {
    logger.warn({ commentId }, 'limite horaire de DM atteinte — commentaire laissé en pending');
    return;
  }

  const lien = linkForPost(comment.postId);
  // Porte d'abonnement : on demande d'abord de s'abonner, et la réponse de la
  // personne permettra de vérifier puis d'envoyer le lien (voir handleInstagramMessage).
  const abonne = settings.requireFollow ? await estAbonne(comment.authorExternalId ?? '') : true;
  const porteFermee = settings.requireFollow && abonne !== true;
  const message = porteFermee
    ? buildReply(settings.askFollowTemplate, lien)
    : buildReply(settings.replyTemplate, lien);

  if (config.PUBLISH_MODE === 'dry' || !igToken) {
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'dry',
      })
      .run();
    db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, matched }, 'DM simulé (mode dry)');
    await repondreEnPublic(commentId, true, lien);
    return;
  }

  try {
    // Private reply : la fenêtre d'envoi est déclenchée par le commentaire lui-même
    await fetchJson(`${GRAPH}/${igToken.externalId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: comment.externalId },
        message: { text: message },
        access_token: igToken.accessToken,
      }),
    });
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'sent',
      })
      .run();
    db.update(schema.comments)
      .set({ dmStatus: porteFermee ? 'awaiting_follow' : 'sent' })
      .where(eq(schema.comments.id, commentId))
      .run();
    logger.info({ commentId, matched, porteFermee }, porteFermee ? 'demande d’abonnement envoyée' : 'private reply envoyée');
    await repondreEnPublic(commentId, true, lien);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'failed',
        error: detail.slice(0, 500),
      })
      .run();
    db.update(schema.comments).set({ dmStatus: 'failed' }).where(eq(schema.comments.id, commentId)).run();
    logger.error({ commentId, err: detail }, 'échec de la private reply');
    // Le commentaire reçoit quand même une réponse : la messagerie Meta peut être
    // fermée (produit Messenger absent) sans que la personne reste sans réponse.
    await repondreEnPublic(commentId, false, lien);
  }
}

/**
 * Message entrant d'une personne. Deux usages :
 *
 * — elle attend un lien derrière la porte d'abonnement : on revérifie son
 *   abonnement, et le lien part dès qu'il est constaté ;
 * — elle vient d'arriver en conversation : si elle suit le compte, un mot de
 *   remerciement part une seule fois.
 *
 * Meta n'émettant aucun événement d'abonnement, c'est ce message entrant qui
 * sert de déclencheur : c'est le seul moment où l'état d'abonnement devient
 * lisible.
 */
export async function handleInstagramMessage(igsid: string, texte = ''): Promise<void> {
  if (!igsid) return;
  const settings = getDmTriggers();
  if (!settings.enabled) return;
  const igToken = getStoredToken('meta', 'ig_user');
  if (igToken && igsid === igToken.externalId) return; // nos propres envois

  const enAttente = db
    .select()
    .from(schema.comments)
    .where(and(eq(schema.comments.authorExternalId, igsid), eq(schema.comments.dmStatus, 'awaiting_follow')))
    .orderBy(desc(schema.comments.id))
    .limit(1)
    .get();

  const abonne = await estAbonne(igsid);
  if (!enAttente) {
    // Personne sans demande en cours : un remerciement, seulement si elle suit
    // et qu'aucun message ne lui a déjà été envoyé.
    if (abonne !== true) return;
    const dejaEcrit = db
      .select({ id: schema.dmEvents.id })
      .from(schema.dmEvents)
      .where(eq(schema.dmEvents.recipientExternalId, igsid))
      .limit(1)
      .get();
    if (dejaEcrit) return;
    const message = buildReply(settings.thanksTemplate, 'https://odileai.com');
    await envoyerMessage(igsid, message);
    db.insert(schema.dmEvents)
      .values({ commentId: null, platform: 'instagram', recipientExternalId: igsid, message, status: 'sent' })
      .run();
    logger.info({ igsid }, 'remerciement d’abonnement envoyé');
    return;
  }

  if (config.PUBLISH_MODE === 'dry') {
    db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, enAttente.id)).run();
    logger.info({ commentId: enAttente.id }, 'lien simulé (mode dry)');
    return;
  }

  const message =
    abonne === false
      ? buildReply(settings.remindTemplate, linkForPost(enAttente.postId))
      : buildReply(settings.thanksTemplate, linkForPost(enAttente.postId));
  try {
    await envoyerMessage(igsid, message);
    db.insert(schema.dmEvents)
      .values({ commentId: enAttente.id, platform: 'instagram', recipientExternalId: igsid, message, status: 'sent' })
      .run();
    // Abonnement indéterminé : Meta ne sait pas répondre, on ne bloque pas la
    // personne pour autant — le lien est parti, la demande est close.
    if (abonne !== false) {
      db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, enAttente.id)).run();
    }
    logger.info({ commentId: enAttente.id, abonne, texte: texte.slice(0, 40) }, abonne === false ? 'relance abonnement' : 'lien envoyé après abonnement');
  } catch (err) {
    logger.warn({ igsid, err: String(err).slice(0, 200) }, 'message privé impossible');
  }
}
