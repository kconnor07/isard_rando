import type { z } from 'zod';
import { getLlmRouting } from '../db/settingsRepo.js';
import { config } from '../config.js';
import { BudgetDepasseError, enregistrerUsage, verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { anthropicProvider } from './anthropic.js';
import { geminiProvider } from './gemini.js';
import { mockProvider } from './mock.js';
import {
  appliquerCorrections,
  corrigerDepassements,
  correctionsSchema,
  decrireIssues,
  extractJson,
  reparerJson,
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
  // Le plafond se vérifie avant l'appel : un dépassement est un choix de dépense,
  // pas une panne — il ne doit pas déclencher la chaîne de repli entre fournisseurs.
  const verdict = verifierBudget(req.task);
  if (!verdict.autorise) {
    logger.warn({ task: req.task, cout: verdict.consommation.cout, plafond: verdict.plafond }, 'appel LLM refusé par le budget');
    throw new BudgetDepasseError(verdict);
  }
  let lastError: unknown;
  for (const provider of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const started = Date.now();
        const res = await provider.completeText(req);
        enregistrerUsage({
          provider: provider.name,
          model: res.model,
          task: req.task,
          label: req.label,
          attempt: req.attempt ?? 1,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        });
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
 * Complétion JSON validée par zod. Le schéma est injecté dans le prompt ; la
 * réponse est extraite, réparée (syntaxe) puis validée.
 *
 * Quand elle ne passe pas, on n'écrit pas tout une seconde fois : d'abord les
 * dépassements modestes sont corrigés sans appel (chaîne coupée sur un mot,
 * tableau raccourci) ; ensuite le modèle reçoit SA réponse et la liste des défauts,
 * et ne renvoie que les champs à corriger (quelques lignes, pas un article) ; en
 * dernier recours seulement, tout est régénéré avec les défauts en consigne.
 * Une réponse coupée par max_tokens est régénérée en demandant plus court.
 * L'erreur finale dit la cause : le fondateur la lit sur le post ou l'article.
 */
export async function completeJson<T>(
  req: LlmRequest,
  schema: z.ZodType<T>,
  opts: { attempts?: number } = {},
): Promise<{ value: T; model: string }> {
  const maxAttempts = Math.max(1, opts.attempts ?? 2);
  const jsonSchema = zodToPromptSchema(schema);
  const basePrompt = `${req.prompt}\n\nRéponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, pas de bloc de code) conforme à ce schéma JSON — respecte les longueurs maximales (maxLength, maxItems), elles sont vérifiées :\n${jsonSchema}`;
  let lastModel = '';
  let cause = '';
  /** dernière réponse lisible (objet JSON) : sert de base à une correction ciblée */
  let precedent: { objet: unknown; texte: string } | null = null;
  let extrait = '';

  const valider = (objet: unknown): { ok: true; value: T } | { ok: false; issues: z.core.$ZodIssue[] } => {
    const parsed = schema.safeParse(objet);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, issues: parsed.error.issues };
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Une reprise coûte un appel : elle est comptée comme telle, à part.
    const cible =
      attempt === 0
        ? basePrompt
        : precedent
          ? `${req.prompt}\n\nTa réponse précédente (ci-dessous) est presque bonne mais invalide : ${cause}.\nNe la réécris pas. Renvoie UNIQUEMENT un objet JSON {"corrections":[{"path":"…","value":…}]} : un élément par champ à corriger, « path » étant le chemin indiqué (ex. "sections.2.paragraphs.1", "metaTitle"), « value » la nouvelle valeur complète de ce champ, conforme aux contraintes. Aucun autre texte.\n\nRÉPONSE PRÉCÉDENTE :\n${precedent.texte.slice(0, 60_000)}`
          : `${basePrompt}\n\nTa réponse précédente était inutilisable (${cause}). ${/tronqu/.test(cause) ? 'Fais plus court : ' : ''}Renvoie uniquement le JSON complet.`;
    const res = await completeText({ ...req, prompt: cible, attempt: attempt + 1 });
    lastModel = res.model;
    extrait = res.text.slice(0, 600);
    if (res.truncated) {
      cause = `réponse tronquée par la limite de ${req.maxTokens ?? 'jetons'} (max_tokens) après ${res.outputTokens ?? '?'} jetons`;
      precedent = null;
      continue;
    }
    // Correction ciblée : on applique les retouches à la réponse précédente
    if (attempt > 0 && precedent) {
      try {
        const patch = correctionsSchema.safeParse(JSON.parse(reparerJson(extractJson(res.text))));
        if (patch.success) {
          appliquerCorrections(precedent.objet, patch.data.corrections);
          const verdict = valider(precedent.objet);
          if (verdict.ok) return { value: verdict.value, model: res.model };
          corrigerDepassements(precedent.objet, verdict.issues);
          const encore = valider(precedent.objet);
          if (encore.ok) return { value: encore.value, model: res.model };
          cause = decrireIssues(encore.issues, precedent.objet);
          precedent = { objet: precedent.objet, texte: JSON.stringify(precedent.objet) };
          continue;
        }
      } catch {
        /* le modèle n'a pas renvoyé de corrections lisibles : on retombe sur la lecture normale */
      }
    }
    let objet: unknown;
    try {
      objet = JSON.parse(reparerJson(extractJson(res.text)));
    } catch (err) {
      cause = `JSON non parsable (${String(err).slice(0, 160)})`;
      precedent = null;
      continue;
    }
    const verdict = valider(objet);
    if (verdict.ok) return { value: verdict.value, model: res.model };
    // Dépassements modestes : réglés sur place, sans nouvel appel
    if (corrigerDepassements(objet, verdict.issues) > 0) {
      const encore = valider(objet);
      if (encore.ok) {
        logger.info({ task: req.task, label: req.label }, 'réponse JSON ajustée sans nouvel appel (longueurs)');
        return { value: encore.value, model: res.model };
      }
      cause = decrireIssues(encore.issues, objet);
    } else {
      cause = decrireIssues(verdict.issues, objet);
    }
    precedent = { objet, texte: JSON.stringify(objet) };
  }
  logger.warn({ task: req.task, label: req.label, model: lastModel, cause, extrait }, 'réponse LLM invalide');
  throw new Error(`Réponse LLM invalide après ${maxAttempts} tentatives (modèle ${lastModel}, tâche ${req.label ?? req.task}) — ${cause}`);
}
