import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { canonicalizeUrl, contentHash, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from './dedupe.js';
import { fetchHackerNews } from './hackernews.js';
import { estRechercheActus, fetchRss, type FetchedItem } from './rss.js';
import { estTendanceIA, seedSourcesIfEmpty } from './sources.js';

/** Recherches d'actualités par passage horaire, et pause entre deux (Bing limite le rythme). */
const RECHERCHES_PAR_PASSAGE = 4;
const PAUSE_ENTRE_RECHERCHES_MS = Number(process.env.PAUSE_RECHERCHES_MS ?? 10_000);
/** Une tendance IA vieillit en quelques heures ; une actu PME tient plusieurs jours. */
const INTERVALLE_TENDANCE_H = 3;
const INTERVALLE_ACTUS_H = 8;

/**
 * Les recherches à relancer maintenant : celles dont l'intervalle est écoulé, les
 * plus en retard d'abord (une jamais lue passe devant tout), au plus quatre.
 * Fonction pure, testée.
 */
export function recherchesDues<T extends { name: string; lastFetchedAt: string | null }>(
  recherches: T[],
  now: Date,
  max = RECHERCHES_PAR_PASSAGE,
): T[] {
  const retard = (s: T) => {
    if (!s.lastFetchedAt) return Number.POSITIVE_INFINITY;
    const heures = (now.getTime() - new Date(s.lastFetchedAt).getTime()) / 3_600_000;
    return heures - (estTendanceIA(s.name) ? INTERVALLE_TENDANCE_H : INTERVALLE_ACTUS_H);
  };
  return recherches
    .map((s) => ({ s, r: retard(s) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => b.r - a.r)
    .slice(0, max)
    .map(({ s }) => s);
}

/** Échecs consécutifs avant auto-désactivation d'une source (≈ 12 h au rythme horaire). */
const MAX_CONSECUTIVE_ERRORS = 12;
const SCRAPE_CONCURRENCY = 4;

export interface ScrapeSummary {
  sources: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  crossDuplicates: number;
  errors: { source: string; error: string }[];
}

export async function runScrape(): Promise<ScrapeSummary> {
  seedSourcesIfEmpty();
  const sources = db
    .select()
    .from(schema.newsSources)
    .where(eq(schema.newsSources.enabled, true))
    .all();

  // Les recherches d'actualités (Bing) passent à part, peu à la fois et espacées :
  // les interroger toutes d'un coup leur fait renvoyer des pages vides.
  const recherches = sources.filter((s) => s.kind === 'rss' && estRechercheActus(s.url));
  const dues = recherchesDues(recherches, new Date());
  const aTraiter = sources.filter((s) => !recherches.includes(s));

  const summary: ScrapeSummary = {
    sources: aTraiter.length + dues.length,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    crossDuplicates: 0,
    errors: [],
  };

  // Traitement parallèle (pool de concurrence limitée)
  const queue = [...aTraiter];
  const workers = Array.from({ length: Math.min(SCRAPE_CONCURRENCY, queue.length) }, async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      await processSource(source, summary);
    }
  });
  await Promise.allSettled(workers);
  for (const [i, source] of dues.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_ENTRE_RECHERCHES_MS));
    await processSource(source, summary);
  }

  summary.crossDuplicates = crossSourceDedupe();
  return summary;
}

async function processSource(
  source: typeof schema.newsSources.$inferSelect,
  summary: ScrapeSummary,
): Promise<void> {
  try {
    let items: FetchedItem[] = [];
    if (source.kind === 'websearch') {
      return; // source virtuelle alimentée par le job websearch quotidien
    }
    if (source.kind === 'reddit') {
      const { fetchRedditTop, redditConfigured } = await import('./reddit.js');
      if (!redditConfigured()) return; // clés absentes → source en veille, sans erreur
      items = await fetchRedditTop(source.url);
    } else if (source.kind === 'hn') {
      items = await fetchHackerNews(source.url);
    } else if (source.kind === 'github') {
      const { fetchGithubRepos } = await import('./github.js');
      items = await fetchGithubRepos(source.url);
    } else {
      const result = await fetchRss(source.url, source.etag, source.lastModified, estTendanceIA(source.name) ? { ageMaxJours: 3 } : {});
      if (result.notModified) {
        db.update(schema.newsSources)
          .set({ lastFetchedAt: new Date().toISOString(), lastError: null, consecutiveErrors: 0 })
          .where(eq(schema.newsSources.id, source.id))
          .run();
        return;
      }
      items = result.items;
      db.update(schema.newsSources)
        .set({ etag: result.etag, lastModified: result.lastModified })
        .where(eq(schema.newsSources.id, source.id))
        .run();
    }

    summary.fetched += items.length;
    for (const item of items.slice(0, 60)) {
      const canonical = canonicalizeUrl(item.url);
      const inserted = db
        .insert(schema.newsItems)
        .values({
          sourceId: source.id,
          url: item.url,
          canonicalUrl: canonical,
          title: item.title,
          summary: item.summary,
          imageUrl: item.imageUrl,
          publishedAt: item.publishedAt,
          lang: source.lang,
          contentHash: contentHash(canonical),
          ...(item.engagement != null ? { engagement: item.engagement, engagementRaw: item.engagementRaw } : {}),
        })
        .onConflictDoNothing({ target: schema.newsItems.contentHash })
        .returning({ id: schema.newsItems.id })
        .all();
      if (inserted.length > 0) summary.inserted++;
      else summary.duplicates++;
    }

    db.update(schema.newsSources)
      .set({ lastFetchedAt: new Date().toISOString(), lastError: null, consecutiveErrors: 0 })
      .where(eq(schema.newsSources.id, source.id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errors.push({ source: source.name, error: message });
    const errors = source.consecutiveErrors + 1;
    const disable = errors >= MAX_CONSECUTIVE_ERRORS;
    db.update(schema.newsSources)
      .set({
        lastFetchedAt: new Date().toISOString(),
        lastError: message.slice(0, 500),
        consecutiveErrors: errors,
        ...(disable ? { enabled: false } : {}),
      })
      .where(eq(schema.newsSources.id, source.id))
      .run();
    logger.warn({ source: source.name, errors, err: message }, 'échec de récupération de la source');
    if (disable) {
      logger.error({ source: source.name }, 'source auto-désactivée après échecs répétés');
      try {
        const { sendMail } = await import('../mailer/smtp.js');
        const { getApprovalEmail } = await import('../db/settingsRepo.js');
        await sendMail({
          kind: 'error',
          to: getApprovalEmail().to,
          subject: `[Odile] ⚠️ Source de veille désactivée : ${source.name}`,
          html: `<p>La source <b>${source.name}</b> a échoué ${errors} fois d'affilée et a été désactivée.<br/>
Dernière erreur : <code>${message.slice(0, 300)}</code><br/>
Réactive-la depuis le dashboard → Réglages → Sources (après avoir corrigé l'URL si besoin).</p>`,
          text: `Source ${source.name} désactivée après ${errors} échecs. Dernière erreur : ${message.slice(0, 200)}`,
        });
      } catch {
        /* l'alerte email ne doit pas casser le scrape */
      }
    }
  }
}

/**
 * Dédoublonnage inter-sources : le même sujet repris par plusieurs médias
 * (titres quasi identiques) — on garde l'item de la source au poids le plus fort.
 */
function crossSourceDedupe(): number {
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const rows = db
    .select({
      id: schema.newsItems.id,
      title: schema.newsItems.title,
      sourceId: schema.newsItems.sourceId,
      fetchedAt: schema.newsItems.fetchedAt,
    })
    .from(schema.newsItems)
    .where(and(gt(schema.newsItems.fetchedAt, since), ne(schema.newsItems.status, 'discarded')))
    .all();

  const weights = new Map<number, number>();
  for (const s of db.select().from(schema.newsSources).all()) weights.set(s.id, s.weight);

  const toDiscard = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (toDiscard.has(a.id) || toDiscard.has(b.id)) continue;
      if (titleSimilarity(a.title, b.title) >= TITLE_SIMILARITY_THRESHOLD) {
        const wa = a.sourceId ? (weights.get(a.sourceId) ?? 1) : 1;
        const wb = b.sourceId ? (weights.get(b.sourceId) ?? 1) : 1;
        toDiscard.add(wa >= wb ? b.id : a.id);
      }
    }
  }
  if (toDiscard.size > 0) {
    db.update(schema.newsItems)
      .set({ status: 'discarded', scoreReason: 'Doublon inter-sources' })
      .where(inArray(schema.newsItems.id, [...toDiscard]))
      .run();
  }
  return toDiscard.size;
}
