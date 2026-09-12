import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { fetchJson, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from './instagram.js';
import { API, linkedInHeaders } from './linkedin.js';
import { getStoredToken } from './tokens.js';

type Post = typeof schema.posts.$inferSelect;
export type MetricsRow = typeof schema.postMetrics.$inferSelect;

export interface MetricsSnapshot {
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement: number | null;
  /** ce que la plateforme n'a pas fourni, et pourquoi */
  partial: string[];
  raw: unknown;
}

function sumKnown(...values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

interface IgInsight {
  name: string;
  values?: { value?: number }[];
  total_value?: { value?: number };
}

/** Jeux de métriques essayés dans l'ordre : Meta refuse tout l'appel si une seule n'est pas supportée. */
const IG_METRIC_SETS = [
  ['reach', 'saved', 'shares', 'total_interactions', 'views'],
  ['reach', 'saved', 'shares', 'total_interactions'],
  ['reach', 'saved', 'total_interactions'],
  ['reach'],
];

export async function fetchInstagramMetrics(mediaId: string, token: string): Promise<MetricsSnapshot> {
  const partial: string[] = [];
  const media = await fetchJson<{ like_count?: number; comments_count?: number; media_type?: string }>(
    `${GRAPH}/${mediaId}?fields=like_count,comments_count,media_type&access_token=${encodeURIComponent(token)}`,
  );
  let insights: Record<string, number> = {};
  let insightsError: string | null = null;
  for (const set of IG_METRIC_SETS) {
    try {
      const res = await fetchJson<{ data?: IgInsight[] }>(
        `${GRAPH}/${mediaId}/insights?metric=${set.join(',')}&access_token=${encodeURIComponent(token)}`,
      );
      insights = Object.fromEntries(
        (res.data ?? []).map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? 0]),
      );
      insightsError = null;
      const missing = IG_METRIC_SETS[0]!.filter((m) => !set.includes(m));
      if (missing.length) partial.push(`insights partiels (${missing.join(', ')} non disponibles pour ce média)`);
      break;
    } catch (err) {
      insightsError = err instanceof HttpError ? `HTTP ${err.status}` : String(err).slice(0, 120);
      if (!(err instanceof HttpError) || err.status !== 400) break;
    }
  }
  if (insightsError) partial.push(`insights indisponibles (${insightsError} — permission instagram_manage_insights ?)`);
  const likes = media.like_count ?? null;
  const comments = media.comments_count ?? null;
  const saves = insights.saved ?? null;
  const shares = insights.shares ?? null;
  return {
    reach: insights.reach ?? null,
    impressions: insights.views ?? null,
    likes,
    comments,
    shares,
    saves,
    engagement: insights.total_interactions ?? sumKnown(likes, comments, shares, saves),
    partial,
    raw: { media, insights },
  };
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

interface SocialActions {
  likesSummary?: { totalLikes?: number; aggregatedTotalLikes?: number };
  commentsSummary?: { totalFirstLevelComments?: number; aggregatedTotalComments?: number };
}
interface ShareStats {
  elements?: {
    totalShareStatistics?: {
      impressionCount?: number;
      uniqueImpressionsCount?: number;
      clickCount?: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
      engagement?: number;
    };
  }[];
}

export async function fetchLinkedInMetrics(post: Post, token: string, orgId: string | null): Promise<MetricsSnapshot> {
  const partial: string[] = [];
  const urn = post.externalPostId!;
  let likes: number | null = null;
  let comments: number | null = null;
  let social: SocialActions | null = null;
  try {
    social = await fetchJson<SocialActions>(`${API}/rest/socialActions/${encodeURIComponent(urn)}`, {
      headers: linkedInHeaders(token),
    });
    likes = social.likesSummary?.totalLikes ?? social.likesSummary?.aggregatedTotalLikes ?? null;
    comments = social.commentsSummary?.aggregatedTotalComments ?? social.commentsSummary?.totalFirstLevelComments ?? null;
  } catch (err) {
    partial.push(`réactions indisponibles (${err instanceof HttpError ? `HTTP ${err.status}` : String(err).slice(0, 80)})`);
  }
  let reach: number | null = null;
  let impressions: number | null = null;
  let shares: number | null = null;
  let stats: ShareStats | null = null;
  if (orgId) {
    // Statistiques de page entreprise (r_organization_social) : impressions, clics, partages
    const param = urn.startsWith('urn:li:ugcPost:') ? 'ugcPosts' : 'shares';
    try {
      stats = await fetchJson<ShareStats>(
        `${API}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          `urn:li:organization:${orgId}`,
        )}&${param}=List(${encodeURIComponent(urn)})`,
        { headers: linkedInHeaders(token) },
      );
      const s = stats.elements?.[0]?.totalShareStatistics;
      if (s) {
        reach = s.uniqueImpressionsCount ?? null;
        impressions = s.impressionCount ?? null;
        shares = s.shareCount ?? null;
        likes = likes ?? s.likeCount ?? null;
        comments = comments ?? s.commentCount ?? null;
      }
    } catch (err) {
      partial.push(`statistiques de page indisponibles (${err instanceof HttpError ? `HTTP ${err.status}` : String(err).slice(0, 80)})`);
    }
  } else {
    partial.push('portée non exposée par LinkedIn pour un profil personnel');
  }
  return {
    reach,
    impressions,
    likes,
    comments,
    shares,
    saves: null,
    engagement: sumKnown(likes, comments, shares),
    partial,
    raw: { social, stats },
  };
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/** Relève les statistiques d'un post publié (null : pas de jeton, ou publication simulée). */
export async function fetchPostMetrics(post: Post): Promise<MetricsSnapshot | null> {
  if (!post.externalPostId || post.externalPostId.startsWith('dry-')) return null;
  if (post.platform === 'instagram') {
    const token = getStoredToken('meta', 'ig_user');
    if (!token) return null;
    return fetchInstagramMetrics(post.externalPostId, token.accessToken);
  }
  const isOrg = post.channel === 'li_org';
  const token = getStoredToken('linkedin', isOrg ? 'li_org' : 'li_person');
  if (!token) return null;
  return fetchLinkedInMetrics(post, token.accessToken, isOrg ? token.externalId : null);
}

export interface MetricsJobSummary {
  candidates: number;
  fetched: number;
  skipped: number;
  errors: number;
  partial: number;
}

/**
 * Relève quotidienne des statistiques des posts publiés depuis moins de `maxAgeDays`
 * (une ligne d'historique par relevé ; un post n'est relevé qu'une fois par 20 h, sauf `force`).
 */
export async function runMetricsJob(opts: { maxAgeDays?: number; postIds?: number[]; force?: boolean } = {}): Promise<MetricsJobSummary> {
  const maxAgeDays = opts.maxAgeDays ?? 60;
  const since = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const conditions = [eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since), isNotNull(schema.posts.externalPostId)];
  if (opts.postIds?.length) conditions.push(inArray(schema.posts.id, opts.postIds));
  const posts = db.select().from(schema.posts).where(and(...conditions)).all();
  const latest = latestMetricsByPost(posts.map((p) => p.id));
  const summary: MetricsJobSummary = { candidates: posts.length, fetched: 0, skipped: 0, errors: 0, partial: 0 };
  for (const post of posts) {
    const last = latest.get(post.id);
    if (!opts.force && last && Date.now() - new Date(last.fetchedAt).getTime() < 20 * 3600000) {
      summary.skipped++;
      continue;
    }
    try {
      const snapshot = await fetchPostMetrics(post);
      if (!snapshot) {
        summary.skipped++;
        continue;
      }
      db.insert(schema.postMetrics)
        .values({
          postId: post.id,
          reach: snapshot.reach,
          impressions: snapshot.impressions,
          likes: snapshot.likes,
          comments: snapshot.comments,
          shares: snapshot.shares,
          saves: snapshot.saves,
          engagement: snapshot.engagement,
          partial: snapshot.partial.length ? snapshot.partial.join(' · ') : null,
          raw: JSON.stringify(snapshot.raw).slice(0, 8000),
        })
        .run();
      summary.fetched++;
      if (snapshot.partial.length) summary.partial++;
    } catch (err) {
      summary.errors++;
      logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'relevé des statistiques impossible');
    }
  }
  return summary;
}

/** Dernier relevé connu par post (une requête pour tous). */
export function latestMetricsByPost(postIds: number[]): Map<number, MetricsRow> {
  const out = new Map<number, MetricsRow>();
  if (postIds.length === 0) return out;
  const rows = db
    .select()
    .from(schema.postMetrics)
    .where(inArray(schema.postMetrics.postId, postIds))
    .orderBy(desc(schema.postMetrics.fetchedAt), desc(schema.postMetrics.id))
    .all();
  for (const row of rows) if (!out.has(row.postId)) out.set(row.postId, row);
  return out;
}

/** Score de performance d'un post : clics trackés + interactions pondérées (quand la plateforme les fournit). */
export function performanceScore(clicks: number, m: MetricsRow | MetricsSnapshot | undefined | null): number {
  if (!m) return clicks;
  return clicks + 0.5 * (m.likes ?? 0) + 2 * (m.comments ?? 0) + 2 * (m.saves ?? 0) + 3 * (m.shares ?? 0);
}
