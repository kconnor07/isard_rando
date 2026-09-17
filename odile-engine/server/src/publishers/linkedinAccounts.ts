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
import { listStoredTokens, type StoredToken, type TokenSubject } from './tokens.js';

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
  };
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
  return comptes.find((c) => c.actif) ?? comptes[0]!;
}

/**
 * À qui revient le prochain post personnel.
 *
 * Tour de rôle : le compte actif qui a publié le moins récemment. Deux recrues qui
 * arrivent le même jour se partagent donc la cadence sans réglage à faire.
 */
export function prochainComptePersonnel(): CompteLinkedIn | null {
  const actifs = comptesLinkedIn('li_person').filter((c) => c.actif);
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
  if (channel === 'li_org') return comptesLinkedIn('li_org').find((c) => c.actif) ?? null;
  return null;
}

/** Droits nécessaires pour lire et écrire des commentaires, selon la surface. */
export function droitCommentaire(compte: CompteLinkedIn): { peutRepondre: boolean; manque: string } {
  const attendu = compte.subject === 'li_org' ? 'w_organization_social' : 'w_member_social';
  if (compte.scopes.includes(attendu)) return { peutRepondre: true, manque: '' };
  return { peutRepondre: false, manque: attendu };
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
