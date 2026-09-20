import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateFromNewsSchema } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { themeExists } from '../../render/custom-theme.js';
import { logger } from '../../lib/logger.js';
import { runJob } from '../../lib/jobRunner.js';
import { runScrape } from '../../scraper/index.js';
import { runScore } from '../../scorer/score.js';
import { buildDailyShortlist } from '../../scorer/shortlist.js';
import { runDraftPipeline } from '../../scheduler/pipeline.js';
import { construireSujets, itemPrincipal, sujetsDuMoment } from '../../scorer/sujets.js';

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
      scoreFinal: n.scoreFinal,
      engagement: n.engagement,
      topics: n.topics ? (JSON.parse(n.topics) as string[]) : [],
      contentExtracted: Boolean(n.contentText),
      reason: n.scoreReason,
      status: n.status,
      shortlistRank: n.shortlistRank,
    }));
  });

  app.post('/api/news/refresh', async () => {
    const scrape = await runJob('scrape', runScrape);
    const score = await runJob('score', () => runScore());
    const shortlist = await runJob('shortlist', () => buildDailyShortlist());
    return { scrape: scrape.result, score: score.result, shortlist: shortlist.result };
  });

  /** Fabrications en cours (pipeline complet), par actu : une seule à la fois. */
  const generating = new Map<number, { startedAt: string }>();
  app.get('/api/news/generating', async () => Array.from(generating, ([newsId, v]) => ({ newsId, startedAt: v.startedAt })));

  app.post<{ Params: { id: string } }>('/api/news/:id/generate', async (request, reply) => {
    const parsed = generateFromNewsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const newsId = Number(request.params.id);
    const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsId)).get();
    if (!news) return reply.status(404).send({ error: 'Actualité introuvable' });
    if (parsed.data.theme && !themeExists(parsed.data.theme)) {
      return reply.status(400).send({ error: 'Thème introuvable' });
    }
    if (generating.has(newsId)) return reply.status(409).send({ error: 'Un post est déjà en fabrication pour cette actualité' });
    // Pipeline long (LLM + rendus + reviews) : lancé en tâche de fond,
    // le dashboard suit l'avancement via GET /api/news/generating puis la liste des posts.
    generating.set(newsId, { startedAt: new Date().toISOString() });
    void runJob('pipeline-manuel', () =>
      runDraftPipeline({ newsItemId: newsId, ...parsed.data }),
    )
      .catch((err) => logger.error({ err: String(err) }, 'pipeline manuel en échec'))
      .finally(() => generating.delete(newsId));
    return { started: true };
  });

  // ----- Sujets de veille ----------------------------------------------------

  /** Les sujets du moment : ce que le fondateur choisit, au lieu d'articles isolés. */
  app.get('/api/news/sujets', async () => sujetsDuMoment());

  /** Reconstruit les sujets à partir des items de la semaine (sinon, cron quotidien). */
  app.post('/api/news/sujets/refresh', async () => {
    const r = await runJob('sujets', () => construireSujets());
    return r.result ?? { groupes: 0, crees: 0, ecartesDejaTraites: 0, saison: 0 };
  });

  /** Écrit un post sur ce sujet, sous l'angle choisi. */
  app.post<{ Params: { id: string }; Body: { angle?: string; channel?: 'li_personal' | 'li_org' | 'ig'; theme?: string } }>(
    '/api/news/sujets/:id/ecrire',
    async (request, reply) => {
      const id = Number(request.params.id);
      const sujet = db.select().from(schema.newsSubjects).where(eq(schema.newsSubjects.id, id)).get();
      if (!sujet) return reply.status(404).send({ error: 'Sujet introuvable' });
      if (sujet.status !== 'nouveau') return reply.status(409).send({ error: 'Ce sujet a déjà été traité ou écarté' });
      const theme = request.body?.theme;
      if (theme && !themeExists(theme)) return reply.status(400).send({ error: 'Thème introuvable' });
      const itemIds = JSON.parse(sujet.itemIds) as number[];
      const principal = itemPrincipal(id);
      // Un sujet de saison n'a pas d'article : le rédacteur part alors du sujet seul,
      // ce qui suppose qu'une actualité soit disponible pour la matière factuelle.
      if (!principal && itemIds.length > 0) return reply.status(409).send({ error: 'Les articles de ce sujet ne sont plus disponibles' });
      if (sujetEnCours.has(id)) return reply.status(409).send({ error: 'Un post est déjà en fabrication pour ce sujet' });
      sujetEnCours.set(id, { startedAt: new Date().toISOString() });
      const angle = request.body?.angle?.trim() || undefined;
      void runJob('pipeline-sujet', async () => {
        const res = await runDraftPipeline({
          ...(principal ? { newsItemId: principal } : {}),
          ...(request.body?.channel ? { channel: request.body.channel } : {}),
          ...(theme ? { theme } : {}),
          sujet: { label: sujet.label, reason: sujet.reason, ...(angle ? { angle } : {}) },
          contexteItemIds: itemIds,
        });
        db.update(schema.newsSubjects)
          .set({ status: 'utilise', postId: res.postId ?? null, updatedAt: new Date().toISOString() })
          .where(eq(schema.newsSubjects.id, id))
          .run();
        return res;
      })
        .catch((err) => logger.error({ err: String(err), sujet: id }, 'pipeline depuis un sujet en échec'))
        .finally(() => sujetEnCours.delete(id));
      return { started: true };
    },
  );

  /** Sujets en fabrication, pour que le dashboard montre l'attente. */
  const sujetEnCours = new Map<number, { startedAt: string }>();
  app.get('/api/news/sujets/en-cours', async () => Array.from(sujetEnCours, ([id, v]) => ({ id, startedAt: v.startedAt })));

  app.post<{ Params: { id: string } }>('/api/news/sujets/:id/ecarter', async (request) => {
    db.update(schema.newsSubjects)
      .set({ status: 'ecarte', updatedAt: new Date().toISOString() })
      .where(eq(schema.newsSubjects.id, Number(request.params.id)))
      .run();
    return { ok: true };
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

  app.post<{ Body: { name: string; url: string; kind?: 'rss' | 'hn' | 'youtube' | 'github'; lang?: 'fr' | 'en'; weight?: number } }>(
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
