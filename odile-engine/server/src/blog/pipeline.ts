/**
 * Chaîne du blog : choisir un sujet → rédiger → couverture → attente de validation
 * → publication dans Framer au moment voulu.
 *
 * Comme pour les posts, rien ne part sans validation : l'article attend dans le
 * dashboard (page Blog), un email prévient. La publication effective se fait à
 * l'heure programmée par le job « blog-publish-due ».
 */
import { and, desc, eq, lte } from 'drizzle-orm';
import { articleSchema, type Article, type BlogSettings } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getBlog, getBrand } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { fabriquerCouverture } from './cover.js';
import { publierDansFramer, type ContenuAPublier } from './framer.js';
import { articleHtml, articleJsonLd, choisirSujet, redigerArticle, slugDisponible } from './writer.js';

type ArticleRow = typeof schema.articles.$inferSelect;

function siteUrl(): string {
  return (getBrand().siteUrl || 'https://odileai.com').replace(/\/$/, '');
}

/** Adresse publique de la couverture (Framer la télécharge depuis là). */
export function coverUrl(assetId: string | null): string | null {
  return assetId ? `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${assetId}.jpg` : null;
}

/** Un article est-il dû, selon la cadence ? */
export function blogDue(reglages: BlogSettings = getBlog(), now = new Date()): { due: boolean; reason: string } {
  if (!reglages.enabled) return { due: false, reason: 'blog désactivé' };
  const dernier = db.select({ createdAt: schema.articles.createdAt }).from(schema.articles).orderBy(desc(schema.articles.id)).limit(1).get();
  if (!dernier) return { due: true, reason: 'premier article' };
  const ecart = (now.getTime() - new Date(dernier.createdAt).getTime()) / 86400000;
  return ecart >= reglages.everyDays
    ? { due: true, reason: `dernier article il y a ${Math.floor(ecart)} j` }
    : { due: false, reason: `prochain dans ${Math.ceil(reglages.everyDays - ecart)} j` };
}

/** Recalcule HTML et JSON-LD d'un article à partir de son contenu structuré. */
export function deriverArticle(row: ArticleRow, article: Article, reglages: BlogSettings): { bodyHtml: string; jsonLd: string } {
  const site = siteUrl();
  const brand = getBrand();
  return {
    bodyHtml: articleHtml(article, site),
    jsonLd: articleJsonLd(article, {
      url: `${site}/blog/${row.slug || article.slug}`,
      siteUrl: site,
      brand: brand.name,
      author: reglages.authorName,
      ville: reglages.ville,
      datePublished: (row.publishedAt ?? row.createdAt).slice(0, 10),
      coverUrl: coverUrl(row.coverAssetId),
      logoUrl: brand.logoAssetId ? `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${brand.logoAssetId}.png` : null,
    }),
  };
}

export interface BlogPipelineSummary {
  articleId: number;
  title: string;
  emailed: boolean;
}

/** Rédige un nouvel article (sujet choisi automatiquement, ou l'actualité donnée) et le met en attente de validation. */
export async function runBlogPipeline(opts: { newsItemId?: number } = {}): Promise<BlogPipelineSummary> {
  const reglages = getBlog();
  const sujet = choisirSujet(reglages, opts.newsItemId);
  const row = db.insert(schema.articles).values({ status: 'drafting', brief: sujet.brief, newsItemId: sujet.newsItemId }).returning().get();
  try {
    const article = await redigerArticle(sujet, reglages);
    await enregistrerRedaction(row.id, article, reglages);
    if (sujet.newsItemId) db.update(schema.newsItems).set({ status: 'used' }).where(eq(schema.newsItems.id, sujet.newsItemId)).run();
    const emailed = await prevenir(row.id, article.title);
    logger.info({ articleId: row.id, titre: article.title }, 'article rédigé, en attente de validation');
    return { articleId: row.id, title: article.title, emailed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.articles).set({ status: 'failed', error: message.slice(0, 700), updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, row.id)).run();
    logger.error({ articleId: row.id, err: message }, 'rédaction de l’article en échec');
    throw err;
  }
}

/** Rejoue la rédaction d'un article existant (même sujet, texte neuf). */
export async function regenererArticle(articleId: number): Promise<BlogPipelineSummary> {
  const row = db.select().from(schema.articles).where(eq(schema.articles.id, articleId)).get();
  if (!row) throw new Error(`Article ${articleId} introuvable`);
  if (['publishing', 'published'].includes(row.status)) throw new Error('Cet article est déjà publié');
  const reglages = getBlog();
  db.update(schema.articles).set({ status: 'drafting', error: null, updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, articleId)).run();
  try {
    const news = row.newsItemId ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, row.newsItemId)).get() : null;
    const article = await redigerArticle(
      {
        brief: row.brief,
        newsItemId: row.newsItemId,
        matiere: news ? [news.title, news.summary ?? '', news.contentText?.slice(0, 3000) ?? '', `Source : ${news.url}`].filter(Boolean).join('\n\n') : '',
      },
      reglages,
    );
    await enregistrerRedaction(articleId, article, reglages);
    return { articleId, title: article.title, emailed: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.articles).set({ status: 'failed', error: message.slice(0, 700), updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, articleId)).run();
    throw err;
  }
}

async function enregistrerRedaction(articleId: number, article: Article, reglages: BlogSettings): Promise<void> {
  const slug = slugDisponible(article.slug, articleId);
  const coverAssetId = await fabriquerCouverture({ title: article.coverTitle, accentWord: article.coverAccentWord, kicker: reglages.ville, articleId });
  const now = new Date().toISOString();
  db.update(schema.articles)
    .set({ title: article.title, slug, metaTitle: article.metaTitle, metaDescription: article.metaDescription, excerpt: article.excerpt, content: JSON.stringify(article), keywords: JSON.stringify(article.keywords), coverAssetId, updatedAt: now })
    .where(eq(schema.articles.id, articleId))
    .run();
  const row = db.select().from(schema.articles).where(eq(schema.articles.id, articleId)).get()!;
  const derive = deriverArticle(row, article, reglages);
  db.update(schema.articles).set({ ...derive, status: 'awaiting_approval', error: null, updatedAt: now }).where(eq(schema.articles.id, articleId)).run();
}

async function prevenir(articleId: number, titre: string): Promise<boolean> {
  try {
    const lien = `${config.PUBLIC_URL.replace(/\/$/, '')}/blog`;
    const res = await sendMail({
      kind: 'approval',
      to: getApprovalEmail().to,
      subject: `${getApprovalEmail().subjectPrefix} 📝 Article de blog à valider · ${titre.slice(0, 70)}`,
      html: `<p>Un article de blog est prêt pour le site : <b>${titre}</b>.</p><p>Relis-le, ajuste-le si besoin et approuve-le depuis le dashboard : <a href="${lien}">${lien}</a></p><p style="color:#889">Rien ne sera publié sur le site sans ton accord.</p>`,
      text: `Un article de blog est prêt : ${titre}\nÀ valider ici : ${lien}`,
    });
    return res.ok;
  } catch (err) {
    logger.warn({ articleId, err: String(err).slice(0, 200) }, 'email de validation du blog non envoyé');
    return false;
  }
}

/** Publie un article dans Framer, maintenant. */
export async function publierArticle(articleId: number): Promise<{ url: string | null; draft: boolean }> {
  const row = db.select().from(schema.articles).where(eq(schema.articles.id, articleId)).get();
  if (!row) throw new Error(`Article ${articleId} introuvable`);
  const reglages = getBlog();
  const article = articleSchema.parse(JSON.parse(row.content));
  db.update(schema.articles).set({ status: 'publishing', updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, articleId)).run();
  try {
    const derive = deriverArticle({ ...row, publishedAt: new Date().toISOString() }, article, reglages);
    const contenu: ContenuAPublier = {
      slug: row.slug,
      title: row.title,
      bodyHtml: derive.bodyHtml,
      excerpt: row.excerpt,
      coverUrl: coverUrl(row.coverAssetId),
      coverAlt: article.coverTitle,
      date: new Date().toISOString(),
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      keywords: article.keywords,
      jsonLd: derive.jsonLd,
      author: reglages.authorName,
    };
    const res = await publierDansFramer(contenu, reglages);
    const now = new Date().toISOString();
    db.update(schema.articles)
      .set({ status: 'published', framerItemId: res.itemId, publishedUrl: res.url, publishedAt: now, bodyHtml: derive.bodyHtml, jsonLd: derive.jsonLd, error: null, updatedAt: now })
      .where(eq(schema.articles.id, articleId))
      .run();
    return { url: res.url, draft: res.draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.articles).set({ status: 'failed', error: message.slice(0, 700), updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, articleId)).run();
    logger.error({ articleId, err: message }, 'publication de l’article en échec');
    throw err;
  }
}

/** Publie les articles programmés dont l'heure est venue. */
export async function publierArticlesDus(now = new Date()): Promise<{ published: number; failed: number }> {
  const dus = db
    .select()
    .from(schema.articles)
    .where(and(eq(schema.articles.status, 'scheduled'), lte(schema.articles.scheduledAt, now.toISOString())))
    .all();
  let published = 0;
  let failed = 0;
  for (const a of dus) {
    try {
      await publierArticle(a.id);
      published++;
    } catch {
      failed++;
    }
  }
  return { published, failed };
}
