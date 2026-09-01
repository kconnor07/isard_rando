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

export interface SummaryDto {
  awaitingApproval: number;
  scheduled: number;
  published: number;
  clicks7d: number;
  pendingComments: number;
  cadence: { due: boolean; reason: string };
  nextSlots: { instagram: string; linkedin: string };
}
