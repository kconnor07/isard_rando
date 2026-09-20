/**
 * Chaîne du blog : choisir un sujet → rédiger → couverture → attente de validation
 * → publication dans Framer au moment voulu.
 *
 * Comme pour les posts, rien ne part sans validation : l'article attend dans le
 * dashboard (page Blog), un email prévient. La publication effective se fait à
 * l'heure programmée par le job « blog-publish-due ».
 */
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { articleSchema, type Article, type BlogSettings } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getBlog, getBrand } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { fabriquerCouverture } from './cover.js';
import { publierDansFramer, type ContenuAPublier } from './framer.js';
import { articleHtml, articleJsonLd, choisirSujet, redigerArticle, slugDisponible, sujetDepuisArticle, type SujetArticle } from './writer.js';

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
  // Un brouillon en échec ou rejeté n'est pas un article : il ne repousse pas le
  // suivant de sept jours. Après un échec, on réessaie dès le lendemain.
  const dernier = db
    .select({ createdAt: schema.articles.createdAt, status: schema.articles.status })
    .from(schema.articles)
    .where(inArray(schema.articles.status, ['awaiting_approval', 'scheduled', 'publishing', 'published']))
    .orderBy(desc(schema.articles.id))
    .limit(1)
    .get();
  if (!dernier) {
    const echec = db.select({ createdAt: schema.articles.createdAt }).from(schema.articles).orderBy(desc(schema.articles.id)).limit(1).get();
    if (echec && now.getTime() - new Date(echec.createdAt).getTime() < 86400000) return { due: false, reason: 'dernière tentative en échec il y a moins d’un jour' };
    return { due: true, reason: echec ? 'nouvel essai après un échec' : 'premier article' };
  }
  const ecart = (now.getTime() - new Date(dernier.createdAt).getTime()) / 86400000;
  return ecart >= reglages.everyDays
    ? { due: true, reason: `dernier article il y a ${Math.floor(ecart)} j` }
    : { due: false, reason: `prochain dans ${Math.ceil(reglages.everyDays - ecart)} j` };
}

/** Le texte alternatif de la couverture : le titre de l'image, la marque et la ville — ce que cherchent les moteurs, pas « image ». */
export function altDeCouverture(article: Pick<Article, 'coverTitle'>, reglages: Pick<BlogSettings, 'ville'>): string {
  const brand = getBrand();
  const ville = brand.ville || reglages.ville || 'Toulouse';
  return `${article.coverTitle} — ${brand.name}${ville ? `, ${ville}` : ''}`.slice(0, 125);
}

/** Recalcule HTML et JSON-LD d'un article à partir de son contenu structuré. */
export function deriverArticle(row: ArticleRow, article: Article, reglages: BlogSettings): { bodyHtml: string; jsonLd: string } {
  const site = siteUrl();
  const brand = getBrand();
  return {
    bodyHtml: articleHtml(article, site),
    jsonLd: articleJsonLd(article, {
      url: row.publishedUrl || `${site}/blog/${row.slug || article.slug}`,
      siteUrl: site,
      brand: brand.name,
      author: reglages.authorName,
      ville: brand.ville || reglages.ville,
      datePublished: (row.publishedAt ?? row.createdAt).slice(0, 10),
      dateModified: (row.updatedAt ?? row.publishedAt ?? row.createdAt).slice(0, 10),
      coverUrl: coverUrl(row.coverAssetId),
      logoUrl: brand.logoAssetId ? `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${brand.logoAssetId}.png` : null,
      zones: reglages.zones,
      telephone: brand.telephone,
      rue: brand.rue,
      codePostal: brand.codePostal,
      sameAs: brand.sameAs,
    }),
  };
}

export interface BlogPipelineSummary {
  articleId: number;
  title: string;
  emailed: boolean;
}

/**
 * Ouvre le brouillon en base avec un slug provisoire unique. Le slug définitif
 * n'existe qu'une fois l'article rédigé ; en attendant, la valeur vide par défaut
 * faisait tomber la seconde insertion sur l'index unique (« UNIQUE constraint
 * failed: articles.slug ») dès qu'une rédaction précédente avait échoué avant
 * de nommer son article — et le blog ne pouvait plus rien rédiger.
 */
export function ouvrirBrouillon(sujet: Pick<SujetArticle, 'brief' | 'newsItemId'>): ArticleRow {
  const provisoire = `brouillon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return db
    .insert(schema.articles)
    .values({ status: 'drafting', brief: sujet.brief, newsItemId: sujet.newsItemId, slug: provisoire })
    .returning()
    .get();
}

/** Rédige un nouvel article (sujet choisi automatiquement, ou l'actualité donnée) et le met en attente de validation. */
export async function runBlogPipeline(opts: { newsItemId?: number } = {}): Promise<BlogPipelineSummary> {
  const reglages = getBlog();
  const sujet = choisirSujet(reglages, opts.newsItemId);
  const row = ouvrirBrouillon(sujet);
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
    const article = await redigerArticle(sujetDepuisArticle(row), reglages, articleId);
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
  const coverAssetId = await fabriquerCouverture({ title: article.coverTitle, accentWord: article.coverAccentWord, kicker: reglages.ville, articleId, reglages });
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

/**
 * Repousse un article déjà en ligne vers Framer : texte, méta, JSON-LD et
 * couverture recalculés aux règles du moment (entités locales, maillage, fiche
 * locale de la marque). Les articles publiés avant ces règles n'avaient aucun
 * moyen d'en profiter.
 */
export async function republierArticle(articleId: number): Promise<{ url: string | null; draft: boolean; champsIgnores: string[] }> {
  const row = db.select().from(schema.articles).where(eq(schema.articles.id, articleId)).get();
  if (!row) throw new Error(`Article ${articleId} introuvable`);
  if (row.status !== 'published') throw new Error('Seul un article déjà publié se met à jour sur le site');
  if (!row.framerItemId || row.framerItemId.startsWith('dry-')) {
    // Publié à la main ou avant que l'identifiant soit gardé : on ne sait pas quel item toucher.
    throw new Error('Cet article n’est pas relié à un item Framer connu : republie-le depuis Framer, ou rejette-le et réécris-le');
  }
  const reglages = getBlog();
  const article = articleSchema.parse(JSON.parse(row.content));
  const maintenant = new Date().toISOString();
  const derive = deriverArticle({ ...row, updatedAt: maintenant }, article, reglages);
  const contenu: ContenuAPublier = {
    slug: row.slug,
    title: row.title,
    bodyHtml: derive.bodyHtml,
    excerpt: row.excerpt,
    coverUrl: coverUrl(row.coverAssetId),
    coverAlt: altDeCouverture(article, reglages),
    date: row.publishedAt ?? maintenant,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    keywords: article.keywords,
    jsonLd: derive.jsonLd,
    author: reglages.authorName,
  };
  const res = await publierDansFramer(contenu, reglages, { itemId: row.framerItemId });
  // L'adresse en ligne ne bouge que si Framer en rend une vraie (en simulation, c'est un fichier).
  const url = res.url && /^https?:/.test(res.url) ? res.url : row.publishedUrl;
  db.update(schema.articles)
    .set({ publishedUrl: url, bodyHtml: derive.bodyHtml, jsonLd: derive.jsonLd, error: null, updatedAt: maintenant })
    .where(eq(schema.articles.id, articleId))
    .run();
  logger.info({ articleId, slug: row.slug, ignores: res.champsIgnores }, 'article mis à jour sur le site');
  return { url, draft: res.draft, champsIgnores: res.champsIgnores };
}

/** Publie un article dans Framer, maintenant. */
export async function publierArticle(articleId: number): Promise<{ url: string | null; draft: boolean; champsIgnores: string[]; pagesNonPubliees: string[] }> {
  const row = db.select().from(schema.articles).where(eq(schema.articles.id, articleId)).get();
  if (!row) throw new Error(`Article ${articleId} introuvable`);
  const reglages = getBlog();
  const article = articleSchema.parse(JSON.parse(row.content));
  db.update(schema.articles).set({ status: 'publishing', updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, articleId)).run();
  try {
    // Publié et modifié à l'instant : le JSON-LD ne doit pas dater la modification d'avant la parution.
    const maintenant = new Date().toISOString();
    const derive = deriverArticle({ ...row, publishedAt: maintenant, updatedAt: maintenant }, article, reglages);
    const contenu: ContenuAPublier = {
      slug: row.slug,
      title: row.title,
      bodyHtml: derive.bodyHtml,
      excerpt: row.excerpt,
      coverUrl: coverUrl(row.coverAssetId),
      coverAlt: altDeCouverture(article, reglages),
      date: new Date().toISOString(),
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      keywords: article.keywords,
      jsonLd: derive.jsonLd,
      author: reglages.authorName,
    };
    // Un nouvel essai retrouve l'item déjà déposé au lieu d'en créer un second.
    const res = await publierDansFramer(contenu, reglages, { itemId: row.framerItemId && !row.framerItemId.startsWith('dry-') ? row.framerItemId : null });
    const now = new Date().toISOString();
    if (res.pagesNonPubliees.length > 0) {
      // L'article est déposé mais le site n'a pas été publié : des retouches en cours
      // sur d'autres pages seraient parties avec lui. Nouvel essai au prochain passage.
      const dansUneHeure = new Date(Date.now() + 3600_000).toISOString();
      const message = `Site non publié : des modifications non publiées attendent dans Framer sur ${res.pagesNonPubliees.join(', ')}. Publie-les (ou annule-les) dans Framer ; l’article part au prochain essai.`;
      db.update(schema.articles)
        .set({ status: 'scheduled', scheduledAt: dansUneHeure, framerItemId: res.itemId, bodyHtml: derive.bodyHtml, jsonLd: derive.jsonLd, error: message, updatedAt: now })
        .where(eq(schema.articles.id, articleId))
        .run();
      logger.warn({ articleId, pages: res.pagesNonPubliees }, 'article déposé, site non publié (retouches en cours)');
      return { url: null, draft: true, champsIgnores: res.champsIgnores, pagesNonPubliees: res.pagesNonPubliees };
    }
    db.update(schema.articles)
      .set({ status: 'published', framerItemId: res.itemId, publishedUrl: res.url, publishedAt: now, bodyHtml: derive.bodyHtml, jsonLd: derive.jsonLd, error: null, updatedAt: now })
      .where(eq(schema.articles.id, articleId))
      .run();
    return { url: res.url, draft: res.draft, champsIgnores: res.champsIgnores, pagesNonPubliees: [] };
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
