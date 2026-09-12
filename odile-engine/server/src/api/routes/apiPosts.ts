import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import {
  generateImageSchema,
  patchPostSchema,
  putSlideSchema,
  regenerateSchema,
  rejectSchema,
  schedulePostSchema,
} from '@odile/shared';
import { executeApprovalAction, schedulePost, unschedulePost } from '../../approvals/service.js';
import { getPublishSlots } from '../../db/settingsRepo.js';
import { slotOccurrencesBetween } from '../../lib/time.js';
import { db, schema } from '../../db/client.js';
import { runDesignReview } from '../../design-studio/index.js';
import { sendApprovalEmail } from '../../mailer/approvalEmail.js';
import { themeExists } from '../../render/custom-theme.js';
import { assetIsCutout, parseVisualOverrides, renderPost } from '../../render/renderer.js';
import { regeneratePart } from '../../writer/regenerate.js';

const nanoJti = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

function postSummary(post: typeof schema.posts.$inferSelect) {
  const news = post.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, post.newsItemId)).get()
    : null;
  const slideCount = db
    .select({ id: schema.slides.id })
    .from(schema.slides)
    .where(eq(schema.slides.postId, post.id))
    .all().length;
  return {
    id: post.id,
    platform: post.platform,
    channel: post.channel,
    format: post.format,
    theme: post.theme,
    status: post.status,
    hook: post.hook,
    caption: post.caption,
    cta: post.cta,
    hashtags: JSON.parse(post.hashtags) as string[],
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    externalUrl: post.externalUrl,
    createdAt: post.createdAt,
    commentTriggerKeyword: post.commentTriggerKeyword,
    reviewSummary: post.reviewSummary ? JSON.parse(post.reviewSummary) : null,
    newsTitle: news?.title ?? null,
    newsUrl: news?.url ?? null,
    slideCount,
  };
}

/** Insère une ligne d'approbation « dashboard » puis exécute l'action. */
function dashboardAction(postId: number, act: 'approve' | 'reject', ctx: { publishNow?: boolean; reason?: string; ip?: string }) {
  const jti = `dash-${nanoJti()}`;
  db.insert(schema.approvals)
    .values({
      postId,
      jti,
      kind: 'approval',
      sentTo: 'dashboard',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    .run();
  return executeApprovalAction(
    { v: 1, jti, pid: postId, act, exp: Math.floor(Date.now() / 1000) + 60 },
    ctx,
  );
}

export function registerPostRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { status?: string } }>('/api/posts', async (request) => {
    const statuses = request.query.status?.split(',');
    const rows = statuses?.length
      ? db
          .select()
          .from(schema.posts)
          .where(inArray(schema.posts.status, statuses as never))
          .orderBy(desc(schema.posts.createdAt))
          .limit(100)
          .all()
      : db.select().from(schema.posts).orderBy(desc(schema.posts.createdAt)).limit(100).all();
    return rows.map(postSummary);
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, Number(request.params.id))).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    const slides = db
      .select()
      .from(schema.slides)
      .where(eq(schema.slides.postId, post.id))
      .orderBy(schema.slides.idx)
      .all()
      .map((s) => ({
        id: s.id,
        idx: s.idx,
        kind: s.kind,
        content: JSON.parse(s.content),
        renderAssetId: s.renderAssetId,
        screenshotAssetId: s.screenshotAssetId,
        heroAssetId: s.heroAssetId,
        heroCutout: assetIsCutout(s.heroAssetId),
      }));
    const reviews = db
      .select()
      .from(schema.designReviews)
      .where(eq(schema.designReviews.postId, post.id))
      .orderBy(schema.designReviews.iteration, schema.designReviews.reviewer)
      .all()
      .map((r) => ({
        id: r.id,
        iteration: r.iteration,
        reviewer: r.reviewer,
        score: r.score,
        verdict: r.verdict,
        issues: JSON.parse(r.issues),
        passed: r.passed,
        modelUsed: r.modelUsed,
        createdAt: r.createdAt,
      }));
    const clicks = post.linkId
      ? db.select({ id: schema.clicks.id }).from(schema.clicks).where(eq(schema.clicks.linkId, post.linkId)).all().length
      : 0;
    return { ...postSummary(post), slides, reviews, clicks, visualOverrides: parseVisualOverrides(post.visualOverrides) };
  });

  app.patch<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const parsed = patchPostSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const data = parsed.data;
    if (data.theme && !themeExists(data.theme)) {
      return reply.status(400).send({ error: 'Thème introuvable' });
    }
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (data.caption !== undefined) update.caption = data.caption;
    if (data.hook !== undefined) update.hook = data.hook;
    if (data.cta !== undefined) update.cta = data.cta;
    if (data.hashtags !== undefined) update.hashtags = JSON.stringify(data.hashtags);
    if (data.channel !== undefined) {
      update.channel = data.channel;
      update.platform = data.channel === 'ig' ? 'instagram' : 'linkedin';
    }
    if (data.format !== undefined) update.format = data.format;
    if (data.theme !== undefined) update.theme = data.theme;
    if (data.scheduledAt !== undefined) update.scheduledAt = data.scheduledAt;
    db.update(schema.posts).set(update).where(eq(schema.posts.id, id)).run();
    if (data.theme !== undefined || data.format !== undefined) {
      db.update(schema.slides).set({ renderAssetId: null }).where(eq(schema.slides.postId, id)).run();
    }
    return { ok: true };
  });

  app.put<{ Params: { id: string; idx: string } }>('/api/posts/:id/slides/:idx', async (request, reply) => {
    const parsed = putSlideSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const slide = db
      .select()
      .from(schema.slides)
      .where(
        and(
          eq(schema.slides.postId, Number(request.params.id)),
          eq(schema.slides.idx, Number(request.params.idx)),
        ),
      )
      .get();
    if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
    db.update(schema.slides)
      .set({
        content: JSON.stringify(parsed.data.content),
        kind: parsed.data.content.kind,
        renderAssetId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.slides.id, slide.id))
      .run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/regenerate', async (request, reply) => {
    const parsed = regenerateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const id = Number(request.params.id);
    if (parsed.data.scope === 'all') {
      return reply.status(400).send({ error: 'Régénération complète : rejette le post et relance depuis l’actu.' });
    }
    try {
      await regeneratePart({
        postId: id,
        scope: parsed.data.scope,
        slideIdx: parsed.data.slideIdx,
        instructions: parsed.data.instructions,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: `Régénération impossible : ${message.slice(0, 200)}` });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Querystring: { slide?: string } }>('/api/posts/:id/render', async (request) => {
    const slide = request.query.slide !== undefined ? Number(request.query.slide) : undefined;
    return renderPost(Number(request.params.id), Number.isInteger(slide) ? { onlyIdx: slide } : {});
  });

  // Génération / régénération de l'illustration IA d'une slide
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/generate-image',
    async (request, reply) => {
      const parsed = generateImageSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      // Nouvelle génération demandée explicitement : on repart de zéro
      db.update(schema.slides).set({ heroAssetId: null }).where(eq(schema.slides.id, slide.id)).run();
      const { generateHeroImage } = await import('../../imagegen/index.js');
      const result = await generateHeroImage(slide.id, parsed.data);
      if (!result.ok) return reply.status(422).send({ error: result.reason });
      return result;
    },
  );

  // Retirer l'illustration d'une slide
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/remove-image',
    async (request, reply) => {
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      db.update(schema.slides)
        .set({ heroAssetId: null, renderAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, slide.id))
        .run();
      return { ok: true };
    },
  );

  // Illustration maison : l'utilisateur téléverse sa propre image pour une slide
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/upload-image',
    async (request, reply) => {
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'Aucun fichier reçu' });
      if (!/^image\/(png|jpe?g|webp|avif)$/.test(file.mimetype)) {
        return reply.status(415).send({ error: `Format non pris en charge : ${file.mimetype}` });
      }
      const raw = await file.toBuffer();
      const sharp = (await import('sharp')).default;
      // Même normalisation que les illustrations générées : 1080×1350 JPEG
      const normalized = await sharp(raw)
        .resize(1080, 1350, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 90 })
        .toBuffer();
      const { saveAsset } = await import('../../render/renderer.js');
      const assetId = saveAsset(
        normalized,
        'genimage',
        {
          postId: slide.postId,
          slideId: slide.id,
          extraMeta: { source: 'upload', filename: file.filename },
        },
        { width: 1080, height: 1350 },
        { ext: 'jpg', mime: 'image/jpeg' },
      );
      db.update(schema.slides)
        .set({ heroAssetId: assetId, renderAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, slide.id))
        .run();
      return { ok: true, assetId };
    },
  );

  app.post<{ Params: { id: string } }>('/api/posts/:id/review', async (request) => {
    return runDesignReview(Number(request.params.id));
  });

  app.post<{ Params: { id: string }; Body: { publishNow?: boolean } }>(
    '/api/posts/:id/approve',
    async (request, reply) => {
      const outcome = await dashboardAction(Number(request.params.id), 'approve', {
        publishNow: Boolean(request.body?.publishNow),
        ip: request.ip,
      });
      if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
      return outcome;
    },
  );

  /** Programme (ou déplace) un post à une date précise, choisie dans le calendrier ou l'éditeur. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/schedule', async (request, reply) => {
    const parsed = schedulePostSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Date invalide : format ISO 8601 attendu (ex. 2026-09-18T16:30:00Z)' });
    const outcome = schedulePost(Number(request.params.id), parsed.data.at);
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  /** Post programmé : retour à « à valider » (job de publication annulé). */
  app.post<{ Params: { id: string } }>('/api/posts/:id/unschedule', async (request, reply) => {
    const outcome = unschedulePost(Number(request.params.id));
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/reject', async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const outcome = await dashboardAction(Number(request.params.id), 'reject', {
      reason: parsed.data.reason,
      ip: request.ip,
    });
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/send-approval-email', async (request, reply) => {
    const result = await sendApprovalEmail(Number(request.params.id));
    if (!result.ok) return reply.status(409).send({ error: "L'email n'a pas pu être envoyé (SMTP) — vérifiez Réglages → Email" });
    return result;
  });

  /**
   * Créneaux de publication configurés sur une période (heure de Paris), avec le post qui
   * occupe chacun d'eux : la grille du calendrier propose les créneaux libres à un clic.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/schedule/slots', async (request) => {
    const now = Date.now();
    const fromRaw = request.query.from ? new Date(request.query.from) : new Date(now);
    const from = Number.isNaN(fromRaw.getTime()) ? new Date(now) : fromRaw;
    const toRaw = request.query.to ? new Date(request.query.to) : new Date(from.getTime() + 28 * 86400000);
    const to = Number.isNaN(toRaw.getTime()) ? new Date(from.getTime() + 28 * 86400000) : toRaw;
    if (to.getTime() - from.getTime() > 70 * 86400000) to.setTime(from.getTime() + 70 * 86400000);
    const slots = getPublishSlots();
    const occupied = db
      .select({ id: schema.posts.id, hook: schema.posts.hook, platform: schema.posts.platform, scheduledAt: schema.posts.scheduledAt, status: schema.posts.status })
      .from(schema.posts)
      .where(
        and(
          inArray(schema.posts.status, ['scheduled', 'publishing', 'published']),
          gte(schema.posts.scheduledAt, new Date(from.getTime() - 30 * 60000).toISOString()),
          lte(schema.posts.scheduledAt, new Date(to.getTime() + 30 * 60000).toISOString()),
        ),
      )
      .all();
    const out: { at: string; platform: 'instagram' | 'linkedin'; past: boolean; postId: number | null; postHook: string | null }[] = [];
    for (const platform of ['instagram', 'linkedin'] as const) {
      for (const slot of platform === 'instagram' ? slots.ig : slots.li) {
        for (const at of slotOccurrencesBetween(slot, from, to)) {
          const taken = occupied.find(
            (p) => p.platform === platform && p.scheduledAt && Math.abs(new Date(p.scheduledAt).getTime() - at.getTime()) < 30 * 60000,
          );
          out.push({
            at: at.toISOString(),
            platform,
            // délai minimal de 2 h avant publication (rendu, vérification)
            past: at.getTime() < now + 2 * 3600000,
            postId: taken?.id ?? null,
            postHook: taken?.hook ?? null,
          });
        }
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/calendar', async (request) => {
    const from = request.query.from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const to = request.query.to ?? new Date(Date.now() + 30 * 86400000).toISOString();
    const rows = db
      .select()
      .from(schema.posts)
      .where(
        and(
          inArray(schema.posts.status, ['scheduled', 'publishing', 'published']),
          gte(schema.posts.scheduledAt, from),
          lte(schema.posts.scheduledAt, to),
        ),
      )
      .orderBy(schema.posts.scheduledAt)
      .all();
    return rows.map(postSummary);
  });
}
