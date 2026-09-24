/**
 * Qui un post peut identifier (@), et comment.
 *
 * LinkedIn : une identification exige l'identifiant de la page (urn:li:organization:…).
 * Le chercher par nom demande un droit que LinkedIn n'accorde qu'aux apps du
 * programme « page entreprise » : le répertoire (Réglages → Mentions) le fournit.
 * Les personnes ne s'identifient pas par l'API — sauf les profils connectés au moteur.
 *
 * Instagram : un @ n'est que du texte ; un @ faux identifierait un inconnu. Seuls
 * passent les comptes du répertoire, et ceux que l'API Instagram confirme exister.
 */
import type { MentionRepertoire } from '@odile/shared';
import { getMentions } from '../db/settingsRepo.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { getStoredToken } from '../publishers/tokens.js';

export interface MentionDeclaree {
  nom: string;
  type?: 'entreprise' | 'personne';
  vanityName?: string;
  instagram?: string;
  source?: boolean;
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Un nom écrit dans le texte, comme mot entier, hors @ déjà posé. Apostrophes droites ou courbes. */
function motif(nom: string): RegExp {
  const souple = echapper(nom.trim()).replace(/['’]/g, "['’]").replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_@])${souple}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** La forme exacte sous laquelle le texte écrit ce nom (ou l'un de ses alias), sinon null. */
export function formeDansLeTexte(texte: string, noms: string[]): string | null {
  for (const n of noms) {
    if (!n || n.trim().length < 2) continue;
    const m = motif(n).exec(texte);
    if (m) return m[0];
  }
  return null;
}

/** Les entrées du répertoire que le texte cite, avec la forme employée. */
export function citesDuRepertoire(texte: string, repertoire: MentionRepertoire[] = getMentions().repertoire): { entree: MentionRepertoire; forme: string }[] {
  const out: { entree: MentionRepertoire; forme: string }[] = [];
  for (const entree of repertoire) {
    const forme = formeDansLeTexte(texte, [entree.nom, ...entree.alias]);
    if (forme) out.push({ entree, forme });
  }
  return out;
}

/** LinkedIn : les identifications que le répertoire permet, sans aucun appel à l'API. */
export function mentionsLinkedInDuRepertoire(texte: string, repertoire?: MentionRepertoire[]): { nom: string; urn: string }[] {
  return citesDuRepertoire(texte, repertoire)
    .filter((c) => c.entree.linkedinUrn)
    .map((c) => ({ nom: c.forme, urn: c.entree.linkedinUrn }));
}

// ---- Instagram ------------------------------------------------------------------

const verdicts = new Map<string, { ok: boolean; at: number }>();
const UNE_SEMAINE = 7 * 86400000;

/**
 * Le compte Instagram existe-t-il ? (API « Business Discovery » : elle répond pour
 * les comptes professionnels — ceux des marques, médias et personnalités publiques.)
 * Sans jeton ou sans droit, la réponse est non : dans le doute, pas de @.
 */
export async function compteInstagramVerifie(handle: string): Promise<boolean> {
  const cle = handle.toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(cle)) return false;
  const deja = verdicts.get(cle);
  if (deja && Date.now() - deja.at < UNE_SEMAINE) return deja.ok;
  const ig = getStoredToken('meta', 'ig_user');
  if (!ig) return false;
  let ok = false;
  try {
    const { GRAPH } = await import('../publishers/instagram.js');
    const res = await fetchJson<{ business_discovery?: { username?: string } }>(
      `${GRAPH}/${ig.externalId}?fields=${encodeURIComponent(`business_discovery.username(${cle}){username}`)}&access_token=${encodeURIComponent(ig.accessToken)}`,
      { retries: 1, timeoutMs: 12_000 },
    );
    ok = res.business_discovery?.username?.toLowerCase() === cle;
  } catch (err) {
    logger.debug({ handle: cle, err: String(err).slice(0, 160) }, 'compte Instagram non vérifiable — pas de @');
  }
  verdicts.set(cle, { ok, at: Date.now() });
  return ok;
}

/**
 * Pose les @ Instagram : la première apparition de chaque nom devient son compte,
 * s'il est dans le répertoire ou confirmé par l'API. Le reste reste écrit en clair.
 */
export async function mentionnerSurInstagram(
  caption: string,
  declarees: MentionDeclaree[],
  opts: { repertoire?: MentionRepertoire[]; verifier?: (handle: string) => Promise<boolean> } = {},
): Promise<{ caption: string; poses: string[] }> {
  const repertoire = opts.repertoire ?? getMentions().repertoire;
  const verifier = opts.verifier ?? compteInstagramVerifie;
  const candidats: { forme: string; handle: string }[] = [];
  for (const c of citesDuRepertoire(caption, repertoire)) {
    if (c.entree.instagram) candidats.push({ forme: c.forme, handle: c.entree.instagram });
  }
  for (const m of declarees) {
    const handle = (m.instagram ?? '').trim().replace(/^@+/, '');
    if (!handle || candidats.some((c) => c.handle.toLowerCase() === handle.toLowerCase())) continue;
    const forme = formeDansLeTexte(caption, [m.nom]);
    if (!forme) continue;
    if (await verifier(handle)) candidats.push({ forme, handle });
  }
  let texte = caption;
  const poses: string[] = [];
  for (const c of candidats.slice(0, 5)) {
    if (new RegExp(`@${echapper(c.handle)}(?![\\w.])`, 'i').test(texte)) continue;
    const m = motif(c.forme).exec(texte);
    if (!m) continue;
    texte = `${texte.slice(0, m.index)}@${c.handle}${texte.slice(m.index + m[0].length)}`;
    poses.push(c.handle);
  }
  return { caption: texte, poses };
}
