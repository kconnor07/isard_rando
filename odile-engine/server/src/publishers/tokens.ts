import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  externalId: string;
  expiresAt: string | null;
  scopes: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

export type TokenSubject = 'li_person' | 'li_org' | 'fb_user' | 'fb_page' | 'ig_user';

export function getStoredToken(provider: 'linkedin' | 'meta', subject: TokenSubject): StoredToken | null {
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
    .get();
  if (!row) return null;
  return {
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
    externalId: row.externalId,
    expiresAt: row.expiresAt,
    scopes: row.scopes,
    updatedAt: row.updatedAt,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {},
  };
}

/** Fusionne des informations dans la meta d'un jeton (état de vérification, organisations…). */
export function updateTokenMeta(provider: 'linkedin' | 'meta', subject: TokenSubject, patch: Record<string, unknown>): void {
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
    .get();
  if (!row) return;
  const meta = { ...(row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {}), ...patch };
  db.update(schema.oauthTokens).set({ meta: JSON.stringify(meta) }).where(eq(schema.oauthTokens.id, row.id)).run();
}

export function deleteToken(provider: 'linkedin' | 'meta', subject: TokenSubject): void {
  db.delete(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
    .run();
}

export function storeToken(args: {
  provider: 'linkedin' | 'meta';
  subject: TokenSubject;
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
    .values({ provider: args.provider, subject: args.subject, ...values })
    .onConflictDoUpdate({ target: [schema.oauthTokens.provider, schema.oauthTokens.subject], set: values })
    .run();
}
