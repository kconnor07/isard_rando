import { eq, inArray } from 'drizzle-orm';
import { newsScoreBatchSchema } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { completeJson } from '../llm/router.js';

const SYSTEM = `Tu es l'analyste veille d'Odile AI, agence française d'automatisation IA pour les PME et TPE.
Tu évalues des actualités IA pour décider lesquelles méritent un post LinkedIn/Instagram.`;

const RUBRIC = `Note chaque item sur deux axes :
- "relevance" (0-50) : utilité concrète pour un dirigeant de PME/TPE française — outils accessibles,
  automatisation de tâches réelles (devis, relances, support, compta, marketing), gains chiffrables.
  Les levées de fonds abstraites, la recherche fondamentale et la géopolitique scorent bas.
- "click" (0-50) : potentiel d'accroche et de clic — nouveauté, chiffre marquant, outil testable,
  tutoriel possible, sujet qui fait réagir. Bonus si on peut en faire une démonstration visuelle.
Ajoute "reason" : une phrase en français qui justifie la note (elle sera montrée à l'humain qui valide).`;

export interface ScoreSummary {
  scored: number;
  batches: number;
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
