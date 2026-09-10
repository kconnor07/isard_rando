import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { ARCHETYPES } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getImageGen } from '../../db/settingsRepo.js';
import { fitCutout, removeImageBackground } from '../../imagegen/cutout.js';
import { generateImageBuffer, type ImageAspect } from '../../imagegen/index.js';
import { buildImagePrompt } from '../../imagegen/prompt.js';
import { logger } from '../../lib/logger.js';
import { saveAsset } from '../../render/renderer.js';

const OUT = { '4:5': { width: 1080, height: 1350 }, '1:1': { width: 1080, height: 1080 } } as const;

/** Métadonnées d'une image de bibliothèque (studio, upload, détourage). */
interface LibraryMeta {
  source: 'studio' | 'upload' | 'cutout' | 'monochrome';
  prompt?: string | null;
  model?: string | null;
  tokens?: number;
  cutout: boolean;
  monochrome: boolean;
  filename?: string;
  from?: string;
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
  };
}

/**
 * Prépare une image pour la bibliothèque : recadrage aux dimensions des
 * slides (ou pose entière sur fond transparent si elle est détourée),
 * noir et blanc si le réglage l'impose, puis encodage.
 */
async function prepareLibraryImage(
  input: Buffer,
  opts: { cutout: boolean; monochrome: boolean; size?: { width: number; height: number } },
): Promise<{ buffer: Buffer; ext: 'png' | 'jpg'; mime: string; cutout: boolean; size: { width: number; height: number } }> {
  const size = opts.size ?? OUT['4:5'];
  const meta = await sharp(input).metadata();
  let source = input;
  let transparent = Boolean(meta.hasAlpha);
  if (opts.cutout) {
    source = await removeImageBackground(input);
    transparent = true;
  }
  if (transparent) {
    let png = sharp(await fitCutout(source, size.width, size.height));
    if (opts.monochrome) png = png.grayscale();
    return { buffer: await png.png().toBuffer(), ext: 'png', mime: 'image/png', cutout: true, size };
  }
  let jpg = sharp(source).resize(size.width, size.height, { fit: 'cover', position: 'attention' });
  if (opts.monochrome) jpg = jpg.grayscale();
  return { buffer: await jpg.jpeg({ quality: 88 }).toBuffer(), ext: 'jpg', mime: 'image/jpeg', cutout: false, size };
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
      .where(eq(schema.customThemes.backgroundAssetId, id))
      .all();
    if (templates.length > 0) {
      return reply.status(409).send({ error: `Image utilisée par ${templates.length} template(s).` });
    }
    const slides = db.select().from(schema.slides).where(eq(schema.slides.heroAssetId, id)).all();
    if (slides.length > 0) {
      return reply.status(409).send({ error: `Image posée sur ${slides.length} slide(s) — retirez-la d'abord.` });
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
    const prompt = buildImagePrompt({
      idea: parsed.data.prompt,
      archetypeId: parsed.data.composition,
      styleNotes: settings.styleNotes,
      monochrome: settings.monochrome,
    });
    try {
      const generated = await generateImageBuffer(prompt, {
        quality: parsed.data.quality ?? settings.quality,
        aspect: parsed.data.aspect as ImageAspect,
      });
      const prepared = await prepareLibraryImage(generated.buffer, {
        cutout: parsed.data.cutout,
        monochrome: settings.monochrome,
        size: OUT[parsed.data.aspect],
      });
      const id = storeLibraryImage(prepared, {
        source: 'studio',
        prompt: parsed.data.prompt,
        model: generated.model,
        tokens: generated.tokens,
        monochrome: settings.monochrome,
      });
      logger.info({ id, model: generated.model, cutout: prepared.cutout }, 'image studio générée');
      return { ok: true, id, model: generated.model };
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
