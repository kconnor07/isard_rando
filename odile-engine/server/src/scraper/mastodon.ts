/**
 * Veille Mastodon : les liens que le Fédivers partage le plus en ce moment.
 *
 * mastodon.social (et sigmoid.social, l'instance des chercheurs en IA) publient leurs
 * tendances sans clé, à 300 requêtes par 5 minutes : un article repris par des
 * dizaines de comptes distincts en un jour est une actualité qui circule. On ne garde
 * que l'IA, et le nombre de comptes fait le signal. Le lien lui-même fait écho aux
 * articles déjà remontés par la presse.
 */
import { fetchJson } from '../lib/http.js';
import { AI_PATTERN } from './hackernews.js';
import type { FetchedItem } from './rss.js';

export interface MastoLink {
  url: string;
  title?: string;
  description?: string;
  provider_name?: string;
  published_at?: string | null;
  image?: string | null;
  /** du jour le plus récent au plus ancien ; valeurs servies en chaînes */
  history?: { day: string; accounts: string | number; uses: string | number }[];
}

const echelle = (x: number) => Math.min(100, Math.round(20 * Math.log(1 + Math.max(0, x))));

export function linkToItem(l: MastoLink): FetchedItem | null {
  if (!l.url || !/^https?:\/\//i.test(l.url)) return null;
  const titre = (l.title ?? '').replace(/\s+/g, ' ').trim();
  if (!titre) return null;
  const desc = (l.description ?? '').replace(/\s+/g, ' ').trim();
  if (!AI_PATTERN.test(`${titre} ${desc} ${l.url}`)) return null;
  const recent = (l.history ?? []).slice(0, 2);
  const comptes = recent.reduce((s, h) => s + (Number(h.accounts) || 0), 0);
  const partages = recent.reduce((s, h) => s + (Number(h.uses) || 0), 0);
  return {
    url: l.url,
    title: titre,
    summary: [desc || null, `partagé par ${comptes} comptes sur Mastodon en 48 h${l.provider_name ? ` (${l.provider_name})` : ''}`]
      .filter(Boolean)
      .join(' — '),
    imageUrl: l.image ?? null,
    publishedAt: l.published_at ?? null,
    engagement: echelle(comptes),
    engagementRaw: JSON.stringify({ mastoComptes: comptes, mastoPartages: partages }),
  };
}

/** Une source Mastodon : son URL est l'appel `trends/links` d'une instance. */
export async function fetchMastodonTrends(url: string): Promise<FetchedItem[]> {
  const data = await fetchJson<unknown>(url, {
    headers: { 'user-agent': 'OdileEngine/1.0 (+https://odileai.com)', accept: 'application/json' },
    retries: 2,
    timeoutMs: 20_000,
  });
  if (!Array.isArray(data)) return [];
  const items: FetchedItem[] = [];
  for (const brut of data) {
    const item = linkToItem(brut as MastoLink);
    if (item) items.push(item);
  }
  return items;
}
