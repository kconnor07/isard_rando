import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

export const SHORTLIST_SIZE = 10;
export const SHORTLIST_MIN_SCORE = 55;

export interface ShortlistSummary {
  date: string;
  selected: number;
}

/** Classe les meilleurs items des dernières 24 h dans la shortlist du jour. */
export function buildDailyShortlist(now = new Date()): ShortlistSummary {
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
    .limit(SHORTLIST_SIZE)
    .all();

  candidates.forEach((item, rank) => {
    db.update(schema.newsItems)
      .set({ shortlistDate: date, shortlistRank: rank + 1, status: 'shortlisted' })
      .where(eq(schema.newsItems.id, item.id))
      .run();
  });

  return { date, selected: candidates.length };
}

/** Meilleur item de shortlist non encore utilisé (le plus récent d'abord). */
export function nextShortlistedItem() {
  return (
    db
      .select()
      .from(schema.newsItems)
      .where(eq(schema.newsItems.status, 'shortlisted'))
      .orderBy(desc(schema.newsItems.shortlistDate), schema.newsItems.shortlistRank)
      .limit(1)
      .get() ?? null
  );
}
