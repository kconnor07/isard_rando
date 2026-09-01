import { eq, gte } from 'drizzle-orm';
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

  const message = buildReply(settings.replyTemplate, linkForPost(comment.postId));

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
    db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, matched }, 'private reply envoyée');
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
  }
}
