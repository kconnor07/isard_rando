import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { runDesignReview } from '../design-studio/index.js';
import { renderPost } from '../render/renderer.js';
import { captureForPost } from '../screenshot/capture.js';
import { draftPost, type DraftOptions } from '../writer/generate.js';

export interface PipelineSummary {
  postId: number;
  screenshot: string;
  review: { iterations: number; passed: boolean };
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

  const capture = await captureForPost(draft.postId, draft.screenshotUrl);
  await renderPost(draft.postId);
  const review = await runDesignReview(draft.postId);

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
    review: { iterations: review.iterations, passed: review.passed },
    emailed,
  };
}
