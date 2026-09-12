import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { DEFAULTS, THEMES, type SlideContent } from '@odile/shared';
import { db, schema } from '../../db/client.js';
import { getBrand, getDefaultTheme, getImageGen, setSetting } from '../../db/settingsRepo.js';
import { generateMockPlaceholderBuffer } from '../../imagegen/index.js';
import { buildCustomThemeCss, customThemeId, slideStyleFor } from '../../render/custom-theme.js';
import { assetDataUri, buildSlideHtml, renderHtmlToPng } from '../../render/renderer.js';
import { floatsOnSlide } from '../../render/floats.js';
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
  accentStyle: z.enum(['serif', 'plain', 'underline', 'highlight', 'argent']).default('serif'),
  accentLine: z.boolean().default(false),
  align: z.enum(['auto', 'left', 'center']).default('auto'),
  // Décor
  decor: z.enum(['orbes', 'halo', 'degrade', 'points', 'anneaux', 'arcs', 'disques', 'colonne', 'anneaux-larges', 'aucun']),
  bgTop: z.string().regex(HEX).nullable().optional(),
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
  brandStyle: z.enum(['auto', 'logo', 'initiales', 'logo-nom', 'aucun']).default('auto'),
  counterStyle: z.enum(['pilule', 'mono']).default('pilule'),
  // Pack premium
  titleGradient: z.enum(['aucun', 'accent', 'argent', 'horizontal']).default('aucun'),
  ctaStyle: z.enum(['verre', 'plein', 'degrade', 'chevron']).default('verre'),
  ctaArrow: z.enum(['droite', 'haut-droite', 'aucune']).default('droite'),
  bigNumberWeight: z.union([z.literal(300), z.literal(500), z.literal(900)]).default(900),
  showAuthor: z.boolean().default(false),
  showVerifiedBadge: z.boolean().default(false),
  brandPosition: z.enum(['bas', 'bas-centre', 'haut-centre']).default('bas'),
  floatAssetId1: z.string().max(30).nullable().optional(),
  floatAssetId2: z.string().max(30).nullable().optional(),
  floatAssetId3: z.string().max(30).nullable().optional(),
  floatAssetId4: z.string().max(30).nullable().optional(),
  floatSize: z.number().int().min(10).max(60).default(30),
  floatLayout: z.enum(['coins', 'haut', 'bas', 'cotes', '4-coins']).default('coins'),
  floatBleed: z.boolean().default(true),
  floatTilt: z.number().int().min(0).max(30).default(12),
  floatSlides: z.enum(['centrees', 'accroche', 'toutes']).default('centrees'),
  // Illustration
  imageStyle: z.enum(['auto', 'full', 'objets', 'chrome']).default('auto'),
  heroGrade: z.enum(['aucun', 'vif', 'teinte', 'doux']).default('vif'),
  heroPlacement: z.enum(['centre', 'haut', 'droite', 'gauche']).default('centre'),
  heroSize: z.number().int().min(60).max(140).default(100),
  heroGlow: z.boolean().default(true),
  popColor: z.union([z.literal('auto'), z.literal('aucune'), z.string().regex(HEX)]).default('auto'),
  accentFromImage: z.boolean().default(true),
  // Personnalisation fine
  bodyFont: z.enum(['inter', 'playfair', 'fragment']).default('inter'),
  bodyScale: z.number().int().min(60).max(140).default(100),
  bodyWeight: z.number().int().min(400).max(700).default(500),
  bodyOpacity: z.number().int().min(40).max(100).default(88),
  bodyColor: z.string().regex(HEX).nullable().optional(),
  lineHeight: z.enum(['serre', 'normal', 'aere']).default('normal'),
  titleTracking: z.number().int().min(-60).max(40).default(-25),
  titleColor: z.string().regex(HEX).nullable().optional(),
  blockGap: z.number().int().min(8).max(80).default(36),
  subtitleScale: z.number().int().min(60).max(140).default(100),
  subtitleTone: z.enum(['voile', 'plein']).default('voile'),
  verticalAlign: z.enum(['centre', 'haut', 'bas']).default('centre'),
  padTop: z.number().int().min(40).max(320).nullable().optional(),
  padSide: z.number().int().min(40).max(220).nullable().optional(),
  padBottom: z.number().int().min(80).max(360).nullable().optional(),
  badgeStyle: z.enum(['point', 'plein', 'contour', 'texte']).default('point'),
  badgeColor: z.string().regex(HEX).nullable().optional(),
  bulletGlyph: z.enum(['fleche', 'point', 'coche', 'numero', 'tiret']).default('fleche'),
  bulletColor: z.string().regex(HEX).nullable().optional(),
  iconBadgeSize: z.number().int().min(60).max(140).default(100),
  annotationFont: z.enum(['caveat', 'inter', 'fragment']).default('caveat'),
  annotationScale: z.number().int().min(60).max(140).default(100),
  annotationColor: z.string().regex(HEX).nullable().optional(),
  annotationTilt: z.number().int().min(-12).max(12).default(-4),
  ctaSize: z.number().int().min(60).max(130).default(100),
  logoSize: z.number().int().min(50).max(160).default(100),
  footerInset: z.number().int().min(40).max(160).default(96),
  footerBottom: z.number().int().min(24).max(120).default(56),
  counterSize: z.number().int().min(60).max(140).default(100),
  decorScale: z.number().int().min(60).max(140).default(100),
  bgTopSpread: z.number().int().min(5).max(45).default(15),
  heroScrim: z.number().int().min(0).max(100).default(100),
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
    floatAssetId3: data.floatAssetId3 ?? null,
    floatAssetId4: data.floatAssetId4 ?? null,
    bgTop: data.bgTop ?? null,
    bodyColor: data.bodyColor ?? null,
    titleColor: data.titleColor ?? null,
    padTop: data.padTop ?? null,
    padSide: data.padSide ?? null,
    padBottom: data.padBottom ?? null,
    badgeColor: data.badgeColor ?? null,
    bulletColor: data.bulletColor ?? null,
    annotationColor: data.annotationColor ?? null,
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
  objet: {
    kind: 'hook',
    title: 'Devis Express',
    accentWord: 'Express',
    body: 'Intégré à votre outil de gestion, **signé en 90 secondes**.',
  },
  value_prop: {
    kind: 'value_prop',
    title: 'des TPE perdent des devis faute de réponse.',
    accentWord: 'perdent',
    bigNumber: '87%',
    ctaLabel: 'Automatisez vos devis',
  },
  content: {
    kind: 'content',
    icon: 'chrono',
    title: 'Latence',
    subtitle: 'le tueur silencieux des | conversions',
    body: 'Des millisecondes qui décident si vous vendez… ou non.',
    ctaLabel: "Voyez l'impact réel sur votre CA",
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
  liste: {
    kind: 'content',
    badge: 'Étape 2',
    annotation: 'concrètement',
    title: "Ce que l'agent fait à votre place",
    accentWord: 'à votre place',
    bullets: [
      'Lit chaque demande entrante et la classe par urgence',
      'Rédige un devis conforme à votre grille tarifaire',
      'Relance automatiquement à J+2, J+5 et J+10',
      'Met à jour votre CRM sans double saisie',
    ],
    ctaLabel: 'Voir la démo complète',
  },
  capture: {
    kind: 'screenshot',
    title: "L'outil en action",
    toolName: 'Odile Studio',
    body: 'Un tableau de bord, zéro saisie.',
  },
  echo: {
    kind: 'echo',
    title: 'Répondre vite, c’est vendre.',
    echoWord: 'VITESSE',
    body: 'Chaque heure d’attente coûte 7 % de chances de signer.',
    ctaLabel: 'Réagir en 5 minutes',
  },
  bouton: {
    kind: 'cta',
    title: 'On en parle ?',
    body: 'Un appel de 20 minutes suffit pour cadrer votre premier agent.',
    ctaLabel: 'Réserver un créneau',
  },
} satisfies Record<string, SlideContent>;
type PreviewKind = keyof typeof PREVIEW_SLIDES;
const previewSchema = templateSchema.extend({
  kind: z.enum(['hook', 'objet', 'value_prop', 'content', 'liste', 'notifications', 'capture', 'echo', 'cta', 'bouton']).default('value_prop'),
  /** true : image pleine taille (1080×1350) pour la loupe ; sinon 540×675 */
  full: z.boolean().default(false),
});

const previewObjectCache = new Map<string, string>();
/** Objet détouré témoin (sphère de verre dessinée par sharp) pour l'aperçu du placement. */
async function previewObjectDataUri(accent: string): Promise<string> {
  const hit = previewObjectCache.get(accent);
  if (hit) return hit;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <defs>
    <radialGradient id="s" cx="0.38" cy="0.32" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="${accent}"/><stop offset="0.7" stop-color="#101428"/><stop offset="1" stop-color="#05060d"/></radialGradient>
    <radialGradient id="h" cx="0.35" cy="0.28" r="0.3"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="540" cy="560" r="330" fill="url(#s)"/>
  <circle cx="540" cy="560" r="330" fill="url(#h)"/>
  <circle cx="540" cy="560" r="326" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3"/>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const uri = `data:image/png;base64,${png.toString('base64')}`;
  previewObjectCache.set(accent, uri);
  return uri;
}

let previewShotCache: string | null = null;
/** Capture témoin (maquette d'interface dessinée par sharp) pour l'aperçu de la slide capture. */
async function previewScreenshotDataUri(): Promise<string> {
  if (previewShotCache) return previewShotCache;
  const rows = [0, 1, 2, 3, 4]
    .map((i) => `<rect x="60" y="${170 + i * 96}" width="${640 - (i % 3) * 120}" height="30" rx="8" fill="#ffffff" fill-opacity="0.16"/>
  <rect x="60" y="${212 + i * 96}" width="380" height="18" rx="6" fill="#ffffff" fill-opacity="0.08"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700">
  <rect width="1200" height="700" fill="#141a2e"/>
  <rect x="0" y="0" width="260" height="700" fill="#0e1325"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="28" y="${60 + i * 62}" width="${i === 1 ? 204 : 150}" height="22" rx="7" fill="#ffffff" fill-opacity="${i === 1 ? 0.5 : 0.14}"/>`).join('')}
  <rect x="320" y="60" width="820" height="74" rx="14" fill="#1c2440"/>
  <rect x="340" y="86" width="260" height="22" rx="7" fill="#ffffff" fill-opacity="0.5"/>
  <rect x="320" y="160" width="820" height="480" rx="14" fill="#1c2440"/>
  <g transform="translate(300 0)">${rows}</g>
  <rect x="930" y="560" width="180" height="52" rx="26" fill="#3b82f6"/>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  previewShotCache = `data:image/png;base64,${png.toString('base64')}`;
  return previewShotCache;
}

const previewHeroCache = new Map<'0' | '1', string>();
/** Illustration témoin (placeholder de marque, en N&B si le réglage l'impose). */
async function previewHeroDataUri(monochrome: boolean): Promise<string> {
  const key = monochrome ? '1' : '0';
  const hit = previewHeroCache.get(key);
  if (hit) return hit;
  let pipeline = sharp(await generateMockPlaceholderBuffer());
  if (monochrome) pipeline = pipeline.grayscale();
  const jpg = await pipeline.jpeg({ quality: 80 }).toBuffer();
  const uri = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  previewHeroCache.set(key, uri);
  return uri;
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
    const ids = db.select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.theme, themeId)).all().map((p) => p.id);
    if (ids.length) db.update(schema.slides).set({ renderAssetId: null }).where(inArray(schema.slides.postId, ids)).run();
    return { ok: true, postsToRerender: ids.length };
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
    const { kind, full, ...data } = parsed.data;
    const draft = { id: '__preview__', ...toRow(data), createdAt: '', updatedAt: '' };
    const slide = PREVIEW_SLIDES[kind as PreviewKind];
    const monochrome = getImageGen().monochrome;
    const withHero = kind === 'hook';
    const withObject = kind === 'objet';
    const brand = getBrand();
    const style = slideStyleFor(draft, {}, slide.kind);
    const html = buildSlideHtml({
      theme: 'odile-nuit',
      kind: slide.kind,
      content: slide,
      format: 'carousel',
      brand,
      slideNum: kind === 'hook' || kind === 'objet' ? 1 : kind === 'cta' || kind === 'bouton' ? 6 : 3,
      slideTotal: 6,
      keyword: kind === 'cta' ? 'OUTIL' : null,
      screenshotDataUri: kind === 'capture' ? await previewScreenshotDataUri() : null,
      toolUrlDisplay: kind === 'capture' ? 'app.odile.ai' : null,
      heroDataUri: withHero ? await previewHeroDataUri(monochrome) : withObject ? await previewObjectDataUri(draft.accent) : null,
      heroContain: withObject,
      monochromeHero: monochrome,
      themeCssOverride: buildCustomThemeCss(draft),
      slideClasses: style.classes,
      slideStyle: style.style,
      floatsOn: floatsOnSlide(slide.kind, draft.floatSlides),
      logoDataUri: assetDataUri(brand.logoAssetId),
      avatarDataUri: assetDataUri(brand.avatarAssetId),
      brandStyle: style.brandStyle,
      authorOn: style.authorOn,
    });
    const png = await renderHtmlToPng(html, { width: 1080, height: 1350 }, { scale: full ? 2 : 1 });
    const out = full
      ? await sharp(png).jpeg({ quality: 88 }).toBuffer()
      : await sharp(png).resize(540, 675).jpeg({ quality: 84 }).toBuffer();
    return reply.type('image/jpeg').send(out);
  });
}
