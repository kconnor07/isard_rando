/**
 * Veille YouTube : les dernières vidéos des chaînes suivies.
 *
 * Le flux Atom public (feeds/videos.xml) est refusé aux serveurs : 404 ou 500 depuis
 * un centre de données, et le robots.txt de YouTube l'interdit aux robots. Il ne
 * marche que depuis un poste. Avec une clé YouTube Data API (gratuite, 10 000 unités
 * par jour, une unité par appel), on lit la liste des mises en ligne de chaque
 * chaîne ; sans clé, on retente le flux, qui marche encore depuis certains réseaux.
 * La clé voyage dans un en-tête, jamais dans l'adresse : elle ne finit ni dans les
 * journaux ni dans les messages d'erreur.
 */
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { fetchRss, type FetchedItem, type RssFetchResult } from './rss.js';

export function channelIdDe(url: string): string | null {
  try {
    const id = new URL(url).searchParams.get('channel_id');
    return id && /^UC[\w-]{20,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** La liste « mises en ligne » d'une chaîne porte le même identifiant, préfixé UU au lieu de UC. */
export function uploadsPlaylistDe(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

export interface YtPlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelTitle?: string;
    resourceId?: { videoId?: string };
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
  };
}

export function playlistItemToItem(it: YtPlaylistItem): FetchedItem | null {
  const s = it.snippet;
  const id = s?.resourceId?.videoId;
  const titre = s?.title?.trim();
  if (!s || !id || !titre || /^(Private|Deleted) video$/i.test(titre)) return null;
  return {
    url: `https://www.youtube.com/watch?v=${id}`,
    title: titre,
    summary: (s.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 800) || null,
    imageUrl: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? null,
    publishedAt: s.publishedAt ?? null,
  };
}

export function youtubeApiConfigured(): boolean {
  return Boolean(config.YOUTUBE_API_KEY);
}

export async function fetchYoutube(url: string, etag: string | null, lastModified: string | null): Promise<RssFetchResult> {
  const channelId = channelIdDe(url);
  if (!config.YOUTUBE_API_KEY || !channelId) return fetchRss(url, etag, lastModified);
  const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  api.searchParams.set('part', 'snippet');
  api.searchParams.set('playlistId', uploadsPlaylistDe(channelId));
  api.searchParams.set('maxResults', '10');
  const data = await fetchJson<{ items?: YtPlaylistItem[] }>(api.toString(), {
    headers: { 'user-agent': 'OdileEngine/1.0 (+https://odileai.com)', accept: 'application/json', 'x-goog-api-key': config.YOUTUBE_API_KEY },
    retries: 1,
    timeoutMs: 20_000,
  });
  const items: FetchedItem[] = [];
  for (const it of data.items ?? []) {
    const item = playlistItemToItem(it);
    if (item) items.push(item);
  }
  return { notModified: false, etag: null, lastModified: null, items };
}
