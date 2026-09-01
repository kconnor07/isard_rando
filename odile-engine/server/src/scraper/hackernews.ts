import { fetchJson } from '../lib/http.js';
import type { FetchedItem } from './rss.js';

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  created_at: string;
  story_text: string | null;
}

const AI_PATTERN =
  /\b(ai|ia|llm|gpt|claude|gemini|openai|anthropic|mistral|copilot|agent|automation|automatisation|machine learning|deep ?learning|chatbot)\b/i;

/** Front page Hacker News (API Algolia), filtrée sur les sujets IA. */
export async function fetchHackerNews(apiUrl: string): Promise<FetchedItem[]> {
  const data = await fetchJson<{ hits: AlgoliaHit[] }>(apiUrl, {
    headers: { 'user-agent': 'OdileEngine/1.0' },
    retries: 2,
    timeoutMs: 20_000,
  });
  const items: FetchedItem[] = [];
  for (const hit of data.hits ?? []) {
    if (!hit.title || !AI_PATTERN.test(hit.title)) continue;
    const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
    items.push({
      url,
      title: hit.title,
      summary: hit.points != null ? `${hit.points} points sur Hacker News` : null,
      imageUrl: null,
      publishedAt: hit.created_at,
    });
  }
  return items;
}
