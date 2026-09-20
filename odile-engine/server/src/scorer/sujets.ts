/**
 * Des SUJETS, pas des articles.
 *
 * La veille remonte des dizaines d'items par jour. Un item seul ne dit pas s'il y
 * a matière à un post : c'est quand trois sources parlent de la même chose dans la
 * semaine qu'un thème devient un sujet. Ce module regroupe les items par thème,
 * fait nommer chaque groupe et proposer trois angles, écarte ce qui a déjà été
 * publié, et y ajoute les rendez-vous du calendrier des PME. Le fondateur choisit
 * alors un sujet et un angle, au lieu de lire une liste d'articles.
 */
import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { normalizeTitle, titleSimilarity } from '../scraper/dedupe.js';
import { marronniersDuMoment } from '../scraper/saison.js';

/** Un groupe d'items qui parlent de la même chose. */
export interface Groupe {
  itemIds: number[];
  titres: string[];
  topics: string[];
  sourceIds: number[];
  score: number;
}

export interface AngleSujet {
  titre: string;
  angle: string;
}

const JACCARD_MIN = 0.34;
/** Deux titres qui se ressemblent beaucoup parlent du même fait, même sans sujet commun. */
const TITRE_PROCHE = 0.5;
const FENETRE_JOURS = 7;
const MAX_SUJETS = 8;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let commun = 0;
  for (const t of sa) if (sb.has(t)) commun++;
  return commun / (sa.size + sb.size - commun);
}

interface ItemPourGroupe {
  id: number;
  title: string;
  topics: string[];
  sourceId: number | null;
  score: number;
}

/**
 * Regroupement glouton : chaque item rejoint le premier groupe avec lequel il
 * partage assez de sujets (ou un titre très proche), sinon il ouvre le sien.
 * Fonction pure, testée — le reste du module dépend de la base et du modèle.
 */
export function grouperParSujet(items: ItemPourGroupe[]): Groupe[] {
  const groupes: Groupe[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    const proche = groupes.find(
      (g) => jaccard(g.topics, item.topics) >= JACCARD_MIN || g.titres.some((t) => titleSimilarity(t, item.title) >= TITRE_PROCHE),
    );
    if (proche) {
      proche.itemIds.push(item.id);
      proche.titres.push(item.title);
      for (const t of item.topics) if (!proche.topics.includes(t)) proche.topics.push(t);
      if (item.sourceId && !proche.sourceIds.includes(item.sourceId)) proche.sourceIds.push(item.sourceId);
      proche.score = Math.max(proche.score, item.score) + item.score * 0.15;
      continue;
    }
    groupes.push({
      itemIds: [item.id],
      titres: [item.title],
      topics: [...item.topics],
      sourceIds: item.sourceId ? [item.sourceId] : [],
      score: item.score,
    });
  }
  return groupes.sort((a, b) => b.score - a.score);
}

/**
 * Ce qui a déjà été raconté : les accroches des posts des deux derniers mois, les
 * titres des articles du blog, et les items déjà transformés en post. Un sujet
 * qui ressemble à l'un d'eux n'est pas reproposé.
 */
export function dejaTraite(now = new Date()): string[] {
  const depuis = new Date(now.getTime() - 60 * 86400000).toISOString();
  const hooks = db
    .select({ hook: schema.posts.hook, caption: schema.posts.caption })
    .from(schema.posts)
    .where(gt(schema.posts.createdAt, depuis))
    .all()
    .map((p) => p.hook);
  const articles = db
    .select({ title: schema.articles.title })
    .from(schema.articles)
    .where(gt(schema.articles.createdAt, depuis))
    .all()
    .map((a) => a.title);
  const utilises = db
    .select({ title: schema.newsItems.title })
    .from(schema.newsItems)
    .where(and(eq(schema.newsItems.status, 'used'), gt(schema.newsItems.fetchedAt, depuis)))
    .all()
    .map((n) => n.title);
  return [...hooks, ...articles, ...utilises].filter((t) => t && t.trim().length > 0);
}

/** Un sujet déjà raconté, au titre près. */
export function ressembleADejaTraite(label: string, deja: string[]): boolean {
  return deja.some((t) => titleSimilarity(t, label) >= 0.45 || partageLesMotsForts(t, label));
}

function partageLesMotsForts(a: string, b: string): boolean {
  const ma = new Set(normalizeTitle(a));
  const mb = normalizeTitle(b);
  if (ma.size < 3 || mb.length < 3) return false;
  const communs = mb.filter((m) => ma.has(m)).length;
  return communs >= Math.min(4, Math.ceil(Math.min(ma.size, mb.length) * 0.7));
}

const sujetsSchema = z.object({
  sujets: z.array(
    z.object({
      groupe: z.number().int(),
      label: z.string().min(10).max(140),
      reason: z.string().min(10).max(320),
      angles: z.array(z.object({ titre: z.string().min(3).max(40), angle: z.string().min(15).max(280) })).min(2).max(3),
      garder: z.boolean(),
    }),
  ),
});

export interface SujetsSummary {
  groupes: number;
  crees: number;
  ecartesDejaTraites: number;
  saison: number;
}

/**
 * Construit les sujets du moment à partir des items des sept derniers jours,
 * puis ajoute les rendez-vous du calendrier des PME. Idempotent : un sujet déjà
 * présent est mis à jour (nouveaux items, nouveau score), pas dupliqué.
 */
export async function construireSujets(now = new Date()): Promise<SujetsSummary> {
  const depuis = new Date(now.getTime() - FENETRE_JOURS * 86400000).toISOString();
  const items = db
    .select()
    .from(schema.newsItems)
    .where(
      and(
        inArray(schema.newsItems.status, ['scored', 'shortlisted']),
        gt(schema.newsItems.fetchedAt, depuis),
        ne(schema.newsItems.status, 'discarded'),
      ),
    )
    .orderBy(desc(schema.newsItems.scoreTotal))
    .limit(120)
    .all();

  const groupes = grouperParSujet(
    items.map((it) => ({
      id: it.id,
      title: it.title,
      topics: it.topics ? (JSON.parse(it.topics) as string[]) : [],
      sourceId: it.sourceId,
      score: it.scoreFinal ?? it.scoreTotal ?? 0,
    })),
  )
    // Un sujet mérite ce nom quand plusieurs sources en parlent, ou quand un seul
    // item est excellent. Le reste reste dans la liste d'articles.
    .filter((g) => g.itemIds.length >= 2 || g.score >= 75)
    .slice(0, MAX_SUJETS);

  const resume: SujetsSummary = { groupes: groupes.length, crees: 0, ecartesDejaTraites: 0, saison: 0 };
  const deja = dejaTraite(now);

  if (groupes.length > 0) {
    const liste = groupes
      .map((g, i) => `[groupe=${i}] (${g.itemIds.length} article${g.itemIds.length > 1 ? 's' : ''}, sujets : ${g.topics.slice(0, 6).join(', ') || 'aucun'})\n- ${g.titres.slice(0, 6).join('\n- ')}`)
      .join('\n\n');
    try {
      const { value } = await completeJson(
        {
          task: 'scoring',
          label: 'veille:sujets',
          tier: 'fast',
          system: `Tu es le rédacteur en chef de la veille d'Odile AI, agence française d'automatisation IA pour les PME et TPE, basée à Toulouse.
Tu ne cherches pas des actualités : tu cherches des SUJETS de publication pour un dirigeant de petite entreprise.`,
          prompt: `Voici des groupes d'articles remontés par la veille cette semaine. Pour chacun, dis s'il y a
un vrai sujet de post pour une PME française, et lequel.

Pour chaque groupe :
- "label" : le sujet en une phrase, du point de vue du dirigeant, pas du point de vue de la technologie
  (« Les relances de factures qui partent toutes seules » plutôt que « OpenAI lance un agent »).
- "reason" : pourquoi ce sujet maintenant, en une ou deux phrases, avec le chiffre marquant s'il y en a un.
- "angles" : deux ou trois façons différentes de le traiter, chacune avec un "titre" court (le type d'angle)
  et un "angle" (ce que le post raconterait concrètement). Varie : le cas d'entreprise chiffré, la méthode
  pas à pas, l'erreur à éviter, le calcul du temps gagné, la prise de position.
- "garder" : false si le groupe n'intéresse pas un dirigeant de PME (actu corporate, levée de fonds,
  recherche, politique, annonce produit sans usage concret), true sinon.

SUJETS DÉJÀ PUBLIÉS ces deux derniers mois, à ne pas reproposer :
${deja.slice(0, 40).map((t) => `- ${t}`).join('\n') || '- (aucun)'}

GROUPES :

${liste}`,
          maxTokens: 4000,
        },
        sujetsSchema,
      );
      for (const s of value.sujets) {
        const g = groupes[s.groupe];
        if (!g || !s.garder) continue;
        if (ressembleADejaTraite(s.label, deja)) {
          resume.ecartesDejaTraites++;
          continue;
        }
        if (enregistrerSujet({
          label: s.label,
          reason: s.reason,
          angles: s.angles,
          topics: g.topics.slice(0, 6),
          itemIds: g.itemIds,
          sourcesCount: Math.max(1, g.sourceIds.length),
          score: Math.round(g.score * 10) / 10,
          kind: 'actu',
        })) resume.crees++;
      }
    } catch (err) {
      logger.warn({ err: String(err).slice(0, 200) }, 'construction des sujets de veille en échec');
    }
  }

  // Les rendez-vous du calendrier : aucun appel au modèle, ils sont écrits d'avance.
  for (const m of marronniersDuMoment(now)) {
    if (ressembleADejaTraite(m.label, deja)) continue;
    if (enregistrerSujet({
      label: m.label,
      reason: m.reason,
      angles: m.angles,
      topics: m.topics,
      itemIds: [],
      sourcesCount: 0,
      score: 60,
      kind: 'saison',
    })) resume.saison++;
  }

  return resume;
}

interface SujetAEnregistrer {
  label: string;
  reason: string;
  angles: AngleSujet[];
  topics: string[];
  itemIds: number[];
  sourcesCount: number;
  score: number;
  kind: 'actu' | 'douleur' | 'local' | 'saison';
}

/** Crée le sujet, ou met à jour celui qui dit déjà la même chose. Renvoie vrai si c'est un nouveau. */
export function enregistrerSujet(sujet: SujetAEnregistrer): boolean {
  const now = new Date().toISOString();
  const existants = db.select().from(schema.newsSubjects).where(ne(schema.newsSubjects.status, 'ecarte')).all();
  // Exigeant : deux sujets proches mais distincts (« les devis » et « les relances »)
  // doivent rester deux sujets. Seul un quasi-doublon fusionne.
  const jumeau = existants.find((e) => titleSimilarity(e.label, sujet.label) >= 0.6 || partageLesMotsForts(e.label, sujet.label));
  if (jumeau) {
    // Déjà utilisé : on ne le ressuscite pas, on ne le remonte pas dans la liste.
    if (jumeau.status === 'utilise') return false;
    const anciens = JSON.parse(jumeau.itemIds) as number[];
    const fusion = [...new Set([...anciens, ...sujet.itemIds])];
    db.update(schema.newsSubjects)
      .set({
        itemIds: JSON.stringify(fusion),
        sourcesCount: Math.max(jumeau.sourcesCount, sujet.sourcesCount),
        score: Math.max(jumeau.score, sujet.score),
        reason: sujet.reason || jumeau.reason,
        updatedAt: now,
      })
      .where(eq(schema.newsSubjects.id, jumeau.id))
      .run();
    return false;
  }
  db.insert(schema.newsSubjects)
    .values({
      label: sujet.label,
      reason: sujet.reason,
      angles: JSON.stringify(sujet.angles),
      topics: JSON.stringify(sujet.topics),
      itemIds: JSON.stringify(sujet.itemIds),
      sourcesCount: sujet.sourcesCount,
      score: sujet.score,
      kind: sujet.kind,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return true;
}

/** Les sujets à proposer, le meilleur d'abord, avec leurs articles. */
export function sujetsDuMoment(limit = 12) {
  const sujets = db
    .select()
    .from(schema.newsSubjects)
    .where(eq(schema.newsSubjects.status, 'nouveau'))
    .orderBy(desc(schema.newsSubjects.score))
    .limit(limit)
    .all();
  return sujets.map((s) => {
    const ids = JSON.parse(s.itemIds) as number[];
    const items = ids.length
      ? db
          .select({ id: schema.newsItems.id, title: schema.newsItems.title, url: schema.newsItems.url, sourceId: schema.newsItems.sourceId })
          .from(schema.newsItems)
          .where(inArray(schema.newsItems.id, ids))
          .all()
      : [];
    return {
      id: s.id,
      label: s.label,
      reason: s.reason,
      angles: JSON.parse(s.angles) as AngleSujet[],
      topics: JSON.parse(s.topics) as string[],
      kind: s.kind,
      score: s.score,
      sourcesCount: s.sourcesCount,
      createdAt: s.createdAt,
      items,
    };
  });
}

/** L'item de veille le plus fort d'un sujet : c'est lui que le rédacteur recevra. */
export function itemPrincipal(subjectId: number): number | null {
  const sujet = db.select().from(schema.newsSubjects).where(eq(schema.newsSubjects.id, subjectId)).get();
  if (!sujet) return null;
  const ids = JSON.parse(sujet.itemIds) as number[];
  if (ids.length === 0) return null;
  const meilleur = db
    .select({ id: schema.newsItems.id })
    .from(schema.newsItems)
    .where(inArray(schema.newsItems.id, ids))
    .orderBy(desc(schema.newsItems.scoreFinal), desc(schema.newsItems.scoreTotal))
    .limit(1)
    .get();
  return meilleur?.id ?? null;
}
