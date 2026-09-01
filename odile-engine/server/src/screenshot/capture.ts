import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getBrowser } from '../render/browser.js';
import { saveAsset } from '../render/renderer.js';
import { dismissCookieBanners } from './cookieBanners.js';
import { validateScreenshot } from './validate.js';

export interface CaptureResult {
  assetId: string | null;
  ok: boolean;
  reason: string;
}

/** Capture une page web (1440×900) avec fermeture des bannières et validation. */
export async function captureUrl(
  url: string,
  meta: { postId?: number; slideId?: number } = {},
): Promise<CaptureResult> {
  const browser = await getBrowser();
  let lastReason = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      deviceScaleFactor: 1.5,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 * attempt });
      await page.waitForLoadState('networkidle', { timeout: 12_000 * attempt }).catch(() => undefined);
      await dismissCookieBanners(page);
      await page.waitForTimeout(attempt === 1 ? 1200 : 3500);
      const png = await page.screenshot({ type: 'png' });

      const validation = await validateScreenshot(png);
      if (!validation.ok) {
        lastReason = validation.reason;
        logger.warn({ url, attempt, reason: validation.reason }, 'capture invalide');
        continue;
      }
      const assetId = saveAsset(
        png,
        'screenshot',
        {
          postId: meta.postId ?? null,
          slideId: meta.slideId ?? null,
          extraMeta: {
            sourceUrl: url,
            variance: validation.variance,
            visionOk: validation.visionOk,
            visionReason: validation.reason,
            capturedAt: new Date().toISOString(),
          },
        },
        { width: 2160, height: 1350 },
      );
      return { assetId, ok: true, reason: validation.reason };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
      logger.warn({ url, attempt, err: lastReason }, 'échec de capture');
    } finally {
      await context.close().catch(() => undefined);
    }
  }
  return { assetId: null, ok: false, reason: lastReason || 'Capture impossible' };
}

/**
 * Capture l'URL d'outil d'un post et l'attache à sa slide "screenshot".
 * En cas d'échec, la slide bascule en kind "content" (fallback sans capture).
 */
export async function captureForPost(postId: number, url: string | null): Promise<CaptureResult> {
  const slide = db
    .select()
    .from(schema.slides)
    .where(and(eq(schema.slides.postId, postId), eq(schema.slides.kind, 'screenshot')))
    .get();
  if (!slide) return { assetId: null, ok: true, reason: 'Pas de slide screenshot dans ce post' };

  const content = JSON.parse(slide.content) as { toolUrl?: string };
  const target = content.toolUrl ?? url;
  if (!target) {
    demoteSlide(slide.id, slide.content);
    return { assetId: null, ok: false, reason: 'Aucune URL à capturer — slide convertie en contenu' };
  }

  const result = await captureUrl(target, { postId, slideId: slide.id });
  if (result.ok && result.assetId) {
    db.update(schema.slides)
      .set({ screenshotAssetId: result.assetId, updatedAt: new Date().toISOString() })
      .where(eq(schema.slides.id, slide.id))
      .run();
  } else {
    demoteSlide(slide.id, slide.content);
  }
  return result;
}

function demoteSlide(slideId: number, contentJson: string): void {
  const content = JSON.parse(contentJson) as Record<string, unknown>;
  content.kind = 'content';
  db.update(schema.slides)
    .set({ kind: 'content', content: JSON.stringify(content), updatedAt: new Date().toISOString() })
    .where(eq(schema.slides.id, slideId))
    .run();
}
