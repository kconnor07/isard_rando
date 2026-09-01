import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getTopicAffinity } from '../../db/settingsRepo.js';
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
      .where(gte(schema.clicks.ts, since7d))
      .all().length;
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
      pendingComments,
      cadence,
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

  // ----- Analytics ----------------------------------------------------------
  app.get<{ Querystring: { days?: string } }>('/api/analytics/clicks', async (request) => {
    const days = Number(request.query.days ?? 30);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const clicks = db
      .select()
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since))
      .all();
    const links = new Map(db.select().from(schema.links).all().map((l) => [l.id, l]));
    const perDay = new Map<string, number>();
    const perLink = new Map<number, number>();
    for (const c of clicks) {
      const day = c.ts.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      perLink.set(c.linkId, (perLink.get(c.linkId) ?? 0) + 1);
    }
    return {
      total: clicks.length,
      perDay: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })),
      perLink: [...perLink.entries()].map(([linkId, count]) => ({
        linkId,
        postId: links.get(linkId)?.postId ?? null,
        label: links.get(linkId)?.label ?? '',
        target: links.get(linkId)?.targetUrl ?? '',
        count,
      })),
    };
  });

  // Ce que la boucle d'apprentissage a retenu (poids sources + affinités sujets)
  app.get('/api/analytics/learning', async () => {
    const sources = db
      .select({
        name: schema.newsSources.name,
        weight: schema.newsSources.weight,
        enabled: schema.newsSources.enabled,
      })
      .from(schema.newsSources)
      .orderBy(desc(schema.newsSources.weight))
      .all();
    const affinity = getTopicAffinity();
    const topics = Object.entries(affinity)
      .map(([topic, factor]) => ({ topic, factor }))
      .sort((a, b) => b.factor - a.factor);
    const lastLearn = db
      .select()
      .from(schema.jobRuns)
      .where(and(eq(schema.jobRuns.jobName, 'learn'), like(schema.jobRuns.summary, '%postsAnalyzed%')))
      .orderBy(desc(schema.jobRuns.id))
      .limit(1)
      .get();
    return {
      sources,
      topics,
      lastLearnAt: lastLearn?.finishedAt ?? null,
      lastLearn: lastLearn?.summary ? JSON.parse(lastLearn.summary) : null,
    };
  });

  app.get('/api/analytics/posts', async () => {
    const posts = db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, 'published'))
      .orderBy(desc(schema.posts.publishedAt))
      .limit(50)
      .all();
    return posts.map((p) => {
      const clicks = p.linkId
        ? db.select({ id: schema.clicks.id }).from(schema.clicks).where(eq(schema.clicks.linkId, p.linkId)).all().length
        : 0;
      const comments = db
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .where(eq(schema.comments.postId, p.id))
        .all().length;
      return {
        id: p.id,
        hook: p.hook,
        channel: p.channel,
        publishedAt: p.publishedAt,
        externalUrl: p.externalUrl,
        clicks,
        comments,
      };
    });
  });
}
