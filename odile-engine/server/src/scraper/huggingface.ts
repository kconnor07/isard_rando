/**
 * Veille Hugging Face : les modèles qui montent et les papiers du jour.
 *
 * C'est là que naissent la plupart des « nouveaux modèles » dont LinkedIn parle le
 * lendemain (DeepSeek, Qwen, Mistral, les modèles de voix ou de vidéo). L'API Hub
 * est publique et sans clé : /api/models?sort=trendingScore donne le classement du
 * moment, /api/daily_papers les papiers mis en avant par la communauté. Le scoring
 * éditorial fait ensuite le tri — un modèle n'est un sujet que si l'on peut dire ce
 * qu'il change pour une entreprise.
 */
import { fetchJson } from '../lib/http.js';
import type { FetchedItem } from './rss.js';

export interface HfModel {
  id: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  createdAt?: string;
  pipeline_tag?: string;
  tags?: string[];
}

export interface HfPaper {
  paper: { id: string; title: string; summary?: string; upvotes?: number; publishedAt?: string };
  publishedAt?: string;
  submittedOnDailyAt?: string;
  numComments?: number;
}

/** Ce que fait un modèle, dit en français à partir de son étiquette Hugging Face. */
const TACHES: Record<string, string> = {
  'text-generation': 'génération de texte (assistant, agent)',
  'image-text-to-text': 'compréhension d’images et de documents',
  'text-to-image': 'génération d’images',
  'text-to-video': 'génération de vidéo',
  'image-to-video': 'animation d’images en vidéo',
  'automatic-speech-recognition': 'transcription de la parole',
  'text-to-speech': 'synthèse vocale',
  'audio-text-to-text': 'compréhension audio',
  'any-to-any': 'multimodal (texte, image, audio)',
  'feature-extraction': 'recherche sémantique (embeddings)',
  'sentence-similarity': 'recherche sémantique (embeddings)',
  'image-text-to-image': 'retouche d’images guidée',
  'document-question-answering': 'lecture de documents',
  'object-detection': 'détection d’objets dans des images',
  translation: 'traduction',
  summarization: 'résumé de textes',
  'text-ranking': 'classement de résultats de recherche',
};

/** 20·ln(1+x) plafonné à 100 : la même échelle que Hacker News, Reddit et GitHub. */
const echelle = (x: number) => Math.min(100, Math.round(20 * Math.log(1 + Math.max(0, x))));

export function modelToItem(m: HfModel): FetchedItem | null {
  if (!m.id || !m.id.includes('/')) return null;
  const [org, nom] = m.id.split('/') as [string, string];
  const tache = m.pipeline_tag ? (TACHES[m.pipeline_tag] ?? m.pipeline_tag.replace(/-/g, ' ')) : null;
  const likes = m.likes ?? 0;
  const dl = m.downloads ?? 0;
  const morceaux = [
    `modèle ouvert publié par ${org} sur Hugging Face`,
    tache ? `tâche : ${tache}` : null,
    `${likes.toLocaleString('fr-FR')} likes`,
    dl ? `${dl.toLocaleString('fr-FR')} téléchargements` : null,
    m.trendingScore ? `n° ${m.trendingScore} au score de tendance` : null,
  ].filter(Boolean);
  return {
    url: `https://huggingface.co/${m.id}`,
    title: `${nom} (${org})${tache ? ` — nouveau modèle ouvert : ${tache}` : ' — nouveau modèle ouvert'}`,
    summary: morceaux.join(' · '),
    imageUrl: null,
    publishedAt: m.createdAt ?? null,
    engagement: echelle(likes / 4 + dl / 2000),
    engagementRaw: JSON.stringify({ hfLikes: likes, hfDownloads: dl, hfTrending: m.trendingScore ?? 0 }),
  };
}

export function paperToItem(p: HfPaper): FetchedItem | null {
  const titre = p.paper?.title?.trim();
  if (!titre || !p.paper.id) return null;
  const upvotes = p.paper.upvotes ?? 0;
  const resume = (p.paper.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  return {
    url: `https://huggingface.co/papers/${p.paper.id}`,
    title: titre,
    summary: `${resume}${resume ? ' — ' : ''}papier du jour sur Hugging Face, ${upvotes} votes${p.numComments ? `, ${p.numComments} commentaires` : ''}`,
    imageUrl: null,
    publishedAt: p.publishedAt ?? p.paper.publishedAt ?? p.submittedOnDailyAt ?? null,
    engagement: echelle(upvotes),
    engagementRaw: JSON.stringify({ hfUpvotes: upvotes, hfComments: p.numComments ?? 0 }),
  };
}

/** Une source Hugging Face : son URL est l'appel d'API (modèles tendance ou papiers du jour). */
export async function fetchHuggingFace(url: string): Promise<FetchedItem[]> {
  const data = await fetchJson<unknown>(url, {
    headers: { 'user-agent': 'OdileEngine/1.0 (+https://odileai.com)', accept: 'application/json' },
    retries: 2,
    timeoutMs: 20_000,
  });
  if (!Array.isArray(data)) return [];
  const papiers = url.includes('daily_papers');
  const items: FetchedItem[] = [];
  for (const brut of data) {
    const item = papiers ? paperToItem(brut as HfPaper) : modelToItem(brut as HfModel);
    if (item) items.push(item);
  }
  return items;
}
