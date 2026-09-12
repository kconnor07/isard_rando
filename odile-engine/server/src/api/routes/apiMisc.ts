import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { latestMetricsByPost } from '../../publishers/metrics.js';
import { connectionWarnings } from '../../publishers/refresh.js';
import { nextPublishSlot, shouldDraftToday } from '../../scheduler/cadence.js';
import { checkPassword, hasValidSession, issueSession, SESSION_COOKIE } from '../auth.js';

export function registerMiscRoutes(app: FastifyInstance): void {
  // ----- Auth ---------------------------------------------------------------
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success || !checkPassword(parsed.data.password)) {
      return reply.status(401).send({ error: 'Mot de passe incorrect' });
    }
    issueSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({ authenticated: hasValidSession(request) }));

  // ----- Résumé du dashboard ------------------------------------------------
  app.get('/api/dashboard/summary', async () => {
    const count = (statuses: string[]) =>
      db
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(inArray(schema.posts.status, statuses as never))
        .all().length;
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const clicks7d = db
      .select({ id: schema.clicks.id })
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since7d), eq(schema.clicks.bot, false)))
      .all().length;
    // Portée et interactions des posts publiés sur 7 jours (dernier relevé de chaque post)
    const published7d = db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since7d)))
      .all();
    let reach7d = 0;
    let engagement7d = 0;
    for (const m of latestMetricsByPost(published7d.map((p) => p.id)).values()) {
      reach7d += m.reach ?? 0;
      engagement7d += m.engagement ?? 0;
    }
    const pendingComments = db
      .select({ id: schema.comments.id })
      .from(schema.comments)
      .where(inArray(schema.comments.dmStatus, ['manual_suggested', 'pending']))
      .all().length;
    const cadence = shouldDraftToday();
    return {
      awaitingApproval: count(['awaiting_approval', 'reviewing', 'draft']),
      scheduled: count(['scheduled', 'publishing']),
      published: count(['published']),
      clicks7d,
      reach7d,
      engagement7d,
      pendingComments,
      cadence,
      warnings: connectionWarnings(),
      nextSlots: {
        instagram: nextPublishSlot('instagram').toISOString(),
        linkedin: nextPublishSlot('linkedin').toISOString(),
      },
    };
  });

  // ----- Commentaires / DM --------------------------------------------------
  app.get<{ Querystring: { platform?: string; dmStatus?: string } }>('/api/comments', async (request) => {
    const conditions = [];
    if (request.query.platform) conditions.push(eq(schema.comments.platform, request.query.platform as never));
    if (request.query.dmStatus)
      conditions.push(inArray(schema.comments.dmStatus, request.query.dmStatus.split(',') as never));
    const rows = (
      conditions.length
        ? db.select().from(schema.comments).where(and(...conditions))
        : db.select().from(schema.comments)
    )
      .orderBy(desc(schema.comments.id))
      .limit(100)
      .all();
    return rows.map((c) => ({
      id: c.id,
      platform: c.platform,
      authorName: c.authorName,
      text: c.text,
      matchedKeyword: c.matchedKeyword,
      dmStatus: c.dmStatus,
      suggestedReply: c.suggestedReply,
      externalPostUrl: c.externalPostUrl,
      createdTime: c.createdTime ?? c.fetchedAt,
    }));
  });

  app.post<{ Params: { id: string } }>('/api/comments/:id/mark-handled', async (request) => {
    db.update(schema.comments)
      .set({ dmStatus: 'handled' })
      .where(eq(schema.comments.id, Number(request.params.id)))
      .run();
    return { ok: true };
  });
}
