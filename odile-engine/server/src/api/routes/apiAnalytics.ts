import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../../db/client.js';
import { getTopicAffinity } from '../../db/settingsRepo.js';
import { runJob } from '../../lib/jobRunner.js';
import { parisParts } from '../../lib/time.js';
import { latestMetricsByPost, performanceScore, runMetricsJob } from '../../publishers/metrics.js';
import { connectionWarnings } from '../../publishers/refresh.js';
import { getStoredToken } from '../../publishers/tokens.js';

/** Clics humains par lien (les aperçus de liens et crawlers sont exclus). */
export function clicksByLink(linkIds: number[], since?: string): Map<number, number> {
  const out = new Map<number, number>();
  if (linkIds.length === 0) return out;
  const conditions = [inArray(schema.clicks.linkId, linkIds), eq(schema.clicks.bot, false)];
  if (since) conditions.push(gte(schema.clicks.ts, since));
  for (const row of db.select({ linkId: schema.clicks.linkId }).from(schema.clicks).where(and(...conditions)).all()) {
    out.set(row.linkId, (out.get(row.linkId) ?? 0) + 1);
  }
  return out;
}

function commentsByPost(postIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (postIds.length === 0) return out;
  for (const row of db.select({ postId: schema.comments.postId }).from(schema.comments).where(inArray(schema.comments.postId, postIds)).all()) {
    if (row.postId !== null) out.set(row.postId, (out.get(row.postId) ?? 0) + 1);
  }
  return out;
}

const DOW_LABELS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { days?: string } }>('/api/analytics/clicks', async (request) => {
    const days = Math.min(365, Math.max(1, Number(request.query.days ?? 30) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const clicks = db
      .select()
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since), eq(schema.clicks.bot, false)))
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
      .select({ name: schema.newsSources.name, weight: schema.newsSources.weight, enabled: schema.newsSources.enabled })
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

  /** Posts publiés avec leur dernier relevé de statistiques et leurs clics humains. */
  app.get<{ Querystring: { limit?: string } }>('/api/analytics/posts', async (request) => {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50) || 50));
    const posts = db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, 'published'))
      .orderBy(desc(schema.posts.publishedAt))
      .limit(limit)
      .all();
    const metrics = latestMetricsByPost(posts.map((p) => p.id));
    const clicks = clicksByLink(posts.map((p) => p.linkId).filter((id): id is number => id !== null));
    const comments = commentsByPost(posts.map((p) => p.id));
    return posts.map((p) => {
      const m = metrics.get(p.id);
      const postClicks = p.linkId ? (clicks.get(p.linkId) ?? 0) : 0;
      return {
        id: p.id,
        hook: p.hook,
        channel: p.channel,
        format: p.format,
        publishedAt: p.publishedAt,
        externalUrl: p.externalUrl,
        simulated: Boolean(p.externalPostId?.startsWith('dry-')),
        clicks: postClicks,
        comments: comments.get(p.id) ?? 0,
        score: Math.round(performanceScore(postClicks, m) * 10) / 10,
        metrics: m
          ? {
              fetchedAt: m.fetchedAt,
              reach: m.reach,
              impressions: m.impressions,
              likes: m.likes,
              comments: m.comments,
              shares: m.shares,
              saves: m.saves,
              engagement: m.engagement,
              partial: m.partial,
            }
          : null,
      };
    });
  });

  /** Vue d'ensemble : par canal, par jour, meilleurs créneaux, alertes de connexion. */
  app.get<{ Querystring: { days?: string } }>('/api/analytics/overview', async (request) => {
    const days = Math.min(365, Math.max(7, Number(request.query.days ?? 30) || 30));
    const now = Date.now();
    const since = new Date(now - days * 86400000).toISOString();
    const posts = db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since)))
      .all();
    const metrics = latestMetricsByPost(posts.map((p) => p.id));
    const clicks = clicksByLink(posts.map((p) => p.linkId).filter((id): id is number => id !== null));

    // --- Par canal ---
    const channels = ['ig', 'li_personal', 'li_org'].map((channel) => {
      const list = posts.filter((p) => p.channel === channel);
      const agg = { channel, posts: list.length, withMetrics: 0, reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagement: 0, clicks: 0 };
      for (const p of list) {
        const m = metrics.get(p.id);
        if (m) {
          agg.withMetrics++;
          agg.reach += m.reach ?? 0;
          agg.impressions += m.impressions ?? 0;
          agg.likes += m.likes ?? 0;
          agg.comments += m.comments ?? 0;
          agg.shares += m.shares ?? 0;
          agg.saves += m.saves ?? 0;
          agg.engagement += m.engagement ?? 0;
        }
        agg.clicks += p.linkId ? (clicks.get(p.linkId) ?? 0) : 0;
      }
      return agg;
    });

    // --- Par jour (portée attribuée au jour de publication ; clics au jour du clic) ---
    const perDay = new Map<string, { day: string; reach: number; clicks: number; posts: number }>();
    for (let t = now - (days - 1) * 86400000; t <= now; t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      perDay.set(day, { day, reach: 0, clicks: 0, posts: 0 });
    }
    for (const p of posts) {
      const day = (p.publishedAt ?? p.createdAt).slice(0, 10);
      const entry = perDay.get(day);
      if (!entry) continue;
      entry.posts++;
      entry.reach += metrics.get(p.id)?.reach ?? 0;
    }
    for (const c of db
      .select({ ts: schema.clicks.ts })
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since), eq(schema.clicks.bot, false)))
      .all()) {
      const entry = perDay.get(c.ts.slice(0, 10));
      if (entry) entry.clicks++;
    }

    // --- Meilleurs créneaux (tous les posts publiés, jusqu'à 200) ---
    const allPublished = db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, 'published'))
      .orderBy(desc(schema.posts.publishedAt))
      .limit(200)
      .all();
    const allMetrics = latestMetricsByPost(allPublished.map((p) => p.id));
    const allClicks = clicksByLink(allPublished.map((p) => p.linkId).filter((id): id is number => id !== null));
    const slots = new Map<string, { dow: number; hour: number; posts: number; total: number }>();
    for (const p of allPublished) {
      if (!p.publishedAt) continue;
      const parts = parisParts(new Date(p.publishedAt));
      const key = `${parts.dow}-${parts.hh}`;
      const entry = slots.get(key) ?? { dow: parts.dow, hour: parts.hh, posts: 0, total: 0 };
      entry.posts++;
      entry.total += performanceScore(p.linkId ? (allClicks.get(p.linkId) ?? 0) : 0, allMetrics.get(p.id));
      slots.set(key, entry);
    }
    const bestSlots = [...slots.values()]
      .map((s) => ({ ...s, label: `${DOW_LABELS[s.dow]} ${String(s.hour).padStart(2, '0')}h`, avg: Math.round((s.total / s.posts) * 10) / 10 }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.avg - a.avg || b.posts - a.posts)
      .slice(0, 6);

    const lastFetch = db.select({ fetchedAt: schema.postMetrics.fetchedAt }).from(schema.postMetrics).orderBy(desc(schema.postMetrics.id)).limit(1).get();
    const ig = getStoredToken('meta', 'ig_user');
    const totals = channels.reduce(
      (a, c) => ({ posts: a.posts + c.posts, reach: a.reach + c.reach, engagement: a.engagement + c.engagement, clicks: a.clicks + c.clicks, withMetrics: a.withMetrics + c.withMetrics }),
      { posts: 0, reach: 0, engagement: 0, clicks: 0, withMetrics: 0 },
    );
    return {
      days,
      totals: { ...totals, followers: (ig?.meta.followers as number | null | undefined) ?? null },
      channels,
      perDay: [...perDay.values()],
      bestSlots,
      lastFetchAt: lastFetch?.fetchedAt ?? null,
      warnings: connectionWarnings(now),
      connected: { linkedin: Boolean(getStoredToken('linkedin', 'li_person')), instagram: Boolean(ig) },
    };
  });

  /** Relevé immédiat des statistiques (sinon chaque matin à 9 h 10). */
  app.post<{ Body: { force?: boolean } }>('/api/analytics/refresh', async (request, reply) => {
    const run = await runJob('metrics', () => runMetricsJob({ force: Boolean(request.body?.force) }));
    if (!run.ok) return reply.status(500).send({ error: run.error?.slice(0, 200) ?? 'échec du relevé' });
    return run.result;
  });
}
