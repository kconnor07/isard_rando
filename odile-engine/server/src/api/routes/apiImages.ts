import { and, desc, eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { ARCHETYPES } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getBrand, getImageGen } from '../../db/settingsRepo.js';
import { config } from '../../config.js';
import { fitCutout, removeImageBackground } from '../../imagegen/cutout.js';
import { generateStyledImage, usableReference, type ImageAspect } from '../../imagegen/index.js';
import { POP_PRESETS } from '../../imagegen/color.js';
import { buildImagePrompt, IMAGE_STYLES, isCutoutStyle, styleForArchetype, type ImageStyle } from '../../imagegen/prompt.js';
import { notesFor } from '../../imagegen/references.js';
import { editViaFreepik, FREEPIK_EDIT_OPS, freepikAvailable, type FreepikEditOp } from '../../imagegen/providers/freepik.js';
import { FREEPIK_MODELS } from '../../imagegen/providers/freepikCatalog.js';
import { logger } from '../../lib/logger.js';
import { saveAsset } from '../../render/renderer.js';

const OUT = { '4:5': { width: 1080, height: 1350 }, '1:1': { width: 1080, height: 1080 } } as const;

/** Métadonnées d'une image de bibliothèque (studio, upload, détourage). */
interface LibraryMeta {
  source: 'studio' | 'upload' | 'cutout' | 'monochrome' | 'edit';
  prompt?: string | null;
  model?: string | null;
  tokens?: number;
  cutout: boolean;
  monochrome: boolean;
  filename?: string;
  from?: string;
  /** opération d'édition Magnific appliquée */
  op?: string;
  /** couleur signature détectée (plein cadre) */
  popColor?: string | null;
}

function parseMeta(raw: string | null): Partial<LibraryMeta> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<LibraryMeta>;
  } catch {
    return {};
  }
}

function libraryDto(a: typeof schema.assets.$inferSelect) {
  const meta = parseMeta(a.meta);
  return {
    id: a.id,
    width: a.width,
    height: a.height,
    mime: a.mime,
    createdAt: a.createdAt,
    source: meta.source ?? 'upload',
    prompt: meta.prompt ?? null,
    cutout: Boolean(meta.cutout),
    monochrome: Boolean(meta.monochrome),
    model: meta.model ?? null,
    op: meta.op ?? null,
  };
}

/**
 * Prépare une image pour la bibliothèque : recadrage aux dimensions des
 * slides (ou pose entière sur fond transparent si elle est détourée),
 * noir et blanc si le réglage l'impose, puis encodage.
 */
async function prepareLibraryImage(
  input: Buffer,
  opts: { cutout: boolean; monochrome: boolean; size?: { width: number; height: number }; keepSize?: boolean },
): Promise<{ buffer: Buffer; ext: 'png' | 'jpg'; mime: string; cutout: boolean; size: { width: number; height: number } }> {
  const meta = await sharp(input).metadata();
  // keepSize : on conserve les dimensions (upscale, extension) au lieu du 1080×1350
  const size = opts.keepSize ? { width: meta.width ?? 1080, height: meta.height ?? 1350 } : (opts.size ?? OUT['4:5']);
  let source = input;
  let transparent = Boolean(meta.hasAlpha);
  if (opts.cutout) {
    source = await removeImageBackground(input);
    transparent = true;
  }
  if (transparent) {
    let png = sharp(opts.keepSize ? source : await fitCutout(source, size.width, size.height));
    if (opts.monochrome) png = png.grayscale();
    return { buffer: await png.png().toBuffer(), ext: 'png', mime: 'image/png', cutout: true, size };
  }
  let jpg = opts.keepSize ? sharp(source) : sharp(source).resize(size.width, size.height, { fit: 'cover', position: 'attention' });
  if (opts.monochrome) jpg = jpg.grayscale();
  return { buffer: await jpg.jpeg({ quality: 90 }).toBuffer(), ext: 'jpg', mime: 'image/jpeg', cutout: false, size };
}

function storeLibraryImage(
  prepared: Awaited<ReturnType<typeof prepareLibraryImage>>,
  meta: Omit<LibraryMeta, 'cutout'>,
): string {
  return saveAsset(
    prepared.buffer,
    'library',
    { extraMeta: { ...meta, cutout: prepared.cutout } },
    prepared.size,
    { ext: prepared.ext, mime: prepared.mime },
  );
}

function getLibraryAsset(id: string) {
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  return asset && asset.kind === 'library' ? asset : null;
}

const generateSchema = z.object({
  prompt: z.string().min(3).max(600),
  /** archétype de composition (registre ARCHETYPES) ou libre */
  composition: z.string().max(40).optional(),
  aspect: z.enum(['4:5', '1:1']).default('4:5'),
  quality: z.enum(['pro', 'fast']).optional(),
  cutout: z.boolean().default(false),
  /** modèle du catalogue Freepik/Magnific (sinon celui des réglages) */
  model: z.string().max(60).optional(),
  /** style : plein cadre, objets détourés, chrome & verre (auto = selon la composition) */
  style: z.enum(['auto', 'full', 'objets', 'chrome']).default('auto'),
});

const editSchema = z.object({
  op: z.enum(FREEPIK_EDIT_OPS.map((o) => o.id) as [FreepikEditOp, ...FreepikEditOp[]]),
  prompt: z.string().max(600).optional(),
  /** image de référence (transfert de style) */
  referenceId: z.string().max(30).optional(),
});

const useOnSlideSchema = z.object({ postId: z.number().int(), slideIdx: z.number().int().min(0) });

export function registerImageRoutes(app: FastifyInstance): void {
  // --- Bibliothèque ---------------------------------------------------------

  app.get('/api/library', async () => {
    return db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.kind, 'library'))
      .orderBy(desc(schema.assets.createdAt))
      .all()
      .map(libraryDto);
  });

  /** Upload : passe en N&B (réglage) ; un PNG transparent est traité comme un détourage. */
  app.post('/api/library', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Aucun fichier reçu' });
    if (!/^image\/(png|jpe?g|webp|avif)$/.test(file.mimetype)) {
      return reply.status(415).send({ error: `Format non pris en charge : ${file.mimetype}` });
    }
    const monochrome = getImageGen().monochrome;
    const prepared = await prepareLibraryImage(await file.toBuffer(), { cutout: false, monochrome });
    const id = storeLibraryImage(prepared, { source: 'upload', filename: file.filename, monochrome });
    return { ok: true, id };
  });

  app.delete<{ Params: { id: string } }>('/api/library/:id', async (request, reply) => {
    const id = request.params.id;
    const templates = db
      .select()
      .from(schema.customThemes)
      .where(
        or(
          eq(schema.customThemes.backgroundAssetId, id),
          eq(schema.customThemes.floatAssetId1, id),
          eq(schema.customThemes.floatAssetId2, id),
          eq(schema.customThemes.floatAssetId3, id),
          eq(schema.customThemes.floatAssetId4, id),
        ),
      )
      .all();
    if (templates.length > 0) {
      return reply.status(409).send({ error: `Image utilisée par ${templates.length} template(s).` });
    }
    const slides = db.select().from(schema.slides).where(eq(schema.slides.heroAssetId, id)).all();
    if (slides.length > 0) {
      return reply.status(409).send({ error: `Image posée sur ${slides.length} slide(s) — retirez-la d'abord.` });
    }
    const refs = getImageGen().references;
    if (refs.full === id || refs.objets === id || refs.chrome === id) {
      return reply.status(409).send({ error: 'Cette image sert de référence de style (Réglages › Illustrations IA).' });
    }
    if (getBrand().avatarAssetId === id) {
      return reply.status(409).send({ error: 'Cette image est la photo de la chip auteur (Réglages › Marque).' });
    }
    db.delete(schema.assets).where(eq(schema.assets.id, id)).run();
    return { ok: true };
  });

  /** Détourage d'une image existante → nouvelle image (PNG transparent). */
  app.post<{ Params: { id: string } }>('/api/library/:id/cutout', async (request, reply) => {
    const asset = getLibraryAsset(request.params.id);
    if (!asset) return reply.status(404).send({ error: 'Image introuvable' });
    const fs = await import('node:fs');
    const monochrome = getImageGen().monochrome;
    const prepared = await prepareLibraryImage(fs.readFileSync(asset.path), { cutout: true, monochrome });
    const meta = parseMeta(asset.meta);
    const id = storeLibraryImage(prepared, {
      source: 'cutout',
      from: asset.id,
      prompt: meta.prompt ?? null,
      monochrome,
    });
    return { ok: true, id };
  });

  /** Version noir et blanc d'une image couleur (déjà en bibliothèque). */
  app.post<{ Params: { id: string } }>('/api/library/:id/monochrome', async (request, reply) => {
    const asset = getLibraryAsset(request.params.id);
    if (!asset) return reply.status(404).send({ error: 'Image introuvable' });
    const fs = await import('node:fs');
    const prepared = await prepareLibraryImage(fs.readFileSync(asset.path), { cutout: false, monochrome: true });
    const meta = parseMeta(asset.meta);
    const id = storeLibraryImage(prepared, {
      source: 'monochrome',
      from: asset.id,
      prompt: meta.prompt ?? null,
      monochrome: true,
    });
    return { ok: true, id };
  });

  /** Pose une image de bibliothèque comme illustration d'une slide. */
  app.post<{ Params: { id: string } }>('/api/library/:id/use-on-slide', async (request, reply) => {
    const parsed = useOnSlideSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const asset = getLibraryAsset(request.params.id);
    if (!asset) return reply.status(404).send({ error: 'Image introuvable' });
    const slide = db
      .select()
      .from(schema.slides)
      .where(and(eq(schema.slides.postId, parsed.data.postId), eq(schema.slides.idx, parsed.data.slideIdx)))
      .get();
    if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
    db.update(schema.slides)
      .set({ heroAssetId: asset.id, renderAssetId: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.slides.id, slide.id))
      .run();
    return { ok: true };
  });

  // --- Catalogue Freepik / Magnific ---------------------------------------------

  app.get('/api/images/models', async () => {
    const settings = getImageGen();
    return {
      available: freepikAvailable(),
      provider: settings.provider,
      defaultModel: settings.model,
      models: FREEPIK_MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        family: m.family,
        speed: m.speed,
        note: m.note ?? null,
        recommended: Boolean(m.recommended),
      })),
      edits: FREEPIK_EDIT_OPS,
      styles: IMAGE_STYLES,
      defaultStyle: settings.style,
      references: settings.references,
      notesByStyle: settings.notesByStyle,
      cutoutStyles: IMAGE_STYLES.filter((s) => isCutoutStyle(s.id)).map((s) => s.id),
      modelByStyle: settings.modelByStyle,
      popPresets: POP_PRESETS,
      /** URL publique en https : requis pour les références des modèles Google */
      publicHttps: config.PUBLIC_URL.startsWith('https://'),
    };
  });

  /**
   * Édition d'une image de la bibliothèque par les outils Magnific : le
   * résultat devient une nouvelle image (l'originale reste).
   */
  app.post<{ Params: { id: string } }>('/api/library/:id/edit', async (request, reply) => {
    const parsed = editSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    if (!freepikAvailable()) return reply.status(400).send({ error: 'FREEPIK_API_KEY manquante (Réglages › Illustrations IA)' });
    const asset = getLibraryAsset(request.params.id);
    if (!asset) return reply.status(404).send({ error: 'Image introuvable' });
    const fs = await import('node:fs');
    const image = fs.readFileSync(asset.path);
    const reference = parsed.data.referenceId ? getLibraryAsset(parsed.data.referenceId) : null;
    if (parsed.data.referenceId && !reference) return reply.status(404).send({ error: 'Image de référence introuvable' });
    const op = parsed.data.op;
    const publicUrl = `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${asset.id}.${asset.mime === 'image/png' ? 'png' : 'jpg'}`;
    try {
      const result = await editViaFreepik(op, image, {
        prompt: parsed.data.prompt,
        reference: reference ? fs.readFileSync(reference.path) : undefined,
        publicUrl: publicUrl.startsWith('https://') ? publicUrl : undefined,
      });
      const monochrome = getImageGen().monochrome;
      const keepSize = op === 'upscale-creative' || op === 'upscale-precision' || op === 'expand';
      const prepared = await prepareLibraryImage(result, { cutout: false, monochrome, keepSize });
      const meta = parseMeta(asset.meta);
      const id = storeLibraryImage(prepared, {
        source: 'edit',
        op,
        from: asset.id,
        prompt: parsed.data.prompt ?? meta.prompt ?? null,
        model: `magnific/${op}`,
        monochrome,
      });
      logger.info({ id, op, from: asset.id }, 'image éditée via Magnific');
      return { ok: true, id };
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Studio : génération à la demande --------------------------------------

  app.get('/api/images/compositions', async () => {
    return ARCHETYPES.filter((a) => a.needsImage && a.imageComposition).map((a) => ({
      id: a.id,
      label: a.label,
    }));
  });

  /**
   * Génère une image depuis une description : même chaîne de modèles que les
   * illustrations de slides, toujours en noir et blanc si le réglage l'impose,
   * détourage optionnel. L'image rejoint la bibliothèque.
   */
  app.post('/api/images/generate', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const settings = getImageGen();
    const style: ImageStyle =
      parsed.data.style !== 'auto'
        ? parsed.data.style
        : settings.style !== 'auto'
          ? settings.style
          : styleForArchetype(parsed.data.composition);
    const cutout = parsed.data.cutout || isCutoutStyle(style);
    const reference = usableReference(style, parsed.data.model);
    const prompt = buildImagePrompt({
      idea: parsed.data.prompt,
      archetypeId: parsed.data.composition,
      styleNotes: settings.styleNotes,
      monochrome: settings.monochrome,
      style,
      hasReference: Boolean(reference),
      styleSpecificNotes: notesFor(style),
    });
    try {
      const generated = await generateStyledImage(prompt, {
        style,
        quality: parsed.data.quality ?? settings.quality,
        aspect: parsed.data.aspect as ImageAspect,
        model: parsed.data.model,
        reference,
        monochrome: settings.monochrome,
        size: OUT[parsed.data.aspect],
      });
      // Détourage demandé explicitement sur un style plein cadre : passe locale
      const prepared = cutout && !generated.cutout
        ? await prepareLibraryImage(generated.raw, { cutout: true, monochrome: settings.monochrome, size: OUT[parsed.data.aspect] })
        : { buffer: generated.buffer, cutout: generated.cutout, ext: generated.ext, mime: generated.mime, size: { width: generated.width, height: generated.height } };
      const id = storeLibraryImage(prepared, {
        source: 'studio',
        prompt: parsed.data.prompt,
        model: generated.model,
        tokens: generated.tokens,
        monochrome: settings.monochrome,
        op: style,
        popColor: generated.popColor,
      });
      logger.info({ id, model: generated.model, cutout: prepared.cutout }, 'image studio générée');
      return { ok: true, id, model: generated.model };
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
