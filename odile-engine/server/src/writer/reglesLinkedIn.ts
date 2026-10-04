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

/** L'emplacement laissé par le rédacteur quand aucun fait de la banque ne sert le sujet. */
export const EMPLACEMENT_FAIT = /\[\s*FAIT V[ÉE]CU[^\]]*\]/i;

/** Le post attend-il encore son fait vécu ? */
export function faitACompleter(texte: string): boolean {
  return EMPLACEMENT_FAIT.test(texte);
}

/** Le mot qui signe un texte « écrit par une IA », et ce qu'il faut en dire au relecteur. */
const MOTS_IA: [RegExp, string][] = [
  [/révolutionn/i, '« révolutionner »'],
  [/game[- ]?changer/i, '« game changer »'],
  [/dans un monde où/i, '« dans un monde où »'],
  [/à l[’']ère (?:de|du|des)/i, '« à l’ère de »'],
  [/(?<![\p{L}])(?:booster|incontournable|crucial(?:e|es|aux)?)(?![\p{L}])/iu, 'mot de plaquette (booster, incontournable, crucial)'],
  [/n[’']est plus une option/i, '« n’est plus une option »'],
  [/(?<![\p{L}])plongeons(?![\p{L}])|(?<![\p{L}])décortiqu/iu, '« plongeons », « décortiquer »'],
  [/(?<![\p{L}])spoiler(?![\p{L}])/iu, '« spoiler »'],
];

/** Le jargon qu'un dirigeant de PME ne parle pas : on dit des heures, des euros, des mois. */
const JARGON = /(?<![\p{L}])(?:workflows?|RAG|LLMs?|prompts?|agentiques?|no-code|low-code|SaaS|scalables?|pipelines?|stack)(?![\p{L}])/iu;

/** Les promesses que personne ne peut vérifier. */
const INVERIFIABLE = /chez (?:tous )?nos clients|(?<![\d,])100\s?%|\b\d{2,}\s+(?:PME|clients|entreprises)\s+(?:accompagnées|nous font confiance)|\b\d+\s?x\s+plus\b|\+\s?\d{3,}\s?%/i;

/**
 * Les signaux d'un texte « écrit par une IA », que LinkedIn déclasse (un texte 100 %
 * généré fait 2,8 fois moins de portée). Chaque entrée est une phrase pour le relecteur.
 */
export function signauxIA(texte: string): string[] {
  const signaux: string[] = [];
  if (/→|➡️|➜|->/.test(texte)) signaux.push('des flèches en début de ligne');
  const tirets = (texte.match(/—/g) ?? []).length;
  if (tirets >= 2) signaux.push(`${tirets} tirets longs (—)`);
  // Une énumération par trois (« a, b et c ») : phrase par phrase, pour rester rapide.
  const triades = texte.split(/[.!?\n]+/).filter((phrase) => /^[^,]{2,80},[^,]{2,80},?\s+et\s+[^,]{2,80}$/.test(phrase.trim())).length;
  if (triades >= 2) signaux.push('des énumérations par trois, à répétition');
  const lignesEmoji = texte.split('\n').filter((l) => /^\s*\p{Extended_Pictographic}/u.test(l)).length;
  if (lignesEmoji >= 3) signaux.push('une liste à puces en émojis');
  for (const [motif, libelle] of MOTS_IA) if (motif.test(texte)) signaux.push(libelle);
  const jargon = JARGON.exec(texte);
  if (jargon) signaux.push(`du jargon (« ${jargon[0]} ») : parlez d’heures, d’euros, de mois`);
  const promesse = INVERIFIABLE.exec(texte);
  if (promesse) signaux.push(`une promesse invérifiable (« ${promesse[0].trim()} »)`);
  return signaux;
}

/** Le texte nomme-t-il la marque ou son offre ? (le pitch, réservé au post promotionnel) */
export function porteUnPitch(texte: string, noms: string[], offre: string): boolean {
  const bas = texte.toLowerCase();
  if (offre.trim() && bas.includes(offre.trim().toLowerCase())) return true;
  return noms
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .some((n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}(?![\\p{L}])`, 'iu').test(texte));
}

const mots = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Part du texte réécrite par une personne, de 0 (texte de l'IA tel quel) à 1 (tout
 * réécrit) : 1 − (plus longue suite de mots communs ÷ longueur du plus long texte).
 */
export function tauxDeReecriture(genere: string, publie: string): number {
  const a = mots(genere);
  const b = mots(publie);
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  let precedent = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const courant = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      courant[j] = a[i - 1] === b[j - 1] ? precedent[j - 1]! + 1 : Math.max(precedent[j]!, courant[j - 1]!);
    }
    precedent = courant;
  }
  return Math.round((1 - precedent[b.length]! / Math.max(a.length, b.length)) * 100) / 100;
}
