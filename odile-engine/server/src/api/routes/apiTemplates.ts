import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { DEFAULTS, THEMES, type SlideContent } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getBrand, getDefaultTheme, setSetting } from '../../db/settingsRepo.js';
import { customThemeId } from '../../render/custom-theme.js';
import { buildSlideHtml, renderHtmlToPng, saveAsset } from '../../render/renderer.js';
import { THEME_LABELS } from '../../render/themes.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

const templateSchema = z.object({
  name: z.string().min(2).max(60),
  accent: z.string().regex(HEX),
  bg1: z.string().regex(HEX),
  bg2: z.string().regex(HEX),
  textColor: z.string().regex(HEX),
  decor: z.enum(['orbes', 'halo', 'degrade', 'aucun']),
  backgroundAssetId: z.string().max(30).nullable().optional(),
  backgroundOpacity: z.number().int().min(0).max(100),
  grain: z.boolean(),
});

/** « Ma Signature » → « ma-signature » */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Slide témoin de l'aperçu : montre titre accentué, corps, badge et pied. */
const PREVIEW_SLIDE: SlideContent = {
  kind: 'value_prop',
  badge: 'APERÇU',
  title: 'Vos devis en 90 secondes',
  accentWord: '90 secondes',
  body: 'Un aperçu de votre template avec un vrai texte, pour juger des contrastes.',
  bigNumber: '+27%',
};

export function registerTemplateRoutes(app: FastifyInstance): void {
  // Catalogue : thèmes intégrés (lecture seule) + templates maison
  app.get('/api/templates', async () => {
    const custom = db
      .select()
      .from(schema.customThemes)
      .orderBy(desc(schema.customThemes.updatedAt))
      .all();
    return {
      builtin: THEMES.map((id) => ({ id, label: THEME_LABELS[id] })),
      custom: custom.map((t) => ({ ...t, themeId: customThemeId(t.id) })),
    };
  });

  app.post('/api/templates', async (request, reply) => {
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const base = slugify(parsed.data.name) || 'template';
    let id = base;
    for (let n = 2; db.select().from(schema.customThemes).where(eq(schema.customThemes.id, id)).get(); n++) {
      id = `${base}-${n}`;
    }
    db.insert(schema.customThemes)
      .values({ id, ...parsed.data, backgroundAssetId: parsed.data.backgroundAssetId ?? null })
      .run();
    return { ok: true, id, themeId: customThemeId(id) };
  });

  app.put<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const existing = db
      .select()
      .from(schema.customThemes)
      .where(eq(schema.customThemes.id, request.params.id))
      .get();
    if (!existing) return reply.status(404).send({ error: 'Template introuvable' });
    db.update(schema.customThemes)
      .set({
        ...parsed.data,
        backgroundAssetId: parsed.data.backgroundAssetId ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.customThemes.id, request.params.id))
      .run();
    // Les slides rendues avec ce template devront être régénérées
    const themeId = customThemeId(request.params.id);
    const posts = db.select().from(schema.posts).where(eq(schema.posts.theme, themeId)).all();
    for (const post of posts) {
      db.update(schema.slides).set({ renderAssetId: null }).where(eq(schema.slides.postId, post.id)).run();
    }
    return { ok: true, postsToRerender: posts.length };
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const themeId = customThemeId(request.params.id);
    const used = db.select().from(schema.posts).where(eq(schema.posts.theme, themeId)).all();
    if (used.length > 0) {
      return reply
        .status(409)
        .send({ error: `Ce template est utilisé par ${used.length} post(s) — changez-en le thème d'abord.` });
    }
    db.delete(schema.customThemes).where(eq(schema.customThemes.id, request.params.id)).run();
    // S'il servait de thème par défaut, on revient au thème intégré
    if (getDefaultTheme() === themeId) setSetting('default_theme', DEFAULTS.theme);
    return { ok: true };
  });

  /** Aperçu à la volée : rend une slide témoin sans rien enregistrer. */
  app.post('/api/templates/preview', async (request, reply) => {
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const draft = {
      id: '__preview__',
      ...parsed.data,
      backgroundAssetId: parsed.data.backgroundAssetId ?? null,
      createdAt: '',
      updatedAt: '',
    };
    const { buildCustomThemeCss } = await import('../../render/custom-theme.js');
    const html = buildSlideHtml({
      theme: 'odile-nuit',
      kind: PREVIEW_SLIDE.kind,
      content: PREVIEW_SLIDE,
      format: 'carousel',
      brand: getBrand(),
      slideNum: 3,
      slideTotal: 6,
      themeCssOverride: buildCustomThemeCss(draft),
    });
    const png = await renderHtmlToPng(html, { width: 1080, height: 1350 });
    const small = await sharp(png).resize(432, 540).jpeg({ quality: 82 }).toBuffer();
    return reply.type('image/jpeg').send(small);
  });

  // --- Bibliothèque d'images (fonds réutilisables) --------------------------

  app.get('/api/library', async () => {
    return db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.kind, 'library'))
      .orderBy(desc(schema.assets.createdAt))
      .all()
      .map((a) => ({ id: a.id, width: a.width, height: a.height, createdAt: a.createdAt }));
  });

  app.post('/api/library', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Aucun fichier reçu' });
    if (!/^image\/(png|jpe?g|webp|avif)$/.test(file.mimetype)) {
      return reply.status(415).send({ error: `Format non pris en charge : ${file.mimetype}` });
    }
    const normalized = await sharp(await file.toBuffer())
      .resize(1080, 1350, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const id = saveAsset(
      normalized,
      'library',
      { extraMeta: { filename: file.filename } },
      { width: 1080, height: 1350 },
      { ext: 'jpg', mime: 'image/jpeg' },
    );
    return { ok: true, id };
  });

  app.delete<{ Params: { id: string } }>('/api/library/:id', async (request, reply) => {
    const inUse = db
      .select()
      .from(schema.customThemes)
      .where(eq(schema.customThemes.backgroundAssetId, request.params.id))
      .all();
    if (inUse.length > 0) {
      return reply.status(409).send({ error: `Image utilisée par ${inUse.length} template(s).` });
    }
    db.delete(schema.assets).where(eq(schema.assets.id, request.params.id)).run();
    return { ok: true };
  });
}
