import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { newsScoreBatchSchema } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { completeJson } from '../llm/router.js';

const SYSTEM = `Tu es l'analyste veille d'Odile AI, agence française d'automatisation IA pour les PME et TPE.
Odile VEND l'implémentation de solutions IA : ses posts ne présentent jamais un outil « en tant
qu'actu produit » — ils racontent des bénéfices, des capacités et des résultats d'entreprises.
Tu évalues des contenus (articles, vidéos, posts sociaux) pour décider lesquels méritent un post.`;

const RUBRIC = `Note chaque item sur deux axes :
- "relevance" (0-50) : matière pour un post « bénéfices/résultats » destiné à un dirigeant de
  PME/TPE française. Score HAUT : cas d'entreprise avec résultats mesurés (temps gagné, CA,
  taux de conversion, coûts), données réelles/études d'adoption chiffrées, capacité IA nouvelle
  expliquée par ce qu'elle permet (devis, relances, support, compta, prospection, marketing),
  ce que des entreprises comparables mettent déjà en place. Score BAS : annonce produit sans
  application concrète, levée de fonds, recherche fondamentale, géopolitique, actu corporate.
- "click" (0-50) : potentiel d'accroche — chiffre marquant, histoire d'entreprise racontable,
  résultat surprenant, sujet qui fait réagir, démonstration visuelle possible.
  Un contenu US qui a déjà beaucoup d'engagement (points, partages, vues) est un excellent
  candidat : la preuve sociale est faite, il ne reste qu'à l'adapter au public français.
Ajoute "reason" : une phrase en français qui justifie la note (elle sera montrée à l'humain qui valide).`;

export interface ScoreSummary {
  scored: number;
  batches: number;
}

const rescoreSchema = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      relevance: z.number().min(0).max(50),
      click: z.number().min(0).max(50),
      reason: z.string().max(300),
      topics: z.array(z.string().min(2).max(30)).min(1).max(5),
    }),
  ),
});

/**
 * Étape 2 : rescoring des candidats shortlist sur le TEXTE COMPLET de
 * l'article (extrait en interne pour analyse) + attribution de sujets.
 */
export async function rescoreWithContent(itemIds: number[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const items = db
    .select()
    .from(schema.newsItems)
    .where(inArray(schema.newsItems.id, itemIds))
    .all();
  let rescored = 0;
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    const list = batch
      .map((it) => {
        const body = (it.contentText ?? it.summary ?? '').slice(0, 2500);
        return `[id=${it.id}] (${it.lang}) ${it.title}\n${body}`;
      })
      .join('\n\n---\n\n');
    try {
      const { value } = await completeJson(
        {
          task: 'scoring',
          tier: 'fast',
          system: SYSTEM,
          prompt: `${RUBRIC}\n\nCette fois tu disposes du texte (ou d'un large extrait) de chaque article :
note avec précision, et ajoute "topics" : 3 à 5 sujets courts en français, en minuscules
(ex: "facturation", "chatbot", "no-code", "prospection", "juridique") — ils servent à
apprendre quels sujets performent auprès de notre audience.\n\nArticles :\n\n${list}`,
          maxTokens: 4000,
        },
        rescoreSchema,
      );
      const validIds = new Set(batch.map((b) => b.id));
      for (const s of value.items) {
        if (!validIds.has(s.id)) continue;
        db.update(schema.newsItems)
          .set({
            scoreRelevance: Math.round(s.relevance),
            scoreClick: Math.round(s.click),
            scoreTotal: Math.round(s.relevance + s.click),
            scoreReason: s.reason,
            topics: JSON.stringify(s.topics.map((t) => t.toLowerCase())),
            scoredAt: new Date().toISOString(),
          })
          .where(eq(schema.newsItems.id, s.id))
          .run();
        rescored++;
      }
    } catch (err) {
      // non bloquant : les scores de l'étape 1 restent valables
      console.warn(`rescoring lot ${i / 5 + 1} en échec:`, String(err).slice(0, 200));
    }
  }
  return rescored;
}

/** Note les items encore non scorés, par lots de 10. */
export async function runScore(limit = 60): Promise<ScoreSummary> {
  const items = db
    .select()
    .from(schema.newsItems)
    .where(eq(schema.newsItems.status, 'new'))
    .limit(limit)
    .all();

  let scored = 0;
  let batches = 0;
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    batches++;
    const list = batch
      .map(
        (it) =>
          `[id=${it.id}] (${it.lang}) ${it.title}\n${(it.summary ?? '').slice(0, 300)}`,
      )
      .join('\n\n');
    const { value } = await completeJson(
      {
        task: 'scoring',
        tier: 'fast',
        system: SYSTEM,
        prompt: `${RUBRIC}\n\nItems à noter :\n\n${list}`,
        maxTokens: 4000,
      },
      newsScoreBatchSchema,
    );
    const validIds = new Set(batch.map((b) => b.id));
    for (const s of value.scores) {
      if (!validIds.has(s.id)) continue;
      db.update(schema.newsItems)
        .set({
          scoreRelevance: Math.round(s.relevance),
          scoreClick: Math.round(s.click),
          scoreTotal: Math.round(s.relevance + s.click),
          scoreReason: s.reason,
          scoredAt: new Date().toISOString(),
          status: 'scored',
        })
        .where(eq(schema.newsItems.id, s.id))
        .run();
      scored++;
    }
    // Les items du lot que le LLM aurait oubliés restent "new" et repasseront.
    const missing = batch.filter((b) => !value.scores.some((s) => s.id === b.id)).map((b) => b.id);
    if (missing.length === batch.length) {
      // lot entièrement raté deux fois de suite → on écarte pour ne pas boucler
      db.update(schema.newsItems)
        .set({ status: 'discarded', scoreReason: 'Scoring impossible' })
        .where(inArray(schema.newsItems.id, missing))
        .run();
    }
  }
  return { scored, batches };
}
