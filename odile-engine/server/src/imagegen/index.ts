import { eq } from 'drizzle-orm';
import { GoogleGenAI, Modality } from '@google/genai';
import sharp from 'sharp';
import type { SlideContent } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getImageGen } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { getCustomTheme } from '../render/custom-theme.js';
import { saveAsset } from '../render/renderer.js';
import { freepikAvailable, generateViaFreepik } from './providers/freepik.js';
import { buildImagePrompt } from './prompt.js';

const OUT_WIDTH = 1080;
const OUT_HEIGHT = 1350;

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

export interface GeneratedImage {
  buffer: Buffer;
  model: string;
  tokens: number;
}

export type ImageAspect = '4:5' | '1:1';

/** Appel via la surface `interactions` (Nano Banana Pro / Nano Banana 2). */
async function generateViaInteractions(
  model: string,
  prompt: string,
  aspect: ImageAspect = '4:5',
): Promise<GeneratedImage> {
  const interaction = await getClient().interactions.create({
    model,
    input: prompt,
    response_format: {
      type: 'image',
      aspect_ratio: aspect,
      image_size: '2K',
      delivery: 'inline',
      mime_type: 'image/jpeg',
    },
  });
  const data = interaction.output_image?.data;
  if (!data) throw new Error(`Réponse sans image (modèle ${model})`);
  return {
    buffer: Buffer.from(data, 'base64'),
    model,
    tokens: interaction.usage?.total_tokens ?? 0,
  };
}

/** Fallback : ancienne surface generateContent + responseModalities IMAGE. */
async function generateViaContent(model: string, prompt: string): Promise<GeneratedImage> {
  const response = await getClient().models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: string } }).inlineData;
    if (inline?.data) {
      return {
        buffer: Buffer.from(inline.data, 'base64'),
        model,
        tokens: response.usageMetadata?.totalTokenCount ?? 0,
      };
    }
  }
  throw new Error(`Réponse sans image (modèle ${model}, surface generateContent)`);
}

/** Buffer du placeholder de marque (exposé pour la galerie de contrôle). */
export async function generateMockPlaceholderBuffer(): Promise<Buffer> {
  return (await generateMockPlaceholder()).buffer;
}

/** Placeholder de marque (mode mock / sans clé) : dégradé + halo bleu via sharp. */
async function generateMockPlaceholder(): Promise<GeneratedImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_WIDTH}" height="${OUT_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#04060f"/><stop offset="0.6" stop-color="#071233"/><stop offset="1" stop-color="#0a2a66"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.4" r="0.45">
      <stop offset="0" stop-color="#66c2ff" stop-opacity="0.9"/>
      <stop offset="0.45" stop-color="#0099ff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#0099ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${OUT_WIDTH / 2}" cy="${OUT_HEIGHT * 0.4}" r="${OUT_WIDTH * 0.42}" fill="url(#halo)"/>
  <circle cx="${OUT_WIDTH / 2}" cy="${OUT_HEIGHT * 0.4}" r="150" fill="#0d1e45" stroke="#3db4ff" stroke-width="4"/>
</svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return { buffer, model: 'mock-placeholder', tokens: 0 };
}

/**
 * Génère une image brute depuis un prompt (chaîne : Pro → Fast → legacy →
 * échec), ou le placeholder de marque en mode mock / sans clé. Partagé par
 * les illustrations de slides et le studio d'images du dashboard.
 */
export async function generateImageBuffer(
  prompt: string,
  opts: { quality?: 'pro' | 'fast'; aspect?: ImageAspect } = {},
): Promise<GeneratedImage> {
  const settings = getImageGen();
  const quality = opts.quality ?? settings.quality;
  const aspect = opts.aspect ?? '4:5';
  const attempts: (() => Promise<GeneratedImage>)[] = [];
  if (config.LLM_MODE !== 'mock') {
    // Freepik / Magnific (Nano Banana via leur plateforme) puis Gemini direct,
    // selon le réglage « fournisseur » et les clés présentes.
    if (settings.provider !== 'gemini' && freepikAvailable()) {
      const pro = config.FREEPIK_MODEL_IMAGE;
      const fast = config.FREEPIK_MODEL_IMAGE_FAST;
      attempts.push(() =>
        generateViaFreepik(quality === 'pro' ? pro : fast, prompt, { aspect, resolution: quality === 'pro' ? '2K' : '1K' }),
      );
      if (quality === 'pro') attempts.push(() => generateViaFreepik(fast, prompt, { aspect, resolution: '1K' }));
    }
    if (settings.provider !== 'freepik' && config.GEMINI_API_KEY) {
      attempts.push(
        () =>
          generateViaInteractions(
            quality === 'pro' ? config.GEMINI_MODEL_IMAGE : config.GEMINI_MODEL_IMAGE_FAST,
            prompt,
            aspect,
          ),
        () => generateViaInteractions(config.GEMINI_MODEL_IMAGE_FAST, prompt, aspect),
        () => generateViaContent(config.GEMINI_MODEL_IMAGE_LEGACY, prompt),
      );
    }
    // Fournisseur imposé mais absent : on retombe sur l'autre plutôt que d'échouer
    if (attempts.length === 0 && config.GEMINI_API_KEY) {
      attempts.push(() => generateViaInteractions(config.GEMINI_MODEL_IMAGE_FAST, prompt, aspect));
    }
    if (attempts.length === 0 && freepikAvailable()) {
      attempts.push(() => generateViaFreepik(config.FREEPIK_MODEL_IMAGE_FAST, prompt, { aspect, resolution: '1K' }));
    }
  }
  if (attempts.length === 0) attempts.push(generateMockPlaceholder);
  let lastError = '';
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err: lastError.slice(0, 200) }, "échec de génération d'image, tentative suivante");
    }
  }
  throw new Error(lastError || "génération d'image impossible");
}

/**
 * Génère l'illustration d'une slide (chaîne : Pro → Fast → legacy → échec doux),
 * normalise en 1080×1350 JPEG, enregistre l'asset et l'attache à la slide.
 */
export async function generateHeroImage(
  slideId: number,
  opts: { instructions?: string; quality?: 'pro' | 'fast' } = {},
): Promise<{ ok: boolean; assetId?: string; model?: string; tokens?: number; reason?: string }> {
  const slide = db.select().from(schema.slides).where(eq(schema.slides.id, slideId)).get();
  if (!slide) return { ok: false, reason: `Slide ${slideId} introuvable` };
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, slide.postId)).get();
  const content = JSON.parse(slide.content) as SlideContent;
  if (!content.imageIdea) return { ok: false, reason: 'Pas de concept (imageIdea) sur cette slide' };

  const settings = getImageGen();
  // Template maison : l'illustration suit sa palette, pas le bleu Odile
  const custom = post ? getCustomTheme(post.theme) : null;
  const prompt = buildImagePrompt({
    idea: content.imageIdea,
    archetypeId: post?.archetype,
    styleNotes: settings.styleNotes,
    instructions: opts.instructions,
    theme: post?.theme,
    palette: custom
      ? { bg1: custom.bg1, bg2: custom.bg2, accent: custom.accent, textColor: custom.textColor }
      : null,
    monochrome: settings.monochrome,
  });

  try {
    const generated = await generateImageBuffer(prompt, { quality: opts.quality ?? settings.quality });
    {
      let pipeline = sharp(generated.buffer).resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'cover', position: 'attention' });
      // Noir et blanc garanti côté serveur, quoi que réponde le modèle
      if (settings.monochrome) pipeline = pipeline.grayscale();
      const normalized = await pipeline.jpeg({ quality: 88 }).toBuffer();
      const assetId = saveAsset(
        normalized,
        'genimage',
        {
          postId: slide.postId,
          slideId: slide.id,
          extraMeta: {
            idea: content.imageIdea,
            archetype: post?.archetype ?? null,
            model: generated.model,
            tokens: generated.tokens,
            instructions: opts.instructions ?? null,
            monochrome: settings.monochrome,
          },
        },
        { width: OUT_WIDTH, height: OUT_HEIGHT },
        { ext: 'jpg', mime: 'image/jpeg' },
      );
      db.update(schema.slides)
        .set({ heroAssetId: assetId, renderAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, slide.id))
        .run();
      logger.info({ slideId, assetId, model: generated.model }, 'illustration générée');
      return { ok: true, assetId, model: generated.model, tokens: generated.tokens };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ slideId, err: reason.slice(0, 200) }, "illustration non générée");
    return { ok: false, reason };
  }
}

export interface ImagesSummary {
  generated: number;
  skipped: number;
  failed: number;
  tokens: number;
}

/**
 * Génère les illustrations d'un post : les premières slides portant un
 * `imageIdea`, dans la limite du réglage `imagesPerPost`. Idempotent
 * (les slides déjà illustrées sont ignorées) et fail-soft.
 */
export async function generateImagesForPost(postId: number): Promise<ImagesSummary> {
  const summary: ImagesSummary = { generated: 0, skipped: 0, failed: 0, tokens: 0 };
  const settings = getImageGen();
  if (!settings.enabled || settings.imagesPerPost === 0) return summary;

  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();

  let budget = settings.imagesPerPost;
  for (const slide of slides) {
    if (budget <= 0) break;
    const content = JSON.parse(slide.content) as SlideContent;
    if (!content.imageIdea) continue;
    if (slide.heroAssetId) {
      summary.skipped++;
      budget--;
      continue;
    }
    const result = await generateHeroImage(slide.id);
    if (result.ok) {
      summary.generated++;
      summary.tokens += result.tokens ?? 0;
    } else {
      summary.failed++;
    }
    budget--;
  }
  return summary;
}
