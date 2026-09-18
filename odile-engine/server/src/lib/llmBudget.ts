import { eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getLlmBudget } from '../db/settingsRepo.js';
import { logger } from './logger.js';
import { parisParts } from './time.js';

/**
 * Compteur et plafond de consommation des modèles de langage.
 *
 * Chaque appel réussi est enregistré avec ses jetons et un coût estimé. Le plafond
 * est quotidien et remis à zéro à minuit, heure de Paris — comme les créneaux de
 * publication, pour que « aujourd'hui » veuille dire la même chose partout.
 *
 * Un dépassement n'interrompt jamais une tâche en cours : il empêche d'en démarrer
 * une nouvelle, et les travaux facultatifs (relecture, agent visuel) cèdent la place
 * avant les travaux essentiels (rédaction du post du jour).
 */

/**
 * Tarifs indicatifs en millièmes d'euro par million de jetons (entrée / sortie),
 * au tarif public Anthropic converti à ~0,93 € le dollar. Les anciens chiffres
 * dataient d'une génération de modèles : Sonnet était compté 60 % trop cher,
 * Opus trois fois — le compteur ne disait pas la vérité, donc le plafond non plus.
 */
const TARIFS: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 4_650, out: 23_250 },
  'claude-sonnet-5': { in: 1_860, out: 9_300 },
  'claude-haiku-4-5': { in: 930, out: 4_650 },
  'gemini-2.5-pro': { in: 1_250, out: 10_000 },
  'gemini-2.5-flash': { in: 300, out: 2_500 },
};
const TARIF_PAR_DEFAUT = { in: 1_000, out: 5_000 };

/** Coût estimé d'un appel, en millièmes d'euro. */
export function coutMilli(model: string, inputTokens: number, outputTokens: number): number {
  const clef = Object.keys(TARIFS).find((k) => model.startsWith(k));
  const tarif = clef ? TARIFS[clef]! : TARIF_PAR_DEFAUT;
  return Math.round((inputTokens * tarif.in + outputTokens * tarif.out) / 1_000_000);
}

/** Jour de Paris au format AAAA-MM-JJ (le plafond suit le calendrier local). */
export function jourParis(date = new Date()): string {
  return parisParts(date).ymd;
}

export interface Consommation {
  jour: string;
  appels: number;
  inputTokens: number;
  outputTokens: number;
  /** en euros */
  cout: number;
}

/** Enregistre un appel. Ne lève jamais : la comptabilité ne doit pas casser la génération. */
export function enregistrerUsage(args: {
  provider: string;
  model: string;
  task: string;
  /** métier qui a passé l'appel (« post:redaction », « studio:copy »…) */
  label?: string;
  /** 1 = première tentative ; 2 et plus = reprise */
  attempt?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** coût hors jetons, en millièmes d'euro (ex. : les recherches web facturées à l'unité) */
  coutSupplementMilli?: number;
}): void {
  try {
    const entree = Math.max(0, args.inputTokens ?? 0);
    const sortie = Math.max(0, args.outputTokens ?? 0);
    const supplement = Math.max(0, Math.round(args.coutSupplementMilli ?? 0));
    if (entree === 0 && sortie === 0 && supplement === 0) return;
    db.insert(schema.llmUsage)
      .values({
        day: jourParis(),
        provider: args.provider,
        model: args.model,
        task: args.task,
        label: args.label ?? null,
        attempt: Math.max(1, args.attempt ?? 1),
        inputTokens: entree,
        outputTokens: sortie,
        costMilli: coutMilli(args.model, entree, sortie) + supplement,
      })
      .run();
  } catch (err) {
    logger.debug({ err: String(err) }, 'comptabilisation LLM impossible');
  }
}

/** Consommation d'un jour (celui de Paris par défaut). */
export function consommationDuJour(jour = jourParis()): Consommation {
  const row = db
    .select({
      appels: sql<number>`count(*)`,
      entree: sql<number>`coalesce(sum(${schema.llmUsage.inputTokens}), 0)`,
      sortie: sql<number>`coalesce(sum(${schema.llmUsage.outputTokens}), 0)`,
      cout: sql<number>`coalesce(sum(${schema.llmUsage.costMilli}), 0)`,
    })
    .from(schema.llmUsage)
    .where(eq(schema.llmUsage.day, jour))
    .get();
  return {
    jour,
    appels: row?.appels ?? 0,
    inputTokens: row?.entree ?? 0,
    outputTokens: row?.sortie ?? 0,
    cout: (row?.cout ?? 0) / 1000,
  };
}

/** Les N derniers jours, du plus ancien au plus récent (jours sans appel inclus). */
export function consommationRecente(jours = 14): Consommation[] {
  const depuis = new Date(Date.now() - (jours - 1) * 86400000);
  const rows = db
    .select({
      jour: schema.llmUsage.day,
      appels: sql<number>`count(*)`,
      entree: sql<number>`coalesce(sum(${schema.llmUsage.inputTokens}), 0)`,
      sortie: sql<number>`coalesce(sum(${schema.llmUsage.outputTokens}), 0)`,
      cout: sql<number>`coalesce(sum(${schema.llmUsage.costMilli}), 0)`,
    })
    .from(schema.llmUsage)
    .where(gte(schema.llmUsage.day, jourParis(depuis)))
    .groupBy(schema.llmUsage.day)
    .all();
  const parJour = new Map(rows.map((r) => [r.jour, r]));
  return Array.from({ length: jours }, (_, i) => {
    const jour = jourParis(new Date(Date.now() - (jours - 1 - i) * 86400000));
    const r = parJour.get(jour);
    return { jour, appels: r?.appels ?? 0, inputTokens: r?.entree ?? 0, outputTokens: r?.sortie ?? 0, cout: (r?.cout ?? 0) / 1000 };
  });
}

export interface LigneRepartition {
  /** le métier ; à défaut (lignes d'avant le suivi par métier), la tâche */
  label: string;
  task: string;
  provider: string;
  appels: number;
  tokens: number;
  cout: number;
  /** appels qui étaient une reprise après réponse invalide, et ce qu'ils ont coûté */
  reprises: number;
  coutReprises: number;
}

/**
 * Répartition du jour par métier, du plus coûteux au moins coûteux.
 *
 * Les reprises sont comptées à part : un métier qui coûte cher parce qu'il
 * recommence n'a pas le même remède qu'un métier qui coûte cher parce qu'il
 * travaille.
 */
export function repartitionDuJour(jour = jourParis()): LigneRepartition[] {
  const metier = sql<string>`coalesce(${schema.llmUsage.label}, ${schema.llmUsage.task})`;
  return db
    .select({
      label: metier,
      task: sql<string>`min(${schema.llmUsage.task})`,
      provider: schema.llmUsage.provider,
      appels: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(${schema.llmUsage.inputTokens} + ${schema.llmUsage.outputTokens}), 0)`,
      cout: sql<number>`coalesce(sum(${schema.llmUsage.costMilli}), 0)`,
      reprises: sql<number>`coalesce(sum(case when ${schema.llmUsage.attempt} > 1 then 1 else 0 end), 0)`,
      coutReprises: sql<number>`coalesce(sum(case when ${schema.llmUsage.attempt} > 1 then ${schema.llmUsage.costMilli} else 0 end), 0)`,
    })
    .from(schema.llmUsage)
    .where(eq(schema.llmUsage.day, jour))
    .groupBy(metier, schema.llmUsage.provider)
    .all()
    .map((r) => ({ ...r, cout: r.cout / 1000, coutReprises: r.coutReprises / 1000 }))
    .sort((a, b) => b.cout - a.cout);
}

/** Tâches facultatives : elles s'effacent dès que le plafond souple est atteint. */
const FACULTATIVES = new Set(['review', 'vision', 'visionFinal', 'scoring', 'websearch']);

export interface Verdict {
  autorise: boolean;
  motif: string;
  consommation: Consommation;
  plafond: number;
}

/**
 * Un appel peut-il partir ? Au-delà de 70 % du plafond, seules les tâches
 * essentielles passent ; au-delà de 100 %, plus rien jusqu'à minuit.
 */
export function verifierBudget(task: string): Verdict {
  const budget = getLlmBudget();
  const consommation = consommationDuJour();
  const plafond = budget.dailyEuros;
  if (!budget.enabled || plafond <= 0) {
    return { autorise: true, motif: 'plafond désactivé', consommation, plafond };
  }
  if (consommation.cout >= plafond) {
    return {
      autorise: false,
      motif: `plafond quotidien atteint (${consommation.cout.toFixed(2)} € sur ${plafond.toFixed(2)} €) — reprise à minuit, heure de Paris`,
      consommation,
      plafond,
    };
  }
  if (FACULTATIVES.has(task) && consommation.cout >= plafond * 0.7) {
    return {
      autorise: false,
      motif: `budget à ${Math.round((consommation.cout / plafond) * 100)} % — les tâches facultatives cèdent la place à la rédaction`,
      consommation,
      plafond,
    };
  }
  return { autorise: true, motif: '', consommation, plafond };
}

/** Erreur distincte d'une panne de fournisseur : c'est un choix, pas un incident. */
export class BudgetDepasseError extends Error {
  constructor(public readonly verdict: Verdict) {
    super(`Budget IA : ${verdict.motif}`);
    this.name = 'BudgetDepasseError';
  }
}
