/**
 * Reprise des posts dont la vidéo est arrivée après la fabrication.
 *
 * Quand HeyGen dépasse le temps d'attente du pipeline, le post reste en chantier
 * sans email : personne ne valide un post dont le visuel principal manque. Dès que
 * le MP4 est rapatrié, ce module fait ce que le pipeline aurait fait — statut
 * « à valider » et email — et prévient honnêtement quand la vidéo a échoué.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getApprovalEmail } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';

export interface RepriseVideo {
  valides: number;
  abandonnes: number;
}

/** Les posts vidéo en chantier dont la vidéo vient d'aboutir (ou d'échouer). */
export async function finirPostsVideo(): Promise<RepriseVideo> {
  const resume: RepriseVideo = { valides: 0, abandonnes: 0 };
  const enChantier = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.format, 'reel'), inArray(schema.posts.status, ['draft', 'reviewing'])))
    .all();

  for (const post of enChantier) {
    if (post.videoStatus === 'pending') continue;
    const now = new Date().toISOString();
    if (post.videoStatus === 'ready') {
      db.update(schema.posts)
        .set({ status: 'awaiting_approval', pipelineStep: null, updatedAt: now })
        .where(eq(schema.posts.id, post.id))
        .run();
      try {
        const { sendApprovalEmail } = await import('../mailer/approvalEmail.js');
        await sendApprovalEmail(post.id);
      } catch (err) {
        logger.error({ postId: post.id, err: String(err).slice(0, 200) }, 'email de validation de la vidéo non envoyé');
      }
      resume.valides++;
      logger.info({ postId: post.id }, 'vidéo arrivée — post proposé à la validation');
      continue;
    }
    if (post.videoStatus === 'failed') {
      db.update(schema.posts)
        .set({
          status: 'failed',
          error: `Vidéo impossible : ${post.videoError ?? 'motif non enregistré'}`.slice(0, 700),
          pipelineStep: null,
          updatedAt: now,
        })
        .where(eq(schema.posts.id, post.id))
        .run();
      await sendMail({
        kind: 'error',
        to: getApprovalEmail().to,
        postId: post.id,
        subject: `[Odile] 🎬 Vidéo impossible · ${post.hook.slice(0, 50)}`,
        html: `<p>La vidéo de l'avatar n'a pas pu être fabriquée pour « ${post.hook} ».</p><p><b>Motif :</b> ${post.videoError ?? 'non enregistré'}</p><p>Le texte et la couverture sont prêts : relance la vidéo depuis l'éditeur, ou publie le post en visuel simple.</p>`,
        text: `Vidéo impossible pour « ${post.hook} » : ${post.videoError ?? 'motif non enregistré'}`,
      }).catch(() => undefined);
      resume.abandonnes++;
      logger.warn({ postId: post.id, motif: post.videoError }, 'post vidéo abandonné');
    }
  }
  return resume;
}
