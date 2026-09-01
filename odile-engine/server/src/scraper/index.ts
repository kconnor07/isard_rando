import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { canonicalizeUrl, contentHash, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from './dedupe.js';
import { fetchHackerNews } from './hackernews.js';
import { fetchRss, type FetchedItem } from './rss.js';
import { seedSourcesIfEmpty } from './sources.js';

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

  const summary: ScrapeSummary = {
    sources: sources.length,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    crossDuplicates: 0,
    errors: [],
  };

  for (const source of sources) {
    try {
      let items: FetchedItem[] = [];
      if (source.kind === 'hn') {
        items = await fetchHackerNews(source.url);
      } else {
        const result = await fetchRss(source.url, source.etag, source.lastModified);
        if (result.notModified) {
          db.update(schema.newsSources)
            .set({ lastFetchedAt: new Date().toISOString(), lastError: null })
            .where(eq(schema.newsSources.id, source.id))
            .run();
          continue;
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
        const hash = contentHash(canonical);
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
            contentHash: hash,
          })
          .onConflictDoNothing({ target: schema.newsItems.contentHash })
          .returning({ id: schema.newsItems.id })
          .all();
        if (inserted.length > 0) summary.inserted++;
        else summary.duplicates++;
      }

      db.update(schema.newsSources)
        .set({ lastFetchedAt: new Date().toISOString(), lastError: null })
        .where(eq(schema.newsSources.id, source.id))
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ source: source.name, error: message });
      db.update(schema.newsSources)
        .set({ lastFetchedAt: new Date().toISOString(), lastError: message.slice(0, 500) })
        .where(eq(schema.newsSources.id, source.id))
        .run();
      logger.warn({ source: source.name, err: message }, 'échec de récupération de la source');
    }
  }

  summary.crossDuplicates = crossSourceDedupe();
  return summary;
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
