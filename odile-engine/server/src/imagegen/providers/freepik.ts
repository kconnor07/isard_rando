import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

/**
 * Freepik / Magnific API — les modèles Google Nano Banana (Gemini image) via
 * leur plateforme : `POST` crée une tâche, on interroge son statut jusqu'à
 * `COMPLETED`, puis on télécharge l'image générée.
 */

export function freepikAvailable(): boolean {
  return Boolean(config.FREEPIK_API_KEY);
}

interface TaskResponse {
  data?: { task_id?: string; status?: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'; generated?: string[] };
  message?: string;
}

function headers(): Record<string, string> {
  const key = config.FREEPIK_API_KEY ?? '';
  // Les deux en-têtes : l'API a été rebaptisée (Freepik → Magnific), les deux hôtes coexistent
  return { 'x-magnific-api-key': key, 'x-freepik-api-key': key, 'content-type': 'application/json' };
}

/** Chemin de l'endpoint : les modèles Gemini « preview » vivent hors de /text-to-image. */
function endpointFor(model: string): string {
  const base = config.FREEPIK_API_BASE.replace(/\/$/, '');
  return model.startsWith('gemini-') ? `${base}/v1/ai/${model}` : `${base}/v1/ai/text-to-image/${model}`;
}

async function readJson(res: Response): Promise<TaskResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text) as TaskResponse;
  } catch {
    return { message: text.slice(0, 200) };
  }
}

export async function generateViaFreepik(
  model: string,
  prompt: string,
  opts: { aspect?: '4:5' | '1:1'; resolution?: '1K' | '2K' } = {},
): Promise<{ buffer: Buffer; model: string; tokens: number }> {
  const endpoint = endpointFor(model);
  const body: Record<string, unknown> = { prompt };
  if (!model.startsWith('gemini-')) {
    body.aspect_ratio = opts.aspect ?? '4:5';
    body.resolution = opts.resolution ?? '2K';
  }
  const created = await fetch(endpoint, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const createdJson = await readJson(created);
  if (!created.ok) {
    throw new Error(`Freepik ${created.status} (${model}) : ${createdJson.message ?? 'erreur'}`);
  }
  const taskId = createdJson.data?.task_id;
  if (!taskId) throw new Error(`Freepik (${model}) : réponse sans task_id`);

  // Attente active : ~15 s (flash) à ~60 s (pro), plafond 4 min
  const started = Date.now();
  let status = createdJson.data?.status ?? 'CREATED';
  let generated = createdJson.data?.generated ?? [];
  while (status !== 'COMPLETED' && Date.now() - started < 240_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${endpoint}/${taskId}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    const json = await readJson(res);
    if (!res.ok) throw new Error(`Freepik ${res.status} (tâche ${taskId}) : ${json.message ?? 'erreur'}`);
    status = json.data?.status ?? status;
    generated = json.data?.generated ?? generated;
    if (status === 'FAILED') throw new Error(`Freepik (${model}) : tâche en échec`);
  }
  if (status !== 'COMPLETED' || !generated[0]) {
    throw new Error(`Freepik (${model}) : délai dépassé sans image`);
  }
  const image = await fetch(generated[0], { signal: AbortSignal.timeout(60_000) });
  if (!image.ok) throw new Error(`Freepik : téléchargement de l'image impossible (${image.status})`);
  const buffer = Buffer.from(await image.arrayBuffer());
  logger.info({ model, ms: Date.now() - started, bytes: buffer.length }, 'image Freepik générée');
  return { buffer, model: `freepik/${model}`, tokens: 0 };
}
