/**
 * La banque de faits vécus : ce qu'Odile a réellement fait ou observé.
 *
 * L'audit LinkedIn 2026 est formel : un post de dirigeant qui performe contient une
 * preuve propre à son auteur, et un fait inventé ruine la crédibilité. Le rédacteur
 * ne raconte donc que des faits de cette banque ; s'il n'en trouve aucun qui serve le
 * sujet, il laisse un emplacement « [FAIT VÉCU : …] » que la personne complète.
 */
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getStrategieLinkedIn } from '../db/settingsRepo.js';
import { verifierBudget } from '../lib/llmBudget.js';
import { completeJson } from '../llm/router.js';
import { EMPLACEMENT_FAIT, faitACompleter, porteUnAppat, tutoie } from './reglesLinkedIn.js';

export type Fait = typeof schema.faits.$inferSelect;

export const SOURCES_DE_FAIT = ['audit', 'appel', 'boutique', 'evenement', 'client', 'autre'] as const;

export const faitSchema = z.object({
  texte: z.string().trim().min(15, 'Racontez le fait en une ou deux phrases (15 caractères au moins)').max(600),
  dateFait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.enum(SOURCES_DE_FAIT).default('autre'),
  compte: z.string().max(80).nullable().optional(),
  accordClient: z.boolean().default(false),
  actif: z.boolean().default(true),
});
export type FaitSaisi = z.infer<typeof faitSchema>;

export function listerFaits(): Fait[] {
  return db.select().from(schema.faits).orderBy(desc(schema.faits.createdAt)).all();
}

export function ajouterFait(saisi: FaitSaisi): Fait {
  return db
    .insert(schema.faits)
    .values({
      texte: saisi.texte,
      dateFait: saisi.dateFait ?? null,
      source: saisi.source,
      compte: saisi.compte?.trim() || null,
      accordClient: saisi.accordClient,
      actif: saisi.actif,
    })
    .returning()
    .get();
}

export function modifierFait(id: number, saisi: Partial<FaitSaisi>): Fait | null {
  const champs: Partial<typeof schema.faits.$inferInsert> = {};
  if (saisi.texte !== undefined) champs.texte = saisi.texte;
  if (saisi.dateFait !== undefined) champs.dateFait = saisi.dateFait;
  if (saisi.source !== undefined) champs.source = saisi.source;
  if (saisi.compte !== undefined) champs.compte = saisi.compte?.trim() || null;
  if (saisi.accordClient !== undefined) champs.accordClient = saisi.accordClient;
  if (saisi.actif !== undefined) champs.actif = saisi.actif;
  if (Object.keys(champs).length > 0) db.update(schema.faits).set(champs).where(eq(schema.faits.id, id)).run();
  return db.select().from(schema.faits).where(eq(schema.faits.id, id)).get() ?? null;
}

export function supprimerFait(id: number): boolean {
  return db.delete(schema.faits).where(eq(schema.faits.id, id)).run().changes > 0;
}

/**
 * Les faits qu'un compte peut raconter : les siens et ceux de toute l'équipe, les moins
 * racontés d'abord — un même fait servi trois fois se remarque.
 */
export function faitsPourLeCompte(compteKey: string | null, limite = 6): Fait[] {
  return db
    .select()
    .from(schema.faits)
    .where(and(eq(schema.faits.actif, true), compteKey ? or(isNull(schema.faits.compte), eq(schema.faits.compte, compteKey)) : isNull(schema.faits.compte)))
    .orderBy(asc(schema.faits.utilisations), desc(schema.faits.dateFait), desc(schema.faits.createdAt))
    .limit(limite)
    .all();
}

export function noterUsage(faitId: number, now = new Date()): void {
  db.update(schema.faits)
    .set({ utilisations: sql`${schema.faits.utilisations} + 1`, dernierUsage: now.toISOString() })
    .where(eq(schema.faits.id, faitId))
    .run();
}

/** Un fait tel que le rédacteur le lit : numéro, date, source, et s'il peut nommer le client. */
export function faitPourLePrompt(f: Fait): string {
  const date = f.dateFait ? ` (${f.dateFait})` : '';
  const nommable = f.source === 'client' || f.source === 'audit' ? (f.accordClient ? ' — client nommable' : ' — client anonyme') : '';
  return `[${f.id}]${date} ${f.source}${nommable} : ${f.texte}`;
}

/**
 * Intègre un fait vécu à la place de l'emplacement « [FAIT VÉCU : …] » : le modèle
 * l'écrit à la voix du post, sans rien inventer autour. En simulation (ou sans
 * budget), le fait remplace l'emplacement tel quel.
 */
export async function integrerLeFait(caption: string, fait: { texte: string; accordClient: boolean }, registre: 'vous' | 'tu'): Promise<string> {
  const brut = caption.replace(EMPLACEMENT_FAIT, fait.texte.trim());
  if (config.LLM_MODE === 'mock' || !verifierBudget('writing').autorise) return brut;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        label: 'post:fait-vecu',
        tier: 'best',
        prompt: `Voici un post LinkedIn. Il contient l'emplacement « [FAIT VÉCU : …] ». Remplace-le par le fait réel ci-dessous,
écrit à la voix du post, en une à trois phrases courtes. N'ajoute AUCUN détail qui ne figure pas dans le fait (pas de chiffre,
pas de nom, pas de durée inventés).${fait.accordClient ? '' : ' Le client ne doit pas être nommé : garde-le anonyme (« un cabinet comptable », « une boutique toulousaine »).'}
Ne touche à rien d'autre dans le texte. ${registre === 'vous' ? 'Vouvoiement.' : 'Tutoiement.'}

FAIT RÉEL :
${fait.texte.trim()}

POST :
${caption}

Réponds en JSON : {"caption": "..."}`,
        maxTokens: 2500,
      },
      z.object({ caption: z.string().min(50).max(3000) }).superRefine((v, ctx) => {
        if (faitACompleter(v.caption)) ctx.addIssue({ code: 'custom', path: ['caption'], message: 'l’emplacement [FAIT VÉCU] doit disparaître' });
        if (porteUnAppat(v.caption)) ctx.addIssue({ code: 'custom', path: ['caption'], message: 'aucun « Commente MOT »' });
        if (registre === 'vous' && tutoie(v.caption)) ctx.addIssue({ code: 'custom', path: ['caption'], message: 'vouvoiement' });
      }),
    );
    return value.caption.trim();
  } catch {
    return brut;
  }
}

/** Le registre d'un compte : le sien s'il est réglé, sinon celui de la stratégie. */
export function registreDuCompte(compteKey: string | null | undefined): 'vous' | 'tu' {
  const strategie = getStrategieLinkedIn();
  return (compteKey && strategie.registres[compteKey]) || strategie.registre;
}
