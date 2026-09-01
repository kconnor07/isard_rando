import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';

const nanoCode = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 8);

export interface CreatedLink {
  id: number;
  code: string;
  shortUrl: string;
}

export function createLink(
  targetUrl: string,
  opts: { postId?: number | null; label?: string; utm?: Record<string, string> } = {},
): CreatedLink {
  const code = nanoCode();
  const row = db
    .insert(schema.links)
    .values({
      code,
      targetUrl,
      postId: opts.postId ?? null,
      label: opts.label ?? '',
      utm: opts.utm ? JSON.stringify(opts.utm) : null,
    })
    .returning({ id: schema.links.id })
    .get();
  return { id: row.id, code, shortUrl: `${config.PUBLIC_URL}/r/${code}` };
}

export function resolveLink(code: string) {
  return db.select().from(schema.links).where(eq(schema.links.code, code)).get() ?? null;
}

/** URL finale avec les UTM ajoutés au moment de la redirection. */
export function targetWithUtm(link: { targetUrl: string; utm: string | null }): string {
  if (!link.utm) return link.targetUrl;
  try {
    const utm = JSON.parse(link.utm) as Record<string, string>;
    const u = new URL(link.targetUrl);
    for (const [k, v] of Object.entries(utm)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return link.targetUrl;
  }
}
