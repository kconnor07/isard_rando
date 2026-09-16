/**
 * Veille GitHub : les dépôts qui prennent, sur nos sujets.
 *
 * Pas de flux « tendances » officiel : on interroge la recherche de dépôts avec
 * une requête par source (sujet, ancienneté, étoiles), triée par étoiles. Sans
 * clé, GitHub accorde 10 requêtes par minute — largement assez pour un passage
 * horaire sur quelques sources ; `GITHUB_TOKEN` (facultatif) relève le plafond.
 *
 * Ce qu'on en tire n'est jamais « un outil sort » : c'est une capacité nouvelle,
 * une compétence qui se répand, une brique qu'une PME peut mettre au travail —
 * le scoring éditorial fait ensuite le tri, comme pour toute autre source.
 */
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import type { FetchedItem } from './rss.js';

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count?: number;
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at?: string;
  fork?: boolean;
  archived?: boolean;
}

const AI_PATTERN =
  /\b(ai|llm|gpt|claude|gemini|openai|anthropic|mistral|copilot|agent|agents|agentic|mcp|automation|workflow|rag|skill|skills|chatbot|assistant|n8n|zapier|make)\b/i;

/**
 * Remplace les repères d'ancienneté d'une requête (« {7d} », « {60d} ») par une
 * date ISO : les sources restent lisibles en base et la fenêtre glisse toute seule.
 */
export function resolveGithubQuery(template: string, now = new Date()): string {
  return template.replace(/\{(\d+)d\}/g, (_, jours: string) => {
    const d = new Date(now.getTime() - Number(jours) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

/** Un dépôt, lu comme une actualité : titre parlant, résumé factuel, traction en signal social. */
export function repoToItem(repo: GithubRepo): FetchedItem | null {
  if (repo.fork || repo.archived) return null;
  const texte = `${repo.full_name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`;
  if (!AI_PATTERN.test(texte)) return null;
  const nom = repo.full_name.split('/')[1] ?? repo.full_name;
  const description = (repo.description ?? '').trim();
  const morceaux = [
    `${repo.stargazers_count.toLocaleString('fr-FR')} étoiles GitHub`,
    repo.language ? `écrit en ${repo.language}` : null,
    repo.topics?.length ? `sujets : ${repo.topics.slice(0, 6).join(', ')}` : null,
  ].filter(Boolean);
  return {
    url: repo.html_url,
    title: description ? `${nom} — ${description.slice(0, 140)}` : nom,
    summary: morceaux.join(' · '),
    imageUrl: null,
    publishedAt: repo.created_at,
    // Même échelle que Hacker News / Reddit : 20·ln(1+signal), plafonné à 100.
    engagement: Math.min(100, Math.round(20 * Math.log(1 + repo.stargazers_count / 10))),
    engagementRaw: JSON.stringify({ githubStars: repo.stargazers_count, githubForks: repo.forks_count ?? 0 }),
  };
}

/** Recherche de dépôts GitHub pour une source (sa `url` est la requête, repères d'ancienneté compris). */
export async function fetchGithubRepos(queryTemplate: string): Promise<FetchedItem[]> {
  const q = resolveGithubQuery(queryTemplate);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'OdileEngine/1.0',
    'x-github-api-version': '2022-11-28',
  };
  if (config.GITHUB_TOKEN) headers.authorization = `Bearer ${config.GITHUB_TOKEN}`;
  const data = await fetchJson<{ items?: GithubRepo[] }>(url, { headers, retries: 1, timeoutMs: 20_000 });
  const items: FetchedItem[] = [];
  for (const repo of data.items ?? []) {
    const item = repoToItem(repo);
    if (item) items.push(item);
  }
  return items;
}
