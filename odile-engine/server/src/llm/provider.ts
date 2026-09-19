import { z } from 'zod';

export type LlmTask = 'scoring' | 'writing' | 'review' | 'vision_check' | 'generic';

export interface LlmRequest {
  task: LlmTask;
  system?: string;
  prompt: string;
  /** images PNG/JPEG à joindre (analyse vision) */
  images?: { data: Buffer; mime: 'image/png' | 'image/jpeg' }[];
  maxTokens?: number;
  /** finale = modèle le plus capable du provider ; rapide sinon */
  tier?: 'fast' | 'best';
  /** métier qui passe l'appel, pour la comptabilité (« post:redaction », « studio:copy »…) */
  label?: string;
  /** posé par completeJson quand une réponse invalide force une reprise (2, 3…) */
  attempt?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** le modèle a été coupé par max_tokens : la réponse est incomplète, inutile de la réparer */
  truncated?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  completeText(req: LlmRequest): Promise<LlmResponse>;
}

/** Extrait le premier objet/tableau JSON d'une réponse LLM (fences, prose autour…). */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) t = fence[1].trim();
  const firstBrace = Math.min(
    ...['{', '['].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))),
  );
  if (firstBrace === Infinity) return t;
  const open = t[firstBrace];
  const close = open === '{' ? '}' : ']';
  const lastClose = t.lastIndexOf(close);
  if (lastClose > firstBrace) return t.slice(firstBrace, lastClose + 1);
  return t;
}

/** Description JSON Schema compacte du schéma zod, à injecter dans le prompt. */
export function zodToPromptSchema(schema: z.ZodType): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    return '';
  }
}

/**
 * Répare les défauts de syntaxe les plus fréquents d'un JSON écrit par un modèle,
 * sans toucher au contenu : retours à la ligne et tabulations bruts à l'intérieur
 * des chaînes (interdits par JSON), virgules finales avant } ou ], caractères de
 * contrôle. Tout ce qui est déjà valide ressort tel quel.
 */
export function reparerJson(brut: string): string {
  let sortie = '';
  let dansChaine = false;
  let echappe = false;
  for (const c of brut.replace(/^\uFEFF/, '')) {
    if (dansChaine) {
      if (echappe) {
        sortie += c;
        echappe = false;
      } else if (c === '\\') {
        sortie += c;
        echappe = true;
      } else if (c === '"') {
        sortie += c;
        dansChaine = false;
      } else if (c === '\n') sortie += '\\n';
      else if (c === '\r') sortie += '';
      else if (c === '\t') sortie += '\\t';
      else if (c < ' ') sortie += '';
      else sortie += c;
    } else if (c === '"') {
      sortie += c;
      dansChaine = true;
    } else sortie += c;
  }
  // Virgule finale : « "a": 1, } » → « "a": 1 }
  return sortie.replace(/,\s*([}\]])/g, '$1');
}

/** Lit une valeur à un chemin zod (« sections.2.paragraphs.1 »). */
function lireChemin(objet: unknown, chemin: (string | number)[]): unknown {
  let cur: unknown = objet;
  for (const cle of chemin) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[cle];
  }
  return cur;
}

function ecrireChemin(objet: unknown, chemin: (string | number)[], valeur: unknown): void {
  if (chemin.length === 0) return;
  let cur: unknown = objet;
  for (const cle of chemin.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object') return;
    cur = (cur as Record<string | number, unknown>)[cle];
  }
  if (cur !== null && typeof cur === 'object') (cur as Record<string | number, unknown>)[chemin[chemin.length - 1]!] = valeur;
}

/** Coupe un texte à `max` caractères sur une fin de mot, avec une ellipse quand on a coupé. */
export function couperAuMot(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const tranche = texte.slice(0, Math.max(0, max - 1));
  const espace = tranche.lastIndexOf(' ');
  const base = espace > max * 0.6 ? tranche.slice(0, espace) : tranche;
  return `${base.replace(/[\s,;:(\-–]+$/u, '')}…`;
}

/**
 * Corrections sans appel au modèle, pour les dépassements modestes : une chaîne
 * un peu trop longue est coupée sur un mot, un tableau trop long perd sa queue.
 * Une chaîne trop longue de plus de 15 % n'est pas coupée — on y perdrait du
 * sens — et reste au modèle. Renvoie le nombre de corrections appliquées ;
 * l'objet est modifié sur place.
 */
export function corrigerDepassements(objet: unknown, issues: z.core.$ZodIssue[]): number {
  let n = 0;
  for (const issue of issues) {
    if (issue.code !== 'too_big') continue;
    const chemin = issue.path as (string | number)[];
    const valeur = lireChemin(objet, chemin);
    const max = Number(issue.maximum);
    if (!Number.isFinite(max)) continue;
    if (typeof valeur === 'string' && valeur.length <= max * 1.15) {
      ecrireChemin(objet, chemin, couperAuMot(valeur, max));
      n++;
    } else if (Array.isArray(valeur) && issue.origin === 'array') {
      ecrireChemin(objet, chemin, valeur.slice(0, max));
      n++;
    }
  }
  return n;
}

/** Une correction ciblée renvoyée par le modèle : le chemin zod (« a.b.0 ») et la nouvelle valeur. */
export const correctionsSchema = z.object({
  corrections: z.array(z.object({ path: z.string().min(1).max(200), value: z.unknown() })).max(40),
});

/** Applique des corrections ciblées ; renvoie le nombre de chemins effectivement écrits. */
export function appliquerCorrections(objet: unknown, corrections: { path: string; value: unknown }[]): number {
  let n = 0;
  for (const c of corrections) {
    const chemin = c.path.split('.').filter(Boolean).map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
    if (chemin.length === 0 || c.value === undefined) continue;
    const parent = lireChemin(objet, chemin.slice(0, -1));
    if (parent === null || typeof parent !== 'object') continue;
    ecrireChemin(objet, chemin, c.value);
    n++;
  }
  return n;
}

/** Résumé lisible des défauts de validation, avec la taille réelle quand elle compte. */
export function decrireIssues(issues: z.core.$ZodIssue[], objet: unknown, max = 8): string {
  return issues
    .slice(0, max)
    .map((i) => {
      const chemin = i.path.join('.') || '(racine)';
      const valeur = lireChemin(objet, i.path as (string | number)[]);
      const taille =
        typeof valeur === 'string' ? ` (${valeur.length} caractères)` : Array.isArray(valeur) ? ` (${valeur.length} éléments)` : '';
      return `${chemin}${taille} : ${i.message}`;
    })
    .join(' ; ');
}
