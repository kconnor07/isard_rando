import { createHash } from 'node:crypto';

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|source|cmpid)/i;

/** URL canonique : https, host en minuscules, sans paramètres de tracking ni fragment. */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.protocol = 'https:';
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    u.pathname = u.pathname.replace(/\/+$/, '');
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl.trim();
  }
}

export function contentHash(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex');
}

const STOPWORDS = new Set([
  'les', 'des', 'une', 'aux', 'est', 'pour', 'avec', 'sur', 'dans', 'par', 'son', 'ses', 'qui', 'que',
  'the', 'and', 'for', 'with', 'its', 'has', 'are', 'this', 'that', 'from', 'into', 'how', 'why',
]);

export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Similarité de Jaccard entre deux titres normalisés. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a));
  const tb = new Set(normalizeTitle(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const TITLE_SIMILARITY_THRESHOLD = 0.85;
