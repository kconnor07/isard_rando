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
import { getBrand } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { getBrowser } from './browser.js';
import { baseCss, fontFaceCss, slideTemplate, themeCss } from './themes.js';

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
}

/** Construit le HTML complet d'une slide (coquille + template du kind). */
export function buildSlideHtml(input: SlideRenderInput): string {
  const { width, height } = RENDER_SIZES[input.format];
  const inner = eta.renderString(slideTemplate(input.kind), {
    content: input.content,
    titleHtml: buildTitleHtml(input.content.title, input.content.accentWord),
    keyword: input.keyword ?? null,
    screenshotDataUri: input.screenshotDataUri ?? null,
    toolUrlDisplay: input.toolUrlDisplay ?? null,
  });

  const brandBlock = input.logoDataUri
    ? `<img class="brand-logo" src="${input.logoDataUri}" alt="" />`
    : `<div class="brand-mark">${escapeHtml(initials(input.brand.name))}</div>`;
  const counter =
    input.slideTotal > 1
      ? input.slideNum < input.slideTotal
        ? `<div class="slide-counter">${pad(input.slideNum)}/${pad(input.slideTotal)} <span class="swipe">→ swipe</span></div>`
        : `<div class="slide-counter">${pad(input.slideNum)}/${pad(input.slideTotal)}</div>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontFaceCss()}
${baseCss()}
${themeCss(input.theme)}
:root { --accent: ${input.brand.accentColor}; }
html, body, .slide { width: ${width}px; height: ${height}px; }
</style></head>
<body>
<div class="slide theme-${input.theme} kind-${input.kind}">
  <div class="bg"></div>
  <div class="decor-1"></div><div class="decor-2"></div><div class="decor-3"></div>
  <div class="safe">
${inner}
  </div>
  <footer class="brand-footer">
    <div class="brand-id">
      ${brandBlock}
      <div>
        <div class="brand-name">${escapeHtml(input.brand.name)}</div>
        <div class="brand-handle">${escapeHtml(input.brand.handle)}</div>
      </div>
    </div>
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

/** Rend un HTML 1080×H en PNG via Chromium (réseau totalement bloqué). */
export async function renderHtmlToPng(
  html: string,
  size: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
      return route.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...size } });
  } finally {
    await page.close().catch(() => undefined);
  }
}

function assetDataUri(assetId: string | null): string | null {
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  const data = fs.readFileSync(asset.path);
  return `data:${asset.mime};base64,${data.toString('base64')}`;
}

export function saveAsset(
  png: Buffer,
  kind: 'render' | 'screenshot' | 'logo' | 'upload',
  meta: { postId?: number | null; slideId?: number | null; extraMeta?: Record<string, unknown> },
  size?: { width?: number; height?: number },
): string {
  const id = nanoAsset();
  const filePath = path.join(config.assetsDir, `${id}.png`);
  fs.writeFileSync(filePath, png);
  db.insert(schema.assets)
    .values({
      id,
      kind,
      postId: meta.postId ?? null,
      slideId: meta.slideId ?? null,
      path: filePath,
      width: size?.width ?? null,
      height: size?.height ?? null,
      mime: 'image/png',
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
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
  const format = post.format as PostFormat;
  const size = RENDER_SIZES[format];
  const assetIds: string[] = [];

  for (const slide of slides) {
    const content = slideContentSchema.parse(JSON.parse(slide.content));
    const screenshotDataUri = assetDataUri(slide.screenshotAssetId);
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
      toolUrlDisplay: content.toolUrl ? new URL(content.toolUrl).hostname : null,
      logoDataUri,
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
