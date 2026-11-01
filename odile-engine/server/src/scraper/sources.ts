import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { rechercheBluesky } from './bluesky.js';

export interface SeedSource {
  name: string;
  kind: 'rss' | 'hn' | 'youtube' | 'reddit' | 'github' | 'hf' | 'openrouter' | 'bluesky' | 'mastodon';
  url: string;
  lang: 'fr' | 'en';
  weight: number;
  enabled?: boolean;
}

/**
 * Recherche d'actualités par mots-clés (Bing Actualités, en français) : tous les
 * médias français à la fois — presse régionale, Les Echos, JDN, Batiactu, Bpifrance…
 * Une requête simple par source (Bing n'accepte pas les « OU » dans son flux RSS).
 */
export function rechercheActus(requete: string): string {
  return `https://www.bing.com/news/search?${new URLSearchParams({ q: requete, format: 'rss', setlang: 'fr', cc: 'FR', mkt: 'fr-FR' })}`;
}

const RECHERCHES_ACTUS: [string, string, number][] = [
  ['Actus · PME & IA', 'PME intelligence artificielle', 1.3],
  ['Actus · TPE & IA', 'TPE intelligence artificielle', 1.3],
  ['Actus · artisans & IA', 'artisans intelligence artificielle', 1.2],
  ['Actus · commerçants & IA', 'commerçants IA', 1.2],
  ['Actus · automatisation en PME', 'PME automatisation', 1.3],
  ['Actus · IA et gain de temps', 'IA gain de temps entreprise', 1.2],
  ['Actus · facturation électronique', 'facturation électronique PME', 1.3],
  ['Actus · AI Act & PME', 'AI Act PME', 1.2],
  ['Actus · Toulouse & IA', 'Toulouse intelligence artificielle', 1.4],
];

/**
 * L'actualité IA du moment, celle dont tout le monde parle (et qui fait cliquer) :
 * les grands acteurs et les usages qui font les gros titres. Ces recherches ne
 * gardent que les articles de moins de trois jours et repassent toutes les 3 h.
 */
export const TENDANCES_IA: [string, string, number][] = [
  ['Tendances IA · à la une', 'intelligence artificielle', 1.3],
  ['Tendances IA · ChatGPT', 'ChatGPT', 1.3],
  ['Tendances IA · OpenAI', 'OpenAI', 1.3],
  ['Tendances IA · Claude', 'Claude Anthropic', 1.2],
  ['Tendances IA · Gemini', 'Google Gemini', 1.2],
  ['Tendances IA · Mistral', 'Mistral AI', 1.2],
  ['Tendances IA · Copilot', 'Copilot Microsoft', 1.1],
  ['Tendances IA · agents', 'agents IA', 1.3],
];

/** Une source « tendance » : rafraîchie plus souvent, et seulement sur l'ultra-récent. */
export function estTendanceIA(nom: string): boolean {
  return /^Tendances IA · /.test(nom);
}

/** Le flux Product Hunt filtré sur l'IA : le flux général noie les lancements IA dans tout le reste. */
export const PRODUCT_HUNT_IA = 'https://www.producthunt.com/feed?category=artificial-intelligence';

/**
 * Sources de veille par défaut. Elles vivent en base (news_sources) :
 * on peut en ajouter/désactiver depuis le dashboard sans toucher au code.
 */
export const SEED_SOURCES: SeedSource[] = [
  { name: 'TechCrunch AI', kind: 'rss', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', lang: 'en', weight: 1.2 },
  { name: 'VentureBeat AI', kind: 'rss', url: 'https://venturebeat.com/category/ai/feed/', lang: 'en', weight: 1.1 },
  { name: 'The Verge', kind: 'rss', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', weight: 1.0, enabled: false },
  { name: "Ben's Bites", kind: 'rss', url: 'https://www.bensbites.com/feed', lang: 'en', weight: 1.3 },
  { name: 'The Rundown AI', kind: 'rss', url: 'https://www.therundown.ai/feed', lang: 'en', weight: 1.2 },
  { name: 'OpenAI Blog', kind: 'rss', url: 'https://openai.com/news/rss.xml', lang: 'en', weight: 1.1 },
  { name: 'Google AI Blog', kind: 'rss', url: 'https://blog.google/technology/ai/rss/', lang: 'en', weight: 1.0 },
  { name: 'MIT Tech Review AI', kind: 'rss', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', lang: 'en', weight: 1.0, enabled: false },
  { name: 'Product Hunt', kind: 'rss', url: PRODUCT_HUNT_IA, lang: 'en', weight: 0.9, enabled: false },
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
  // Veille v5 — ce qui monte sur Hacker News sans attendre la une : plus de 60 points
  // en moins de 24 h, c'est l'actu IA que LinkedIn reprendra demain.
  { name: 'Hacker News · IA qui monte (24 h)', kind: 'hn', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>60,created_at_i>{24h}&hitsPerPage=50', lang: 'en', weight: 1.1 },
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
  // Veille v5 — les laboratoires et éditeurs eux-mêmes (flux vérifiés le 1er novembre 2026) :
  // l'annonce arrive ici des heures avant la presse.
  { name: 'Google DeepMind', kind: 'rss', url: 'https://deepmind.google/blog/rss.xml', lang: 'en', weight: 1.0 },
  { name: 'Hugging Face Blog', kind: 'rss', url: 'https://huggingface.co/blog/feed.xml', lang: 'en', weight: 0.9 },
  { name: 'GitHub Blog', kind: 'rss', url: 'https://github.blog/feed/', lang: 'en', weight: 0.9 },
  { name: 'Simon Willison', kind: 'rss', url: 'https://simonwillison.net/atom/everything/', lang: 'en', weight: 1.0 },
  { name: 'The Decoder', kind: 'rss', url: 'https://the-decoder.com/feed/', lang: 'en', weight: 1.0 },
  // Veille v5 — la presse tech française grand public : c'est elle que lisent les dirigeants,
  // et c'est son angle (« ce que ça change pour vous ») que nos posts reprennent.
  { name: 'Numerama', kind: 'rss', url: 'https://www.numerama.com/feed/', lang: 'fr', weight: 1.1 },
  { name: '01net', kind: 'rss', url: 'https://www.01net.com/feed/', lang: 'fr', weight: 1.0 },
  { name: 'BFM Tech', kind: 'rss', url: 'https://www.bfmtv.com/rss/tech/', lang: 'fr', weight: 1.0 },
  { name: 'Le Monde · Pixels', kind: 'rss', url: 'https://www.lemonde.fr/pixels/rss_full.xml', lang: 'fr', weight: 1.1 },
  { name: 'Frandroid', kind: 'rss', url: 'https://www.frandroid.com/feed', lang: 'fr', weight: 0.9 },
  { name: 'Presse-citron', kind: 'rss', url: 'https://www.presse-citron.net/feed/', lang: 'fr', weight: 0.9 },
  { name: 'Journal du Geek', kind: 'rss', url: 'https://www.journaldugeek.com/feed/', lang: 'fr', weight: 0.9 },
  { name: 'Les Numériques', kind: 'rss', url: 'https://www.lesnumeriques.com/rss.xml', lang: 'fr', weight: 0.8 },
  { name: 'L’ADN', kind: 'rss', url: 'https://www.ladn.eu/feed/', lang: 'fr', weight: 1.0 },
  { name: 'ZDNet France', kind: 'rss', url: 'https://www.zdnet.fr/feeds/rss/actualites/', lang: 'fr', weight: 1.0 },
  { name: 'IT for Business', kind: 'rss', url: 'https://www.itforbusiness.fr/feed', lang: 'fr', weight: 1.0 },
  // Veille v3 — Reddit top quotidien (nécessite REDDIT_CLIENT_ID/SECRET, sinon ignoré)
  { name: 'Reddit · IA & automatisation', kind: 'reddit', url: 'r/artificial+OpenAI+automation+nocode/top?t=day&limit=25', lang: 'en', weight: 1.1 },
  // Veille GitHub — les dépôts qui prennent sur nos sujets. L'URL est la requête de
  // recherche ; « {60d} » devient la date d'il y a 60 jours au moment du passage.
  // Ce n'est pas de l'actu outil : c'est une capacité nouvelle qu'une PME peut mettre au travail.
  { name: 'GitHub · agents IA', kind: 'github', url: 'topic:ai-agents created:>{60d} stars:>150', lang: 'en', weight: 1.0 },
  { name: 'GitHub · automatisation & workflows', kind: 'github', url: 'topic:automation topic:ai created:>{90d} stars:>100', lang: 'en', weight: 1.1 },
  { name: 'GitHub · compétences & MCP (skills)', kind: 'github', url: 'topic:mcp created:>{60d} stars:>100', lang: 'en', weight: 1.0 },
  { name: 'GitHub · skills d’agents', kind: 'github', url: 'skills agent in:name,description,topics created:>{60d} stars:>60', lang: 'en', weight: 0.9 },
  // Veille v5 — les dépôts tout neufs qui explosent, quel que soit leur sujet (le filtre
  // IA fait le tri) : 300 étoiles en dix jours, c'est le dépôt dont tout le monde parle.
  { name: 'GitHub · nouveaux dépôts qui montent', kind: 'github', url: 'created:>{10d} stars:>300', lang: 'en', weight: 1.2 },
  { name: 'GitHub · outils n8n & Make', kind: 'github', url: 'n8n in:name,description,topics created:>{90d} stars:>40', lang: 'en', weight: 1.0 },
  // Veille v5 — Hugging Face : là où naissent les modèles dont LinkedIn parle le lendemain.
  { name: 'Hugging Face · modèles tendance', kind: 'hf', url: 'https://huggingface.co/api/models?sort=trendingScore&limit=25', lang: 'en', weight: 1.0 },
  { name: 'Hugging Face · papiers du jour', kind: 'hf', url: 'https://huggingface.co/api/daily_papers?limit=20', lang: 'en', weight: 0.8 },
  // Veille v6 — les sources primaires : l'annonce y paraît des heures avant la presse
  // (flux vérifiés le 1er novembre 2026 ; Mistral sert son RSS en text/plain, ça se lit quand même).
  { name: 'Mistral AI', kind: 'rss', url: 'https://mistral.ai/news/rss', lang: 'en', weight: 1.2 },
  { name: 'Google · Gemini', kind: 'rss', url: 'https://blog.google/products-and-platforms/products/gemini/rss/', lang: 'en', weight: 1.0 },
  { name: 'Meta Newsroom', kind: 'rss', url: 'https://about.fb.com/news/feed/', lang: 'en', weight: 0.8 },
  { name: 'Microsoft · Copilot', kind: 'rss', url: 'https://www.microsoft.com/en-us/copilot/blog/feed/', lang: 'en', weight: 0.9 },
  { name: 'GitHub · Changelog', kind: 'rss', url: 'https://github.blog/changelog/feed/', lang: 'en', weight: 0.8 },
  { name: 'GitHub · IA & ML', kind: 'rss', url: 'https://github.blog/ai-and-ml/feed/', lang: 'en', weight: 0.9 },
  { name: 'n8n · versions', kind: 'rss', url: 'https://github.com/n8n-io/n8n/releases.atom', lang: 'en', weight: 0.8 },
  { name: 'n8n · communauté', kind: 'rss', url: 'https://community.n8n.io/latest.rss', lang: 'en', weight: 0.6 },
  { name: 'Make · communauté', kind: 'rss', url: 'https://community.make.com/latest.rss', lang: 'en', weight: 0.6 },
  { name: 'Cursor · changelog', kind: 'rss', url: 'https://cursor.com/changelog/rss.xml', lang: 'en', weight: 0.8 },
  { name: 'LangChain Blog', kind: 'rss', url: 'https://www.langchain.com/blog/rss.xml', lang: 'en', weight: 0.8 },
  // OpenRouter liste les modèles de tous les éditeurs avec leur date d'arrivée et leur prix :
  // le détecteur de lancement le plus simple qui existe.
  { name: 'OpenRouter · nouveaux modèles', kind: 'openrouter', url: 'https://openrouter.ai/api/v1/models', lang: 'en', weight: 1.1 },
  // Veille v6 — ceux qui trient l'actu IA pour les autres (agrégateur, lettres du matin) :
  // une confirmation le lendemain, et l'angle « ce qui compte vraiment ».
  { name: 'Techmeme', kind: 'rss', url: 'https://www.techmeme.com/feed.xml', lang: 'en', weight: 1.0 },
  { name: 'TLDR AI', kind: 'rss', url: 'https://tldr.tech/api/rss/ai', lang: 'en', weight: 1.1 },
  { name: 'The Neuron', kind: 'rss', url: 'https://rss.beehiiv.com/feeds/N4eCstxvgX.xml', lang: 'en', weight: 1.0 },
  { name: 'Latent Space', kind: 'rss', url: 'https://www.latent.space/feed', lang: 'en', weight: 0.8 },
  { name: 'Import AI', kind: 'rss', url: 'https://importai.substack.com/feed', lang: 'en', weight: 0.8 },
  { name: 'Ars Technica · IA', kind: 'rss', url: 'https://arstechnica.com/ai/feed/', lang: 'en', weight: 1.0 },
  { name: 'MarkTechPost', kind: 'rss', url: 'https://www.marktechpost.com/feed/', lang: 'en', weight: 0.7 },
  // Veille v6 — la presse française spécialisée (IA, informatique d'entreprise, marketing)
  // et les lettres d'information IA en français.
  { name: 'Le Monde · Intelligence artificielle', kind: 'rss', url: 'https://www.lemonde.fr/intelligence-artificielle/rss_full.xml', lang: 'fr', weight: 1.2 },
  { name: 'Le Monde Informatique · IA', kind: 'rss', url: 'https://www.lemondeinformatique.fr/flux-rss/thematique/intelligence-artificielle/rss.xml', lang: 'fr', weight: 1.1 },
  { name: 'Developpez · IA', kind: 'rss', url: 'https://intelligence-artificielle.developpez.com/index/rss', lang: 'fr', weight: 0.8 },
  { name: 'Solutions Numériques', kind: 'rss', url: 'https://www.solutions-numeriques.com/feed/', lang: 'fr', weight: 0.9 },
  { name: 'LeMagIT', kind: 'rss', url: 'https://www.lemagit.fr/rss/ContentSyndication.xml', lang: 'fr', weight: 0.9 },
  { name: 'JDN · Web & Tech', kind: 'rss', url: 'https://www.journaldunet.com/web-tech/rss/', lang: 'fr', weight: 0.9 },
  { name: 'Codeur.com · blog', kind: 'rss', url: 'https://www.codeur.com/blog/feed/', lang: 'fr', weight: 0.8 },
  { name: 'LEPTIDIGITAL', kind: 'rss', url: 'https://www.leptidigital.fr/feed/', lang: 'fr', weight: 0.8 },
  { name: 'Webmarketing & co’m', kind: 'rss', url: 'https://www.webmarketing-com.com/feed', lang: 'fr', weight: 0.7 },
  { name: 'Abondance (SEO)', kind: 'rss', url: 'https://www.abondance.com/feed', lang: 'fr', weight: 0.8 },
  { name: 'IA-Pulse (lettre hebdo)', kind: 'rss', url: 'https://iapulse.substack.com/feed', lang: 'fr', weight: 0.9 },
  { name: 'La Lettre de Flint', kind: 'rss', url: 'https://rss.beehiiv.com/feeds/34rMwxKHj7.xml', lang: 'fr', weight: 0.9 },
  // Veille v6 — l'État et les régulateurs : aides, obligations, RGPD, AI Act, dits pour les TPE/PME.
  { name: 'France Num', kind: 'rss', url: 'https://www.francenum.gouv.fr/flux-rss-principal', lang: 'fr', weight: 1.0 },
  { name: 'DGE · entreprises.gouv.fr', kind: 'rss', url: 'https://www.entreprises.gouv.fr/rss.xml', lang: 'fr', weight: 0.8 },
  { name: 'CNIL', kind: 'rss', url: 'https://www.cnil.fr/fr/rss.xml', lang: 'fr', weight: 1.0 },
  { name: 'Hub France IA', kind: 'rss', url: 'https://www.hub-franceia.fr/feed/', lang: 'fr', weight: 0.7 },
  // Veille v6 — les signaux sociaux ouverts : Bluesky (une requête par entité, les meilleurs
  // posts des 24 dernières heures ; X ne se lit plus gratuitement) et les liens que le
  // Fédivers partage le plus. Un lien déjà en base compte alors comme un écho de plus.
  { name: 'Bluesky · intelligence artificielle (fr)', kind: 'bluesky', url: rechercheBluesky('intelligence artificielle', 'fr'), lang: 'fr', weight: 0.8 },
  { name: 'Bluesky · ChatGPT (fr)', kind: 'bluesky', url: rechercheBluesky('ChatGPT', 'fr'), lang: 'fr', weight: 0.8 },
  { name: 'Bluesky · OpenAI', kind: 'bluesky', url: rechercheBluesky('OpenAI'), lang: 'en', weight: 0.8 },
  { name: 'Bluesky · Anthropic', kind: 'bluesky', url: rechercheBluesky('Anthropic'), lang: 'en', weight: 0.8 },
  { name: 'Bluesky · Mistral', kind: 'bluesky', url: rechercheBluesky('Mistral AI'), lang: 'en', weight: 0.8 },
  { name: 'Bluesky · agents IA', kind: 'bluesky', url: rechercheBluesky('AI agents'), lang: 'en', weight: 0.7 },
  { name: 'Mastodon · liens tendance', kind: 'mastodon', url: 'https://mastodon.social/api/v1/trends/links?limit=40', lang: 'en', weight: 0.8 },
  { name: 'Mastodon · liens tendance (sigmoid.social)', kind: 'mastodon', url: 'https://sigmoid.social/api/v1/trends/links?limit=40', lang: 'en', weight: 0.8 },
  // Veille v4 — le terrain des PME françaises, par mots-clés, dans toute la presse.
  // Chaque requête a été vérifiée : elle ramène des articles de la semaine.
  ...RECHERCHES_ACTUS.map(([name, requete, weight]) => ({ name, kind: 'rss' as const, url: rechercheActus(requete), lang: 'fr' as const, weight })),
  ...TENDANCES_IA.map(([name, requete, weight]) => ({ name, kind: 'rss' as const, url: rechercheActus(requete), lang: 'fr' as const, weight })),
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
  // Une base qui reçoit les recherches d'actualités pour la première fois reçoit
  // aussi le rééquilibrage qui va avec (une seule fois : ensuite, le dashboard décide).
  const premiereFoisActus = existing.size > 0 && !RECHERCHES_ACTUS.some(([name]) => existing.has(name));
  // Les bases d'avant la veille v6 lisaient le flux Product Hunt général : on le recentre sur l'IA.
  db.update(schema.newsSources)
    .set({ url: PRODUCT_HUNT_IA })
    .where(and(eq(schema.newsSources.name, 'Product Hunt'), eq(schema.newsSources.url, 'https://www.producthunt.com/feed')))
    .run();
  let added = 0;
  for (const s of SEED_SOURCES) {
    if (existing.has(s.name)) continue;
    db.insert(schema.newsSources).values(s).run();
    added++;
  }
  if (premiereFoisActus) reequilibrerSources();
  return added;
}

/**
 * Veille v4 : les sources qui remontaient surtout de la tech générale, des levées de
 * fonds ou la promotion des éditeurs passent au second plan. Les poids ne font que
 * baisser (jamais au-dessus de ce que l'apprentissage a déjà décidé).
 */
export const REEQUILIBRAGE_V4: { name: string; weight?: number; enabled?: false }[] = [
  { name: 'The Verge', enabled: false },
  { name: 'Product Hunt', enabled: false },
  { name: 'MIT Tech Review AI', enabled: false },
  { name: 'YouTube · Micode', enabled: false },
  // Les annonces des grands acteurs de l'IA restent : c'est l'actualité qui fait cliquer.
  { name: 'TechCrunch AI', weight: 1.0 },
  { name: 'Google AI Blog', weight: 0.9 },
  { name: 'Hacker News (IA)', weight: 0.7 },
  { name: 'Zapier Blog', weight: 1.0 },
  { name: 'n8n Blog', weight: 1.0 },
  { name: 'GitHub · agents IA', weight: 0.8 },
  { name: 'GitHub · automatisation & workflows', weight: 0.8 },
  { name: 'GitHub · compétences & MCP (skills)', weight: 0.8 },
  { name: 'GitHub · skills d’agents', weight: 0.7 },
];

export function reequilibrerSources(): number {
  let n = 0;
  for (const r of REEQUILIBRAGE_V4) {
    const src = db.select().from(schema.newsSources).where(eq(schema.newsSources.name, r.name)).get();
    if (!src) continue;
    db.update(schema.newsSources)
      .set({
        ...(r.enabled === false ? { enabled: false } : {}),
        ...(r.weight !== undefined ? { weight: Math.min(src.weight, r.weight) } : {}),
      })
      .where(eq(schema.newsSources.id, src.id))
      .run();
    n++;
  }
  return n;
}
