import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import type { TokenPayload } from '../lib/signedToken.js';
import { nextPublishSlot } from '../scheduler/cadence.js';

export interface ActionContext {
  ip?: string;
  publishNow?: boolean;
  /** date choisie (ISO) à la place du prochain créneau optimal */
  scheduleAt?: string;
  reason?: string;
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
  postId: number;
  scheduledAt?: string;
}

export function getApprovalByJti(jti: string) {
  return db.select().from(schema.approvals).where(eq(schema.approvals.jti, jti)).get() ?? null;
}

/** Exécute une action d'approbation (appelée uniquement depuis un POST confirmé). */
export function executeApprovalAction(payload: TokenPayload, ctx: ActionContext): ActionOutcome {
  const approval = getApprovalByJti(payload.jti);
  if (!approval) return { ok: false, message: 'Lien inconnu ou révoqué.', postId: payload.pid };
  if (approval.actedAt && payload.act !== 'edit') {
    return { ok: false, message: `Ce lien a déjà été utilisé (${approval.action}).`, postId: payload.pid };
  }
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, approval.postId)).get();
  if (!post) return { ok: false, message: 'Post introuvable.', postId: payload.pid };

  const now = new Date().toISOString();

  if (payload.act === 'approve') {
    const rescheduling = post.status === 'scheduled' && ctx.publishNow;
    // Un post rejeté ou en échec de publication peut être repris et reprogrammé
    if (!['draft', 'reviewing', 'awaiting_approval', 'rejected', 'failed'].includes(post.status) && !rescheduling) {
      return { ok: false, message: `Ce post est déjà « ${post.status} » — rien à faire.`, postId: post.id };
    }
    const chosen = ctx.scheduleAt ? new Date(ctx.scheduleAt) : null;
    if (chosen && (Number.isNaN(chosen.getTime()) || chosen.getTime() < Date.now() + 60_000)) {
      return { ok: false, message: 'La date choisie est passée ou invalide.', postId: post.id };
    }
    const scheduledAt = ctx.publishNow
      ? new Date(Date.now() + 60 * 1000)
      : (chosen ?? nextPublishSlot(post.platform as 'linkedin' | 'instagram'));
    // « Publier maintenant » sur un post déjà programmé : on avance le créneau
    if (rescheduling) {
      db.update(schema.publishJobs)
        .set({ state: 'canceled', finishedAt: now })
        .where(and(eq(schema.publishJobs.postId, post.id), eq(schema.publishJobs.state, 'pending')))
        .run();
    }
    db.insert(schema.publishJobs)
      .values({ postId: post.id, scheduledAt: scheduledAt.toISOString() })
      .run();
    db.update(schema.posts)
      .set({ status: 'scheduled', approvedAt: now, scheduledAt: scheduledAt.toISOString(), rejectReason: null, updatedAt: now })
      .where(eq(schema.posts.id, post.id))
      .run();
    if (post.status === 'rejected' && post.newsItemId) {
      db.update(schema.newsItems).set({ status: 'used' }).where(eq(schema.newsItems.id, post.newsItemId)).run();
    }
    markActed(approval.id, 'approve', ctx.ip);
    logger.info({ postId: post.id, scheduledAt }, 'post approuvé');
    return {
      ok: true,
      message: ctx.publishNow ? 'Approuvé — publication dans une minute.' : chosen ? 'Approuvé et programmé à la date choisie.' : 'Approuvé et programmé au prochain créneau.',
      postId: post.id,
      scheduledAt: scheduledAt.toISOString(),
    };
  }

  if (payload.act === 'reject') {
    if (['published', 'publishing'].includes(post.status)) {
      return { ok: false, message: 'Trop tard : le post est déjà publié.', postId: post.id };
    }
    db.update(schema.posts)
      .set({ status: 'rejected', rejectReason: ctx.reason ?? null, updatedAt: now })
      .where(eq(schema.posts.id, post.id))
      .run();
    // Annule un éventuel job programmé et libère l'actu pour le prochain brouillon
    db.update(schema.publishJobs)
      .set({ state: 'canceled', finishedAt: now })
      .where(eq(schema.publishJobs.postId, post.id))
      .run();
    if (post.newsItemId) {
      db.update(schema.newsItems)
        .set({ status: 'shortlisted' })
        .where(eq(schema.newsItems.id, post.newsItemId))
        .run();
    }
    markActed(approval.id, 'reject', ctx.ip);
    logger.info({ postId: post.id }, 'post rejeté');
    return { ok: true, message: 'Post rejeté. L’actualité suivante sera proposée au prochain cycle.', postId: post.id };
  }

  // 'edit' : ne consomme pas le jeton (le lien Approuver doit rester valide)
  return { ok: true, message: 'Ouverture de l’éditeur…', postId: post.id };
}

/**
 * Programme (ou reprogramme) un post à une date précise : un post à valider, rejeté
 * ou en échec est approuvé pour cette date ; un post déjà programmé change de créneau.
 */
export function schedulePost(postId: number, at: string): ActionOutcome {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) return { ok: false, message: 'Post introuvable.', postId };
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return { ok: false, message: 'Date invalide.', postId };
  if (when.getTime() < Date.now() + 60_000) return { ok: false, message: 'La date choisie est déjà passée.', postId };
  if (!['awaiting_approval', 'rejected', 'failed', 'scheduled', 'approved'].includes(post.status)) {
    return { ok: false, message: `Ce post est « ${post.status} » — il ne peut pas être programmé.`, postId };
  }
  const now = new Date().toISOString();
  db.update(schema.publishJobs)
    .set({ state: 'canceled', finishedAt: now })
    .where(and(eq(schema.publishJobs.postId, postId), eq(schema.publishJobs.state, 'pending')))
    .run();
  db.insert(schema.publishJobs).values({ postId, scheduledAt: when.toISOString() }).run();
  db.update(schema.posts)
    .set({ status: 'scheduled', approvedAt: post.approvedAt ?? now, scheduledAt: when.toISOString(), rejectReason: null, error: null, updatedAt: now })
    .where(eq(schema.posts.id, postId))
    .run();
  if (post.status === 'rejected' && post.newsItemId) {
    db.update(schema.newsItems).set({ status: 'used' }).where(eq(schema.newsItems.id, post.newsItemId)).run();
  }
  logger.info({ postId, scheduledAt: when }, post.status === 'scheduled' ? 'post reprogrammé' : 'post programmé');
  return { ok: true, message: post.status === 'scheduled' ? 'Créneau modifié.' : 'Post programmé.', postId, scheduledAt: when.toISOString() };
}

/** Annule la programmation d'un post : il revient dans la file de validation. */
export function unschedulePost(postId: number): ActionOutcome {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) return { ok: false, message: 'Post introuvable.', postId };
  if (post.status !== 'scheduled') {
    return { ok: false, message: `Ce post est « ${post.status} », pas programmé.`, postId };
  }
  const now = new Date().toISOString();
  db.update(schema.publishJobs)
    .set({ state: 'canceled', finishedAt: now })
    .where(and(eq(schema.publishJobs.postId, postId), eq(schema.publishJobs.state, 'pending')))
    .run();
  db.update(schema.posts)
    .set({ status: 'awaiting_approval', scheduledAt: null, approvedAt: null, updatedAt: now })
    .where(eq(schema.posts.id, postId))
    .run();
  logger.info({ postId }, 'programmation annulée');
  return { ok: true, message: 'Programmation annulée — le post est de retour dans « À valider ».', postId };
}

function markActed(approvalId: number, action: 'approve' | 'reject', ip?: string): void {
  db.update(schema.approvals)
    .set({ action, actedAt: new Date().toISOString(), actedIp: ip ?? null })
    .where(eq(schema.approvals.id, approvalId))
    .run();
}
