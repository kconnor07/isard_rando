import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { slideContentSchema, type ReviewIssue, type SlideContent } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { completeJson } from '../llm/router.js';

const fixSchema = z.object({
  slides: z.array(slideContentSchema),
  caption: z.string().max(2900),
  cta: z.string().max(280),
});

/**
 * Applique les correctifs des reviewers : un appel LLM réécrit les contenus
 * de slides + caption en suivant les issues, puis les slides sont invalidées
 * (re-rendu nécessaire).
 */
export async function applyFixes(postId: number, issues: ReviewIssue[]): Promise<{ applied: number }> {
  // Les critiques d'illustration (target "image") sont traitées par la boucle du
  // studio (régénération d'image) — surtout pas par une réécriture de texte.
  issues = issues.filter((i) => i.target !== 'image');
  if (issues.length === 0) return { applied: 0 };
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  const contents = slides.map((s) => JSON.parse(s.content) as SlideContent);

  const issuesText = issues
    .map(
      (i, n) =>
        `${n + 1}. [${i.severity}] ${i.slideIdx !== null ? `slide ${i.slideIdx + 1}` : 'global'} — ${i.target} : ${i.problem} → CORRECTIF : ${i.fix}`,
    )
    .join('\n');

  const { value } = await completeJson(
    {
      task: 'writing',
      tier: 'best',
      system: `Tu es le copywriter d'Odile AI. Tu appliques les correctifs demandés par le comité de design
sur un post ${post.platform}. Tu modifies UNIQUEMENT ce que les correctifs demandent, tu conserves tout le reste.`,
      prompt: `SLIDES ACTUELLES (JSON, dans l'ordre) :
${JSON.stringify(contents, null, 2)}

CAPTION ACTUELLE :
${post.caption}

CTA ACTUEL : ${post.cta}

CORRECTIFS À APPLIQUER :
${issuesText}

Règles : même nombre de slides, mêmes "kind" dans le même ordre. title ≤ 9 mots.
Recopie les champs "imageIdea" tels quels (l'illustration est gérée séparément).
Renvoie l'intégralité corrigée (slides + caption + cta).`,
      maxTokens: 16000,
    },
    fixSchema,
  );

  if (value.slides.length === contents.length) {
    value.slides.forEach((content, idx) => {
      const slide = slides[idx]!;
      const kind = contents[idx]!.kind; // le kind d'origine fait foi
      db.update(schema.slides)
        .set({
          content: JSON.stringify({ ...content, kind }),
          kind,
          renderAssetId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.slides.id, slide.id))
        .run();
    });
  }
  db.update(schema.posts)
    .set({ caption: value.caption, cta: value.cta, updatedAt: new Date().toISOString() })
    .where(eq(schema.posts.id, postId))
    .run();
  return { applied: issues.length };
}
