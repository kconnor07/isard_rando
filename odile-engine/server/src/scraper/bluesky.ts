/**
 * Veille Bluesky : ce que les comptes tech partagent dans les heures qui suivent.
 *
 * X ne se lit plus gratuitement ; Bluesky expose une recherche publique sans clé
 * (api.bsky.app, 3 000 requêtes par 5 minutes). Les comptes tech francophones y
 * relaient une annonce quelques heures après sa sortie, bien avant la presse. On
 * garde deux choses : le lien partagé — qui fait écho aux articles déjà en base — et
 * le nombre de likes et de reposts, qui mesure le buzz. Un post sans lien et sans
 * écho ne vaut pas un sujet.
 *
 * L'URL d'une source est l'appel de recherche ; « {24h} » y devient l'horodatage ISO
 * d'il y a 24 heures (paramètre `since`). La recherche n'accepte pas de « OU » : une
 * requête par entité.
 */
import { fetchJson } from '../lib/http.js';
import { AI_PATTERN } from './hackernews.js';
import type { FetchedItem } from './rss.js';

export interface BskyExternal {
  uri?: string;
  title?: string;
  description?: string;
  thumb?: string;
}

export interface BskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: { text?: string; createdAt?: string };
  embed?: { $type?: string; external?: BskyExternal; media?: { $type?: string; external?: BskyExternal } };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}

/** Signal minimal (likes + 2·reposts + réponses) pour retenir un post qui ne partage aucun lien. */
export const SIGNAL_MIN_SANS_LIEN = 8;

/** 20·ln(1+x) plafonné à 100 : la même échelle que Hacker News, Reddit et GitHub. */
const echelle = (x: number) => Math.min(100, Math.round(20 * Math.log(1 + Math.max(0, x))));

/** « {24h} » / « {7d} » dans l'URL de recherche → horodatage ISO encodé, pour `since` et `until`. */
export function resolveBskyQuery(url: string, now = new Date()): string {
  return url.replace(/\{(\d+)(h|d)\}/g, (_, n: string, unite: string) => {
    const ms = Number(n) * (unite === 'h' ? 3_600_000 : 86_400_000);
    return encodeURIComponent(new Date(now.getTime() - ms).toISOString());
  });
}

function hote(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Le lien partagé par le post (carte externe), s'il pointe hors de Bluesky. */
export function lienExterne(p: BskyPost): BskyExternal | null {
  const ext = p.embed?.external ?? p.embed?.media?.external ?? null;
  if (!ext?.uri || !/^https?:\/\//i.test(ext.uri)) return null;
  if (/(^|\.)bsky\.app$/i.test(hote(ext.uri))) return null;
  return ext;
}

export function postUrl(p: BskyPost): string {
  const rkey = p.uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
}

export function postToItem(p: BskyPost): FetchedItem | null {
  const texte = (p.record?.text ?? '').replace(/\s+/g, ' ').trim();
  const ext = lienExterne(p);
  if (!AI_PATTERN.test(`${texte} ${ext?.title ?? ''} ${ext?.description ?? ''}`)) return null;
  const likes = p.likeCount ?? 0;
  const reposts = p.repostCount ?? 0;
  const reponses = p.replyCount ?? 0;
  const signal = likes + 2 * reposts + reponses;
  if (!ext && signal < SIGNAL_MIN_SANS_LIEN) return null;
  const auteur = p.author.displayName?.trim() || p.author.handle;
  const premiere = texte.split(/(?<=[.!?])\s+/)[0] ?? texte;
  const titre = ext?.title?.trim() || premiere.slice(0, 140);
  if (!titre) return null;
  const citation = texte ? `« ${texte.slice(0, 280)}${texte.length > 280 ? '…' : ''} »` : '';
  const summary = [
    ext?.description?.replace(/\s+/g, ' ').trim() || null,
    `partagé sur Bluesky par ${auteur}${citation ? ` ${citation}` : ''}`,
    `${likes} likes, ${reposts} reposts`,
  ]
    .filter(Boolean)
    .join(' — ');
  return {
    url: ext?.uri ?? postUrl(p),
    title: titre,
    summary,
    imageUrl: ext?.thumb ?? null,
    publishedAt: p.record?.createdAt ?? null,
    engagement: echelle(signal),
    engagementRaw: JSON.stringify({ bskyLikes: likes, bskyReposts: reposts, bskyReponses: reponses, bskyAuteur: p.author.handle }),
  };
}

export async function fetchBluesky(url: string, now = new Date()): Promise<FetchedItem[]> {
  const data = await fetchJson<{ posts?: BskyPost[] }>(resolveBskyQuery(url, now), {
    headers: { 'user-agent': 'OdileEngine/1.0 (+https://odileai.com)', accept: 'application/json' },
    retries: 2,
    timeoutMs: 20_000,
  });
  const items: FetchedItem[] = [];
  for (const p of data.posts ?? []) {
    const item = postToItem(p);
    if (item) items.push(item);
  }
  return items;
}

/** Une recherche Bluesky prête à servir de source : les meilleurs posts des dernières 24 h sur un mot. */
export function rechercheBluesky(mot: string, lang?: 'fr' | 'en'): string {
  const params = new URLSearchParams({ q: mot, sort: 'top', limit: '50' });
  if (lang) params.set('lang', lang);
  // `since` est posé à part : son « {24h} » doit rester lisible en base, il est résolu au passage.
  return `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}&since={24h}`;
}
