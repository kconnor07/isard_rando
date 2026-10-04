/**
 * Les règles d'écriture LinkedIn 2026, en fonctions simples et testées.
 *
 * Partagées par le rédacteur (le modèle corrige lui-même ce qui ne passe pas), la
 * diffusion sur les autres comptes, la conformité (l'écran de validation) et le
 * réalignement des anciens posts : une seule définition de ce qui est déclassé.
 */
import { porteLeSite } from './marque.js';

/** Un mot entier, accents compris (\b ne connaît que l'ASCII). */
const motEntier = (motif: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${motif})(?![\\p{L}\\p{N}])`, 'iu');

/**
 * « Commente CAS », « commentez OUI » : l'appât à engagement que LinkedIn déclasse
 * officiellement depuis mars 2026. Un mot en capitales après « commente », ou un
 * « oui » à commenter.
 */
export function porteUnAppat(texte: string): boolean {
  return (
    /(?<![\p{L}])[Cc]ommente[sz]?\s+[«"“]?\s*[A-ZÉÈÀÇ]{2,}(?![\p{Ll}])/u.test(texte) ||
    /(?<![\p{L}])commente[sz]?\s+[«"“]?\s*(?:oui|yes|ok)(?![\p{L}])/iu.test(texte)
  );
}

/** La ligne (ou les lignes) qui portent l'appât, à retirer d'un ancien post. */
export function sansAppat(texte: string): string {
  return texte
    .split('\n')
    .filter((ligne) => !porteUnAppat(ligne))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Le texte tutoie-t-il le lecteur ? « ton » et « ta » sont écartés : « le ton d'un message ». */
export function tutoie(texte: string): boolean {
  return motEntier('tu|toi|tes').test(texte) || /(?<![\p{L}])t[’'](?=\p{L})/iu.test(texte);
}

/** Le texte vouvoie-t-il le lecteur ? (« rendez-vous » n'en est pas un) */
export function vouvoie(texte: string): boolean {
  return /(?<![\p{L}-])vous(?![\p{L}])/iu.test(texte) || motEntier('votre|vos').test(texte);
}

/** L'accroche : ce qui précède le premier saut de ligne, seul visible avant « …voir plus » sur mobile. */
export function accroche(caption: string): string {
  return caption.trim().split('\n')[0]?.trim() ?? '';
}

/** Longueur visée de l'accroche, en caractères (troncature mobile). */
export const ACCROCHE_MAX = 140;

/** Une adresse, un lien court, un marqueur de lien, ou le site de la marque. */
export function contientUnLien(texte: string, domaine?: string): boolean {
  return /https?:\/\/|www\.|\{\{link\}\}|\/r\/[a-z2-9]{6,}/i.test(texte) || porteLeSite(texte, domaine);
}

/** Le texte finit-il sur une question ? (les lignes « Source : … » et les hashtags ne comptent pas) */
export function finitSurUneQuestion(caption: string): boolean {
  const lignes = caption
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^source\s*:/i.test(l) && !/^(#[\p{L}\p{N}_]+\s*)+$/u.test(l));
  return /\?\s*[»"”)]?\s*$/.test(lignes.at(-1) ?? '');
}
