import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { normalizeEngagement } from './engagement.js';
import type { FetchedItem } from './rss.js';

/**
 * Source Reddit « top du jour » via l'API officielle (OAuth application-only).
 * Reddit bloque les requêtes JSON anonymes depuis les datacenters : les clés
 * (gratuites, https://www.reddit.com/prefs/apps, type « script ») sont donc
 * requises — sans elles, la source est ignorée sans erreur.
 */

const USER_AGENT = 'odile-engine:veille:v1 (contact: engine@odileai.com)';
const MIN_SCORE = 20;

let cachedToken: { token: string; expiresAt: number } | null = null;

export function redditConfigured(): boolean {
  return Boolean(config.REDDIT_CLIENT_ID && config.REDDIT_CLIENT_SECRET);
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const basic = Buffer.from(`${config.REDDIT_CLIENT_ID}:${config.REDDIT_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth HTTP ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 };
  return data.access_token;
}

interface RedditPost {
  title: string;
  url: string;
  permalink: string;
  is_self: boolean;
  selftext?: string;
  score: number;
  num_comments: number;
  created_utc: number;
  stickied?: boolean;
  over_18?: boolean;
}

/** `sourcePath` : chemin relatif type "r/artificial+OpenAI/top?t=day&limit=25". */
export async function fetchRedditTop(sourcePath: string): Promise<FetchedItem[]> {
  const token = await getToken();
  const path = sourcePath.replace(/^\/+/, '').replace(/^https?:\/\/[^/]+\//, '');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://oauth.reddit.com/${path}${sep}raw_json=1`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status} sur ${path}`);
  const body = (await res.json()) as { data?: { children?: { data: RedditPost }[] } };

  const items: FetchedItem[] = [];
  for (const child of body.data?.children ?? []) {
    const p = child.data;
    if (!p?.title || p.stickied || p.over_18) continue;
    if (p.score < MIN_SCORE) continue;
    const permalink = `https://www.reddit.com${p.permalink}`;
    // Post-lien : on suit le lien externe (article/vidéo) ; post texte : le thread lui-même
    const url = p.is_self || !/^https?:/.test(p.url) ? permalink : p.url;
    items.push({
      url,
      title: p.title.slice(0, 300),
      summary: p.selftext ? p.selftext.replace(/\s+/g, ' ').slice(0, 600) : `Discussion Reddit — ${p.score} points, ${p.num_comments} commentaires (${permalink})`,
      imageUrl: null,
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      engagement: normalizeEngagement({ hnPoints: 0, hnComments: 0, redditScore: p.score, redditComments: p.num_comments }),
      engagementRaw: JSON.stringify({ redditScore: p.score, redditComments: p.num_comments }),
    });
  }
  logger.debug({ path, kept: items.length }, 'reddit top récupéré');
  return items;
}
