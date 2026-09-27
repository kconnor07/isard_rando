/**
 * D'où vient l'information : le média à nommer (et à identifier) sur la ligne
 * « Source ». Un post sourcé est crédible ; un post qui cite « une étude
 * américaine » ne l'est pas, et ne rend rien au média qui l'a publiée.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/** La ligne « Source : … » d'une légende, remise sur le vrai média quand le modèle l'a inventée. */
export function corrigerLigneSource(caption: string, media: string | null): string {
  if (!media) return caption;
  const lignes = caption.split('\n');
  const i = lignes.findIndex((l) => /^\s*source\s*:/i.test(l));
  if (i === -1) return caption;
  if (lignes[i]!.toLowerCase().includes(media.toLowerCase())) return caption;
  lignes[i] = `Source : ${media}`;
  return lignes.join('\n');
}

/**
 * Le média et le titre de l'actualité d'origine : ce que la ligne « Source » doit dire.
 * Un flux qui agrège (recherche web, Reddit, Hacker News, posts LinkedIn, GitHub)
 * n'est pas un média : c'est le site de l'article qui l'est.
 */
export function sourceReelle(newsItemId: number | null): { media: string; titre: string; url: string } | null {
  if (!newsItemId) return null;
  const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsItemId)).get();
  if (!news) return null;
  const source = news.sourceId
    ? db.select({ name: schema.newsSources.name, kind: schema.newsSources.kind }).from(schema.newsSources).where(eq(schema.newsSources.id, news.sourceId)).get()
    : null;
  const parUrl = mediaDepuisUrl(news.url);
  const agregateur = !source || source.kind !== 'rss' || /recherche web|reddit|hacker news|linkedin|github|youtube \(vidéos|^actus ·|^tendances ia ·/i.test(source.name);
  // Une chaîne YouTube se cite par son nom : « Matt Wolfe (YouTube) ».
  const chaine = source?.kind === 'youtube' ? /·\s*(.+)$/.exec(source.name)?.[1]?.trim() : undefined;
  const media = chaine
    ? `${chaine} (YouTube)`
    : agregateur || mediaConnu(news.url)
      ? parUrl
      : source!.name.replace(/\s*\([^)]*\)\s*$/, '');
  return { media: media || parUrl, titre: news.title, url: news.url };
}

/** Les médias dont l'adresse ne dit pas le nom (« usine-digitale.fr » → « L'Usine Digitale »). */
const MEDIAS_CONNUS: Record<string, string> = {
    'actuia.com': 'ActuIA',
    'journaldunet.com': 'JDN',
    'techcrunch.com': 'TechCrunch',
    'lesechos.fr': 'Les Echos',
    'frenchweb.fr': 'FrenchWeb',
    'siecledigital.fr': 'Siècle Digital',
    'maddyness.com': 'Maddyness',
    'theverge.com': 'The Verge',
    'wired.com': 'Wired',
    'venturebeat.com': 'VentureBeat',
    'zdnet.fr': 'ZDNet',
    'numerama.com': 'Numerama',
    '01net.com': '01net',
    'usine-digitale.fr': 'L’Usine Digitale',
    'blogdumoderateur.com': 'Blog du Modérateur',
    'openai.com': 'OpenAI',
    'anthropic.com': 'Anthropic',
    'blog.google': 'Google',
    'microsoft.com': 'Microsoft',
    'youtube.com': 'YouTube',
    'github.com': 'GitHub',
    'news.ycombinator.com': 'Hacker News',
    'reddit.com': 'Reddit',
    // Presse française que ramènent les recherches d'actualités
    'latribune.fr': 'La Tribune',
    'lopinion.fr': 'L’Opinion',
    'lemonde.fr': 'Le Monde',
    'lefigaro.fr': 'Le Figaro',
    'bfmtv.com': 'BFM',
    'ladepeche.fr': 'La Dépêche',
    'actu.fr': 'Actu.fr',
    'francebleu.fr': 'ici',
    'ici.fr': 'ici',
    'batiactu.com': 'Batiactu',
    'lemondeinformatique.fr': 'Le Monde Informatique',
    'journaldesentreprises.com': 'Le Journal des Entreprises',
    'lejournaldesentreprises.com': 'Le Journal des Entreprises',
    'bpifrance.fr': 'Bpifrance',
    'bigmedia.bpifrance.fr': 'Bpifrance Big Média',
    'francenum.gouv.fr': 'France Num',
    'economie.gouv.fr': 'Ministère de l’Économie',
    'travail-emploi.gouv.fr': 'Ministère du Travail',
    'entreprendre.service-public.fr': 'Service-Public Entreprendre',
    'cpme.fr': 'CPME',
    'medef.com': 'Medef',
    'cci.fr': 'CCI France',
    'daf-mag.fr': 'DAF Magazine',
    'decideurs-magazine.com': 'Décideurs Magazine',
    'challenges.fr': 'Challenges',
    'capital.fr': 'Capital',
    'toulouse.fr': 'Ville de Toulouse',
    'touleco.fr': 'ToulÉco',
    'objectifnews.latribune.fr': 'Objectif News',
    'leparisien.fr': 'Le Parisien',
    'tf1info.fr': 'TF1 Info',
    'franceinfo.fr': 'franceinfo',
    'ouest-france.fr': 'Ouest-France',
    'sudouest.fr': 'Sud Ouest',
    'midilibre.fr': 'Midi Libre',
    '20minutes.fr': '20 Minutes',
    'liberation.fr': 'Libération',
    'huffingtonpost.fr': 'HuffPost',
    'ledevoir.com': 'Le Devoir',
    'clubic.com': 'Clubic',
    'journaldugeek.com': 'Journal du Geek',
    'frandroid.com': 'Frandroid',
    'lesnumeriques.com': 'Les Numériques',
    'presse-citron.net': 'Presse-citron',
    'korben.info': 'Korben',
};

function hoteDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Le site de l'article est-il un média que l'on sait nommer ? */
export function mediaConnu(url: string): boolean {
  return Boolean(MEDIAS_CONNUS[hoteDe(url)]);
}

/** Un nom de média lisible depuis l'adresse de l'article (« actuia.com » → « ActuIA »). */
export function mediaDepuisUrl(url: string): string {
  const hote = hoteDe(url);
  if (!hote) return '';
  if (MEDIAS_CONNUS[hote]) return MEDIAS_CONNUS[hote]!;
  const racine = hote.split('.').slice(-2, -1)[0] ?? hote;
  return racine ? racine.charAt(0).toUpperCase() + racine.slice(1) : hote;
}
