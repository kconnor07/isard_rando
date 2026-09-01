import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

export interface StoredToken {
  accessToken: string;
  externalId: string;
  expiresAt: string | null;
  meta: Record<string, unknown>;
}

export function getStoredToken(
  provider: 'linkedin' | 'meta',
  subject: 'li_person' | 'li_org' | 'fb_page' | 'ig_user',
): StoredToken | null {
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.provider, provider), eq(schema.oauthTokens.subject, subject)))
    .get();
  if (!row) return null;
  return {
    accessToken: decryptSecret(row.accessTokenEnc),
    externalId: row.externalId,
    expiresAt: row.expiresAt,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {},
  };
}

export function storeToken(args: {
  provider: 'linkedin' | 'meta';
  subject: 'li_person' | 'li_org' | 'fb_page' | 'ig_user';
  externalId: string;
  accessToken: string;
  scopes?: string;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
}): void {
  const now = new Date().toISOString();
  db.insert(schema.oauthTokens)
    .values({
      provider: args.provider,
      subject: args.subject,
      externalId: args.externalId,
      accessTokenEnc: encryptSecret(args.accessToken),
      scopes: args.scopes ?? '',
      expiresAt: args.expiresAt ?? null,
      meta: args.meta ? JSON.stringify(args.meta) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.oauthTokens.provider, schema.oauthTokens.subject],
      set: {
        externalId: args.externalId,
        accessTokenEnc: encryptSecret(args.accessToken),
        scopes: args.scopes ?? '',
        expiresAt: args.expiresAt ?? null,
        meta: args.meta ? JSON.stringify(args.meta) : null,
        updatedAt: now,
      },
    })
    .run();
}
