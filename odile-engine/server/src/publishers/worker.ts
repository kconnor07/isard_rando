import fs from 'node:fs';
import path from 'node:path';
import { and, eq, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getCadence, getFbMirror } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { nommerRessource } from '../webhooks/commentDm.js';
import { captionFacebook, facebookMirrorDryPayload, mirrorToFacebookPage } from './facebook.js';
import { instagramDryPayload, InstagramPublisher } from './instagram.js';
import { linkedInDryPayload, LinkedInPublisher } from './linkedin.js';
import { buildCaption, collectPublishImages, collectPublishVideo, DryRunPublisher, type Publisher } from './types.js';

/**
 * Recopie du post Instagram sur la Page Facebook, quand le miroir est activé.
 *
 * Volontairement hors du chemin critique : le post Instagram est déjà en ligne, un
 * échec ici est consigné sur le post et n'entraîne ni nouvelle tentative de
 * publication, ni statut « échec ».
 */
async function mirrorOnFacebook(
  post: typeof schema.posts.$inferSelect,
  entree: Parameters<Publisher['publish']>[0],
  urlInstagram: string | null,
): Promise<void> {
  if (post.platform !== 'instagram') return;
  // Miroir activé, ou diffusion sur tous les comptes EN COURS — « tous », c'est aussi
  // Facebook. Un groupe hérité d'un réglage désactivé depuis ne suffit pas : une case
  // décochée doit vouloir dire quelque chose.
  if (!getFbMirror().enabled && !(post.broadcastGroup && getCadence().broadcast)) return;
  // Le mot-clé ne marche pas sur une Page : le moteur ne lit que les commentaires
  // Instagram. La légende renvoie donc là où la promesse est tenue.
  const input = {
    ...entree,
    caption: captionFacebook({
      caption: entree.caption,
      motcle: post.commentTriggerKeyword,
      ressource: nommerRessource(post),
      urlInstagram,
    }),
  };
  try {
    if (config.PUBLISH_MODE === 'dry') {
      const payload = facebookMirrorDryPayload(input);
      const file = path.join(config.outboxDir, `mirror-${post.id}-facebook-${Date.now()}.json`);
      fs.mkdirSync(config.outboxDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ publisher: 'facebook-mirror', post: post.id, payload }, null, 2));
      db.update(schema.posts)
        .set({ fbMirrorPostId: `dry-facebook-${post.id}`, fbMirrorUrl: `file://${file}`, fbMirrorError: null })
        .where(eq(schema.posts.id, post.id))
        .run();
      return;
    }
    const mirror = await mirrorToFacebookPage(input);
    db.update(schema.posts)
      .set({ fbMirrorPostId: mirror.postId, fbMirrorUrl: mirror.url, fbMirrorError: null })
      .where(eq(schema.posts.id, post.id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.posts).set({ fbMirrorError: message.slice(0, 500) }).where(eq(schema.posts.id, post.id)).run();
    logger.warn({ postId: post.id, err: message }, 'recopie Facebook impossible — le post Instagram reste publié');
  }
}

function publisherFor(platform: string): Publisher {
  if (config.PUBLISH_MODE === 'dry') {
    return platform === 'instagram'
      ? new DryRunPublisher('instagram', instagramDryPayload)
      : new DryRunPublisher('linkedin', linkedInDryPayload);
  }
  return platform === 'instagram' ? new InstagramPublisher() : new LinkedInPublisher();
}

export interface PublishWorkerSummary {
  processed: number;
  published: number;
  failed: number;
}

/** Traite les publications dont l'échéance est passée (état pending). */
export async function processDuePublishJobs(): Promise<PublishWorkerSummary> {
  const now = new Date().toISOString();
  const due = db
    .select()
    .from(schema.publishJobs)
    .where(and(eq(schema.publishJobs.state, 'pending'), lte(schema.publishJobs.scheduledAt, now)))
    .limit(5)
    .all();

  const summary: PublishWorkerSummary = { processed: 0, published: 0, failed: 0 };
  for (const job of due) {
    summary.processed++;
    // Verrouillage optimiste : ne prendre le job que s'il est toujours pending
    const claimed = db
      .update(schema.publishJobs)
      .set({ state: 'running', startedAt: new Date().toISOString(), attempt: job.attempt + 1 })
      .where(and(eq(schema.publishJobs.id, job.id), eq(schema.publishJobs.state, 'pending')))
      .run();
    if (claimed.changes === 0) continue;

    const post = db.select().from(schema.posts).where(eq(schema.posts.id, job.postId)).get();
    if (!post || !['scheduled', 'approved', 'failed'].includes(post.status)) {
      db.update(schema.publishJobs)
        .set({ state: 'canceled', finishedAt: new Date().toISOString(), lastError: 'Post absent ou statut incompatible' })
        .where(eq(schema.publishJobs.id, job.id))
        .run();
      continue;
    }

    db.update(schema.posts).set({ status: 'publishing' }).where(eq(schema.posts.id, post.id)).run();
    try {
      const video = collectPublishVideo(post);
      // Un post vidéo n'a qu'une slide : elle sert de couverture, pas de contenu.
      const images = collectPublishImages(post.id);
      const publisher = publisherFor(post.platform);
      const result = await publisher.publish({ post, images, caption: buildCaption(post), video });
      const finished = new Date().toISOString();
      db.update(schema.publishJobs)
        .set({ state: 'done', finishedAt: finished, result: JSON.stringify(result) })
        .where(eq(schema.publishJobs.id, job.id))
        .run();
      db.update(schema.posts)
        .set({
          status: 'published',
          publishedAt: finished,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
          error: null,
          updatedAt: finished,
        })
        .where(eq(schema.posts.id, post.id))
        .run();
      summary.published++;
      logger.info({ postId: post.id, publisher: publisher.name }, 'publication réussie');
      await mirrorOnFacebook(post, { post, images, caption: buildCaption(post), video }, result.externalUrl ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = job.attempt + 1 < job.maxAttempts;
      const prochainEssai = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.update(schema.publishJobs)
        .set(
          retryable
            ? { state: 'pending', lastError: message.slice(0, 800), scheduledAt: prochainEssai }
            : { state: 'failed', finishedAt: new Date().toISOString(), lastError: message.slice(0, 800) },
        )
        .where(eq(schema.publishJobs.id, job.id))
        .run();
      // Le post porte la même date que son job : sans cela, le calendrier continuait
      // d'annoncer l'heure ratée et le créneau restait marqué pris au mauvais endroit.
      db.update(schema.posts)
        .set({
          status: retryable ? 'scheduled' : 'failed',
          error: message.slice(0, 800),
          ...(retryable ? { scheduledAt: prochainEssai } : {}),
        })
        .where(eq(schema.posts.id, post.id))
        .run();
      summary.failed++;
      logger.error({ postId: post.id, err: message, retryable }, 'échec de publication');
      if (!retryable) {
        await sendMail({
          kind: 'error',
          to: getApprovalEmail().to,
          postId: post.id,
          subject: `[Odile] ❌ Échec de publication du post « ${post.hook.slice(0, 50)} »`,
          html: `<p>La publication a échoué après ${job.maxAttempts} tentatives.</p><pre>${message.slice(0, 800)}</pre><p>Corrige depuis le dashboard puis relance.</p>`,
          text: `Échec de publication après ${job.maxAttempts} tentatives : ${message.slice(0, 400)}`,
        });
      }
    }
  }
  return summary;
}
