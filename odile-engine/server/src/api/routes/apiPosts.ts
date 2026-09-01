import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { patchPostSchema, putSlideSchema, regenerateSchema, rejectSchema } from '@odile/shared';
import { executeApprovalAction } from '../../approvals/service.js';
import { db, schema } from '../../db/client.js';
import { runDesignReview } from '../../design-studio/index.js';
import { sendApprovalEmail } from '../../mailer/approvalEmail.js';
import { renderPost } from '../../render/renderer.js';
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
    return { ...postSummary(post), slides, reviews, clicks };
  });

  app.patch<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const parsed = patchPostSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const data = parsed.data;
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
    await regeneratePart({
      postId: id,
      scope: parsed.data.scope,
      slideIdx: parsed.data.slideIdx,
      instructions: parsed.data.instructions,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/render', async (request) => {
    return renderPost(Number(request.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/review', async (request) => {
    return runDesignReview(Number(request.params.id));
  });

  app.post<{ Params: { id: string }; Body: { publishNow?: boolean } }>(
    '/api/posts/:id/approve',
    async (request) => {
      return dashboardAction(Number(request.params.id), 'approve', {
        publishNow: Boolean(request.body?.publishNow),
        ip: request.ip,
      });
    },
  );

  app.post<{ Params: { id: string } }>('/api/posts/:id/reject', async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    return dashboardAction(Number(request.params.id), 'reject', {
      reason: parsed.data.reason,
      ip: request.ip,
    });
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/send-approval-email', async (request) => {
    return sendApprovalEmail(Number(request.params.id));
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
