import { and, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getTopicAffinity, setTopicAffinity } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';

const WINDOW_DAYS = 28;
const MIN_POSTS_PER_SOURCE = 2;

export interface LearnSummary {
  postsAnalyzed: number;
  sourcesAdjusted: { name: string; from: number; to: number }[];
  topics: Record<string, number>;
}

interface PostPerf {
  clicks: number;
  sourceId: number | null;
  topics: string[];
  rejected: boolean;
}

/**
 * Boucle d'apprentissage hebdomadaire : les clics des posts publiés (et les
 * rejets) ajustent le poids des sources et les affinités de sujets utilisés
 * par le score mélangé de la shortlist.
 */
export async function runLearn(now = new Date()): Promise<LearnSummary> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString();
  const posts = db
    .select()
    .from(schema.posts)
    .where(
      and(
        inArray(schema.posts.status, ['published', 'rejected']),
        gte(schema.posts.updatedAt, since),
      ),
    )
    .all();

  const perfs: PostPerf[] = [];
  for (const post of posts) {
    if (!post.newsItemId) continue;
    const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, post.newsItemId)).get();
    if (!news) continue;
    const clicks =
      post.status === 'published' && post.linkId
        ? db
            .select({ id: schema.clicks.id })
            .from(schema.clicks)
            .where(eq(schema.clicks.linkId, post.linkId))
            .all().length
        : 0;
    perfs.push({
      clicks,
      sourceId: news.sourceId,
      topics: news.topics ? (JSON.parse(news.topics) as string[]) : [],
      rejected: post.status === 'rejected',
    });
  }

  const published = perfs.filter((p) => !p.rejected);
  const avgClicks =
    published.length > 0 ? published.reduce((a, p) => a + p.clicks, 0) / published.length : 0;

  // --- Poids des sources : ±0.1 par cycle, borné 0.5-2.0 --------------------
  const sourcesAdjusted: LearnSummary['sourcesAdjusted'] = [];
  const bySource = new Map<number, PostPerf[]>();
  for (const p of published) {
    if (p.sourceId === null) continue;
    bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p]);
  }
  for (const [sourceId, list] of bySource) {
    if (list.length < MIN_POSTS_PER_SOURCE) continue;
    const avg = list.reduce((a, p) => a + p.clicks, 0) / list.length;
    const source = db.select().from(schema.newsSources).where(eq(schema.newsSources.id, sourceId)).get();
    if (!source) continue;
    const delta = avg > avgClicks * 1.2 ? 0.1 : avg < avgClicks * 0.8 ? -0.1 : 0;
    if (delta === 0) continue;
    const next = Math.min(2, Math.max(0.5, Math.round((source.weight + delta) * 10) / 10));
    if (next !== source.weight) {
      db.update(schema.newsSources).set({ weight: next }).where(eq(schema.newsSources.id, sourceId)).run();
      sourcesAdjusted.push({ name: source.name, from: source.weight, to: next });
    }
  }

  // --- Affinités de sujets : lissage vers une cible bornée 0.8-1.3 ----------
  const affinity = { ...getTopicAffinity() };
  const byTopic = new Map<string, { clicks: number; count: number; rejects: number }>();
  for (const p of perfs) {
    for (const topic of p.topics) {
      const key = topic.toLowerCase();
      const entry = byTopic.get(key) ?? { clicks: 0, count: 0, rejects: 0 };
      if (p.rejected) entry.rejects++;
      else {
        entry.clicks += p.clicks;
        entry.count++;
      }
      byTopic.set(key, entry);
    }
  }
  for (const [topic, entry] of byTopic) {
    if (entry.count + entry.rejects < 2) continue;
    const avg = entry.count > 0 ? entry.clicks / entry.count : 0;
    const rejectPenalty = entry.rejects * 0.05;
    const target = Math.min(
      1.3,
      Math.max(0.8, 1 + 0.3 * ((avg - avgClicks) / (avgClicks + 1)) - rejectPenalty),
    );
    const previous = affinity[topic] ?? 1;
    affinity[topic] = Math.round((previous * 0.7 + target * 0.3) * 100) / 100;
  }
  setTopicAffinity(affinity);

  logger.info({ posts: perfs.length, sourcesAdjusted, topics: Object.keys(affinity).length }, 'apprentissage terminé');
  return { postsAnalyzed: perfs.length, sourcesAdjusted, topics: affinity };
}
