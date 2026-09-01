import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { extractJson } from '../llm/provider.js';
import { logger } from '../lib/logger.js';
import { canonicalizeUrl, contentHash } from './dedupe.js';

const WEBSEARCH_SOURCE_NAME = 'Recherche web IA';

const resultSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(5).max(200),
        url: z.string().url(),
        summary: z.string().max(400),
        why: z.string().max(200),
      }),
    )
    .max(6),
});

export interface WebsearchSummary {
  skipped?: string;
  found: number;
  inserted: number;
}

function getWebsearchSource() {
  let source = db
    .select()
    .from(schema.newsSources)
    .where(eq(schema.newsSources.name, WEBSEARCH_SOURCE_NAME))
    .get();
  if (!source) {
    source = db
      .insert(schema.newsSources)
      .values({ name: WEBSEARCH_SOURCE_NAME, kind: 'websearch', url: 'internal:websearch', lang: 'fr', weight: 1.2 })
      .returning()
      .get();
  }
  return source;
}

/**
 * Collecte quotidienne par recherche web (Claude + outil serveur web_search) :
 * attrape les actualités hors flux RSS. Les items stockent titre + URL + un
 * bref résumé original — l'article source est ensuite traité comme les autres.
 */
export async function runWebsearch(): Promise<WebsearchSummary> {
  if (config.LLM_MODE === 'mock') return { skipped: 'mode mock', found: 0, inserted: 0 };
  if (!config.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY absente', found: 0, inserted: 0 };
  const source = getWebsearchSource();
  if (!source.enabled) return { skipped: 'source désactivée', found: 0, inserted: 0 };

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const prompt = `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
Cherche sur le web les actualités IA des dernières 24 heures les plus pertinentes pour ce public :
nouveaux outils accessibles, annonces majeures utilisables par une PME, tutoriels/cas d'usage concrets,
actualité française du secteur. Ignore la recherche fondamentale et la géopolitique.

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 3 à 5 items —
"title" en français, "url" = l'article source précis (pas une home page), "summary" = 2 phrases
factuelles écrites par toi, "why" = pourquoi c'est pertinent pour une PME française.`;

  const webSearchTool = (type: string) =>
    ({ type, name: 'web_search', max_uses: 5 }) as unknown as Anthropic.Messages.ToolUnion;

  let text = '';
  for (const toolType of ['web_search_20260209', 'web_search_20250305']) {
    try {
      const response = await client.messages.create({
        model: config.ANTHROPIC_MODEL_WRITER,
        max_tokens: 16000,
        tools: [webSearchTool(toolType)],
        messages: [{ role: 'user', content: prompt }],
      });
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) break;
    } catch (err) {
      logger.warn({ toolType, err: String(err).slice(0, 200) }, 'websearch : variante d’outil en échec');
    }
  }
  if (!text) return { skipped: 'aucune réponse du modèle', found: 0, inserted: 0 };

  const parsed = resultSchema.safeParse(JSON.parse(extractJson(text)));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues.slice(0, 3) }, 'websearch : JSON invalide');
    return { skipped: 'réponse invalide', found: 0, inserted: 0 };
  }

  let inserted = 0;
  for (const item of parsed.data.items) {
    const canonical = canonicalizeUrl(item.url);
    const rows = db
      .insert(schema.newsItems)
      .values({
        sourceId: source.id,
        url: item.url,
        canonicalUrl: canonical,
        contentHash: contentHash(canonical),
        title: item.title,
        summary: `${item.summary} — ${item.why}`,
        publishedAt: new Date().toISOString(),
        lang: 'fr',
      })
      .onConflictDoNothing({ target: schema.newsItems.contentHash })
      .returning({ id: schema.newsItems.id })
      .all();
    if (rows.length > 0) inserted++;
  }
  return { found: parsed.data.items.length, inserted };
}
