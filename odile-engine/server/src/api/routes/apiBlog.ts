import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { articleSchema } from '@odile/shared';
import { coverUrl, publierArticle, regenererArticle, runBlogPipeline } from '../../blog/pipeline.js';
import { fabriquerCouverture } from '../../blog/cover.js';
import { listerCollections } from '../../blog/framer.js';
import { db, schema } from '../../db/client.js';
import { getBlog } from '../../db/settingsRepo.js';
import { logger } from '../../lib/logger.js';

type ArticleRow = typeof schema.articles.$inferSelect;

function resume(a: ArticleRow) {
  return {
    id: a.id,
    status: a.status,
    title: a.title,
    slug: a.slug,
    brief: a.brief,
    excerpt: a.excerpt,
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    keywords: JSON.parse(a.keywords || '[]') as string[],
    coverUrl: a.coverAssetId ? `/public-assets/${a.coverAssetId}.jpg` : null,
    publishedUrl: a.publishedUrl,
    scheduledAt: a.scheduledAt,
    publishedAt: a.publishedAt,
    error: a.error,
    createdAt: a.createdAt,
    simulated: Boolean(a.framerItemId?.startsWith('dry-')),
  };
}

const editSchema = z.object({
  title: z.string().min(10).max(90).optional(),
  slug: z.string().min(3).max(90).regex(/^[a-z0-9-]+$/).optional(),
  metaTitle: z.string().min(10).max(65).optional(),
  metaDescription: z.string().min(50).max(160).optional(),
  excerpt: z.string().min(40).max(320).optional(),
});

export function registerBlogRoutes(app: FastifyInstance): void {
  app.get('/api/blog/articles', async () =>
    db.select().from(schema.articles).orderBy(desc(schema.articles.id)).limit(100).all().map(resume),
  );

  app.get<{ Params: { id: string } }>('/api/blog/articles/:id', async (request, reply) => {
    const a = db.select().from(schema.articles).where(eq(schema.articles.id, Number(request.params.id))).get();
    if (!a) return reply.status(404).send({ error: 'Article introuvable' });
    let content: unknown = null;
    try {
      content = articleSchema.parse(JSON.parse(a.content));
    } catch {
      content = null;
    }
    return { ...resume(a), content, bodyHtml: a.bodyHtml, jsonLd: a.jsonLd, coverPublicUrl: coverUrl(a.coverAssetId) };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/blog/articles/:id', async (request, reply) => {
    const parsed = editSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map((i) => i.message).join(' ; ') });
    const id = Number(request.params.id);
    const a = db.select().from(schema.articles).where(eq(schema.articles.id, id)).get();
    if (!a) return reply.status(404).send({ error: 'Article introuvable' });
    if (['publishing', 'published'].includes(a.status)) return reply.status(400).send({ error: 'Article déjà publié' });
    // Le contenu structuré suit les corrections de titre, pour que HTML et JSON-LD restent cohérents.
    const patch: Partial<ArticleRow> = { ...parsed.data, updatedAt: new Date().toISOString() };
    if (parsed.data.title || parsed.data.metaDescription || parsed.data.metaTitle || parsed.data.excerpt || parsed.data.slug) {
      try {
        const content = articleSchema.parse(JSON.parse(a.content));
        Object.assign(content, {
          title: parsed.data.title ?? content.title,
          slug: parsed.data.slug ?? content.slug,
          metaTitle: parsed.data.metaTitle ?? content.metaTitle,
          metaDescription: parsed.data.metaDescription ?? content.metaDescription,
          excerpt: parsed.data.excerpt ?? content.excerpt,
        });
        patch.content = JSON.stringify(content);
      } catch {
        /* contenu absent (échec de rédaction) : on garde les champs plats */
      }
    }
    db.update(schema.articles).set(patch).where(eq(schema.articles.id, id)).run();
    return { ok: true };
  });

  /** Approuve : publication dans une minute, ou à la date choisie. */
  app.post<{ Params: { id: string }; Body: { at?: string } }>('/api/blog/articles/:id/approve', async (request, reply) => {
    const id = Number(request.params.id);
    const a = db.select().from(schema.articles).where(eq(schema.articles.id, id)).get();
    if (!a) return reply.status(404).send({ error: 'Article introuvable' });
    if (!['awaiting_approval', 'rejected', 'failed', 'scheduled'].includes(a.status)) {
      return reply.status(400).send({ error: `Cet article est « ${a.status} » — rien à faire` });
    }
    if (!a.content || a.content === '{}') return reply.status(400).send({ error: 'Article sans contenu : relance la rédaction' });
    const at = request.body?.at ? new Date(request.body.at) : new Date(Date.now() + 60_000);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) return reply.status(400).send({ error: 'Date invalide ou passée' });
    db.update(schema.articles)
      .set({ status: 'scheduled', scheduledAt: at.toISOString(), error: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.articles.id, id))
      .run();
    return { ok: true, scheduledAt: at.toISOString() };
  });

  app.post<{ Params: { id: string } }>('/api/blog/articles/:id/reject', async (request, reply) => {
    const id = Number(request.params.id);
    const a = db.select().from(schema.articles).where(eq(schema.articles.id, id)).get();
    if (!a) return reply.status(404).send({ error: 'Article introuvable' });
    if (['publishing', 'published'].includes(a.status)) return reply.status(400).send({ error: 'Trop tard : article publié' });
    db.update(schema.articles).set({ status: 'rejected', scheduledAt: null, updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, id)).run();
    if (a.newsItemId) db.update(schema.newsItems).set({ status: 'shortlisted' }).where(eq(schema.newsItems.id, a.newsItemId)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/blog/articles/:id/regenerate', async (request, reply) => {
    try {
      return await regenererArticle(Number(request.params.id));
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Refabrique la seule image de couverture, aux réglages du moment.
   *
   * Changer le format d'image ne doit pas obliger à réécrire l'article : on
   * essaie, on regarde sur le site, on ajuste.
   */
  app.post<{ Params: { id: string } }>('/api/blog/articles/:id/cover', async (request, reply) => {
    const id = Number(request.params.id);
    const a = db.select().from(schema.articles).where(eq(schema.articles.id, id)).get();
    if (!a) return reply.status(404).send({ error: 'Article introuvable' });
    try {
      const reglages = getBlog();
      // Le titre de couverture vit dans l'article structuré, pas dans une colonne.
      const contenu = articleSchema.partial().safeParse(JSON.parse(a.content || '{}'));
      const coverAssetId = await fabriquerCouverture({
        title: (contenu.success ? contenu.data.coverTitle : null) || a.title,
        accentWord: (contenu.success ? contenu.data.coverAccentWord : '') ?? '',
        kicker: reglages.ville,
        articleId: id,
        reglages,
      });
      db.update(schema.articles).set({ coverAssetId, updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, id)).run();
      return { coverUrl: `/public-assets/${coverAssetId}.jpg`, ratio: reglages.coverRatio };
    } catch (err) {
      logger.warn({ articleId: id, err: String(err).slice(0, 200) }, 'couverture non refabriquée');
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Publie tout de suite, sans attendre le job (pour tester la connexion Framer). */
  app.post<{ Params: { id: string } }>('/api/blog/articles/:id/publish-now', async (request, reply) => {
    try {
      return await publierArticle(Number(request.params.id));
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Rédige un article maintenant (sujet automatique, ou l'actualité donnée). */
  app.post<{ Body: { newsItemId?: number } }>('/api/blog/draft', async (request, reply) => {
    try {
      return await runBlogPipeline({ newsItemId: request.body?.newsItemId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, 'rédaction manuelle du blog en échec');
      return reply.status(400).send({ error: message });
    }
  });

  /** Collections du projet Framer et leurs champs — pour choisir celle du blog. */
  app.get('/api/blog/framer/collections', async (_request, reply) => {
    try {
      return { collections: await listerCollections(), reglages: getBlog() };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
