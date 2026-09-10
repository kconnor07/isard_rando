import sharp from 'sharp';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import {
  DEFAULT_FREEPIK_MODEL,
  findFreepikModel,
  type FreepikAspect,
  type FreepikQuality,
} from './freepikCatalog.js';

/**
 * Freepik / Magnific API : génération (catalogue de modèles) et édition
 * d'images (upscale, relight, style, extension, retouche par instruction,
 * détourage). Schéma commun : `POST` crée une tâche, on interroge son statut
 * jusqu'à `COMPLETED`, puis on télécharge l'image générée.
 */

export function freepikAvailable(): boolean {
  return Boolean(config.FREEPIK_API_KEY);
}

interface TaskJson {
  data?:
    | { task_id?: string; status?: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'; generated?: string[] }
    | { base64?: string }[];
  url?: string;
  high_resolution?: string;
  message?: string;
  error?: string;
}

function headers(): Record<string, string> {
  const key = config.FREEPIK_API_KEY ?? '';
  // Les deux en-têtes : l'API a été rebaptisée (Freepik → Magnific), les deux hôtes coexistent
  return { 'x-magnific-api-key': key, 'x-freepik-api-key': key, 'content-type': 'application/json' };
}

function base(): string {
  return config.FREEPIK_API_BASE.replace(/\/$/, '');
}

async function readJson(res: Response): Promise<TaskJson> {
  const text = await res.text();
  try {
    return JSON.parse(text) as TaskJson;
  } catch {
    return { message: text.slice(0, 200) };
  }
}

function explain(status: number, json: TaskJson, what: string): Error {
  const detail = json.message ?? json.error ?? 'erreur';
  const hint =
    status === 401 ? ' — clé FREEPIK_API_KEY invalide' : status === 402 || status === 403 ? ' — crédits ou droits insuffisants' : '';
  return new Error(`Freepik ${status} (${what}) : ${detail}${hint}`);
}

/**
 * Exécute une opération de l'API : renvoie les images produites (URLs ou
 * base64). Gère les réponses synchrones et les tâches à sonder.
 */
export async function runFreepikTask(
  path: string,
  body: Record<string, unknown>,
  opts: { what?: string; timeoutMs?: number } = {},
): Promise<{ urls: string[]; base64: string[] }> {
  const what = opts.what ?? path;
  const endpoint = `${base()}${path}`;
  const created = await fetch(endpoint, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const json = await readJson(created);
  if (!created.ok) throw explain(created.status, json, what);

  // Réponses synchrones : détourage (url), ou tableau de base64
  if (json.url || json.high_resolution) return { urls: [json.high_resolution ?? json.url!], base64: [] };
  if (Array.isArray(json.data)) {
    const b64 = json.data.map((d) => d.base64).filter(Boolean) as string[];
    if (b64.length) return { urls: [], base64: b64 };
  }
  const data = Array.isArray(json.data) ? undefined : json.data;
  const taskId = data?.task_id;
  if (!taskId) throw new Error(`Freepik (${what}) : réponse sans task_id`);

  const started = Date.now();
  const limit = opts.timeoutMs ?? 300_000;
  let status = data?.status ?? 'CREATED';
  let generated = data?.generated ?? [];
  while (status !== 'COMPLETED' && Date.now() - started < limit) {
    await new Promise((r) => setTimeout(r, status === 'CREATED' ? 4000 : 3000));
    const res = await fetch(`${endpoint}/${taskId}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    const poll = await readJson(res);
    if (!res.ok) throw explain(res.status, poll, `tâche ${what}`);
    const d = Array.isArray(poll.data) ? undefined : poll.data;
    status = d?.status ?? status;
    generated = d?.generated ?? generated;
    if (status === 'FAILED') throw new Error(`Freepik (${what}) : tâche en échec`);
  }
  if (status !== 'COMPLETED' || !generated[0]) throw new Error(`Freepik (${what}) : délai dépassé sans image`);
  logger.info({ what, ms: Date.now() - started }, 'tâche Freepik terminée');
  return { urls: generated, base64: [] };
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`Freepik : téléchargement impossible (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function firstImage(result: { urls: string[]; base64: string[] }): Promise<Buffer> {
  if (result.base64[0]) return Buffer.from(result.base64[0], 'base64');
  if (result.urls[0]) return downloadImage(result.urls[0]);
  throw new Error('Freepik : aucune image dans la réponse');
}

// --- Génération ---------------------------------------------------------------

export async function generateViaFreepik(
  modelId: string,
  prompt: string,
  opts: { aspect?: FreepikAspect; quality?: FreepikQuality } = {},
): Promise<{ buffer: Buffer; model: string; tokens: number }> {
  const model = findFreepikModel(modelId) ?? findFreepikModel(DEFAULT_FREEPIK_MODEL)!;
  const body = model.body(prompt, { aspect: opts.aspect ?? '4:5', quality: opts.quality ?? 'pro' });
  const t0 = Date.now();
  const result = await runFreepikTask(model.path, body, { what: model.label });
  const buffer = await firstImage(result);
  logger.info({ model: model.id, ms: Date.now() - t0, bytes: buffer.length }, 'image Freepik générée');
  return { buffer, model: `freepik/${model.id}`, tokens: 0 };
}

// --- Édition --------------------------------------------------------------------

export type FreepikEditOp =
  | 'upscale-creative'
  | 'upscale-precision'
  | 'relight'
  | 'style-transfer'
  | 'expand'
  | 'edit-prompt'
  | 'remove-background';

export const FREEPIK_EDIT_OPS: { id: FreepikEditOp; label: string; needsPrompt: boolean; needsReference: boolean; hint: string }[] = [
  { id: 'upscale-creative', label: 'Upscale créatif ×2', needsPrompt: false, needsReference: false, hint: 'Magnific : détails réinventés, rendu spectaculaire' },
  { id: 'upscale-precision', label: 'Upscale précision ×2', needsPrompt: false, needsReference: false, hint: 'Magnific : fidèle, sans invention' },
  { id: 'edit-prompt', label: 'Modifier par instruction', needsPrompt: true, needsReference: false, hint: 'Décrivez le changement (Flux.2 Klein)' },
  { id: 'relight', label: 'Rééclairer', needsPrompt: true, needsReference: false, hint: "Décrivez la lumière (ex : « lumière rasante dorée »)" },
  { id: 'style-transfer', label: 'Transférer un style', needsPrompt: false, needsReference: true, hint: "Le style d'une autre image de la bibliothèque" },
  { id: 'expand', label: 'Étendre au format 4:5', needsPrompt: false, needsReference: false, hint: 'Complète les bords manquants (Seedream)' },
  { id: 'remove-background', label: 'Détourer (Magnific)', needsPrompt: false, needsReference: false, hint: 'Alternative au détourage local' },
];

export interface FreepikEditParams {
  prompt?: string;
  reference?: Buffer;
  /** URL publique de l'image (détourage Magnific) */
  publicUrl?: string;
}

/** Applique une opération d'édition et renvoie l'image résultante. */
export async function editViaFreepik(op: FreepikEditOp, image: Buffer, params: FreepikEditParams = {}): Promise<Buffer> {
  const b64 = image.toString('base64');
  switch (op) {
    case 'upscale-creative':
      return firstImage(
        await runFreepikTask(
          '/v1/ai/image-upscaler',
          { image: b64, scale_factor: '2x', optimized_for: 'standard', engine: 'automatic', ...(params.prompt ? { prompt: params.prompt } : {}) },
          { what: 'upscale créatif', timeoutMs: 420_000 },
        ),
      );
    case 'upscale-precision':
      return firstImage(
        await runFreepikTask('/v1/ai/image-upscaler-precision', { image: b64 }, { what: 'upscale précision', timeoutMs: 420_000 }),
      );
    case 'relight':
      return firstImage(
        await runFreepikTask(
          '/v1/ai/image-relight',
          { image: b64, prompt: params.prompt ?? 'lumière douce de studio', style: 'standard', preserve_details: true },
          { what: 'relight' },
        ),
      );
    case 'style-transfer': {
      if (!params.reference) throw new Error('Image de référence requise pour le transfert de style');
      return firstImage(
        await runFreepikTask(
          '/v1/ai/image-style-transfer',
          {
            image: b64,
            reference_image: params.reference.toString('base64'),
            style_strength: 70,
            structure_strength: 50,
            flavor: 'faithful',
            engine: 'balanced',
            ...(params.prompt ? { prompt: params.prompt } : {}),
          },
          { what: 'transfert de style' },
        ),
      );
    }
    case 'expand': {
      // Complète l'image jusqu'au 4:5 en ajoutant des bords (max 2048 px par côté)
      const meta = await sharp(image).metadata();
      const w = meta.width ?? 1080;
      const h = meta.height ?? 1080;
      const targetH = Math.round((w * 5) / 4);
      let top = 0, bottom = 0, left = 0, right = 0;
      if (targetH > h) {
        const extra = Math.min(2048 * 2, targetH - h);
        top = Math.floor(extra / 2);
        bottom = extra - top;
      } else {
        const targetW = Math.round((h * 4) / 5);
        const extra = Math.min(2048 * 2, Math.max(0, targetW - w));
        left = Math.floor(extra / 2);
        right = extra - left;
      }
      if (top + bottom + left + right === 0) return image;
      return firstImage(
        await runFreepikTask(
          '/v1/ai/image-expand/seedream-v4-5',
          { image: b64, top, bottom, left, right, ...(params.prompt ? { prompt: params.prompt } : {}) },
          { what: 'extension' },
        ),
      );
    }
    case 'edit-prompt':
      if (!params.prompt) throw new Error('Instruction requise');
      return firstImage(
        await runFreepikTask(
          '/v1/ai/text-to-image/flux-2-klein',
          { prompt: params.prompt, input_image: b64, aspect_ratio: 'social_post_4_5', resolution: '1k', output_format: 'jpeg' },
          { what: 'retouche par instruction' },
        ),
      );
    case 'remove-background':
      if (!params.publicUrl) throw new Error("Le détourage Magnific a besoin d'une URL publique (PUBLIC_URL en https)");
      return firstImage(
        await runFreepikTask('/v1/ai/beta/remove-background', { image_url: params.publicUrl }, { what: 'détourage Magnific' }),
      );
  }
}
