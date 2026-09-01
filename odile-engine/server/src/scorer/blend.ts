/**
 * Mélange du score final d'un item de veille — fonction pure, testée :
 * scoreFinal = scoreLLM × poidsSource × fraîcheur × affinitéSujets + bonusEngagement
 */

export interface BlendInput {
  /** score LLM total (0-100) */
  scoreLLM: number;
  /** poids de la source (borné 0.5-2.0) */
  sourceWeight: number;
  /** date de publication (ou de récupération) ISO */
  publishedAt: string | null;
  /** instant de référence */
  now?: Date;
  /** multiplicateurs d'affinité par sujet (appris des clics), 0.8-1.3 */
  topicAffinity?: Record<string, number>;
  /** sujets de l'item */
  topics?: string[];
  /** engagement social normalisé 0-100 */
  engagement?: number | null;
}

export function freshnessFactor(publishedAt: string | null, now: Date): number {
  if (!publishedAt) return 0.9;
  const hours = (now.getTime() - new Date(publishedAt).getTime()) / 3_600_000;
  if (Number.isNaN(hours) || hours < 0) return 0.9;
  if (hours <= 12) return 1.0;
  if (hours >= 48) return 0.8;
  return 1.0 - ((hours - 12) / 36) * 0.2;
}

export function topicAffinityFactor(
  topics: string[] | undefined,
  affinity: Record<string, number> | undefined,
): number {
  if (!topics?.length || !affinity) return 1.0;
  const values = topics
    .map((t) => affinity[t.toLowerCase()])
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return 1.0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return clamp(avg, 0.8, 1.3);
}

export function blendScore(input: BlendInput): number {
  const weight = clamp(input.sourceWeight, 0.5, 2.0);
  const fresh = freshnessFactor(input.publishedAt, input.now ?? new Date());
  const affinity = topicAffinityFactor(input.topics, input.topicAffinity);
  const boost = clamp(input.engagement ?? 0, 0, 100) * 0.15;
  return Math.round((input.scoreLLM * weight * fresh * affinity + boost) * 10) / 10;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
