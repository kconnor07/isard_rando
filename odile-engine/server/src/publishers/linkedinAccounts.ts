/**
 * Les comptes LinkedIn de l'équipe.
 *
 * Un même sujet `li_person` peut désormais porter plusieurs connexions — le profil
 * de chacun — distinguées par leur `accountKey` (le `sub` LinkedIn du membre). La
 * page entreprise reste un sujet à part (`li_org`), avec la même mécanique : on
 * pourrait en lier plusieurs sans rien changer ici.
 *
 * Tout ce qui publie, lit des commentaires ou y répond passe par ce module, pour
 * ne jamais avoir à deviner « quel jeton ? » : la réponse est portée par le post.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { listStoredTokens, updateTokenMeta, type StoredToken, type TokenSubject } from './tokens.js';

export interface CompteLinkedIn {
  /** Clé de la connexion (sub du membre, id de l'organisation). */
  key: string;
  subject: 'li_person' | 'li_org';
  /** Identifiant LinkedIn : person id ou organization id. */
  externalId: string;
  /** URN acteur, tel que l'API LinkedIn l'attend pour publier ou commenter. */
  actor: string;
  name: string;
  /** Étiquette libre : « Alexis — cofondateur ». Cosmétique. */
  role: string;
  /** Un compte désactivé reste connecté mais sort de la rotation. */
  actif: boolean;
  expiresAt: string | null;
  scopes: string;
  connectedAt: string | null;
  /** jeton expiré ou dernier contrôle de santé en échec : le compte ne publiera pas */
  enPanne: boolean;
  /** pourquoi, en une phrase, quand il est en panne */
  panne: string;
}

/** URN acteur d'un compte : ce que LinkedIn attend en `author` (posts) et `actor` (commentaires). */
export function actorUrn(subject: 'li_person' | 'li_org', externalId: string): string {
  return subject === 'li_org' ? `urn:li:organization:${externalId}` : `urn:li:person:${externalId}`;
}

function toCompte(subject: 'li_person' | 'li_org', token: StoredToken): CompteLinkedIn {
  const meta = token.meta;
  return {
    key: token.accountKey || token.externalId,
    subject,
    externalId: token.externalId,
    actor: actorUrn(subject, token.externalId),
    name: (meta.name as string | undefined)?.trim() || (subject === 'li_org' ? 'Page entreprise' : `Membre ${token.externalId}`),
    role: (meta.role as string | undefined) ?? '',
    // Absent = actif : les comptes déjà connectés ne doivent pas disparaître de la rotation.
    actif: meta.actif !== false,
    expiresAt: token.expiresAt,
    scopes: token.scopes,
    connectedAt: (meta.connectedAt as string | undefined) ?? null,
    ...etatDuJeton(subject, token),
  };
}

/**
 * Un compte « en panne » ne publiera pas : jeton expiré, dernier contrôle de santé en
 * échec, ou page sans droit de publication. Le calendrier, la validation et
 * l'amplification le savent avant d'y programmer quoi que ce soit.
 */
function etatDuJeton(subject: 'li_person' | 'li_org', token: StoredToken): { enPanne: boolean; panne: string } {
  if (token.expiresAt && new Date(token.expiresAt).getTime() < Date.now()) {
    return { enPanne: true, panne: 'jeton expiré — reconnecter ce compte dans Connexions & santé' };
  }
  if (subject === 'li_org' && !token.scopes.includes('w_organization_social')) {
    return { enPanne: true, panne: 'droit de publication absent — reconnecter LinkedIn avec l’option « page entreprise »' };
  }
  const check = token.meta.lastCheck as DernierControle | undefined;
  if (check && controleEnPanne(check)) {
    return { enPanne: true, panne: `LinkedIn refuse ce compte : ${String(check.detail ?? '').slice(0, 140)}` };
  }
  return { enPanne: false, panne: '' };
}

/** Ce que le bouton « Tester » (ou le contrôle quotidien) a laissé sur le jeton. */
export interface DernierControle {
  at?: string;
  ok?: boolean;
  detail?: string;
  /** refus de la plateforme (jeton, droit) ou simple absence de réponse (réseau, 5xx) */
  cause?: 'auth' | 'reseau';
  status?: number | null;
}

/**
 * Un contrôle raté ne met le compte en panne que si la plateforme a REFUSÉ le
 * jeton ou le droit. Un délai ou une erreur de son côté n'est pas une panne du
 * compte : on le signale, on ne bloque rien. Les contrôles enregistrés avant que
 * la cause soit notée sont lus à leur texte.
 */
export function controleEnPanne(check: DernierControle): boolean {
  if (check.ok !== false) return false;
  if (check.cause) return check.cause === 'auth';
  if (typeof check.status === 'number') return check.status === 401 || check.status === 403;
  return /jeton|expir|r[ée]voqu|droit|permission|invalide|scope|\b40[13]\b/i.test(check.detail ?? '');
}

/** Tous les comptes d'un type, dans l'ordre de connexion. */
export function comptesLinkedIn(subject: 'li_person' | 'li_org'): CompteLinkedIn[] {
  return listStoredTokens('linkedin', subject).map((t) => toCompte(subject, t));
}

/** Les trois surfaces à surveiller : chaque profil personnel connecté, puis la page. */
export function toutesLesSurfaces(): CompteLinkedIn[] {
  return [...comptesLinkedIn('li_person'), ...comptesLinkedIn('li_org')];
}

/** Jeton d'un compte, retrouvé par sa clé. */
export function jetonDuCompte(compte: Pick<CompteLinkedIn, 'subject' | 'key'>): StoredToken | null {
  const tokens = listStoredTokens('linkedin', compte.subject);
  return tokens.find((t) => (t.accountKey || t.externalId) === compte.key) ?? null;
}

/**
 * Le compte qui publie un post donné.
 *
 * `liAccountKey` est fixé à la rédaction ; s'il manque (posts d'avant les comptes
 * multiples) ou si ce compte a été déconnecté depuis, on retombe sur le premier
 * compte actif du canal — mieux vaut publier que de bloquer sur une clé périmée.
 */
export function compteDuPost(post: { channel: string; liAccountKey?: string | null }): CompteLinkedIn | null {
  const subject: 'li_person' | 'li_org' = post.channel === 'li_org' ? 'li_org' : 'li_person';
  const comptes = comptesLinkedIn(subject);
  if (comptes.length === 0) return null;
  if (post.liAccountKey) {
    const exact = comptes.find((c) => c.key === post.liAccountKey);
    if (exact) return exact;
  }
  // Un compte en panne ne prend pas le relais d'un autre : il ne publierait pas.
  return comptes.find((c) => c.actif && !c.enPanne) ?? comptes.find((c) => c.actif) ?? comptes[0]!;
}

/**
 * À qui revient le prochain post personnel.
 *
 * Tour de rôle : le compte actif qui a publié le moins récemment. Deux recrues qui
 * arrivent le même jour se partagent donc la cadence sans réglage à faire.
 */
export function prochainComptePersonnel(): CompteLinkedIn | null {
  // Un profil en panne (jeton expiré, droit refusé) sort du tour de rôle : lui
  // écrire un post, c'est un post qui ne partira pas.
  const actifs = comptesLinkedIn('li_person').filter((c) => c.actif && !c.enPanne);
  if (actifs.length === 0) return null;
  if (actifs.length === 1) return actifs[0]!;
  const dernier = new Map<string, string>();
  for (const row of db
    .select({ key: schema.posts.liAccountKey, at: schema.posts.publishedAt })
    .from(schema.posts)
    .where(and(eq(schema.posts.channel, 'li_personal'), isNotNull(schema.posts.publishedAt)))
    .orderBy(desc(schema.posts.publishedAt))
    .all()) {
    if (row.key && row.at && !dernier.has(row.key)) dernier.set(row.key, row.at);
  }
  // Jamais publié = passe devant ; sinon le plus ancien passage.
  return actifs.slice().sort((a, b) => (dernier.get(a.key) ?? '').localeCompare(dernier.get(b.key) ?? ''))[0]!;
}

/**
 * Le compte qui publiera un brouillon de ce canal — avant même que le post existe.
 *
 * Le rédacteur en a besoin AVANT d'écrire : un post signé d'un profil ne se raconte
 * pas comme un post de la page. Publier avec un autre compte que celui annoncé au
 * rédacteur produirait un texte à la première personne signé par quelqu'un d'autre.
 */
export function compteDuCanal(channel: string): CompteLinkedIn | null {
  if (channel === 'li_personal') return prochainComptePersonnel();
  if (channel === 'li_org') return comptesLinkedIn('li_org').find((c) => c.actif && !c.enPanne) ?? null;
  return null;
}

/** Droits nécessaires pour lire et écrire des commentaires, selon la surface. */
export function droitCommentaire(compte: CompteLinkedIn): {
  peutRepondre: boolean;
  manque: string;
  /** LinkedIn n'ouvre la LECTURE des commentaires qu'avec un droit à part, qu'il n'accorde pas à toutes les applications. */
  peutLire: boolean;
  manqueLecture: string;
} {
  const ecriture = compte.subject === 'li_org' ? 'w_organization_social' : 'w_member_social';
  const lecture = compte.subject === 'li_org' ? 'r_organization_social' : 'r_member_social';
  return {
    peutRepondre: compte.scopes.includes(ecriture),
    manque: compte.scopes.includes(ecriture) ? '' : ecriture,
    peutLire: compte.scopes.includes(lecture),
    manqueLecture: compte.scopes.includes(lecture) ? '' : lecture,
  };
}

/**
 * Ce que le dernier passage du lecteur de commentaires a donné, compte par compte.
 *
 * Sans cette trace, un refus de LinkedIn (droit de lecture non accordé) ne vivait
 * que dans les logs du serveur : le tunnel semblait branché alors qu'aucun
 * commentaire n'était jamais lu.
 */
export interface EtatLecture {
  ok: boolean;
  detail: string;
  at: string;
}

export function noterLecture(compte: CompteLinkedIn, etat: Omit<EtatLecture, 'at'>): void {
  updateTokenMeta('linkedin', compte.subject, { lectureCommentaires: { ...etat, at: new Date().toISOString() } }, compte.key);
}

export function etatLecture(compte: CompteLinkedIn): EtatLecture | null {
  const token = jetonDuCompte(compte);
  const brut = token?.meta.lectureCommentaires as EtatLecture | undefined;
  return brut && typeof brut.ok === 'boolean' ? brut : null;
}

export type { TokenSubject };

/**
 * Les entités que le moteur sait identifier dans un texte : chaque page entreprise
 * liée et chaque profil connecté. Le rédacteur écrit les noms en clair ; le publisher
 * les transforme en identifications cliquables (voir `commentary`).
 */
export function mentionsConnues(): { nom: string; urn: string }[] {
  return toutesLesSurfaces()
    .filter((c) => c.name && !/^(Membre|Organisation) \S+$/.test(c.name) && c.name !== 'Page entreprise')
    .map((c) => ({ nom: c.name, urn: c.actor }));
}
