import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import type { TokenPayload } from '../lib/signedToken.js';
import { nextPublishSlot } from '../scheduler/cadence.js';
import { freresDuGroupe } from '../scheduler/broadcast.js';
import { compteDuPost } from '../publishers/linkedinAccounts.js';
import { motifDeRefus, verifierPost } from '../writer/conformite.js';

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
type Post = typeof schema.posts.$inferSelect;

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
    // Un post qui ne tiendrait pas ses promesses (lien absent, message privé promis sur
    // LinkedIn, compte hors service…) n'est pas programmé : on le dit, on ne le laisse pas partir.
    const refus = motifDeRefus(verifierPost(post));
    if (refus) return { ok: false, message: refus, postId: post.id };
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
    cascaderApprobation(post, scheduledAt, now, Boolean(ctx.publishNow));
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
    cascaderRejet(post, ctx.reason ?? null, now);
    return { ok: true, message: 'Post rejeté. L’actualité suivante sera proposée au prochain cycle.', postId: post.id };
  }

  // 'edit' : ne consomme pas le jeton (le lien Approuver doit rester valide)
  return { ok: true, message: 'Ouverture de l’éditeur…', postId: post.id };
}

/**
 * Diffusion simultanée : approuver l'original approuve ses copies.
 *
 * Chaque copie prend le créneau suivant de sa plateforme, à la queue leu leu derrière
 * l'original. Publier le même sujet à la même minute depuis trois comptes se voit ;
 * l'étaler donne trois passages au lieu d'un, et laisse au premier post le temps de
 * vivre (et d'être commenté par les autres comptes) avant que le suivant parte.
 * « Publier maintenant » reste immédiat pour tout le groupe. Une copie déjà publiée
 * ou déjà programmée à la main n'est pas touchée.
 */
function cascaderApprobation(post: Post, scheduledAt: Date, now: string, toutDeSuite = false): void {
  // Dernier créneau retenu sur chaque plateforme : le suivant se calcule après lui.
  const dernier = new Map<string, Date>([[post.platform, scheduledAt]]);
  for (const frere of freresDuGroupe(post)) {
    if (!['draft', 'reviewing', 'awaiting_approval', 'rejected', 'failed'].includes(frere.status)) continue;
    // Une copie non conforme ne suit pas la validation en silence : elle reste à
    // valider, avec la raison, pour être corrigée ou rejetée à part.
    const refusCopie = motifDeRefus(verifierPost(frere));
    if (refusCopie) {
      db.update(schema.posts).set({ status: 'awaiting_approval', error: refusCopie, updatedAt: now }).where(eq(schema.posts.id, frere.id)).run();
      logger.warn({ postId: frere.id, avec: post.id, refus: refusCopie }, 'copie non programmée avec l’original');
      continue;
    }
    let quand = scheduledAt;
    if (!toutDeSuite) {
      quand = nextPublishSlot(frere.platform as 'linkedin' | 'instagram', dernier.get(frere.platform) ?? scheduledAt);
      dernier.set(frere.platform, quand);
    }
    db.insert(schema.publishJobs).values({ postId: frere.id, scheduledAt: quand.toISOString() }).run();
    db.update(schema.posts)
      .set({ status: 'scheduled', approvedAt: now, scheduledAt: quand.toISOString(), rejectReason: null, error: null, updatedAt: now })
      .where(eq(schema.posts.id, frere.id))
      .run();
    logger.info({ postId: frere.id, avec: post.id, scheduledAt: quand }, 'copie approuvée avec l’original');
  }
}

/** Rejeter l'original rejette ses copies encore en attente. */
function cascaderRejet(post: Post, reason: string | null, now: string): void {
  for (const frere of freresDuGroupe(post)) {
    if (['published', 'publishing'].includes(frere.status)) continue;
    db.update(schema.posts).set({ status: 'rejected', rejectReason: reason, updatedAt: now }).where(eq(schema.posts.id, frere.id)).run();
    db.update(schema.publishJobs).set({ state: 'canceled', finishedAt: now }).where(eq(schema.publishJobs.postId, frere.id)).run();
  }
}

/**
 * Programme (ou reprogramme) un post à une date précise : un post à valider, rejeté
 * ou en échec est approuvé pour cette date ; un post déjà programmé change de créneau.
 */
/**
 * Un autre post du même compte part-il à quelques minutes de là ?
 *
 * Deux publications du même profil à la même demi-heure, c'est le compte qui se fait
 * concurrence à lui-même : la seconde vole la portée de la première. Sur deux comptes
 * différents, en revanche, rien n'empêche deux départs simultanés.
 */
function voisinTropProche(post: Post, when: Date): { hook: string; at: string } | null {
  const marge = 30 * 60_000;
  // Le compte qui publiera VRAIMENT : un post sans compte attribué part sur le premier
  // profil actif — le comparer à vide le faisait passer pour un autre compte.
  const compteDe = (p: Post) => (p.platform === 'linkedin' ? (compteDuPost(p)?.key ?? p.liAccountKey ?? '') : '');
  const mien = compteDe(post);
  const voisin = db
    .select()
    .from(schema.posts)
    .where(and(inArray(schema.posts.status, ['scheduled', 'publishing']), ne(schema.posts.id, post.id)))
    .all()
    .find(
      (p) =>
        p.platform === post.platform &&
        compteDe(p) === mien &&
        p.scheduledAt !== null &&
        Math.abs(new Date(p.scheduledAt).getTime() - when.getTime()) < marge,
    );
  return voisin?.scheduledAt ? { hook: voisin.hook || `Post #${voisin.id}`, at: voisin.scheduledAt } : null;
}

export function schedulePost(postId: number, at: string): ActionOutcome {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) return { ok: false, message: 'Post introuvable.', postId };
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return { ok: false, message: 'Date invalide.', postId };
  if (when.getTime() < Date.now() + 60_000) return { ok: false, message: 'La date choisie est déjà passée.', postId };
  if (!['awaiting_approval', 'rejected', 'failed', 'scheduled', 'approved'].includes(post.status)) {
    return { ok: false, message: `Ce post est « ${post.status} » — il ne peut pas être programmé.`, postId };
  }
  const refus = motifDeRefus(verifierPost(post));
  if (refus) return { ok: false, message: refus, postId };
  const voisin = voisinTropProche(post, when);
  if (voisin) {
    return {
      ok: false,
      message: `Ce compte publie déjà « ${voisin.hook.slice(0, 40)} » à ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(voisin.at))}. Choisis un créneau à plus de 30 minutes : deux posts du même compte à la même heure se volent leur portée.`,
      postId,
    };
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
  cascaderApprobation(post, when, now);
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
  for (const frere of freresDuGroupe(post)) {
    if (frere.status !== 'scheduled') continue;
    db.update(schema.publishJobs)
      .set({ state: 'canceled', finishedAt: now })
      .where(and(eq(schema.publishJobs.postId, frere.id), eq(schema.publishJobs.state, 'pending')))
      .run();
    db.update(schema.posts)
      .set({ status: 'awaiting_approval', scheduledAt: null, approvedAt: null, updatedAt: now })
      .where(eq(schema.posts.id, frere.id))
      .run();
  }
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
