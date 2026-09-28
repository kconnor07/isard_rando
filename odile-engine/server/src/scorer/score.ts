import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { newsScoreBatchSchema } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { getSettingRaw, setSetting } from '../db/settingsRepo.js';
import { completeJson } from '../llm/router.js';

/**
 * Version de la grille de notation. Quand la grille change, les articles de la
 * semaine sont renotés avec la nouvelle, et les sujets qui en découlaient sont
 * refaits : sinon les notes de l'ancienne grille restent en tête pendant des jours.
 */
export const VERSION_GRILLE = 5;
const CLE_VERSION_GRILLE = 'veille_grille_version';

/**
 * Remet en file les articles des 7 derniers jours si la grille a changé depuis leur
 * notation, et supprime les sujets d'actualité encore proposés (ils seront refaits
 * à partir des nouvelles notes). Les articles et sujets déjà utilisés ne bougent pas.
 * Renvoie le nombre d'articles remis en file.
 */
export function reprendreSiGrilleChangee(now = new Date()): number {
  if (getSettingRaw(CLE_VERSION_GRILLE) === VERSION_GRILLE) return 0;
  const depuis = new Date(now.getTime() - 7 * 86400000).toISOString();
  const aRenoter = db
    .select({ id: schema.newsItems.id })
    .from(schema.newsItems)
    .where(and(inArray(schema.newsItems.status, ['scored', 'shortlisted']), gt(schema.newsItems.fetchedAt, depuis)))
    .all()
    .map((r) => r.id);
  for (let i = 0; i < aRenoter.length; i += 400) {
    db.update(schema.newsItems)
      .set({ status: 'new', scoreFinal: null, shortlistRank: null, shortlistDate: null })
      .where(inArray(schema.newsItems.id, aRenoter.slice(i, i + 400)))
      .run();
  }
  db.delete(schema.newsSubjects)
    .where(and(eq(schema.newsSubjects.status, 'nouveau'), eq(schema.newsSubjects.kind, 'actu')))
    .run();
  setSetting(CLE_VERSION_GRILLE, VERSION_GRILLE);
  return aRenoter.length;
}

const SYSTEM = `Tu es l'analyste veille d'Odile AI, agence française d'automatisation IA pour les PME et TPE.
Odile VEND l'implémentation de solutions IA : ses posts ne présentent jamais un outil « en tant
qu'actu produit » — ils racontent des bénéfices, des capacités et des résultats d'entreprises.
Tu évalues des contenus (articles, vidéos, posts sociaux) pour décider lesquels méritent un post.`;

const RUBRIC = `Le lecteur : le dirigeant d'une PME ou TPE française (5 à 50 salariés, artisan, commerçant,
cabinet, PME industrielle ou de services), sans équipe technique, qui se demande ce que l'IA
et l'automatisation peuvent faire pour SON entreprise, lundi matin, avec SON budget.

Note chaque item sur deux axes :
- "relevance" (0-50) : matière pour un post utile à ce dirigeant.
  35-50 : ce qu'il peut reproduire ou doit savoir — une PME ou TPE (française ou européenne de
  préférence) qui a automatisé une tâche avec un résultat mesuré (temps gagné, CA, coûts,
  délais) ; une étude chiffrée sur les PME françaises (Bpifrance, France Num, INSEE, CPME,
  CCI, baromètres) ; une obligation ou une échéance qui le concerne (facturation électronique,
  AI Act, RGPD, cybersécurité) ; une aide ou un financement ouvert aux PME ; une capacité
  nouvelle qu'il peut utiliser tout de suite sans développeur, décrite par la tâche qu'elle
  règle (devis, relances, support, compta, prospection, recrutement, avis clients) ;
  l'économie de Toulouse et de l'Occitanie ; et L'ACTUALITÉ IA DONT TOUT LE MONDE PARLE EN CE
  MOMENT — une nouveauté, une fonctionnalité ou un incident chez OpenAI/ChatGPT, Google/Gemini,
  Anthropic/Claude, Mistral, Microsoft/Copilot ou Meta, un outil IA qui devient viral, une
  polémique qui fait réagir — dès qu'on peut dire ce qu'elle change pour une entreprise, ses
  salariés ou ses clients (c'est presque toujours possible : c'est l'angle du post).
  15-34 : un cas ou une donnée étrangère qui se transpose clairement à une PME française ;
  une tendance de fond expliquée par ses effets concrets sur une petite entreprise.
  0-14 : ce qui ne change rien pour lui — levée de fonds, valorisation ou chiffre d'affaires
  d'une start-up peu connue, benchmark ou classement technique, recherche, outil pour
  développeurs, dépôt de code, géopolitique sans effet sur les entreprises, gadget grand public,
  grand groupe (banque, CAC 40) sans leçon transposable, et la promotion d'un éditeur
  par lui-même (témoignage client publié sur le blog de l'éditeur, « les 10 meilleurs
  outils », annonce commerciale) sauf s'il contient un résultat chiffré vraiment reproductible.
- "click" (0-50) : potentiel d'accroche sur LinkedIn — 40-50 pour l'actualité IA ultra-récente
  (moins de 24-48 h) reprise par plusieurs médias ou qui buzze sur les réseaux, un nom que tout
  le monde connaît (ChatGPT, Gemini, Claude…), un chiffre choc, un incident ou une polémique ;
  ensuite l'histoire d'entreprise racontable, le résultat surprenant, l'échéance qui inquiète.
  Un contenu qui a déjà beaucoup d'engagement est un bon candidat, s'il parle à une PME française.
  Une actualité de plus d'une semaine perd l'essentiel de son potentiel.
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
          label: 'veille:rescoring',
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

/**
 * Note les items encore non scorés, par lots de 10 — les plus récents d'abord :
 * l'actualité du jour ne doit jamais attendre derrière le stock de la veille.
 */
export async function runScore(limit = 60): Promise<ScoreSummary> {
  const renotes = reprendreSiGrilleChangee();
  const items = db
    .select()
    .from(schema.newsItems)
    .where(eq(schema.newsItems.status, 'new'))
    .orderBy(desc(schema.newsItems.fetchedAt), desc(schema.newsItems.id))
    // Une grille qui change remet la semaine en file : on la renote d'un coup.
    .limit(renotes > 0 ? Math.max(limit, 250) : limit)
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
        label: 'veille:notation',
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
