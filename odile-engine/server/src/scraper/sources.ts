import { db, schema } from '../db/client.js';

export interface SeedSource {
  name: string;
  kind: 'rss' | 'hn';
  url: string;
  lang: 'fr' | 'en';
  weight: number;
}

/**
 * Sources de veille par défaut. Elles vivent en base (news_sources) :
 * on peut en ajouter/désactiver depuis le dashboard sans toucher au code.
 */
export const SEED_SOURCES: SeedSource[] = [
  { name: 'TechCrunch AI', kind: 'rss', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', lang: 'en', weight: 1.2 },
  { name: 'VentureBeat AI', kind: 'rss', url: 'https://venturebeat.com/category/ai/feed/', lang: 'en', weight: 1.1 },
  { name: 'The Verge', kind: 'rss', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', weight: 1.0 },
  { name: "Ben's Bites", kind: 'rss', url: 'https://www.bensbites.com/feed', lang: 'en', weight: 1.3 },
  { name: 'The Rundown AI', kind: 'rss', url: 'https://www.therundown.ai/feed', lang: 'en', weight: 1.2 },
  { name: 'OpenAI Blog', kind: 'rss', url: 'https://openai.com/news/rss.xml', lang: 'en', weight: 1.1 },
  { name: 'Google AI Blog', kind: 'rss', url: 'https://blog.google/technology/ai/rss/', lang: 'en', weight: 1.0 },
  { name: 'MIT Tech Review AI', kind: 'rss', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', lang: 'en', weight: 1.0 },
  { name: 'Product Hunt', kind: 'rss', url: 'https://www.producthunt.com/feed', lang: 'en', weight: 0.9 },
  { name: 'Hacker News (IA)', kind: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40', lang: 'en', weight: 1.0 },
  { name: 'Maddyness', kind: 'rss', url: 'https://www.maddyness.com/feed/', lang: 'fr', weight: 1.3 },
  { name: 'Usine Digitale', kind: 'rss', url: 'https://www.usine-digitale.fr/rss', lang: 'fr', weight: 1.2 },
  { name: 'JDN Intelligence artificielle', kind: 'rss', url: 'https://www.journaldunet.com/rss/', lang: 'fr', weight: 1.0 },
  { name: 'Blog du Modérateur', kind: 'rss', url: 'https://www.blogdumoderateur.com/feed/', lang: 'fr', weight: 1.1 },
];

/** Insère les sources par défaut si la table est vide. */
export function seedSourcesIfEmpty(): number {
  const existing = db.select({ id: schema.newsSources.id }).from(schema.newsSources).all();
  if (existing.length > 0) return 0;
  for (const s of SEED_SOURCES) {
    db.insert(schema.newsSources).values(s).run();
  }
  return SEED_SOURCES.length;
}
