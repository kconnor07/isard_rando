export interface PostSummaryDto {
  id: number;
  platform: string;
  channel: string;
  format: string;
  theme: string;
  status: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  createdAt: string;
  commentTriggerKeyword: string | null;
  reviewSummary: { iterations: number; finalScores: Record<string, number>; passed: boolean } | null;
  newsTitle: string | null;
  newsUrl: string | null;
  slideCount: number;
}

export interface SlideDto {
  id: number;
  idx: number;
  kind: string;
  content: Record<string, unknown> & { kind: string; title: string };
  renderAssetId: string | null;
  screenshotAssetId: string | null;
  heroAssetId: string | null;
  /** illustration détourée (PNG alpha) : placement réglable */
  heroCutout?: boolean;
}

export interface ReviewDto {
  id: number;
  iteration: number;
  reviewer: string;
  score: number;
  verdict: string;
  issues: { severity: string; slideIdx: number | null; target: string; problem: string; fix: string }[];
  passed: boolean;
  modelUsed: string;
  createdAt: string;
}

export interface PostDetailDto extends PostSummaryDto {
  slides: SlideDto[];
  reviews: ReviewDto[];
  clicks: number;
  /** objets flottants choisis pour ce post */
  visualOverrides?: {
    float1?: string | null;
    float2?: string | null;
    float3?: string | null;
    float4?: string | null;
    floatSize?: number;
    floatLayout?: string;
    floatBleed?: boolean;
    floatTilt?: number;
    floatSlides?: 'centrees' | 'accroche' | 'toutes';
    heroPlacement?: 'centre' | 'haut' | 'droite' | 'gauche' | null;
    heroSize?: number | null;
  };
}

export interface NewsDto {
  id: number;
  title: string;
  summary: string | null;
  url: string;
  lang: string;
  source: string;
  publishedAt: string | null;
  score: number | null;
  scoreRelevance: number | null;
  scoreClick: number | null;
  scoreFinal: number | null;
  engagement: number | null;
  topics: string[];
  contentExtracted: boolean;
  reason: string | null;
  status: string;
  shortlistRank: number | null;
}

export interface CommentDto {
  id: number;
  platform: string;
  authorName: string;
  text: string;
  matchedKeyword: string | null;
  dmStatus: string;
  suggestedReply: string | null;
  externalPostUrl: string | null;
  createdTime: string;
}

export interface ConnectionWarningDto {
  provider: string;
  subject: string;
  level: 'warn' | 'error';
  message: string;
}

export interface SummaryDto {
  awaitingApproval: number;
  scheduled: number;
  published: number;
  clicks7d: number;
  /** personnes atteintes et interactions des posts publiés sur 7 jours (dernier relevé) */
  reach7d: number;
  engagement7d: number;
  pendingComments: number;
  cadence: { due: boolean; reason: string };
  nextSlots: { instagram: string; linkedin: string };
  warnings: ConnectionWarningDto[];
}

/** Résultat d'une action sur un post (approbation, programmation…) */
export interface ActionOutcomeDto {
  ok: boolean;
  message: string;
  postId: number;
  scheduledAt?: string | null;
}

/** Créneau de publication configuré, avec le post qui l'occupe */
export interface SlotDto {
  at: string;
  platform: 'instagram' | 'linkedin';
  past: boolean;
  postId: number | null;
  postHook: string | null;
}

export interface PostMetricsDto {
  fetchedAt: string;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement: number | null;
  partial: string | null;
}

export interface PostStatDto {
  id: number;
  hook: string;
  channel: string;
  format: string;
  publishedAt: string | null;
  externalUrl: string | null;
  simulated: boolean;
  clicks: number;
  comments: number;
  score: number;
  metrics: PostMetricsDto | null;
}

export interface ChannelStatsDto {
  channel: string;
  posts: number;
  withMetrics: number;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number;
  clicks: number;
}

export interface AnalyticsOverviewDto {
  days: number;
  totals: { posts: number; reach: number; engagement: number; clicks: number; withMetrics: number; followers: number | null };
  channels: ChannelStatsDto[];
  perDay: { day: string; reach: number; clicks: number; posts: number }[];
  bestSlots: { dow: number; hour: number; posts: number; total: number; label: string; avg: number }[];
  lastFetchAt: string | null;
  warnings: ConnectionWarningDto[];
  connected: { linkedin: boolean; instagram: boolean };
}

export interface OauthTokenDto {
  provider: string;
  subject: string;
  externalId: string;
  expiresAt: string | null;
  scopes: string;
  updatedAt: string;
  refreshable: boolean;
  meta: Record<string, unknown> | null;
}

export interface ConnectionCheckDto {
  provider: string;
  subject: string;
  label: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
}

/** Image de la bibliothèque (studio, upload, détourage) */
export interface LibraryImageDto {
  id: string;
  width: number | null;
  height: number | null;
  mime: string;
  createdAt: string;
  source: 'studio' | 'upload' | 'cutout' | 'monochrome' | 'edit';
  prompt: string | null;
  cutout: boolean;
  monochrome: boolean;
  model: string | null;
  op: string | null;
}

/** Catalogue Freepik / Magnific : modèles de génération et outils d'édition */
export interface ImageModelsDto {
  available: boolean;
  provider: 'auto' | 'gemini' | 'freepik';
  defaultModel: string;
  models: { id: string; label: string; family: string; speed: string; note: string | null; recommended: boolean }[];
  edits: { id: string; label: string; needsPrompt: boolean; needsReference: boolean; hint: string }[];
  styles: { id: 'full' | 'objets' | 'chrome'; label: string; hint: string }[];
  defaultStyle: 'auto' | 'full' | 'objets' | 'chrome';
  /** image de référence par style (asset de la bibliothèque) */
  references: { full?: string | null; objets?: string | null; chrome?: string | null };
  notesByStyle: { full?: string; objets?: string; chrome?: string };
  cutoutStyles: string[];
  /** modèle par style (vide = modèle par défaut) */
  modelByStyle: { full?: string; objets?: string; chrome?: string };
  /** couleurs signature proposées */
  popPresets: { id: string; hex: string; label: string }[];
  /** PUBLIC_URL en https : requis pour passer une référence aux modèles Google */
  publicHttps: boolean;
}

/** Proposition de l'agent visuel (capture d'écran ou image générée) */
export interface VisualCandidateDto {
  id: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  origin: 'screenshot' | 'image';
  label: string;
  why?: string;
  url?: string;
  prompt?: string;
  slideIdx: number | null;
  model?: string;
  monochrome?: boolean;
  style?: 'full' | 'objets' | 'chrome';
  cutout?: boolean;
  popColor?: string | null;
  /** série d'objets cohérents */
  set?: string;
  setIdx?: number;
  batch: number;
}
