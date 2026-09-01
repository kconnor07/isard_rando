import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { slideContentSchema, type SlideContent } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { getTone } from '../db/settingsRepo.js';
import { completeJson, completeText } from '../llm/router.js';
import { toneToPrompt } from './tone.js';

const captionSchema = z.object({ caption: z.string().max(2900), cta: z.string().max(280) });

export interface RegenerateOptions {
  postId: number;
  scope: 'caption' | 'slide';
  slideIdx?: number;
  instructions?: string;
}

/** Régénère la caption ou une slide précise, en tenant compte d'instructions humaines. */
export async function regeneratePart(opts: RegenerateOptions): Promise<{ ok: true }> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, opts.postId)).get();
  if (!post) throw new Error(`Post ${opts.postId} introuvable`);
  const tone = getTone();

  if (opts.scope === 'caption') {
    const { value } = await completeJson(
      {
        task: 'writing',
        tier: 'best',
        system: `Tu es le copywriter d'Odile AI. Tu réécris la caption d'un post ${post.platform} en gardant sa substance.`,
        prompt: `Caption actuelle :\n${post.caption}\n\nCTA actuel : ${post.cta}\n\nTon :\n${toneToPrompt(tone)}\n\n${
          opts.instructions ? `Instructions de l'humain : ${opts.instructions}` : 'Améliore le rythme et la clarté.'
        }\nConserve les liens et le mot-clé de commentaire s'il y en a.`,
        maxTokens: 8000,
      },
      captionSchema,
    );
    db.update(schema.posts)
      .set({ caption: value.caption, cta: value.cta, updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, opts.postId))
      .run();
    return { ok: true };
  }

  if (opts.slideIdx === undefined) throw new Error('slideIdx requis pour scope=slide');
  const slide = db
    .select()
    .from(schema.slides)
    .where(and(eq(schema.slides.postId, opts.postId), eq(schema.slides.idx, opts.slideIdx)))
    .get();
  if (!slide) throw new Error(`Slide ${opts.slideIdx} introuvable`);

  const current = JSON.parse(slide.content) as SlideContent;
  const { value } = await completeJson<SlideContent>(
    {
      task: 'writing',
      tier: 'best',
      system: `Tu réécris UNE slide d'un carrousel ${post.platform} d'Odile AI (agence IA pour PME). Slide de type "${current.kind}".`,
      prompt: `Contenu actuel de la slide (JSON) :\n${JSON.stringify(current, null, 2)}\n\nTon :\n${toneToPrompt(
        tone,
      )}\n\n${
        opts.instructions ? `Instructions de l'humain : ${opts.instructions}` : 'Rends-la plus percutante.'
      }\nGarde le même "kind". title ≤ 9 mots.`,
      maxTokens: 4000,
    },
    slideContentSchema,
  );
  db.update(schema.slides)
    .set({
      content: JSON.stringify({ ...value, kind: current.kind }),
      renderAssetId: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.slides.id, slide.id))
    .run();
  return { ok: true };
}

/** Petit utilitaire : réponse libre (suggestions de réponses aux commentaires, etc.). */
export async function freeCompletion(prompt: string, system?: string): Promise<string> {
  const res = await completeText({ task: 'generic', tier: 'fast', prompt, system, maxTokens: 2000 });
  return res.text;
}
