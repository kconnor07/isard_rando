import fs from 'node:fs';
import { eq, isNull, and } from 'drizzle-orm';
import sharp from 'sharp';
import { reviewResultSchema, type ReviewIssue, type ReviewerId } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { getDesignStudio } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { renderPost } from '../render/renderer.js';
import { applyFixes } from './apply-fixes.js';
import { artDirector } from './reviewers/art-director.js';
import { colorimetry } from './reviewers/colorimetry.js';
import { copyReviewer } from './reviewers/copy.js';
import { engagement } from './reviewers/engagement.js';
import type { ReviewerDef } from './reviewers/types.js';

const REVIEWER_DEFS: ReviewerDef[] = [artDirector, colorimetry, copyReviewer, engagement];

export interface DesignReviewSummary {
  postId: number;
  iterations: number;
  passed: boolean;
  finalScores: Record<ReviewerId, number>;
}

/**
 * Boucle du studio de design : rendu → 4 reviewers en parallèle → correctifs →
 * re-rendu, jusqu'à ce que tous les scores passent le seuil ou que le nombre
 * max d'itérations soit atteint. Toutes les critiques sont conservées en base.
 */
export async function runDesignReview(postId: number): Promise<DesignReviewSummary> {
  const settings = getDesignStudio();
  let finalScores = {} as Record<ReviewerId, number>;
  let passed = false;
  let iteration = 0;

  if (!settings.enabled) {
    return { postId, iterations: 0, passed: true, finalScores };
  }

  for (iteration = 1; iteration <= settings.maxIterations; iteration++) {
    await ensureRendered(postId);
    const images = await collectSlideImages(postId);
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    const slides = db
      .select()
      .from(schema.slides)
      .where(eq(schema.slides.postId, postId))
      .orderBy(schema.slides.idx)
      .all();
    const slidesJson = slides.map((s) => JSON.parse(s.content) as unknown);
    const isFinalPass = iteration === settings.maxIterations;

    const results = await Promise.all(
      REVIEWER_DEFS.map(async (reviewer) => {
        const prompt = `Itération : ${iteration}/${settings.maxIterations}

Post ${post.platform} (${post.format}, thème ${post.theme}) — les images jointes sont les slides rendues, dans l'ordre.

SPEC JSON des slides :
${JSON.stringify(slidesJson, null, 2)}

CAPTION :
${post.caption}

${reviewer.focus}

Notation : score 0-100 (${settings.passThreshold} = publiable sur ce critère). verdict : une phrase.
issues : liste de correctifs actionnables (severity minor|major|blocking, slideIdx 0-based ou null si global,
target = champ visé, problem, fix). Aucun issue si le score passe.`;
        const { value, model } = await completeJson(
          {
            task: 'review',
            tier: isFinalPass ? 'best' : 'fast',
            system: reviewer.system,
            prompt,
            images,
            maxTokens: 4000,
          },
          reviewResultSchema,
        );
        db.insert(schema.designReviews)
          .values({
            postId,
            iteration,
            reviewer: reviewer.id,
            score: Math.round(value.score),
            verdict: value.verdict,
            issues: JSON.stringify(value.issues),
            passed: value.score >= settings.passThreshold,
            modelUsed: model,
          })
          .run();
        return { reviewer: reviewer.id, ...value };
      }),
    );

    finalScores = Object.fromEntries(
      results.map((r) => [r.reviewer, Math.round(r.score)]),
    ) as Record<ReviewerId, number>;
    passed = results.every((r) => r.score >= settings.passThreshold);
    logger.info({ postId, iteration, finalScores, passed }, 'passe du studio de design');
    if (passed) break;
    if (iteration === settings.maxIterations) break;

    // Correctifs : les "blocking" et "major" d'abord, minor si peu nombreux.
    const issues: ReviewIssue[] = results
      .flatMap((r) => r.issues)
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 8);

    // Critiques d'illustration → régénération de l'image (1 max par itération),
    // traitées à part pour ne pas polluer la réécriture de texte.
    const imageIssue = issues.find((i) => i.target === 'image');
    if (imageIssue) {
      await regenerateHeroFromIssue(postId, imageIssue);
    }

    await applyFixes(postId, issues);
  }

  db.update(schema.posts)
    .set({
      reviewSummary: JSON.stringify({ iterations: iteration, finalScores, passed }),
      status: 'reviewing',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.posts.id, postId))
    .run();

  return { postId, iterations: Math.min(iteration, getDesignStudio().maxIterations), passed, finalScores };
}

function severityRank(s: ReviewIssue['severity']): number {
  return s === 'blocking' ? 2 : s === 'major' ? 1 : 0;
}

/** Applique une critique d'illustration : nouveau concept + régénération du hero. */
async function regenerateHeroFromIssue(postId: number, issue: ReviewIssue): Promise<void> {
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  const target =
    (issue.slideIdx !== null ? slides.find((s) => s.idx === issue.slideIdx) : undefined) ??
    slides.find((s) => s.heroAssetId);
  if (!target) return;
  try {
    const content = JSON.parse(target.content) as Record<string, unknown>;
    if (typeof issue.fix === 'string' && issue.fix.length > 10) {
      content.imageIdea = issue.fix.slice(0, 300);
      db.update(schema.slides)
        .set({ content: JSON.stringify(content), heroAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, target.id))
        .run();
    } else {
      db.update(schema.slides)
        .set({ heroAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, target.id))
        .run();
    }
    const { generateHeroImage } = await import('../imagegen/index.js');
    await generateHeroImage(target.id, { instructions: issue.problem });
    logger.info({ postId, slideId: target.id }, 'illustration régénérée sur critique du studio');
  } catch (err) {
    logger.warn({ postId, err: String(err) }, "échec de régénération d'illustration (non bloquant)");
  }
}

async function ensureRendered(postId: number): Promise<void> {
  const missing = db
    .select({ id: schema.slides.id })
    .from(schema.slides)
    .where(and(eq(schema.slides.postId, postId), isNull(schema.slides.renderAssetId)))
    .all();
  if (missing.length > 0) await renderPost(postId);
}

/** Slides rendues, réduites en JPEG ~540 px pour limiter le coût vision. */
async function collectSlideImages(
  postId: number,
): Promise<{ data: Buffer; mime: 'image/jpeg' }[]> {
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  const images: { data: Buffer; mime: 'image/jpeg' }[] = [];
  for (const slide of slides) {
    if (!slide.renderAssetId) continue;
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, slide.renderAssetId)).get();
    if (!asset || !fs.existsSync(asset.path)) continue;
    const jpeg = await sharp(asset.path).resize({ width: 540 }).jpeg({ quality: 72 }).toBuffer();
    images.push({ data: jpeg, mime: 'image/jpeg' });
  }
  return images;
}
