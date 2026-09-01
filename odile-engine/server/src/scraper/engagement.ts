import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export interface EngagementRaw {
  hnPoints: number;
  hnComments: number;
  redditScore: number;
  redditComments: number;
}

/** Normalisation logarithmique 0-100 des signaux sociaux bruts. */
export function normalizeEngagement(raw: EngagementRaw): number {
  const signal = raw.hnPoints + raw.hnComments / 2 + raw.redditScore / 2 + raw.redditComments / 2;
  return Math.min(100, Math.round(20 * Math.log(1 + signal)));
}

/** Discussion Hacker News de cette URL (API Algolia publique). */
async function lookupHackerNews(url: string): Promise<{ points: number; comments: number }> {
  try {
    const data = await fetchJson<{ hits?: { points?: number; num_comments?: number }[] }>(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(url)}&restrictSearchableAttributes=url&hitsPerPage=3`,
      { headers: { 'user-agent': 'OdileEngine/1.0' }, retries: 1, timeoutMs: 15_000 },
    );
    let points = 0;
    let comments = 0;
    for (const hit of data.hits ?? []) {
      points += hit.points ?? 0;
      comments += hit.num_comments ?? 0;
    }
    return { points, comments };
  } catch {
    return { points: 0, comments: 0 };
  }
}

/** Partages Reddit de cette URL (endpoint JSON public). */
async function lookupReddit(url: string): Promise<{ score: number; comments: number }> {
  try {
    const data = await fetchJson<{
      data?: { children?: { data?: { score?: number; num_comments?: number } }[] };
    }>(`https://www.reddit.com/search.json?q=url:${encodeURIComponent(url)}&limit=5`, {
      headers: { 'user-agent': 'odile-engine:veille:v1 (contact: engine@odileai.com)' },
      retries: 1,
      timeoutMs: 15_000,
    });
    let score = 0;
    let comments = 0;
    for (const child of data.data?.children ?? []) {
      score += child.data?.score ?? 0;
      comments += child.data?.num_comments ?? 0;
    }
    return { score, comments };
  } catch {
    return { score: 0, comments: 0 };
  }
}

/**
 * Enrichit un item avec ses signaux d'engagement réels (HN + Reddit).
 * Appelé uniquement pour les candidats shortlist (~20/jour) — respectueux
 * des rate limits publics. Idempotent (24 h de fraîcheur).
 */
export async function enrichEngagement(itemId: number): Promise<number> {
  const item = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, itemId)).get();
  if (!item) return 0;
  if (item.engagement !== null && item.engagementRaw) return item.engagement;

  // Points HN déjà connus pour les items issus du scraper HN (résumé "N points…")
  const hnFromSummary = Number(/^(\d+) points/.exec(item.summary ?? '')?.[1] ?? 0);

  const [hn, reddit] = await Promise.all([
    hnFromSummary > 0 ? Promise.resolve({ points: hnFromSummary, comments: 0 }) : lookupHackerNews(item.canonicalUrl),
    lookupReddit(item.canonicalUrl),
  ]);
  const raw: EngagementRaw = {
    hnPoints: hn.points,
    hnComments: hn.comments,
    redditScore: reddit.score,
    redditComments: reddit.comments,
  };
  const engagement = normalizeEngagement(raw);
  db.update(schema.newsItems)
    .set({ engagement, engagementRaw: JSON.stringify(raw) })
    .where(eq(schema.newsItems.id, itemId))
    .run();
  logger.debug({ itemId, engagement, raw }, 'engagement enrichi');
  return engagement;
}
