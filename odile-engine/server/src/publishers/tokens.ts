import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  /** Identifiant de la connexion : le `sub` du membre, l'id de l'organisation. Vide chez Meta. */
  accountKey: string;
  externalId: string;
  expiresAt: string | null;
  scopes: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

export type TokenSubject = 'li_person' | 'li_org' | 'fb_user' | 'fb_page' | 'ig_user';
type Provider = 'linkedin' | 'meta';

type TokenRow = typeof schema.oauthTokens.$inferSelect;

function hydrate(row: TokenRow): StoredToken {
  return {
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
    accountKey: row.accountKey,
    externalId: row.externalId,
    expiresAt: row.expiresAt,
    scopes: row.scopes,
    updatedAt: row.updatedAt,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {},
  };
}

/**
 * Jetons d'un même type, du plus ancien au plus récent.
 *
 * Plusieurs profils LinkedIn personnels cohabitent (le tien, celui d'Alexis, les
 * prochaines recrues) : ils partagent le sujet `li_person` et se distinguent par
 * leur `accountKey`.
 */
export function listStoredTokens(provider: Provider, subject: TokenSubject): StoredToken[] {
  return db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
    .orderBy(asc(schema.oauthTokens.id))
    .all()
    .map(hydrate);
}

/**
 * Un jeton précis. Sans `accountKey`, renvoie la connexion la plus ancienne de ce
 * type — le comportement d'avant les comptes multiples, que tout le code qui ne
 * s'intéresse qu'à « un » compte peut continuer d'utiliser.
 */
export function getStoredToken(provider: Provider, subject: TokenSubject, accountKey?: string): StoredToken | null {
  if (accountKey === undefined) return listStoredTokens(provider, subject)[0] ?? null;
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(
      and(
        eq(schema.oauthTokens.provider, provider),
        eq(schema.oauthTokens.subject, subject),
        eq(schema.oauthTokens.accountKey, accountKey),
      ),
    )
    .get();
  return row ? hydrate(row) : null;
}

/** Fusionne des informations dans la meta d'un jeton (état de vérification, organisations…). */
export function updateTokenMeta(
  provider: Provider,
  subject: TokenSubject,
  patch: Record<string, unknown>,
  accountKey?: string,
): void {
  const row =
    accountKey === undefined
      ? db
          .select()
          .from(schema.oauthTokens)
          .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
          .orderBy(asc(schema.oauthTokens.id))
          .get()
      : db
          .select()
          .from(schema.oauthTokens)
          .where(
            and(
              eq(schema.oauthTokens.provider, provider),
              eq(schema.oauthTokens.subject, subject),
              eq(schema.oauthTokens.accountKey, accountKey),
            ),
          )
          .get();
  if (!row) return;
  const meta = { ...(row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {}), ...patch };
  db.update(schema.oauthTokens).set({ meta: JSON.stringify(meta) }).where(eq(schema.oauthTokens.id, row.id)).run();
}

/** Supprime une connexion. Sans `accountKey`, supprime toutes celles de ce type. */
export function deleteToken(provider: Provider, subject: TokenSubject, accountKey?: string): void {
  const where =
    accountKey === undefined
      ? and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject))
      : and(
          eq(schema.oauthTokens.provider, provider),
          eq(schema.oauthTokens.subject, subject),
          eq(schema.oauthTokens.accountKey, accountKey),
        );
  db.delete(schema.oauthTokens).where(where).run();
}

export function storeToken(args: {
  provider: Provider;
  subject: TokenSubject;
  /** Vide par défaut : un seul compte de ce type (Meta). */
  accountKey?: string;
  externalId: string;
  accessToken: string;
  refreshToken?: string | null;
  scopes?: string;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
}): void {
  const now = new Date().toISOString();
  const values = {
    externalId: args.externalId,
    accessTokenEnc: encryptSecret(args.accessToken),
    refreshTokenEnc: args.refreshToken ? encryptSecret(args.refreshToken) : null,
    scopes: args.scopes ?? '',
    expiresAt: args.expiresAt ?? null,
    meta: args.meta ? JSON.stringify(args.meta) : null,
    updatedAt: now,
  };
  db.insert(schema.oauthTokens)
    .values({ provider: args.provider, subject: args.subject, accountKey: args.accountKey ?? '', ...values })
    .onConflictDoUpdate({
      target: [schema.oauthTokens.provider, schema.oauthTokens.subject, schema.oauthTokens.accountKey],
      set: values,
    })
    .run();
}
