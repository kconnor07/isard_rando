import { z } from 'zod';

export type LlmTask = 'scoring' | 'writing' | 'review' | 'vision_check' | 'generic';

export interface LlmRequest {
  task: LlmTask;
  system?: string;
  prompt: string;
  /** images PNG/JPEG à joindre (analyse vision) */
  images?: { data: Buffer; mime: 'image/png' | 'image/jpeg' }[];
  maxTokens?: number;
  /** finale = modèle le plus capable du provider ; rapide sinon */
  tier?: 'fast' | 'best';
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  completeText(req: LlmRequest): Promise<LlmResponse>;
}

/** Extrait le premier objet/tableau JSON d'une réponse LLM (fences, prose autour…). */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) t = fence[1].trim();
  const firstBrace = Math.min(
    ...['{', '['].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))),
  );
  if (firstBrace === Infinity) return t;
  const open = t[firstBrace];
  const close = open === '{' ? '}' : ']';
  const lastClose = t.lastIndexOf(close);
  if (lastClose > firstBrace) return t.slice(firstBrace, lastClose + 1);
  return t;
}

/** Description JSON Schema compacte du schéma zod, à injecter dans le prompt. */
export function zodToPromptSchema(schema: z.ZodType): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    return '';
  }
}
