import type { z } from 'zod';
import { getLlmRouting } from '../db/settingsRepo.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { anthropicProvider } from './anthropic.js';
import { geminiProvider } from './gemini.js';
import { mockProvider } from './mock.js';
import {
  extractJson,
  zodToPromptSchema,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './provider.js';

const providers: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  mock: mockProvider,
};

function chainFor(task: LlmRequest['task']): LlmProvider[] {
  if (config.LLM_MODE === 'mock') return [mockProvider];
  const routing = getLlmRouting();
  const primaryName =
    task === 'writing'
      ? routing.copywriting
      : task === 'scoring'
        ? routing.scoring
        : task === 'review'
          ? routing.visionFinal
          : task === 'vision_check'
            ? routing.vision
            : routing.copywriting;
  const primary = providers[primaryName] ?? anthropicProvider;
  const fallback = primary.name === 'anthropic' ? geminiProvider : anthropicProvider;
  const chain = [primary, fallback].filter((p) => p.isConfigured());
  if (chain.length === 0) {
    logger.warn('Aucune clé LLM configurée — bascule en mode mock');
    return [mockProvider];
  }
  return chain;
}

/** Plafond d'attente sur une limite de débit (au-delà, on bascule sur le repli). */
const MAX_RETRY_WAIT_MS = 25_000;

/**
 * Les API renvoient le délai d'attente sur un 429 (« Please retry in 13.2s »
 * ou `retryDelay: "13s"`). On le respecte une fois avant de basculer : sur les
 * quotas gratuits, la seconde tentative passe souvent.
 */
export function retryAfterMs(err: unknown): number {
  const text = String(err);
  if (!/429|RESOURCE_EXHAUSTED|rate.?limit/i.test(text)) return 0;
  const seconds =
    Number(/retry in ([0-9.]+)s/i.exec(text)?.[1]) ||
    Number(/"retryDelay"\s*:\s*"([0-9.]+)s"/i.exec(text)?.[1]) ||
    Number(/retry-after"?[:=]\s*"?([0-9.]+)/i.exec(text)?.[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const ms = Math.ceil(seconds * 1000) + 500;
  return ms <= MAX_RETRY_WAIT_MS ? ms : 0;
}

export async function completeText(req: LlmRequest): Promise<LlmResponse> {
  const chain = chainFor(req.task);
  let lastError: unknown;
  for (const provider of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const started = Date.now();
        const res = await provider.completeText(req);
        logger.debug(
          { provider: provider.name, model: res.model, task: req.task, ms: Date.now() - started, in: res.inputTokens, out: res.outputTokens },
          'appel LLM',
        );
        return res;
      } catch (err) {
        lastError = err;
        const wait = attempt === 0 ? retryAfterMs(err) : 0;
        if (wait > 0) {
          logger.warn({ provider: provider.name, task: req.task, waitMs: wait }, 'limite de débit — nouvelle tentative');
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        logger.warn({ provider: provider.name, task: req.task, err: String(err).slice(0, 300) }, 'échec LLM, fallback');
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Complétion JSON validée par zod : le schéma est injecté dans le prompt,
 * la réponse est extraite/parselée ; une nouvelle tentative est faite avec
 * le message d'erreur si la validation échoue.
 */
export async function completeJson<T>(
  req: LlmRequest,
  schema: z.ZodType<T>,
  opts: { attempts?: number } = {},
): Promise<{ value: T; model: string }> {
  const maxAttempts = Math.max(1, opts.attempts ?? 2);
  const jsonSchema = zodToPromptSchema(schema);
  const basePrompt = `${req.prompt}\n\nRéponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, pas de bloc de code) conforme à ce schéma JSON :\n${jsonSchema}`;
  let attemptPrompt = basePrompt;
  let lastModel = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await completeText({ ...req, prompt: attemptPrompt });
    lastModel = res.model;
    try {
      const parsed = schema.safeParse(JSON.parse(extractJson(res.text)));
      if (parsed.success) return { value: parsed.data, model: res.model };
      attemptPrompt = `${basePrompt}\n\nTa réponse précédente était invalide (${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(' ; ')}). Corrige et renvoie uniquement le JSON.`;
    } catch (err) {
      attemptPrompt = `${basePrompt}\n\nTa réponse précédente n'était pas un JSON parsable (${String(
        err,
      ).slice(0, 200)}). Renvoie uniquement le JSON.`;
    }
  }
  throw new Error(`Réponse LLM invalide après 2 tentatives (modèle ${lastModel}, tâche ${req.task})`);
}
