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
import { acceptPopColor, extractPopColor, resolvePopColor } from './color.js';
import { freepikAvailable, generateViaFreepik } from './providers/freepik.js';
import { DEFAULT_FREEPIK_MODEL, FAST_FREEPIK_MODEL, findFreepikModel } from './providers/freepikCatalog.js';
import { cutoutStats, fitCutout, removeImageBackground } from './cutout.js';
import { buildImagePrompt, isCutoutStyle, resolvePalette, styleForArchetype, type ImageStyle, type ThemePalette } from './prompt.js';
import { notesFor, referenceFor } from './references.js';
import type { FreepikReference } from './providers/freepikCatalog.js';

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

/** Modèle Freepik retenu : explicite > modèle du style > modèle par défaut des réglages > config. */
export function modelForStyle(style: ImageStyle | null | undefined, explicit?: string | null): string {
  const settings = getImageGen();
  const byStyle = style ? settings.modelByStyle[style] : undefined;
  const wanted = explicit || byStyle || settings.model;
  return findFreepikModel(wanted)?.id ?? findFreepikModel(config.FREEPIK_MODEL_IMAGE)?.id ?? DEFAULT_FREEPIK_MODEL;
}

/**
 * Génère une image brute depuis un prompt (chaîne : modèle choisi → modèle
 * rapide → Gemini → échec), ou le placeholder de marque en mode mock / sans
 * clé. Partagé par les illustrations de slides et le studio d'images.
 */
export async function generateImageBuffer(
  prompt: string,
  opts: {
    quality?: 'pro' | 'fast';
    aspect?: ImageAspect;
    model?: string | null;
    reference?: FreepikReference | null;
    style?: ImageStyle | null;
  } = {},
): Promise<GeneratedImage> {
  const settings = getImageGen();
  const quality = opts.quality ?? settings.quality;
  const aspect = opts.aspect ?? '4:5';
  const attempts: (() => Promise<GeneratedImage>)[] = [];
  if (config.LLM_MODE !== 'mock') {
    // Freepik / Magnific (catalogue de modèles) puis Gemini direct, selon le
    // réglage « fournisseur » et les clés présentes.
    if (settings.provider !== 'gemini' && freepikAvailable()) {
      const chosen = modelForStyle(opts.style, opts.model);
      const reference = opts.reference ?? null;
      attempts.push(() => generateViaFreepik(chosen, prompt, { aspect, quality, reference }));
      // Repli sur un modèle rapide si le modèle choisi échoue — sans référence si, pour un
      // objet à détourer, ce modèle la prendrait comme image d'entrée (elle imposerait son fond)
      const fallback = findFreepikModel(config.FREEPIK_MODEL_IMAGE_FAST)?.id ?? FAST_FREEPIK_MODEL;
      const fallbackTakesStyle = findFreepikModel(fallback)?.reference === 'style';
      const fallbackReference = opts.style && isCutoutStyle(opts.style) && !fallbackTakesStyle ? null : reference;
      if (fallback !== chosen) attempts.push(() => generateViaFreepik(fallback, prompt, { aspect, quality: 'fast', reference: fallbackReference }));
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
      attempts.push(() => generateViaFreepik(FAST_FREEPIK_MODEL, prompt, { aspect, quality: 'fast' }));
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

export interface StyledImageOpts {
  style: ImageStyle;
  quality?: 'pro' | 'fast';
  aspect?: ImageAspect;
  model?: string | null;
  reference?: FreepikReference | null;
  monochrome?: boolean;
  /** teintes de la palette à ignorer lors de l'extraction de la couleur signature */
  excludeHues?: string[];
  /** couleur signature demandée (repli si l'extraction n'en trouve pas) */
  requestedPop?: string | null;
  size?: { width: number; height: number };
}

export interface StyledImage {
  /** image finale normalisée (JPEG plein cadre, ou PNG détouré posé sur toile transparente) */
  buffer: Buffer;
  /** image brute renvoyée par le modèle (sert de référence aux objets d'une même série) */
  raw: Buffer;
  model: string;
  tokens: number;
  cutout: boolean;
  popColor: string | null;
  ext: 'png' | 'jpg';
  mime: string;
  width: number;
  height: number;
  /** porte qualité du détourage (statistiques de la meilleure tentative) */
  gate?: { coverage: number; touchesEdge: boolean; attempts: number };
}

/**
 * Génère et normalise une image selon son style :
 * - plein cadre : recadrage 1080×1350, couleur signature extraite ;
 * - objets / chrome : détourage local, porte qualité (matière suffisante, objet
 *   entier) avec une regénération si elle échoue, objet posé entier sur toile
 *   transparente.
 * Partagé par les illustrations de slides, l'agent visuel et le studio.
 */
export async function generateStyledImage(prompt: string, opts: StyledImageOpts): Promise<StyledImage> {
  const size = opts.size ?? { width: OUT_WIDTH, height: OUT_HEIGHT };
  const cutout = isCutoutStyle(opts.style);
  const generate = () =>
    generateImageBuffer(prompt, {
      quality: opts.quality,
      aspect: opts.aspect,
      model: opts.model,
      reference: opts.reference,
      style: opts.style,
    });

  if (!cutout) {
    const generated = await generate();
    let pipeline = sharp(generated.buffer).resize(size.width, size.height, { fit: 'cover', position: 'attention' });
    if (opts.monochrome) pipeline = pipeline.grayscale();
    const buffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
    const popColor = opts.monochrome
      ? null
      : acceptPopColor(await extractPopColor(generated.buffer, { exclude: opts.excludeHues }).catch(() => null), opts.requestedPop ?? null);
    return { buffer, raw: generated.buffer, model: generated.model, tokens: generated.tokens, cutout: false, popColor, ext: 'jpg', mime: 'image/jpeg', ...size };
  }

  // Détourage avec porte qualité : une seconde génération si l'objet est rogné ou trop petit
  const maxAttempts = config.LLM_MODE === 'mock' ? 1 : 2;
  let best: { generated: GeneratedImage; png: Buffer; stats: Awaited<ReturnType<typeof cutoutStats>> } | null = null;
  let tokens = 0;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts++;
    const generated = await generate();
    tokens += generated.tokens;
    const png = await removeImageBackground(generated.buffer);
    const stats = await cutoutStats(png);
    if (!best || (stats.ok && !best.stats.ok) || (stats.ok === best.stats.ok && stats.coverage > best.stats.coverage)) {
      best = { generated, png, stats };
    }
    if (stats.ok) break;
    logger.info({ attempt, coverage: Number(stats.coverage.toFixed(3)), touchesEdge: stats.touchesEdge }, 'détourage insuffisant, nouvelle génération');
  }
  const chosen = best!;
  let pipeline = sharp(await fitCutout(chosen.png, size.width, size.height));
  if (opts.monochrome) pipeline = pipeline.grayscale();
  const buffer = await pipeline.png().toBuffer();
  return {
    buffer,
    raw: chosen.generated.buffer,
    model: chosen.generated.model,
    tokens,
    cutout: true,
    popColor: null,
    ext: 'png',
    mime: 'image/png',
    ...size,
    gate: { coverage: chosen.stats.coverage, touchesEdge: chosen.stats.touchesEdge, attempts },
  };
}

/**
 * Référence de style utilisable pour un style et un modèle : pour les objets à
 * détourer, seuls les modèles qui reçoivent une référence « de style » (Mystic)
 * la prennent — passée en image d'entrée à Flux ou Google, elle imposerait son
 * fond (violet, bleu…) à la place du gris neutre, et le détourage échouerait.
 */
export function usableReference(style: ImageStyle, explicitModel?: string | null): FreepikReference | null {
  const reference = referenceFor(style);
  if (!reference || !isCutoutStyle(style)) return reference;
  const model = findFreepikModel(modelForStyle(style, explicitModel));
  return model?.reference === 'style' ? reference : null;
}

/** Palette et couleur signature d'un post (template maison ou thème intégré). */
export function paletteForPost(post: { theme: string } | null | undefined): { palette: ThemePalette; custom: ReturnType<typeof getCustomTheme>; popColor: string | null } {
  const custom = post ? getCustomTheme(post.theme) : null;
  const palette = resolvePalette(post?.theme, custom ? { bg1: custom.bg1, bg2: custom.bg2, accent: custom.accent, textColor: custom.textColor } : null);
  const popColor = getImageGen().monochrome ? null : resolvePopColor(custom?.popColor ?? 'auto', palette.accent);
  return { palette, custom, popColor };
}

/**
 * Génère l'illustration d'une slide (chaîne : Pro → Fast → legacy → échec doux),
 * normalise en 1080×1350, enregistre l'asset et l'attache à la slide.
 */
export async function generateHeroImage(
  slideId: number,
  opts: { instructions?: string; quality?: 'pro' | 'fast'; style?: ImageStyle } = {},
): Promise<{ ok: boolean; assetId?: string; model?: string; tokens?: number; reason?: string }> {
  const slide = db.select().from(schema.slides).where(eq(schema.slides.id, slideId)).get();
  if (!slide) return { ok: false, reason: `Slide ${slideId} introuvable` };
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, slide.postId)).get();
  const content = JSON.parse(slide.content) as SlideContent;
  if (!content.imageIdea) return { ok: false, reason: 'Pas de concept (imageIdea) sur cette slide' };

  const settings = getImageGen();
  // Template maison : l'illustration suit sa palette (et sa couleur signature), pas le bleu Odile
  const { palette, custom, popColor } = paletteForPost(post);
  // Style : demandé > réglage global > style du template > archétype
  const templateStyle = custom && custom.imageStyle !== 'auto' ? custom.imageStyle : null;
  const style: ImageStyle =
    opts.style ?? (settings.style !== 'auto' ? settings.style : (templateStyle ?? styleForArchetype(post?.archetype)));
  const reference = usableReference(style);
  const prompt = buildImagePrompt({
    idea: content.imageIdea,
    archetypeId: post?.archetype,
    styleNotes: settings.styleNotes,
    instructions: opts.instructions,
    theme: post?.theme,
    palette: custom ? palette : null,
    monochrome: settings.monochrome,
    style,
    hasReference: Boolean(reference),
    styleSpecificNotes: notesFor(style),
    popColor,
  });

  try {
    const image = await generateStyledImage(prompt, {
      style,
      quality: opts.quality ?? settings.quality,
      reference,
      monochrome: settings.monochrome,
      excludeHues: [palette.accent, palette.bg2],
      requestedPop: popColor,
    });
    const assetId = saveAsset(
      image.buffer,
      'genimage',
      {
        postId: slide.postId,
        slideId: slide.id,
        extraMeta: {
          idea: content.imageIdea,
          archetype: post?.archetype ?? null,
          model: image.model,
          tokens: image.tokens,
          instructions: opts.instructions ?? null,
          monochrome: settings.monochrome,
          style,
          cutout: image.cutout,
          popColor: image.popColor,
          gate: image.gate ?? null,
        },
      },
      { width: image.width, height: image.height },
      { ext: image.ext, mime: image.mime },
    );
    db.update(schema.slides)
      .set({ heroAssetId: assetId, renderAssetId: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.slides.id, slide.id))
      .run();
    logger.info({ slideId, assetId, model: image.model, popColor: image.popColor }, 'illustration générée');
    return { ok: true, assetId, model: image.model, tokens: image.tokens };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ slideId, err: reason.slice(0, 200) }, 'illustration non générée');
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
