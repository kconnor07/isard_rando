/**
 * Ce qui chauffe : les actualités que plusieurs sources reprennent en même temps.
 *
 * Le fondateur voit passer sur LinkedIn une annonce d'OpenAI, un modèle qui sort,
 * un dépôt GitHub qui explose — et la veille ne lui en parlait pas, parce qu'un
 * article seul, noté pour sa pertinence PME, ne franchissait aucun seuil. Or le
 * signal d'une tendance n'est pas la pertinence : c'est la REPRISE. Ce module
 * regroupe les items des dernières heures qui racontent la même histoire (titres
 * proches, même acteur nommé), compte les médias, ajoute les signaux sociaux et la
 * fraîcheur, et rend les histoires les plus chaudes — avant même qu'elles soient
 * notées. Fonctions pures, testées ; la base et l'API les appellent.
 */
import { normalizeTitle, titleSimilarity } from '../scraper/dedupe.js';

export interface ItemBuzz {
  id: number;
  title: string;
  url: string;
  lang: string;
  sourceId: number | null;
  sourceName: string;
  publishedAt: string | null;
  fetchedAt: string;
  engagement: number | null;
  echoes: number;
  echoSources: number[];
  scoreTotal: number | null;
  scoreClick: number | null;
}

export interface Tendance {
  /** l'article à donner au rédacteur : le mieux noté, en français s'il y en a un */
  itemId: number;
  label: string;
  url: string;
  /** médias distincts qui en parlent, échos compris */
  medias: number;
  /** signal social le plus fort du groupe (0-100) */
  engagement: number;
  /** le classement : reprise, signaux sociaux, fraîcheur, potentiel de clic */
  chaleur: number;
  /** âge de l'article le plus récent, en heures */
  ageHeures: number;
  sources: string[];
  items: { id: number; title: string; url: string; source: string }[];
}

/** Les acteurs dont une même mention rapproche deux titres : « OpenAI lance… » et « … chez OpenAI ». */
const ACTEURS = [
  'openai', 'chatgpt', 'gpt', 'anthropic', 'claude', 'gemini', 'deepmind', 'mistral', 'meta', 'llama', 'deepseek', 'qwen',
  'alibaba', 'nvidia', 'microsoft', 'copilot', 'apple', 'amazon', 'perplexity', 'cursor', 'n8n', 'hugging', 'xai', 'grok',
  'sora', 'midjourney', 'runway', 'elevenlabs', 'notion', 'salesforce', 'altman', 'musk', 'zuckerberg', 'github', 'nano',
  'veo', 'codex', 'gemma', 'kimi', 'moonshot', 'manus', 'genspark', 'lovable', 'bolt', 'replit', 'vercel', 'figma', 'canva',
];
const SIMILARITE_SEULE = 0.4;
const SIMILARITE_AVEC_ACTEUR = 0.25;

function acteurs(titre: string): Set<string> {
  const mots = new Set(normalizeTitle(titre));
  return new Set(ACTEURS.filter((a) => mots.has(a)));
}

/** Deux titres racontent-ils la même histoire ? */
export function memeHistoire(a: string, b: string): boolean {
  const sim = titleSimilarity(a, b);
  if (sim >= SIMILARITE_SEULE) return true;
  if (sim < SIMILARITE_AVEC_ACTEUR) return false;
  const aa = acteurs(a);
  for (const x of acteurs(b)) if (aa.has(x)) return true;
  return false;
}

const heures = (iso: string | null, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / 3_600_000 : 999);

/** Le classement d'un groupe : la reprise d'abord, puis les signaux sociaux, la fraîcheur, le potentiel de clic. */
export function chaleur(args: { medias: number; engagement: number; ageHeures: number; click: number }): number {
  const reprise = 25 * Math.log(1 + Math.max(1, args.medias));
  const social = Math.min(100, Math.max(0, args.engagement)) * 0.35;
  const fraicheur = args.ageHeures <= 6 ? 15 : args.ageHeures <= 24 ? 10 : args.ageHeures <= 36 ? 4 : 0;
  const clic = Math.min(50, Math.max(0, args.click)) * 0.3;
  return Math.round((reprise + social + fraicheur + clic) * 10) / 10;
}

/**
 * Les histoires chaudes des dernières heures, les plus reprises d'abord.
 * Une histoire est « chaude » quand au moins deux médias la reprennent, ou quand
 * un seul article porte un fort signal social ou un fort potentiel de clic.
 */
export function tendancesDuMoment(items: ItemBuzz[], now = new Date(), limit = 8): Tendance[] {
  const groupes: ItemBuzz[][] = [];
  for (const item of [...items].sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0))) {
    const proche = groupes.find((g) => g.some((x) => memeHistoire(x.title, item.title)));
    if (proche) proche.push(item);
    else groupes.push([item]);
  }
  const tendances: Tendance[] = [];
  for (const g of groupes) {
    const sources = new Set<number>();
    const noms = new Set<string>();
    for (const it of g) {
      if (it.sourceId != null) sources.add(it.sourceId);
      for (const s of it.echoSources) sources.add(s);
      if (it.sourceName) noms.add(it.sourceName);
    }
    // Les échos sans source connue (anciens items) comptent quand même comme des médias.
    const echosSansSource = g.reduce((n, it) => n + Math.max(0, it.echoes - it.echoSources.length), 0);
    const medias = Math.max(1, sources.size + echosSansSource);
    const engagement = Math.max(0, ...g.map((it) => it.engagement ?? 0));
    const click = Math.max(0, ...g.map((it) => it.scoreClick ?? 0));
    const ageHeures = Math.min(...g.map((it) => heures(it.publishedAt ?? it.fetchedAt, now)));
    const chaud = medias >= 2 || engagement >= 45 || click >= 40;
    if (!chaud) continue;
    // Le principal : le mieux noté ; à note égale, le français d'abord (le rédacteur part de lui).
    const principal = [...g].sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0) || Number(b.lang === 'fr') - Number(a.lang === 'fr'))[0]!;
    const francais = g.find((it) => it.lang === 'fr');
    tendances.push({
      itemId: principal.id,
      label: (francais ?? principal).title,
      url: principal.url,
      medias,
      engagement,
      chaleur: chaleur({ medias, engagement, ageHeures, click }),
      ageHeures: Math.round(ageHeures * 10) / 10,
      sources: [...noms].slice(0, 6),
      items: g.slice(0, 8).map((it) => ({ id: it.id, title: it.title, url: it.url, source: it.sourceName })),
    });
  }
  return tendances.sort((a, b) => b.chaleur - a.chaleur).slice(0, limit);
}
