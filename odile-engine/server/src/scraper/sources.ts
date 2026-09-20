import { db, schema } from '../db/client.js';

export interface SeedSource {
  name: string;
  kind: 'rss' | 'hn' | 'youtube' | 'reddit' | 'github';
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
  // Côté client, pas côté technologie : ce que vivent les dirigeants de TPE/PME
  // françaises. C'est là que se trouvent les douleurs qu'Odile sait automatiser.
  { name: 'Dynamique Entrepreneuriale', kind: 'rss', url: 'https://www.dynamique-mag.com/feed', lang: 'fr', weight: 1.2 },
  { name: 'Petite Entreprise', kind: 'rss', url: 'https://www.petite-entreprise.net/feed', lang: 'fr', weight: 1.2 },
  // Ancrage toulousain : l'économie locale nourrit les posts et le référencement du blog.
  { name: 'ToulÉco (Toulouse)', kind: 'rss', url: 'https://www.touleco.fr/spip.php?page=backend', lang: 'fr', weight: 1.4 },
  // Les questions que les dirigeants posent vraiment (nécessite les clés Reddit ;
  // sans elles la source dort sans erreur).
  { name: 'Reddit — dirigeants de PME', kind: 'reddit', url: 'r/smallbusiness+Entrepreneur+freelance/top?t=day&limit=25', lang: 'en', weight: 1.2 },
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
  // Veille v3 — YouTube (IDs de chaînes vérifiés via leur flux Atom officiel)
  { name: 'YouTube · Matt Wolfe', kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UChpleBmo18P08aKCIgti38g', lang: 'en', weight: 1.2 },
  { name: 'YouTube · The AI Advantage', kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHhYXsLBEVVnbvsq57n1MTQ', lang: 'en', weight: 1.2 },
  { name: 'YouTube · AI Explained', kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw', lang: 'en', weight: 1.0 },
  { name: 'YouTube · Ludo IA²', kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCICO611QA-KLoV6iAQvca_w', lang: 'fr', weight: 1.3 },
  { name: 'YouTube · Micode', kind: 'youtube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYnvxJ-PKiGXo_tYXpWAC-w', lang: 'fr', weight: 0.9 },
  // Veille v3 — Reddit top quotidien (nécessite REDDIT_CLIENT_ID/SECRET, sinon ignoré)
  { name: 'Reddit · IA & automatisation', kind: 'reddit', url: 'r/artificial+OpenAI+automation+nocode/top?t=day&limit=25', lang: 'en', weight: 1.1 },
  // Veille GitHub — les dépôts qui prennent sur nos sujets. L'URL est la requête de
  // recherche ; « {60d} » devient la date d'il y a 60 jours au moment du passage.
  // Ce n'est pas de l'actu outil : c'est une capacité nouvelle qu'une PME peut mettre au travail.
  { name: 'GitHub · agents IA', kind: 'github', url: 'topic:ai-agents created:>{60d} stars:>150', lang: 'en', weight: 1.0 },
  { name: 'GitHub · automatisation & workflows', kind: 'github', url: 'topic:automation topic:ai created:>{90d} stars:>100', lang: 'en', weight: 1.1 },
  { name: 'GitHub · compétences & MCP (skills)', kind: 'github', url: 'topic:mcp created:>{60d} stars:>100', lang: 'en', weight: 1.0 },
  { name: 'GitHub · skills d’agents', kind: 'github', url: 'skills agent in:name,description,topics created:>{60d} stars:>60', lang: 'en', weight: 0.9 },
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
