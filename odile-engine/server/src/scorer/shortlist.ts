import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getTopicAffinity } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { enrichEngagement } from '../scraper/engagement.js';
import { extractForItem } from '../scraper/extract.js';
import { blendScore } from './blend.js';
import { rescoreWithContent } from './score.js';

export const SHORTLIST_SIZE = 10;
export const SHORTLIST_MIN_SCORE = 50;
const CANDIDATES = 20;
const ENRICH_CONCURRENCY = 3;

export interface ShortlistSummary {
  date: string;
  candidates: number;
  extracted: number;
  rescored: number;
  selected: number;
}

/**
 * Shortlist v2 : les meilleurs candidats des 24 dernières heures sont lus en
 * entier (extraction interne), enrichis de leurs signaux d'engagement réels,
 * rescorés sur le texte complet, puis classés par score mélangé.
 */
export async function buildDailyShortlist(now = new Date()): Promise<ShortlistSummary> {
  const date = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const candidates = db
    .select()
    .from(schema.newsItems)
    .where(
      and(
        inArray(schema.newsItems.status, ['scored', 'shortlisted']),
        gt(schema.newsItems.fetchedAt, since),
        gt(schema.newsItems.scoreTotal, SHORTLIST_MIN_SCORE - 1),
      ),
    )
    .orderBy(desc(schema.newsItems.scoreTotal))
    .limit(CANDIDATES)
    .all();

  // 1. Extraction plein texte + engagement (pool limité, non bloquant)
  let extracted = 0;
  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        if (await extractForItem(item.id)) extracted++;
        await enrichEngagement(item.id);
      } catch (err) {
        logger.debug({ item: item.id, err: String(err).slice(0, 120) }, 'enrichissement en échec');
      }
    }
  });
  await Promise.allSettled(workers);

  // 2. Rescoring sur texte complet + sujets
  const rescored = await rescoreWithContent(candidates.map((c) => c.id));

  // 3. Score mélangé + classement
  const affinity = getTopicAffinity();
  const weights = new Map(db.select().from(schema.newsSources).all().map((s) => [s.id, s.weight]));
  const refreshed = db
    .select()
    .from(schema.newsItems)
    .where(inArray(schema.newsItems.id, candidates.map((c) => c.id)))
    .all();

  const ranked = refreshed
    .map((item) => ({
      item,
      final: blendScore({
        scoreLLM: item.scoreTotal ?? 0,
        sourceWeight: item.sourceId ? (weights.get(item.sourceId) ?? 1) : 1,
        publishedAt: item.publishedAt ?? item.fetchedAt,
        now,
        topicAffinity: affinity,
        topics: item.topics ? (JSON.parse(item.topics) as string[]) : undefined,
        engagement: item.engagement,
      }),
    }))
    .sort((a, b) => b.final - a.final);

  // Nettoyage des rangs du jour (un re-run ne doit pas laisser de rangs orphelins)
  db.update(schema.newsItems)
    .set({ shortlistRank: null })
    .where(eq(schema.newsItems.shortlistDate, date))
    .run();

  for (const { item, final } of ranked) {
    db.update(schema.newsItems).set({ scoreFinal: final }).where(eq(schema.newsItems.id, item.id)).run();
  }
  ranked.slice(0, SHORTLIST_SIZE).forEach(({ item }, rank) => {
    db.update(schema.newsItems)
      .set({ shortlistDate: date, shortlistRank: rank + 1, status: 'shortlisted' })
      .where(eq(schema.newsItems.id, item.id))
      .run();
  });

  return { date, candidates: candidates.length, extracted, rescored, selected: Math.min(ranked.length, SHORTLIST_SIZE) };
}

/** Meilleur item de shortlist non encore utilisé. */
export function nextShortlistedItem() {
  return (
    db
      .select()
      .from(schema.newsItems)
      .where(eq(schema.newsItems.status, 'shortlisted'))
      .orderBy(
        desc(schema.newsItems.shortlistDate),
        desc(schema.newsItems.scoreFinal),
        schema.newsItems.shortlistRank,
      )
      .limit(1)
      .get() ?? null
  );
}

/** Items shortlistés jamais convertis en post depuis > 72 h → retour au pool. */
export function recycleStaleShortlist(now = new Date()): number {
  const cutoff = new Date(now.getTime() - 72 * 3600 * 1000).toISOString().slice(0, 10);
  const stale = db
    .select({ id: schema.newsItems.id })
    .from(schema.newsItems)
    .where(
      and(
        eq(schema.newsItems.status, 'shortlisted'),
        or(isNull(schema.newsItems.shortlistDate), lt(schema.newsItems.shortlistDate, cutoff)),
      ),
    )
    .all();
  if (stale.length > 0) {
    db.update(schema.newsItems)
      .set({ status: 'scored', shortlistDate: null, shortlistRank: null })
      .where(inArray(schema.newsItems.id, stale.map((s) => s.id)))
      .run();
  }
  return stale.length;
}
