import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateFromNewsSchema } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { runJob } from '../../lib/jobRunner.js';
import { runScrape } from '../../scraper/index.js';
import { runScore } from '../../scorer/score.js';
import { buildDailyShortlist } from '../../scorer/shortlist.js';
import { runDraftPipeline } from '../../scheduler/pipeline.js';

export function registerNewsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { status?: string; limit?: string } }>('/api/news', async (request) => {
    const statuses = request.query.status?.split(',') ?? ['shortlisted'];
    const rows = db
      .select()
      .from(schema.newsItems)
      .where(inArray(schema.newsItems.status, statuses as never))
      .orderBy(desc(schema.newsItems.scoreTotal))
      .limit(Number(request.query.limit ?? 40))
      .all();
    const sources = new Map(db.select().from(schema.newsSources).all().map((s) => [s.id, s.name]));
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      url: n.url,
      lang: n.lang,
      source: n.sourceId ? (sources.get(n.sourceId) ?? '') : '',
      publishedAt: n.publishedAt,
      score: n.scoreTotal,
      scoreRelevance: n.scoreRelevance,
      scoreClick: n.scoreClick,
      reason: n.scoreReason,
      status: n.status,
      shortlistRank: n.shortlistRank,
    }));
  });

  app.post('/api/news/refresh', async () => {
    const scrape = await runJob('scrape', runScrape);
    const score = await runJob('score', () => runScore());
    const shortlist = buildDailyShortlist();
    return { scrape: scrape.result, score: score.result, shortlist };
  });

  app.post<{ Params: { id: string } }>('/api/news/:id/generate', async (request, reply) => {
    const parsed = generateFromNewsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const newsId = Number(request.params.id);
    const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsId)).get();
    if (!news) return reply.status(404).send({ error: 'Actualité introuvable' });
    // Pipeline long (LLM + rendus + reviews) : lancé en tâche de fond,
    // le dashboard suit l'avancement via la liste des posts.
    void runJob('pipeline-manuel', () =>
      runDraftPipeline({ newsItemId: newsId, ...parsed.data }),
    ).catch((err) => logger.error({ err: String(err) }, 'pipeline manuel en échec'));
    return { started: true };
  });

  app.post<{ Params: { id: string } }>('/api/news/:id/discard', async (request) => {
    db.update(schema.newsItems)
      .set({ status: 'discarded', scoreReason: 'Écartée manuellement' })
      .where(eq(schema.newsItems.id, Number(request.params.id)))
      .run();
    return { ok: true };
  });

  // ----- Sources de veille ---------------------------------------------------
  app.get('/api/sources', async () => db.select().from(schema.newsSources).all());

  app.post<{ Body: { name: string; url: string; kind?: 'rss' | 'hn'; lang?: 'fr' | 'en'; weight?: number } }>(
    '/api/sources',
    async (request, reply) => {
      const { name, url, kind = 'rss', lang = 'fr', weight = 1 } = request.body ?? ({} as never);
      if (!name || !url) return reply.status(400).send({ error: 'name et url requis' });
      const row = db
        .insert(schema.newsSources)
        .values({ name, url, kind, lang, weight })
        .returning()
        .get();
      return row;
    },
  );

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; weight?: number } }>(
    '/api/sources/:id',
    async (request) => {
      const update: Record<string, unknown> = {};
      if (request.body?.enabled !== undefined) update.enabled = request.body.enabled;
      if (request.body?.weight !== undefined) update.weight = request.body.weight;
      db.update(schema.newsSources)
        .set(update)
        .where(eq(schema.newsSources.id, Number(request.params.id)))
        .run();
      return { ok: true };
    },
  );
}
