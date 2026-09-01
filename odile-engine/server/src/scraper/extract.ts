import { eq } from 'drizzle-orm';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { db, schema } from '../db/client.js';
import { fetchWithRetry } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const MAX_CHARS = 8000;
const MIN_USEFUL_CHARS = 400;

export interface ExtractResult {
  ok: boolean;
  text: string | null;
  method: 'readability' | 'chromium' | 'none';
}

/**
 * Extrait le texte principal d'un article (usage interne : scoring et
 * synthèse — les posts produits sont des réécritures originales qui citent
 * et pointent vers la source, jamais des reproductions).
 */
export async function extractArticle(url: string): Promise<ExtractResult> {
  // 1. Fetch HTML + Readability (rapide, couvre la grande majorité des sites)
  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
      },
      retries: 1,
      timeoutMs: 20_000,
    });
    if (res.ok) {
      const html = await res.text();
      const { document } = parseHTML(html);
      // linkedom fournit un DOM compatible ; le tsconfig serveur n'embarque pas lib.dom
      const article = new Readability(
        document as unknown as ConstructorParameters<typeof Readability>[0],
        { charThreshold: 250 },
      ).parse();
      const text = cleanText(article?.textContent ?? '');
      if (text.length >= MIN_USEFUL_CHARS) {
        return { ok: true, text: text.slice(0, MAX_CHARS), method: 'readability' };
      }
    } else {
      await res.body?.cancel();
    }
  } catch (err) {
    logger.debug({ url, err: String(err).slice(0, 150) }, 'extraction readability en échec');
  }

  // 2. Fallback Chromium (pages rendues en JS)
  try {
    const { getBrowser } = await import('../render/browser.js');
    const browser = await getBrowser();
    const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
      const text = cleanText(
        await page.evaluate(`(() => {
          for (const sel of ['nav','header','footer','aside','script','style','form']) {
            document.querySelectorAll(sel).forEach((el) => el.remove());
          }
          const main = document.querySelector('article, main, [role="main"]') || document.body;
          return main.innerText || '';
        })()`) as string,
      );
      if (text.length >= MIN_USEFUL_CHARS) {
        return { ok: true, text: text.slice(0, MAX_CHARS), method: 'chromium' };
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch (err) {
    logger.debug({ url, err: String(err).slice(0, 150) }, 'extraction chromium en échec');
  }

  return { ok: false, text: null, method: 'none' };
}

/** Extrait et persiste le texte d'un item (non bloquant, idempotent). */
export async function extractForItem(itemId: number): Promise<boolean> {
  const item = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, itemId)).get();
  if (!item) return false;
  if (item.contentText) return true;
  const result = await extractArticle(item.url);
  db.update(schema.newsItems)
    .set({ contentText: result.text, extractedAt: new Date().toISOString() })
    .where(eq(schema.newsItems.id, itemId))
    .run();
  return result.ok;
}

function cleanText(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
