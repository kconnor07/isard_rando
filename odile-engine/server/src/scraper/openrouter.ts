/**
 * Veille OpenRouter : les nouveaux modèles mis à disposition, le jour même.
 *
 * OpenRouter référence les modèles de tous les éditeurs (OpenAI, Anthropic, Google,
 * Mistral, DeepSeek, Qwen…) avec leur date d'apparition et leur prix : c'est le
 * détecteur de lancement le plus simple qui existe, sans clé ni flux RSS. Un modèle
 * n'est un sujet que si l'on peut dire ce qu'il change pour une PME — le scoring
 * éditorial s'en charge ; ici on ne fait que signaler ce qui vient d'arriver, avec
 * ce qu'il coûte et ce qu'il sait lire.
 */
import { fetchJson } from '../lib/http.js';
import type { FetchedItem } from './rss.js';

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  name: string;
  /** date d'apparition sur OpenRouter, en secondes Unix */
  created?: number;
  description?: string;
  context_length?: number;
  /** prix par token, en dollars, sous forme de chaîne */
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  hugging_face_id?: string | null;
}

/** Au-delà, l'arrivée d'un modèle n'est plus une nouvelle. */
export const FENETRE_JOURS = 10;

/** Variantes d'un même modèle (lot, gratuit, contexte étendu…) : pas une nouvelle en soi. */
const VARIANTE = /:(batch|free|extended|nitro|thinking|online|exacto|beta|preview)$/i;

/** Les éditeurs dont chaque sortie fait parler LinkedIn le jour même. */
const GRANDS_EDITEURS =
  /\b(openai|anthropic|google|gemini|mistral|meta|llama|deepseek|qwen|alibaba|x-?ai|grok|moonshot|kimi|zhipu|glm|minimax|nvidia|microsoft|amazon|nova|cohere|perplexity)\b/i;

/** Prix par million de tokens, arrondi au centime ; null si inconnu. */
export function prixParMillion(parToken: string | undefined | null): number | null {
  if (parToken === undefined || parToken === null || parToken === '') return null;
  const n = Number(parToken);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 100) / 100;
}

function contexteLisible(tokens: number): string {
  if (tokens >= 1_000_000) return `${(Math.round(tokens / 100_000) / 10).toLocaleString('fr-FR')} M de tokens`;
  return `${Math.round(tokens / 1000)} k tokens`;
}

/** Première phrase de la description, débarrassée des liens Markdown. */
export function premierePhrase(description: string | undefined): string {
  const texte = (description ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const m = texte.match(/^.{20,}?[.!?](?=\s|$)/);
  return (m ? m[0] : texte).trim().slice(0, 240);
}

function formaterPrix(prompt: number | null, completion: number | null): string | null {
  if (prompt === null && completion === null) return null;
  if (prompt === 0 && (completion === 0 || completion === null)) return 'gratuit';
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const parts: string[] = [];
  if (prompt !== null) parts.push(`${fmt(prompt)} $ par million de tokens en entrée`);
  if (completion !== null) parts.push(`${fmt(completion)} $ en sortie`);
  return parts.join(', ');
}

export function modelToItem(m: OpenRouterModel, now = new Date()): FetchedItem | null {
  if (!m.id || !m.name || !m.created) return null;
  if (VARIANTE.test(m.id)) return null;
  const date = new Date(m.created * 1000);
  const age = now.getTime() - date.getTime();
  if (Number.isNaN(age) || age < -3_600_000 || age > FENETRE_JOURS * 86_400_000) return null;

  const i = m.name.indexOf(':');
  const editeur = (i > 0 ? m.name.slice(0, i) : (m.id.split('/')[0] ?? '')).trim();
  const nom = (i > 0 ? m.name.slice(i + 1) : m.name).trim();
  if (!nom) return null;
  const prompt = prixParMillion(m.pricing?.prompt);
  const completion = prixParMillion(m.pricing?.completion);
  const prix = formaterPrix(prompt, completion);
  const ouvert = Boolean(m.hugging_face_id);
  const entrees = m.architecture?.input_modalities ?? m.architecture?.modality?.split('->')[0]?.split('+') ?? [];
  const sens = [
    entrees.includes('image') ? 'lit les images' : null,
    entrees.includes('file') ? 'lit les documents' : null,
    entrees.includes('audio') ? 'écoute l’audio' : null,
    entrees.includes('video') ? 'regarde la vidéo' : null,
  ].filter(Boolean);
  const morceaux = [
    `nouveau modèle disponible via OpenRouter, publié par ${editeur}`,
    m.context_length ? `contexte de ${contexteLisible(m.context_length)}` : null,
    prix,
    ouvert ? 'poids ouverts sur Hugging Face' : null,
    sens.length ? sens.join(', ') : null,
    premierePhrase(m.description) || null,
  ].filter(Boolean);
  const majeur = GRANDS_EDITEURS.test(`${editeur} ${m.id}`);
  return {
    url: `https://openrouter.ai/${m.id}`,
    title: `${nom} (${editeur}) — nouveau modèle${prix === 'gratuit' ? ' gratuit' : ''}${ouvert ? ' à poids ouverts' : ''}`,
    summary: morceaux.join(' · '),
    imageUrl: null,
    publishedAt: date.toISOString(),
    // Pas de signal social ici : la sortie d'un grand éditeur est chaude par nature,
    // un modèle de niche attend que la presse ou Hacker News le reprenne.
    engagement: majeur ? 45 : ouvert ? 35 : 25,
    engagementRaw: JSON.stringify({
      openrouterContexte: m.context_length ?? null,
      prixEntree: prompt,
      prixSortie: completion,
      poidsOuverts: ouvert,
    }),
  };
}

/** Une source OpenRouter : son URL est l'appel d'API qui liste tous les modèles. */
export async function fetchOpenRouter(url: string, now = new Date()): Promise<FetchedItem[]> {
  const data = await fetchJson<{ data?: OpenRouterModel[] }>(url, {
    headers: { 'user-agent': 'OdileEngine/1.0 (+https://odileai.com)', accept: 'application/json' },
    retries: 2,
    timeoutMs: 30_000,
  });
  const vus = new Set<string>();
  const items: FetchedItem[] = [];
  for (const m of [...(data.data ?? [])].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))) {
    const cle = m.canonical_slug ?? m.id;
    if (vus.has(cle)) continue;
    const item = modelToItem(m, now);
    if (!item) continue;
    vus.add(cle);
    items.push(item);
    if (items.length >= 40) break;
  }
  return items;
}
