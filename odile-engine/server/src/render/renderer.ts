import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Eta } from 'eta';
import { customAlphabet } from 'nanoid';
import sharp from 'sharp';
import { RENDER_SIZES, slideContentSchema, type PostFormat, type SlideContent } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getImageGen } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { getBrowser } from './browser.js';
import { getCustomTheme, slideStyleFor } from './custom-theme.js';
import { floatCss, floatsOnSlide, type FloatLayout, type FloatSlides } from './floats.js';
import { iconSvg } from './icons.js';
import { isLightHex } from '../lib/color.js';
import { baseCss, defaultBrandLogoDataUri, fontFaceCss, slideTemplate, themeCss } from './themes.js';

const nanoAsset = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 21);
const eta = new Eta({ useWith: false, autoEscape: true });

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Enveloppe le mot accentué du titre dans un span serif italique. */
export function buildTitleHtml(title: string, accentWord?: string): string {
  const safe = escapeHtml(title);
  if (!accentWord) return safe;
  const safeAccent = escapeHtml(accentWord);
  const idx = safe.toLowerCase().indexOf(safeAccent.toLowerCase());
  if (idx === -1) return safe;
  return `${safe.slice(0, idx)}<span class="accent">${safe.slice(idx, idx + safeAccent.length)}</span>${safe.slice(idx + safeAccent.length)}`;
}

/** Corps de texte : échappé, avec `**gras**` → <strong> (deux tons). */
export function buildBodyHtml(body?: string | null): string {
  if (!body) return '';
  return escapeHtml(body).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Sous-titre sur deux tons : « le tueur silencieux des | conversions ».
 * Sans séparateur « | », le dernier mot passe en ton plein.
 */
export function buildSubtitleHtml(subtitle?: string | null): string {
  if (!subtitle || !subtitle.trim()) return '';
  const raw = subtitle.trim();
  let tone1: string;
  let tone2: string;
  if (raw.includes('|')) {
    const [a, ...rest] = raw.split('|');
    tone1 = (a ?? '').trim();
    tone2 = rest.join('|').trim();
  } else {
    const words = raw.split(/\s+/);
    tone2 = words.length > 1 ? words.pop()! : '';
    tone1 = words.join(' ');
  }
  return `${tone1 ? `<span class="tone-1">${escapeHtml(tone1)}</span>` : ''}${tone2 ? `<span class="tone-2">${escapeHtml(tone2)}</span>` : ''}`;
}

export interface SlideRenderInput {
  theme: string;
  kind: SlideContent['kind'];
  content: SlideContent;
  format: PostFormat;
  brand: ReturnType<typeof getBrand>;
  slideNum: number;
  slideTotal: number;
  keyword?: string | null;
  screenshotDataUri?: string | null;
  toolUrlDisplay?: string | null;
  logoDataUri?: string | null;
  /** photo de la chip auteur (sinon le logo) */
  avatarDataUri?: string | null;
  /** illustration générée (fond plein cadre sous un dégradé de lisibilité) */
  heroDataUri?: string | null;
  /** illustration du post, diffusée en écho flouté sur les slides sans hero */
  ambientHeroDataUri?: string | null;
  /** CSS de thème injecté directement (aperçu de template non enregistré) */
  themeCssOverride?: string;
  /** illustration en noir et blanc : pas de voile coloré par-dessus */
  monochromeHero?: boolean;
  /** illustration détourée (PNG alpha) : affichée entière, pas recadrée */
  heroContain?: boolean;
  /** CSS propre au post, injecté après le thème (objets flottants choisis) */
  postCss?: string;
  /** classes de la slide portées par le template (voile, CTA, placement, marque…) */
  slideClasses?: string[];
  /** variables CSS inline de la slide (échelle de l'objet) */
  slideStyle?: string;
  /** couleur signature détectée dans l'illustration : le mot accentué la reprend */
  popColor?: string | null;
  /** cette slide reçoit les objets flottants (template ou post) */
  floatsOn?: boolean;
}

/** Objets flottants et placement d'illustration propres à un post (« Visuels proposés »). */
export interface VisualOverrides {
  float1?: string | null;
  float2?: string | null;
  float3?: string | null;
  float4?: string | null;
  floatSize?: number;
  floatLayout?: FloatLayout;
  floatBleed?: boolean;
  floatTilt?: number;
  floatSlides?: FloatSlides;
  heroPlacement?: 'centre' | 'haut' | 'droite' | 'gauche';
  heroSize?: number;
}
export const FLOAT_KEYS = ['float1', 'float2', 'float3', 'float4'] as const;

export function parseVisualOverrides(raw: string | null): VisualOverrides {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as VisualOverrides;
  } catch {
    return {};
  }
}

const VERIFIED_SVG = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 2.1 3.1-.5 1 3 2.9 1.3-.6 3.1 2 2.4-2 2.4.6 3.1-2.9 1.3-1 3-3.1-.5L12 22l-2.4-2.1-3.1.5-1-3-2.9-1.3.6-3.1L1.2 12l2-2.4-.6-3.1 2.9-1.3 1-3 3.1.5z"/><path d="M10.2 15.6l-2.9-2.9 1.4-1.4 1.5 1.5 4.6-4.6 1.4 1.4z" fill="#fff"/></svg>`;

/** Construit le HTML complet d'une slide (coquille + template du kind). */
export function buildSlideHtml(input: SlideRenderInput): string {
  const { width, height } = RENDER_SIZES[input.format];
  const inner = eta.renderString(slideTemplate(input.kind), {
    content: input.content,
    titleHtml: buildTitleHtml(input.content.title, input.content.accentWord),
    subtitleHtml: buildSubtitleHtml(input.content.subtitle),
    bodyHtml: buildBodyHtml(input.content.body),
    iconSvg: iconSvg(input.content.icon),
    keyword: input.keyword ?? null,
    screenshotDataUri: input.screenshotDataUri ?? null,
    toolUrlDisplay: input.toolUrlDisplay ?? null,
  });

  // Pied de marque : le logo officiel (uploadé via le dashboard, sinon celui
  // embarqué dans templates/brand) remplace intégralement le texte « nom + handle ».
  const wordmarkUri = input.logoDataUri ?? defaultBrandLogoDataUri();
  const wordmark = wordmarkUri ? `<img class="brand-wordmark" src="${wordmarkUri}" alt="${escapeHtml(input.brand.name)}" />` : '';
  const brandBlock = wordmarkUri
    ? wordmark
    : `<div class="brand-id"><div class="brand-mark">${escapeHtml(initials(input.brand.name))}</div>
      <div><div class="brand-name">${escapeHtml(input.brand.name)}</div>
      <div class="brand-handle">${escapeHtml(input.brand.handle)}</div></div></div>`;
  // Chip auteur (masquée par défaut, activée par les templates « premium ») :
  // photo si elle est définie dans la marque, sinon le logo / les initiales.
  const avatar = input.avatarDataUri
    ? `<img class="author-avatar photo" src="${input.avatarDataUri}" alt="" />`
    : wordmarkUri
      ? `<img class="author-avatar" src="${wordmarkUri}" alt="" />`
      : `<span class="author-avatar">${escapeHtml(initials(input.brand.name))}</span>`;
  const authorLine = input.brand.authorLine?.trim() || input.brand.handle;
  const authorChip = `<div class="author-chip">${avatar}<div><div class="author-name">${escapeHtml(input.brand.name)}<span class="author-check">${VERIFIED_SVG(26)}</span></div><div class="author-handle">${escapeHtml(authorLine)}</div></div></div>`;
  const counter =
    input.slideTotal > 1
      ? input.slideNum < input.slideTotal
        ? `<div class="slide-counter">${pad(input.slideNum)}/${pad(input.slideTotal)} <span class="swipe">→ swipe</span></div>`
        : `<div class="slide-counter">${pad(input.slideNum)}/${pad(input.slideTotal)}</div>`
      : '';

  const classes = [
    'slide',
    `theme-${input.theme}`,
    `kind-${input.kind}`,
    input.heroDataUri ? 'has-hero' : '',
    input.monochromeHero ? 'mono-hero' : '',
    input.heroContain ? 'hero-contain' : '',
    input.popColor ? 'pop' : '',
    (input.floatsOn ?? floatsOnSlide(input.kind)) ? 'floats-on' : '',
    ...(input.slideClasses ?? slideStyleFor(null).classes),
  ]
    .filter(Boolean)
    .join(' ');
  const style = [input.slideStyle ?? '', input.popColor ? `--pop: ${input.popColor};` : ''].filter(Boolean).join(' ');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontFaceCss()}
${baseCss()}
/* Accent de marque avant le thème : un thème monochrome peut l'imposer */
:root { --accent: ${input.brand.accentColor}; }
${input.themeCssOverride ?? themeCss(input.theme)}
${input.postCss ?? ''}
html, body, .slide { width: ${width}px; height: ${height}px; }
</style></head>
<body>
<div class="${classes}"${style ? ` style="${style}"` : ''}>
  <div class="bg"></div>
  ${
    !input.heroDataUri && input.ambientHeroDataUri
      ? `<div class="hero-ambient" style="background-image:url(${input.ambientHeroDataUri})"></div>`
      : ''
  }
  <div class="decor-1"></div><div class="decor-2"></div><div class="decor-3"></div>
  ${input.heroContain ? '<div class="hero-glow"></div>' : ''}
  ${
    input.heroDataUri
      ? `<div class="hero-image" style="background-image:url(${input.heroDataUri})"></div><div class="hero-grade"></div><div class="hero-scrim"></div>`
      : ''
  }
  <div class="float-1"></div><div class="float-2"></div><div class="float-3"></div><div class="float-4"></div>
  ${authorChip}
  <div class="verified-badge">${VERIFIED_SVG(40)}</div>
  <div class="brand-top">${wordmark}</div>
  <div class="safe">
${inner}
  </div>
  <footer class="brand-footer">
    ${brandBlock}
    ${counter}
  </footer>
  <div class="grain"></div>
</div>
</body></html>`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Rend un HTML 1080×H en PNG via Chromium (réseau totalement bloqué).
 * Par défaut suréchantillonné (RENDER_SCALE = 2 : rendu en 2160×2700 puis
 * réduit) — typographie, dégradés et bords des détourages plus nets.
 */
export async function renderHtmlToPng(
  html: string,
  size: { width: number; height: number },
  opts: { scale?: number } = {},
): Promise<Buffer> {
  const scale = Math.max(1, Math.min(3, opts.scale ?? config.RENDER_SCALE));
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: scale });
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
      return route.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    // Attendre le chargement des polices (contexte navigateur, pas Node)
    await page.evaluate('document.fonts.ready');
    await page.waitForTimeout(120);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...size } });
    if (scale === 1) return png;
    return await sharp(png).resize(size.width, size.height, { kernel: 'lanczos3' }).png().toBuffer();
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Data URI d'un asset (null s'il est absent). */
export function assetDataUri(assetId: string | null): string | null {
  return assetInfo(assetId)?.dataUri ?? null;
}

/** Un asset est-il un détourage (PNG alpha posé entier) ? */
export function assetIsCutout(assetId: string | null): boolean {
  return assetInfo(assetId)?.cutout ?? false;
}

/** Data URI + indicateurs de rendu d'un asset (détouré → affiché entier ; couleur signature). */
function assetInfo(assetId: string | null): { dataUri: string; cutout: boolean; popColor: string | null } | null {
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  const data = fs.readFileSync(asset.path);
  let cutout = false;
  let popColor: string | null = null;
  try {
    const meta = asset.meta ? (JSON.parse(asset.meta) as { cutout?: boolean; popColor?: string | null }) : {};
    cutout = Boolean(meta.cutout);
    popColor = typeof meta.popColor === 'string' && /^#[0-9a-f]{6}$/i.test(meta.popColor) ? meta.popColor : null;
  } catch {
    cutout = false;
  }
  return { dataUri: `data:${asset.mime};base64,${data.toString('base64')}`, cutout, popColor };
}

export function saveAsset(
  data: Buffer,
  kind: 'render' | 'screenshot' | 'logo' | 'upload' | 'genimage' | 'library' | 'candidate',
  meta: { postId?: number | null; slideId?: number | null; extraMeta?: Record<string, unknown> },
  size?: { width?: number; height?: number },
  format: { ext: 'png' | 'jpg'; mime: string } = { ext: 'png', mime: 'image/png' },
): string {
  const id = nanoAsset();
  const filePath = path.join(config.assetsDir, `${id}.${format.ext}`);
  fs.writeFileSync(filePath, data);
  db.insert(schema.assets)
    .values({
      id,
      kind,
      postId: meta.postId ?? null,
      slideId: meta.slideId ?? null,
      path: filePath,
      width: size?.width ?? null,
      height: size?.height ?? null,
      mime: format.mime,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      meta: meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
    })
    .run();
  return id;
}

export interface RenderSummary {
  postId: number;
  slides: number;
  assetIds: string[];
}

/** Rend toutes les slides d'un post en PNG et met à jour slides.render_asset_id. */
export async function renderPost(postId: number): Promise<RenderSummary> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  if (slides.length === 0) throw new Error(`Post ${postId} sans slides`);

  const brand = getBrand();
  const logoDataUri = assetDataUri(brand.logoAssetId);
  const avatarDataUri = assetDataUri(brand.avatarAssetId);
  const monochromeHero = getImageGen().monochrome;
  const format = post.format as PostFormat;
  const size = RENDER_SIZES[format];
  const assetIds: string[] = [];
  const custom = getCustomTheme(post.theme);
  const darkTheme = custom ? isLightHex(custom.textColor) : post.theme !== 'papier-blanc';

  // L'illustration du post (celle du hook) diffuse un écho flouté sur les
  // slides sans image propre → harmonie colorimétrique sur tout le carrousel.
  const postHeroAssetId = slides.find((s) => s.heroAssetId)?.heroAssetId ?? null;
  const ambientHeroDataUri = assetDataUri(postHeroAssetId);
  // Objets flottants et placement propres au post (choisis dans « Visuels proposés »)
  const overrides = parseVisualOverrides(post.visualOverrides);
  const floatUris = FLOAT_KEYS.map((k) => assetDataUri(overrides[k] ?? null));
  const postCss = floatUris.some(Boolean)
    ? floatCss({
        uris: floatUris,
        size: overrides.floatSize ?? custom?.floatSize ?? 30,
        layout: overrides.floatLayout ?? (floatUris.filter(Boolean).length > 2 ? '4-coins' : 'coins'),
        mirrored: custom?.showAuthor ?? false,
        darkTheme,
        bleed: overrides.floatBleed ?? custom?.floatBleed ?? true,
        tilt: overrides.floatTilt ?? custom?.floatTilt ?? 12,
      })
    : undefined;
  const slideStyle = slideStyleFor(custom, overrides);
  const accentFromImage = custom ? custom.accentFromImage : true;
  const floatSlides: FloatSlides = overrides.floatSlides ?? custom?.floatSlides ?? 'centrees';

  for (const slide of slides) {
    const content = slideContentSchema.parse(JSON.parse(slide.content));
    const screenshotDataUri = assetDataUri(slide.screenshotAssetId);
    const hero = assetInfo(slide.heroAssetId);
    const html = buildSlideHtml({
      theme: post.theme,
      kind: content.kind,
      content,
      format,
      brand,
      slideNum: slide.idx + 1,
      slideTotal: slides.length,
      keyword: post.commentTriggerKeyword,
      screenshotDataUri,
      heroDataUri: hero?.dataUri ?? null,
      heroContain: hero?.cutout ?? false,
      monochromeHero,
      postCss,
      slideClasses: slideStyle.classes,
      slideStyle: slideStyle.style,
      popColor: accentFromImage && !monochromeHero && hero && !hero.cutout ? hero.popColor : null,
      floatsOn: floatsOnSlide(content.kind, floatSlides),
      toolUrlDisplay: content.toolUrl ? new URL(content.toolUrl).hostname : null,
      logoDataUri,
      avatarDataUri,
    });
    const png = await renderHtmlToPng(html, size);
    // Sanity : dimensions exactes
    const info = await sharp(png).metadata();
    if (info.width !== size.width || info.height !== size.height) {
      throw new Error(`Rendu inattendu ${info.width}×${info.height} (slide ${slide.idx})`);
    }
    const assetId = saveAsset(png, 'render', { postId, slideId: slide.id }, size);
    db.update(schema.slides)
      .set({ renderAssetId: assetId, updatedAt: new Date().toISOString() })
      .where(eq(schema.slides.id, slide.id))
      .run();
    assetIds.push(assetId);
    logger.debug({ postId, slide: slide.idx, assetId }, 'slide rendue');
  }

  db.update(schema.posts)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.posts.id, postId))
    .run();
  return { postId, slides: slides.length, assetIds };
}
