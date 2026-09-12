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
import { buildCustomThemeCss, getCustomTheme, slideStyleFor } from './custom-theme.js';
import { floatCss, floatsOnSlide, type FloatLayout, type FloatSlides } from './floats.js';
import { iconSvg } from './icons.js';
import { isLightHex } from '../lib/color.js';
import { baseCss, defaultBrandLogoDataUri, fontFaceCss, slideTemplate, themeCss } from './themes.js';
import { brandBlockHtml, brandInitials, resolveBrandStyle, type TemplateBrandStyle } from './brand.js';

const nanoAsset = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 21);
const eta = new Eta({ useWith: false, autoEscape: true });

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Typographie française : espace fine insécable devant « : ; ! ? » » et après « « »,
 * pour qu'un signe de ponctuation ne se retrouve jamais seul en début de ligne.
 */
export function frTypo(s: string): string {
  return s.replace(/ ([:;!?»])/g, '\u202F$1').replace(/« /g, '«\u202F');
}

/** Enveloppe le mot accentué du titre dans un span serif italique. */
export function buildTitleHtml(title: string, accentWord?: string): string {
  const safe = escapeHtml(frTypo(title));
  if (!accentWord) return safe;
  const safeAccent = escapeHtml(frTypo(accentWord));
  const idx = safe.toLowerCase().indexOf(safeAccent.toLowerCase());
  if (idx === -1) return safe;
  return `${safe.slice(0, idx)}<span class="accent">${safe.slice(idx, idx + safeAccent.length)}</span>${safe.slice(idx + safeAccent.length)}`;
}

/** Corps de texte : échappé, avec `**gras**` → <strong> (deux tons). */
export function buildBodyHtml(body?: string | null): string {
  if (!body) return '';
  return escapeHtml(frTypo(body)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Sous-titre sur deux tons : « le tueur silencieux des | conversions ».
 * Sans séparateur « | », le dernier mot passe en ton plein.
 */
export function buildSubtitleHtml(subtitle?: string | null): string {
  if (!subtitle || !subtitle.trim()) return '';
  const raw = frTypo(subtitle.trim());
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
  /** pied de marque demandé par le template (auto = réglage de la marque) */
  brandStyle?: TemplateBrandStyle;
  /** la chip auteur est affichée (le pied évite alors le doublon nom + handle) */
  authorOn?: boolean;
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
  const content: SlideContent = {
    ...input.content,
    bullets: input.content.bullets?.map(frTypo),
    notifications: input.content.notifications?.map((n) => ({ title: frTypo(n.title), body: frTypo(n.body) })),
    ctaLabel: input.content.ctaLabel ? frTypo(input.content.ctaLabel) : input.content.ctaLabel,
    footer: input.content.footer ? frTypo(input.content.footer) : input.content.footer,
  };
  const inner = eta.renderString(slideTemplate(input.kind), {
    content,
    titleHtml: buildTitleHtml(input.content.title, input.content.accentWord),
    subtitleHtml: buildSubtitleHtml(input.content.subtitle),
    bodyHtml: buildBodyHtml(input.content.body),
    iconSvg: iconSvg(input.content.icon),
    keyword: input.keyword ?? null,
    screenshotDataUri: input.screenshotDataUri ?? null,
    toolUrlDisplay: input.toolUrlDisplay ?? null,
  });

  // Pied de marque : logo officiel (uploadé, sinon celui embarqué dans
  // templates/brand), carré aux initiales + nom + handle, ou rien — selon le
  // template puis le réglage de la marque (même règle que l'aperçu).
  const wordmarkUri = input.logoDataUri ?? defaultBrandLogoDataUri();
  const authorOn = input.authorOn ?? false;
  const brandStyle = resolveBrandStyle(input.brandStyle, input.brand, { hasLogo: Boolean(wordmarkUri), authorOn });
  const brandBlock = brandBlockHtml(brandStyle, input.brand, wordmarkUri);
  // Chip auteur (masquée par défaut, activée par les templates « premium ») :
  // photo si elle est définie dans la marque, sinon le logo ou les initiales.
  const avatar = input.avatarDataUri
    ? `<img class="author-avatar photo" src="${input.avatarDataUri}" alt="" />`
    : wordmarkUri && (brandStyle === 'logo' || brandStyle === 'logo-nom' || input.brand.footerStyle === 'logo')
      ? `<img class="author-avatar" src="${wordmarkUri}" alt="" />`
      : `<span class="author-avatar">${escapeHtml(brandInitials(input.brand))}</span>`;
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
    `brand-style-${brandStyle}`,
    ...(input.slideClasses ?? slideStyleFor(null, {}, input.kind).classes),
  ]
    .filter(Boolean)
    .join(' ');
  const style = [input.slideStyle ?? '', input.popColor ? `--pop: ${input.popColor};` : ''].filter(Boolean).join(' ');
  // Slide écho : le mot répété tapisse le fond, hors de la pile de texte (jamais réduit avec elle)
  const echoWord = input.kind === 'echo' ? escapeHtml((input.content.echoWord || input.content.title).toUpperCase()) : '';
  const echoStack = echoWord
    ? `<div class="echo-stack" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<div class="echo-line echo-${i}">${echoWord}</div>`).join('')}</div>`
    : '';

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
  <div class="brand-top">${brandBlock}</div>
  ${echoStack}
  <div class="safe"><div class="stack">
${inner}
  </div></div>
  <footer class="brand-footer">
    ${brandBlock}
    ${counter}
  </footer>
  <div class="grain"></div>
</div>
</body></html>`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Ajustement automatique : si le bloc de texte déborde du cadre (gros chiffre +
 * titre + corps), il est réduit d'un facteur unique (jamais sous 55 %) en
 * gardant son ancrage (centré, ou en bas sous une illustration). Exécuté dans
 * la page avant la capture — aucune slide ne sort avec un texte coupé.
 */
const FIT_SCRIPT = `(() => {
  const slide = document.querySelector('.slide');
  const safe = document.querySelector('.safe');
  const stack = document.querySelector('.safe > .stack');
  if (!slide || !safe || !stack) return 1;
  const cs = getComputedStyle(safe);
  const px = (v) => parseFloat(v) || 0;
  // Les calques absolus (fond répété de l'écho…) ne comptent pas dans la pile
  const kids = Array.from(stack.children).filter((el) => getComputedStyle(el).position !== 'absolute');
  const avail = slide.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  const innerW = safe.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const contentWidth = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Math.max(el.getBoundingClientRect().width, range.getBoundingClientRect().width);
  };
  // 1. Les éléments d'une ligne (gros chiffre, boutons, mot-clé, badge) sont réduits seuls s'ils dépassent en largeur
  for (const el of stack.querySelectorAll('.big-number, .cta-button, .keyword-chip, .badge')) {
    const base = px(getComputedStyle(el).fontSize);
    let f = 1;
    while (contentWidth(el) > innerW && f > 0.5) {
      f -= 0.04;
      el.style.fontSize = Math.round(base * f) + 'px';
    }
  }
  const measure = () => {
    const needed = stack.getBoundingClientRect().height;
    const widest = kids.reduce((w, el) => Math.max(w, contentWidth(el)), 0);
    return Math.min(1, avail / needed, widest > innerW ? innerW / widest : 1);
  };
  // 2. Avant de réduire fortement : version compacte (liste resserrée, badge icône retiré, titre réduit sous un objet)
  let scale = measure();
  if (scale < 0.72) {
    slide.classList.add('fit-compact');
    scale = measure();
  }
  // 3. Puis la pile entière si elle dépasse encore (jamais sous 60 %)
  scale = Math.max(0.6, Math.floor(scale * 100) / 100);
  if (scale < 1) {
    const centered = slide.classList.contains('align-center') || cs.alignItems === 'center';
    const ox = centered ? '50%' : '0%';
    const oy = cs.justifyContent === 'flex-end' ? '100%' : cs.justifyContent === 'flex-start' ? '0%' : '50%';
    stack.style.transformOrigin = ox + ' ' + oy;
    stack.style.transform = 'scale(' + scale + ')';
  }
  // Haut du bloc de texte (après réduction) : le voile de lisibilité des images s'y accroche
  slide.style.setProperty('--text-top', Math.round(stack.getBoundingClientRect().top) + 'px');
  return scale;
})()`;

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
    const fit = (await page.evaluate(FIT_SCRIPT)) as number;
    if (fit < 1) logger.debug({ fit }, 'texte réduit pour tenir dans la slide');
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

/** Un asset est-il un détourage (PNG alpha posé entier) ? — lit la meta seule, jamais le fichier. */
export function assetIsCutout(assetId: string | null): boolean {
  if (!assetId) return false;
  const row = db.select({ meta: schema.assets.meta }).from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  return parseAssetMeta(row?.meta ?? null).cutout;
}

function parseAssetMeta(raw: string | null): { cutout: boolean; popColor: string | null } {
  try {
    const meta = raw ? (JSON.parse(raw) as { cutout?: boolean; popColor?: string | null }) : {};
    return {
      cutout: Boolean(meta.cutout),
      popColor: typeof meta.popColor === 'string' && /^#[0-9a-f]{6}$/i.test(meta.popColor) ? meta.popColor : null,
    };
  } catch {
    return { cutout: false, popColor: null };
  }
}

/** Data URI + indicateurs de rendu d'un asset (détouré → affiché entier ; couleur signature). */
function assetInfo(assetId: string | null): { dataUri: string; cutout: boolean; popColor: string | null } | null {
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  const data = fs.readFileSync(asset.path);
  const { cutout, popColor } = parseAssetMeta(asset.meta);
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

/** Exécute des tâches asynchrones avec au plus `limit` en parallèle, en conservant l'ordre des résultats. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Rend les slides d'un post en PNG (3 en parallèle) et met à jour
 * slides.render_asset_id. `onlyIdx` : une seule slide (action ciblée de
 * l'éditeur : illustration posée, slide régénérée) — les autres gardent leur rendu.
 */
export async function renderPost(postId: number, opts: { onlyIdx?: number } = {}): Promise<RenderSummary> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const allSlides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  if (allSlides.length === 0) throw new Error(`Post ${postId} sans slides`);
  // Rendu partiel : la slide visée, plus celles dont le rendu a été invalidé entre-temps
  const slides =
    opts.onlyIdx === undefined ? allSlides : allSlides.filter((s) => s.idx === opts.onlyIdx || !s.renderAssetId);
  if (opts.onlyIdx !== undefined && !allSlides.some((s) => s.idx === opts.onlyIdx)) {
    throw new Error(`Slide ${opts.onlyIdx} introuvable`);
  }

  const brand = getBrand();
  const logoDataUri = assetDataUri(brand.logoAssetId);
  const avatarDataUri = assetDataUri(brand.avatarAssetId);
  const monochromeHero = getImageGen().monochrome;
  const format = post.format as PostFormat;
  const size = RENDER_SIZES[format];
  const assetIds: string[] = [];
  const custom = getCustomTheme(post.theme);
  const darkTheme = custom ? isLightHex(custom.textColor) : post.theme !== 'papier-blanc';
  // CSS du template maison (image de fond + objets en base64) construit une seule fois pour tout le post
  const themeCssOverride = custom ? buildCustomThemeCss(custom) : undefined;
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
  const accentFromImage = custom ? custom.accentFromImage : true;
  const floatSlides: FloatSlides = overrides.floatSlides ?? custom?.floatSlides ?? 'centrees';

  const rendered = await mapLimit(slides, 3, async (slide) => {
    const content = slideContentSchema.parse(JSON.parse(slide.content));
    const screenshotDataUri = assetDataUri(slide.screenshotAssetId);
    const hero = assetInfo(slide.heroAssetId);
    // Objet détouré sans placement choisi pour ce post : à droite du texte sur une slide
    // de contenu (titre + puces), petit et ancré en haut sur les cartes / captures (qui ont
    // besoin de toute la largeur), au-dessus du titre ailleurs.
    let autoPlacement = overrides;
    if (hero?.cutout && !overrides.heroPlacement) {
      if (content.kind === 'content') autoPlacement = { ...overrides, heroPlacement: 'droite' };
      else if (content.kind === 'notifications' || content.kind === 'screenshot') {
        autoPlacement = { ...overrides, heroPlacement: 'haut', heroSize: Math.min(overrides.heroSize ?? custom?.heroSize ?? 100, 70) };
      }
    }
    const perSlide = slideStyleFor(custom, autoPlacement, content.kind);
    const html = buildSlideHtml({
      theme: post.theme,
      kind: content.kind,
      content,
      format,
      brand,
      slideNum: slide.idx + 1,
      slideTotal: allSlides.length,
      keyword: post.commentTriggerKeyword,
      screenshotDataUri,
      heroDataUri: hero?.dataUri ?? null,
      heroContain: hero?.cutout ?? false,
      monochromeHero,
      postCss,
      slideClasses: perSlide.classes,
      slideStyle: perSlide.style,
      popColor: accentFromImage && !monochromeHero && hero && !hero.cutout ? hero.popColor : null,
      floatsOn: floatsOnSlide(content.kind, floatSlides),
      toolUrlDisplay: content.toolUrl ? new URL(content.toolUrl).hostname.replace(/^www\./, '').slice(0, 40) : null,
      logoDataUri,
      avatarDataUri,
      themeCssOverride,
      brandStyle: perSlide.brandStyle,
      authorOn: perSlide.authorOn,
    });
    const png = await renderHtmlToPng(html, size);
    // Sanity : dimensions exactes
    const info = await sharp(png).metadata();
    if (info.width !== size.width || info.height !== size.height) {
      throw new Error(`Rendu inattendu ${info.width}×${info.height} (slide ${slide.idx})`);
    }
    return { slide, png };
  });
  for (const { slide, png } of rendered) {
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
