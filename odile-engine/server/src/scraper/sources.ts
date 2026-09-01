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
  // Veille v2 — angle outils/automatisation + presse FR (URLs vérifiées)
  { name: 'Zapier Blog', kind: 'rss', url: 'https://zapier.com/blog/feeds/latest/', lang: 'en', weight: 1.2 },
  { name: 'n8n Blog', kind: 'rss', url: 'https://blog.n8n.io/rss/', lang: 'en', weight: 1.2 },
  { name: 'ActuIA', kind: 'rss', url: 'https://www.actuia.com/feed/', lang: 'fr', weight: 1.3 },
  { name: 'FrenchWeb', kind: 'rss', url: 'https://www.frenchweb.fr/feed', lang: 'fr', weight: 1.1 },
  { name: 'Siècle Digital', kind: 'rss', url: 'https://siecledigital.fr/feed/', lang: 'fr', weight: 1.1 },
];

/**
 * Insère les sources par défaut manquantes (par nom) — les bases existantes
 * reçoivent donc les nouvelles sources au démarrage, sans écraser les
 * personnalisations (poids, activation) des sources déjà présentes.
 */
export function seedSourcesIfEmpty(): number {
  const existing = new Set(
    db.select({ name: schema.newsSources.name }).from(schema.newsSources).all().map((s) => s.name),
  );
  let added = 0;
  for (const s of SEED_SOURCES) {
    if (existing.has(s.name)) continue;
    db.insert(schema.newsSources).values(s).run();
    added++;
  }
  return added;
}
