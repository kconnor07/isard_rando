import { fetchJson } from '../lib/http.js';
import type { FetchedItem } from './rss.js';

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments?: number | null;
  created_at: string;
  story_text: string | null;
}

/**
 * Ce qui, dans un titre Hacker News, parle d'IA. Les noms des modèles et des produits
 * comptent autant que le mot « AI » : « DeepSeek V4 », « Cursor 3 », « Sora » ou « un
 * nouveau Qwen » sont des actualités IA sans que le titre le dise.
 */
export const AI_PATTERN =
  /\b(ai|a\.i\.|ia|llms?|gpt\S*|chatgpt|claude\w*|gemini\w*|openai|anthropic|mistral\w*|copilot|agents?|agentic|automation|automatisation|machine[ -]learning|deep[ -]learning|chatbots?|neural|models?|transformers?|diffusion|deepseek\w*|qwen\w*|llama\w*|gemma\w*|grok\w*|xai|nvidia|cursor|codex|sora\w*|veo\w*|midjourney|whisper|rag|mcp|prompts?|prompting|hallucinat\w*|inference|fine-?tun\w*|benchmark\w*|robots?|humanoid|perplexity|hugging ?face|n8n|zapier|langchain|vibe coding|autonomous|speech|voice|text-to-\w+|ocr|embedding\w*|gpus?|tpus?|datacenters?|data centers?)\b/i;

/** Les repères temporels de l'URL (« {24h} », « {7d} ») deviennent un horodatage Unix. */
export function resolveHnQuery(url: string, now = new Date()): string {
  return url.replace(/\{(\d+)(h|d)\}/g, (_, n: string, unite: string) => {
    const ms = Number(n) * (unite === 'h' ? 3_600_000 : 86_400_000);
    return String(Math.floor((now.getTime() - ms) / 1000));
  });
}

/** Hacker News (API Algolia) : la une, ou les histoires récentes au-dessus d'un seuil de points, filtrées sur l'IA. */
export async function fetchHackerNews(apiUrl: string): Promise<FetchedItem[]> {
  const data = await fetchJson<{ hits: AlgoliaHit[] }>(resolveHnQuery(apiUrl), {
    headers: { 'user-agent': 'OdileEngine/1.0' },
    retries: 2,
    timeoutMs: 20_000,
  });
  const items: FetchedItem[] = [];
  for (const hit of data.hits ?? []) {
    if (!hit.title || !AI_PATTERN.test(hit.title)) continue;
    const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
    const points = hit.points ?? 0;
    const commentaires = hit.num_comments ?? 0;
    const texte = (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    items.push({
      url,
      title: hit.title,
      summary: `${texte}${texte ? ' — ' : ''}${points} points et ${commentaires} commentaires sur Hacker News`,
      imageUrl: null,
      publishedAt: hit.created_at,
      // Même échelle que les autres signaux sociaux : 20·ln(1+signal), plafonné à 100.
      engagement: Math.min(100, Math.round(20 * Math.log(1 + points + commentaires / 2))),
      engagementRaw: JSON.stringify({ hnPoints: points, hnComments: commentaires, redditScore: 0, redditComments: 0 }),
    });
  }
  return items;
}
