import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import type { TokenPayload } from '../lib/signedToken.js';
import { nextPublishSlot } from '../scheduler/cadence.js';

export interface ActionContext {
  ip?: string;
  publishNow?: boolean;
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
    if (!['draft', 'reviewing', 'awaiting_approval'].includes(post.status)) {
      return { ok: false, message: `Ce post est déjà « ${post.status} » — rien à faire.`, postId: post.id };
    }
    const scheduledAt = ctx.publishNow
      ? new Date(Date.now() + 60 * 1000)
      : nextPublishSlot(post.platform as 'linkedin' | 'instagram');
    db.insert(schema.publishJobs)
      .values({ postId: post.id, scheduledAt: scheduledAt.toISOString() })
      .run();
    db.update(schema.posts)
      .set({ status: 'scheduled', approvedAt: now, scheduledAt: scheduledAt.toISOString(), updatedAt: now })
      .where(eq(schema.posts.id, post.id))
      .run();
    markActed(approval.id, 'approve', ctx.ip);
    logger.info({ postId: post.id, scheduledAt }, 'post approuvé');
    return {
      ok: true,
      message: ctx.publishNow ? 'Approuvé — publication dans une minute.' : 'Approuvé et programmé.',
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

function markActed(approvalId: number, action: 'approve' | 'reject', ip?: string): void {
  db.update(schema.approvals)
    .set({ action, actedAt: new Date().toISOString(), actedIp: ip ?? null })
    .where(eq(schema.approvals.id, approvalId))
    .run();
}
