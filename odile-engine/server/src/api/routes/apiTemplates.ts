import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { DEFAULTS, THEMES, type SlideContent } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getBrand, getDefaultTheme, getImageGen, setSetting } from '../../db/settingsRepo.js';
import { generateMockPlaceholderBuffer } from '../../imagegen/index.js';
import { buildCustomThemeCss, customThemeId } from '../../render/custom-theme.js';
import { buildSlideHtml, renderHtmlToPng } from '../../render/renderer.js';
import { THEME_LABELS } from '../../render/themes.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

const pct = (def: number) => z.number().int().min(0).max(100).default(def);

/** Paramètres d'un template — tous typés et bornés, jamais de CSS libre. */
export const templateSchema = z.object({
  name: z.string().min(2).max(60),
  // Couleurs
  accent: z.string().regex(HEX),
  secondary: z.string().regex(HEX).nullable().optional(),
  bg1: z.string().regex(HEX),
  bg2: z.string().regex(HEX),
  textColor: z.string().regex(HEX),
  // Typographie
  titleFont: z.enum(['inter', 'playfair', 'fragment']).default('inter'),
  titleWeight: z.number().int().min(400).max(900).default(800),
  titleCase: z.enum(['normal', 'upper']).default('normal'),
  titleScale: z.number().int().min(60).max(140).default(100),
  accentStyle: z.enum(['serif', 'plain', 'underline', 'highlight']).default('serif'),
  align: z.enum(['auto', 'left', 'center']).default('auto'),
  // Décor
  decor: z.enum(['orbes', 'halo', 'degrade', 'points', 'anneaux', 'arcs', 'aucun']),
  decorIntensity: pct(100),
  decorPosition: z
    .enum(['haut-droite', 'haut-gauche', 'bas-droite', 'bas-gauche', 'centre'])
    .default('haut-droite'),
  gradientAngle: z.number().int().min(0).max(360).default(168),
  vignette: pct(0),
  // Image de fond
  backgroundAssetId: z.string().max(30).nullable().optional(),
  backgroundOpacity: z.number().int().min(0).max(100),
  bgFit: z.enum(['cover', 'contain']).default('cover'),
  bgPosition: z.enum(['centre', 'haut', 'bas']).default('centre'),
  bgBlur: z.number().int().min(0).max(60).default(0),
  bgBlend: z.enum(['normal', 'multiply', 'screen', 'soft-light', 'luminosity']).default('normal'),
  // Matière
  radius: z.enum(['pill', 'rounded', 'sharp']).default('pill'),
  glass: pct(50),
  grain: z.boolean(),
  grainLevel: pct(30),
  frame: z.enum(['aucun', 'texte', 'accent']).default('aucun'),
  padding: z.enum(['serre', 'normal', 'aere']).default('normal'),
  // Pied de page
  showLogo: z.boolean().default(true),
  showCounter: z.boolean().default(true),
  // Pack premium
  titleGradient: z.enum(['aucun', 'accent', 'argent']).default('aucun'),
  ctaStyle: z.enum(['verre', 'plein', 'degrade']).default('verre'),
  showAuthor: z.boolean().default(false),
  floatAssetId1: z.string().max(30).nullable().optional(),
  floatAssetId2: z.string().max(30).nullable().optional(),
  floatSize: z.number().int().min(10).max(60).default(30),
  floatLayout: z.enum(['coins', 'haut', 'bas', 'cotes']).default('coins'),
  imageStyle: z.enum(['auto', 'full', 'objets', 'chrome']).default('auto'),
});
type TemplateInput = z.infer<typeof templateSchema>;

/** Valeurs prêtes pour la base (nullables explicités). */
function toRow(data: TemplateInput) {
  return {
    ...data,
    backgroundAssetId: data.backgroundAssetId ?? null,
    secondary: data.secondary ?? null,
    floatAssetId1: data.floatAssetId1 ?? null,
    floatAssetId2: data.floatAssetId2 ?? null,
  };
}

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

/** Slides témoin de l'aperçu : un vrai contenu par type de slide. */
const PREVIEW_SLIDES = {
  hook: {
    kind: 'hook',
    annotation: 'testé pour vous',
    title: 'Vos devis en 90 secondes chrono',
    accentWord: '90 secondes',
    body: "L'IA qui répond à vos prospects avant vos concurrents.",
  },
  value_prop: {
    kind: 'value_prop',
    badge: 'APERÇU',
    title: 'Vos devis en 90 secondes',
    accentWord: '90 secondes',
    body: 'Un aperçu de votre template avec un vrai texte, pour juger des contrastes.',
    bigNumber: '+27%',
  },
  content: {
    kind: 'content',
    badge: 'LA SOLUTION',
    title: "L'IA rédige, vous validez",
    accentWord: 'validez',
    bullets: ['Décrivez le besoin en 2 phrases', "L'IA génère le devis chiffré", 'Vous relisez et envoyez'],
  },
  notifications: {
    kind: 'notifications',
    badge: 'RÉSULTATS RÉELS',
    title: 'Pendant que vous dormez',
    accentWord: 'dormez',
    notifications: [
      { title: 'Devis signé ✓', body: 'Client Martin BTP · 4 290 €' },
      { title: 'Devis envoyé', body: 'Généré en 87 secondes' },
      { title: 'Nouveau prospect', body: 'Formulaire site → CRM' },
    ],
  },
  cta: {
    kind: 'cta',
    title: 'Envie du guide complet ?',
    accentWord: 'guide',
    body: 'Méthode pas à pas + 3 outils comparés pour automatiser vos devis.',
  },
} satisfies Record<string, SlideContent>;
type PreviewKind = keyof typeof PREVIEW_SLIDES;
const previewSchema = templateSchema.extend({
  kind: z.enum(['hook', 'value_prop', 'content', 'notifications', 'cta']).default('value_prop'),
});

let previewHeroCache: string | null = null;
/** Illustration témoin (placeholder de marque, en N&B si le réglage l'impose). */
async function previewHeroDataUri(monochrome: boolean): Promise<string> {
  if (previewHeroCache) return previewHeroCache;
  let pipeline = sharp(await generateMockPlaceholderBuffer());
  if (monochrome) pipeline = pipeline.grayscale();
  const jpg = await pipeline.jpeg({ quality: 80 }).toBuffer();
  previewHeroCache = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  return previewHeroCache;
}

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
    db.insert(schema.customThemes).values({ id, ...toRow(parsed.data) }).run();
    return { ok: true, id, themeId: customThemeId(id) };
  });

  /** Copie d'un template (pour décliner une variante sans repartir de zéro). */
  app.post<{ Params: { id: string } }>('/api/templates/:id/duplicate', async (request, reply) => {
    const source = db
      .select()
      .from(schema.customThemes)
      .where(eq(schema.customThemes.id, request.params.id))
      .get();
    if (!source) return reply.status(404).send({ error: 'Template introuvable' });
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = source;
    const name = `${source.name} (copie)`.slice(0, 60);
    const base = slugify(name) || 'template';
    let id = base;
    for (let n = 2; db.select().from(schema.customThemes).where(eq(schema.customThemes.id, id)).get(); n++) {
      id = `${base}-${n}`;
    }
    db.insert(schema.customThemes).values({ ...fields, id, name }).run();
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
      .set({ ...toRow(parsed.data), updatedAt: new Date().toISOString() })
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

  /** Aperçu à la volée : rend une slide témoin (du type demandé) sans rien enregistrer. */
  app.post('/api/templates/preview', async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const { kind, ...data } = parsed.data;
    const draft = { id: '__preview__', ...toRow(data), createdAt: '', updatedAt: '' };
    const slide = PREVIEW_SLIDES[kind as PreviewKind];
    const monochrome = getImageGen().monochrome;
    const withHero = kind === 'hook';
    const html = buildSlideHtml({
      theme: 'odile-nuit',
      kind: slide.kind,
      content: slide,
      format: 'carousel',
      brand: getBrand(),
      slideNum: kind === 'hook' ? 1 : kind === 'cta' ? 6 : 3,
      slideTotal: 6,
      keyword: kind === 'cta' ? 'OUTIL' : null,
      heroDataUri: withHero ? await previewHeroDataUri(monochrome) : null,
      monochromeHero: monochrome,
      themeCssOverride: buildCustomThemeCss(draft),
    });
    const png = await renderHtmlToPng(html, { width: 1080, height: 1350 });
    const small = await sharp(png).resize(432, 540).jpeg({ quality: 82 }).toBuffer();
    return reply.type('image/jpeg').send(small);
  });
}
