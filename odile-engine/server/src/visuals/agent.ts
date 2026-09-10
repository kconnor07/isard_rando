import { desc, and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';
import type { SlideContent } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { getBrand, getImageGen, getVisualAgent } from '../db/settingsRepo.js';
import { fitCutout, removeImageBackground } from '../imagegen/cutout.js';
import { generateImageBuffer } from '../imagegen/index.js';
import { buildImagePrompt, styleForArchetype, type ImageStyle } from '../imagegen/prompt.js';
import { fetchWithRetry } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { getCustomTheme } from '../render/custom-theme.js';
import { saveAsset } from '../render/renderer.js';
import { captureUrl } from '../screenshot/capture.js';

/** Métadonnées d'une proposition visuelle (asset de kind `candidate`). */
export interface CandidateMeta {
  origin: 'screenshot' | 'image';
  label: string;
  why?: string;
  url?: string;
  prompt?: string;
  slideIdx?: number | null;
  model?: string;
  monochrome?: boolean;
  /** style d'image (full / objets / chrome) et détourage (PNG transparent) */
  style?: ImageStyle;
  cutout?: boolean;
  batch: number;
}

export interface VisualCandidate extends CandidateMeta {
  id: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface VisualRunSummary {
  postId: number;
  batch: number;
  screenshots: number;
  images: number;
  failed: number;
  planner: string;
}

const planSchema = z.object({
  screenshots: z
    .array(z.object({ url: z.string().url(), label: z.string().max(60), why: z.string().max(140) }))
    .max(6),
  images: z
    .array(
      z.object({
        label: z.string().max(60),
        prompt: z.string().min(10).max(400),
        slideIdx: z.number().int().min(0).nullable().optional(),
        /** full = scène plein cadre, objets = objet 3D détouré, chrome = chrome & verre */
        style: z.enum(['full', 'objets', 'chrome']).optional(),
      }),
    )
    .max(8),
});
type Plan = z.infer<typeof planSchema>;

const SYSTEM = `Tu es l'agent visuel d'Odile AI (odileai.com), agence française d'automatisation IA
pour les PME/TPE. Pour chaque post, tu proposes des visuels crédibles et utiles : des pages web
à capturer (preuve, outil, source) et des concepts d'illustration à générer. Tu es précis, sobre,
et tu n'inventes jamais d'URL.`;

function parseMeta(raw: string | null): Partial<CandidateMeta> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<CandidateMeta>;
  } catch {
    return {};
  }
}

/** Propositions existantes d'un post, les plus récentes d'abord. */
export function listCandidates(postId: number): VisualCandidate[] {
  return db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.kind, 'candidate'), eq(schema.assets.postId, postId)))
    .orderBy(desc(schema.assets.createdAt))
    .all()
    .map((a) => {
      const meta = parseMeta(a.meta);
      return {
        id: a.id,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
        origin: meta.origin ?? 'image',
        label: meta.label ?? '',
        why: meta.why,
        url: meta.url,
        prompt: meta.prompt,
        slideIdx: meta.slideIdx ?? null,
        model: meta.model,
        monochrome: meta.monochrome,
        style: meta.style,
        cutout: Boolean(meta.cutout),
        batch: meta.batch ?? 1,
      };
    });
}

/** Une URL répond-elle vraiment ? (l'IA ne doit proposer que des pages existantes) */
async function urlIsAlive(url: string): Promise<boolean> {
  try {
    const res = await fetchWithRetry(url, {
      method: 'GET',
      retries: 0,
      timeoutMs: 12_000,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' },
      redirect: 'follow',
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

/** Plan de secours sans LLM (mode mock, panne) : la source + les idées des slides. */
function fallbackPlan(
  news: { url: string; title: string } | null,
  slides: { idx: number; content: SlideContent }[],
  counts: { screenshots: number; images: number },
): Plan {
  const screenshots = news && counts.screenshots > 0 ? [{ url: news.url, label: 'Source', why: "L'article à l'origine du post" }] : [];
  const images = slides
    .filter((s) => s.content.imageIdea || s.content.title)
    .slice(0, counts.images)
    .map((s) => ({
      label: s.content.title.slice(0, 60),
      prompt: s.content.imageIdea ?? `Une scène métaphorique sobre illustrant : ${s.content.title}`,
      slideIdx: s.idx,
    }));
  return { screenshots, images };
}

/**
 * Lance une passe de l'agent : planification (LLM), captures des pages
 * retenues, génération des concepts, tout enregistré en propositions. Chaque
 * passe est un « lot » ; en mode `more`, l'agent évite ce qu'il a déjà proposé.
 */
export async function runVisualAgent(
  postId: number,
  opts: { more?: boolean; screenshots?: number; images?: number } = {},
): Promise<VisualRunSummary> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const settings = getVisualAgent();
  const counts = {
    screenshots: opts.screenshots ?? settings.screenshots,
    images: opts.images ?? settings.images,
  };
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all()
    .map((s) => ({ idx: s.idx, kind: s.kind, content: JSON.parse(s.content) as SlideContent }));
  const news = post.newsItemId
    ? (db
        .select({
          url: schema.newsItems.url,
          title: schema.newsItems.title,
          summary: schema.newsItems.summary,
          contentText: schema.newsItems.contentText,
          sourceName: schema.newsSources.name,
        })
        .from(schema.newsItems)
        .leftJoin(schema.newsSources, eq(schema.newsItems.sourceId, schema.newsSources.id))
        .where(eq(schema.newsItems.id, post.newsItemId))
        .get() ?? null)
    : null;
  const existing = listCandidates(postId);
  const batch = existing.reduce((m, c) => Math.max(m, c.batch), 0) + 1;
  const knownUrls = new Set(existing.map((c) => c.url).filter(Boolean) as string[]);
  const knownPrompts = existing.map((c) => c.prompt).filter(Boolean) as string[];

  // --- 1. Planification -----------------------------------------------------
  let plan: Plan;
  let planner = 'fallback';
  if (counts.screenshots + counts.images === 0) {
    plan = { screenshots: [], images: [] };
  } else {
    const slidesText = slides
      .map((s) => `- slide ${s.idx} (${s.kind}) : « ${s.content.title} »${s.content.imageIdea ? ` — idée d'image : ${s.content.imageIdea}` : ''}`)
      .join('\n');
    const prompt = `POST
Accroche : ${post.hook}
Slides :
${slidesText}

VEILLE D'ORIGINE
Titre : ${news?.title ?? '(aucune)'}
Source : ${news?.sourceName ?? '?'} — URL : ${news?.url ?? '(aucune)'}
${news?.contentText ? `Extrait de l'article :\n"""\n${news.contentText.slice(0, 2200)}\n"""` : news?.summary ? `Résumé : ${news.summary}` : ''}

MISSION
1. "screenshots" : ${counts.screenshots} page(s) web à capturer pour ce post, dans l'ordre d'intérêt.
   Priorités : le site officiel de l'outil ou du produit dont parle le post (page d'accueil, tarifs,
   démo), puis l'article source lui-même. Uniquement des URL dont tu es CERTAIN qu'elles existent
   (domaine officiel connu, ou URL fournie ci-dessus). Jamais d'URL inventée ou approximative.
2. "images" : ${counts.images} concept(s) d'illustration à générer, en français, une scène précise
   et sobre chacune (objet, matière, lumière, angle), sans aucun texte dans l'image, variés entre eux,
   et indique la slide à laquelle chacun se destine ("slideIdx") et son "style" :
   - "full" : scène cinématique plein cadre (idéal accroche / CTA — sujet en haut, titre en bas) ;
   - "objets" : UN objet 3D isolé qui sera détouré et posé en périphérie ou en illustration
     (pièce, outil, appareil, symbole — idéal chiffre / preuve) ;
   - "chrome" : objet symbolique en chrome et verre irisé, centré (idéal slide de contenu / solution).
   Varie les styles au sein d'une même passe.
${opts.more && (knownUrls.size || knownPrompts.length) ? `\nDÉJÀ PROPOSÉ (à ne PAS répéter, propose autre chose) :\n${[...knownUrls].map((u) => `- page : ${u}`).join('\n')}\n${knownPrompts.map((p) => `- image : ${p}`).join('\n')}` : ''}`;
    try {
      const res = await completeJson(
        { task: 'writing', tier: 'fast', system: SYSTEM, prompt, maxTokens: 1800 },
        planSchema,
      );
      plan = res.value;
      planner = res.model;
    } catch (err) {
      logger.warn({ postId, err: String(err).slice(0, 200) }, 'agent visuel : planification LLM indisponible, plan de secours');
      plan = fallbackPlan(news, slides, counts);
    }
  }

  const summary: VisualRunSummary = { postId, batch, screenshots: 0, images: 0, failed: 0, planner };

  // --- 2. Captures ---------------------------------------------------------
  const targets = plan.screenshots
    .filter((s) => !knownUrls.has(s.url))
    .slice(0, counts.screenshots);
  for (const target of targets) {
    if (!(await urlIsAlive(target.url))) {
      logger.info({ postId, url: target.url }, 'agent visuel : page injoignable, ignorée');
      continue;
    }
    const capture = await captureUrl(target.url, { postId });
    if (!capture.ok || !capture.assetId) {
      summary.failed++;
      continue;
    }
    const meta: CandidateMeta = { origin: 'screenshot', label: target.label, why: target.why, url: target.url, batch };
    db.update(schema.assets)
      .set({ kind: 'candidate', meta: JSON.stringify(meta) })
      .where(eq(schema.assets.id, capture.assetId))
      .run();
    knownUrls.add(target.url);
    summary.screenshots++;
  }

  // --- 3. Images -----------------------------------------------------------
  const imageGen = getImageGen();
  const custom = getCustomTheme(post.theme);
  const palette = custom ? { bg1: custom.bg1, bg2: custom.bg2, accent: custom.accent, textColor: custom.textColor } : null;
  const brand = getBrand();
  for (const concept of plan.images.slice(0, counts.images)) {
    try {
      const style: ImageStyle =
        imageGen.style !== 'auto' ? imageGen.style : (concept.style ?? styleForArchetype(post.archetype));
      const fullPrompt = buildImagePrompt({
        idea: concept.prompt,
        archetypeId: post.archetype,
        styleNotes: imageGen.styleNotes,
        theme: post.theme,
        palette,
        monochrome: imageGen.monochrome,
        style,
      });
      const generated = await generateImageBuffer(fullPrompt, { quality: imageGen.quality });
      // « objets » : détouré et posé entier sur fond transparent
      const cutout = style === 'objets';
      let pipeline = cutout
        ? sharp(await fitCutout(await removeImageBackground(generated.buffer), 1080, 1350))
        : sharp(generated.buffer).resize(1080, 1350, { fit: 'cover', position: 'attention' });
      if (imageGen.monochrome) pipeline = pipeline.grayscale();
      const out = cutout ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 88 }).toBuffer();
      const meta: CandidateMeta = {
        origin: 'image',
        label: concept.label,
        prompt: concept.prompt,
        slideIdx: concept.slideIdx ?? null,
        model: generated.model,
        monochrome: imageGen.monochrome,
        style,
        cutout,
        batch,
      };
      saveAsset(
        out,
        'candidate',
        { postId, extraMeta: { ...meta } },
        { width: 1080, height: 1350 },
        cutout ? { ext: 'png', mime: 'image/png' } : { ext: 'jpg', mime: 'image/jpeg' },
      );
      summary.images++;
    } catch (err) {
      summary.failed++;
      logger.warn({ postId, err: String(err).slice(0, 200) }, 'agent visuel : concept non généré');
    }
  }

  logger.info({ ...summary, brand: brand.name }, 'agent visuel : passe terminée');
  return summary;
}

/** Dans le pipeline : selon les réglages, jamais bloquant. */
export async function runVisualAgentForPipeline(postId: number): Promise<VisualRunSummary | null> {
  const settings = getVisualAgent();
  if (!settings.enabled || !settings.autoRun) return null;
  try {
    return await runVisualAgent(postId);
  } catch (err) {
    logger.error({ postId, err: String(err) }, 'agent visuel en échec (non bloquant)');
    return null;
  }
}
