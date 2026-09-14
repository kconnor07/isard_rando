import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { runDesignReview } from '../design-studio/index.js';
import { getImageGen } from '../db/settingsRepo.js';
import { generateImagesForPost, type ImagesSummary } from '../imagegen/index.js';
import { renderPost } from '../render/renderer.js';
import { captureForPost } from '../screenshot/capture.js';
import { runVisualAgentForPipeline, type VisualRunSummary } from '../visuals/agent.js';
import { draftPost, type DraftOptions } from '../writer/generate.js';

export interface PipelineSummary {
  postId: number;
  screenshot: string;
  images: ImagesSummary;
  review: { iterations: number; passed: boolean; unavailable: boolean };
  visuals: VisualRunSummary | null;
  emailed: boolean;
}

/**
 * Chaîne complète de préparation d'un post :
 * rédaction → capture d'écran → rendu → studio de design → email d'approbation.
 * Rien n'est publié : le post finit en "awaiting_approval".
 */
export async function runDraftPipeline(opts: DraftOptions = {}): Promise<PipelineSummary> {
  const draft = await draftPost(opts);
  logger.info({ postId: draft.postId }, 'brouillon généré');
  try {
    return await fabriquer(draft, opts);
  } catch (err) {
    // Sans cela, une étape qui échoue (rendu, capture, agent visuel) laissait le
    // post figé sur « en fabrication », sans motif et sans moyen de le relancer.
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.posts)
      .set({ status: 'failed', error: `Fabrication interrompue : ${message.slice(0, 700)}`, updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, draft.postId))
      .run();
    logger.error({ postId: draft.postId, err: message }, 'fabrication interrompue');
    throw err;
  }
}

/**
 * Reprend la fabrication d'un post déjà rédigé (rendu, relecture, email), après
 * un échec ou un réglage corrigé. La rédaction, elle, n'est pas rejouée : le
 * texte validé est conservé.
 */
export async function refabriquerPost(postId: number): Promise<PipelineSummary> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  db.update(schema.posts).set({ status: 'reviewing', error: null }).where(eq(schema.posts.id, postId)).run();
  try {
    return await fabriquer({ postId, screenshotUrl: null }, {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.posts)
      .set({ status: 'failed', error: `Fabrication interrompue : ${message.slice(0, 700)}` })
      .where(eq(schema.posts.id, postId))
      .run();
    throw err;
  }
}

/** Les étapes qui suivent la rédaction : capture, illustrations, rendu, relecture, email. */
async function fabriquer(draft: { postId: number; screenshotUrl: string | null }, _opts: DraftOptions): Promise<PipelineSummary> {
  const capture = await captureForPost(draft.postId, draft.screenshotUrl);
  // Par défaut, aucune image n'est posée toute seule : l'agent visuel la propose
  // (idée d'image de l'accroche comprise) et l'humain la pose s'il la veut.
  const images: ImagesSummary = getImageGen().autoPlace
    ? await generateImagesForPost(draft.postId).catch((err) => {
        logger.error({ err: String(err) }, "génération d'images en échec (non bloquant)");
        return { generated: 0, skipped: 0, failed: 1, tokens: 0 };
      })
    : { generated: 0, skipped: 0, failed: 0, tokens: 0 };
  // L'agent visuel propose captures et illustrations pour cette veille (non bloquant)
  const visuals = await runVisualAgentForPipeline(draft.postId);
  await renderPost(draft.postId);
  // Le studio ne doit jamais bloquer la livraison : un post rendu vaut mieux
  // qu'aucun post — l'humain valide de toute façon.
  const review = await runDesignReview(draft.postId).catch((err) => {
    logger.error({ err: String(err) }, 'studio de design en échec (non bloquant)');
    return { postId: draft.postId, iterations: 0, passed: false, finalScores: {}, unavailable: true };
  });

  let emailed = false;
  try {
    const { sendApprovalEmail } = await import('../mailer/approvalEmail.js');
    await sendApprovalEmail(draft.postId);
    emailed = true;
  } catch (err) {
    logger.error({ err: String(err) }, "échec d'envoi de l'email d'approbation");
  }

  db.update(schema.posts)
    .set({ status: 'awaiting_approval', updatedAt: new Date().toISOString() })
    .where(eq(schema.posts.id, draft.postId))
    .run();

  return {
    postId: draft.postId,
    screenshot: capture.ok ? 'ok' : `échec: ${capture.reason.slice(0, 120)}`,
    images,
    review: { iterations: review.iterations, passed: review.passed, unavailable: review.unavailable },
    visuals,
    emailed,
  };
}
