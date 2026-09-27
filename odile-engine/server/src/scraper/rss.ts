import Parser from 'rss-parser';
import { fetchWithRetry } from '../lib/http.js';

export interface FetchedItem {
  url: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  /** Signaux sociaux déjà connus au moment du scrape (ex. score Reddit) */
  engagement?: number | null;
  engagementRaw?: string | null;
}

export interface RssFetchResult {
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  items: FetchedItem[];
}

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['content:encoded', 'contentEncoded'],
      // Flux Atom YouTube : description et miniature dans media:group
      ['media:group', 'mediaGroup'],
    ],
  },
});

/** Récupère un flux RSS avec requête conditionnelle (ETag / Last-Modified). */
export async function fetchRss(
  url: string,
  etag: string | null,
  lastModified: string | null,
  options: { ageMaxJours?: number } = {},
): Promise<RssFetchResult> {
  const headers: Record<string, string> = {
    'user-agent': 'OdileEngine/1.0 (+https://odileai.com)',
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;

  const res = await fetchWithRetry(url, { headers, retries: 2, timeoutMs: 20_000 });
  if (res.status === 304) {
    await res.body?.cancel();
    return { notModified: true, etag, lastModified, items: [] };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const xml = await res.text();
  const recherche = estRechercheActus(url);
  // Bing répond parfois par une page vide au lieu du flux quand on l'interroge trop
  // souvent : ce n'est pas une panne de la source, juste « rien cette fois-ci ».
  if (recherche && !/<rss|<feed/i.test(xml.slice(0, 2000))) {
    return { notModified: true, etag, lastModified, items: [] };
  }
  const feed = await parser.parseString(xml);
  const ageMax = (options.ageMaxJours ?? (recherche ? AGE_MAX_RECHERCHE_JOURS : AGE_MAX_JOURS)) * 86400_000;

  const items: FetchedItem[] = [];
  for (const item of feed.items ?? []) {
    const link = lienReel(item.link?.trim() ?? '');
    const title = item.title?.trim();
    if (!link || !title) continue;
    // MSN republie les articles des autres : la source citée serait fausse, et
    // l'original est presque toujours dans la même recherche.
    if (recherche && /(^|\.)msn\.com$/i.test(hoteDe(link))) continue;
    const date = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
    // Une recherche d'actualités remonte aussi des articles d'il y a deux ans.
    if (date && Date.now() - new Date(date).getTime() > ageMax) continue;
    const media = (item as unknown as Record<string, unknown>).mediaContent as
      | { $?: { url?: string } }
      | undefined;
    const group = (item as unknown as Record<string, unknown>).mediaGroup as
      | { 'media:description'?: string[]; 'media:thumbnail'?: { $?: { url?: string } }[] }
      | undefined;
    items.push({
      url: link,
      title,
      summary:
        stripHtml(item.contentSnippet ?? item.summary ?? group?.['media:description']?.[0] ?? '').slice(0, 800) ||
        null,
      imageUrl: item.enclosure?.url ?? media?.$?.url ?? group?.['media:thumbnail']?.[0]?.$?.url ?? null,
      publishedAt: date,
    });
  }
  return {
    notModified: false,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    items,
  };
}

/** Au-delà, un article n'est plus de l'actualité pour la veille. */
const AGE_MAX_JOURS = 45;
const AGE_MAX_RECHERCHE_JOURS = 10;

/** Flux d'une recherche d'actualités par mots-clés (Bing Actualités). */
export function estRechercheActus(url: string): boolean {
  return /^https?:\/\/(www\.)?bing\.com\/news\/search/i.test(url);
}

/**
 * L'adresse de l'article lui-même : Bing Actualités fait passer chaque lien par un
 * compteur de clics (apiclick.aspx?…&url=<article>). Sans ce décodage, on lirait la
 * page de Bing au lieu de l'article, et la source citée serait « bing.com ».
 */
export function lienReel(link: string): string {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/i.test(u.hostname)) {
      const cible = u.searchParams.get('url');
      if (cible && /^https?:\/\//i.test(cible)) return cible;
    }
  } catch {
    /* lien relatif ou illisible : on le garde tel quel */
  }
  return link;
}

function hoteDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
