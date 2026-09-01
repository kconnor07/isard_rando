import { z } from 'zod';
import {
  CHANNELS,
  DM_STATUSES,
  POST_FORMATS,
  POST_STATUSES,
  REVIEWERS,
  SLIDE_KINDS,
  THEMES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Réglages (table settings, une clé JSON par bloc)
// ---------------------------------------------------------------------------

export const toneSettingsSchema = z.object({
  preset: z.enum(['expert_accessible', 'ami_entrepreneur', 'provocateur_bienveillant', 'custom']),
  /** 0 = très expert/pointu, 100 = très amical/décontracté */
  registre: z.number().min(0).max(100),
  /** 0 = aucun emoji, 3 = généreux */
  emojiLevel: z.number().int().min(0).max(3),
  ctaStyle: z.enum(['question', 'direct', 'curiosite']),
  customInstructions: z.string().max(2000).optional().default(''),
});
export type ToneSettings = z.infer<typeof toneSettingsSchema>;

export const brandSettingsSchema = z.object({
  name: z.string().min(1).max(80),
  handle: z.string().max(80),
  siteUrl: z.string().url(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tagline: z.string().max(200),
  logoAssetId: z.string().nullable().default(null),
});
export type BrandSettings = z.infer<typeof brandSettingsSchema>;

export const slotSchema = z.object({
  /** 0 = dimanche … 6 = samedi (convention JS Date.getDay) */
  dow: z.number().int().min(0).max(6),
  /** HH:MM heure de Paris */
  time: z.string().regex(/^\d{2}:\d{2}$/),
});
export const publishSlotsSchema = z.object({
  ig: z.array(slotSchema),
  li: z.array(slotSchema),
});
export type PublishSlots = z.infer<typeof publishSlotsSchema>;

export const cadenceSettingsSchema = z.object({
  /** au moins un post tous les N jours */
  days: z.number().int().min(1).max(14),
  /** rotation des canaux pour les brouillons automatiques */
  rotation: z.array(z.enum(CHANNELS)).min(1),
});
export type CadenceSettings = z.infer<typeof cadenceSettingsSchema>;

export const dmTriggerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string().min(1).max(40)).max(20),
  replyTemplate: z.string().min(1).max(900),
});
export type DmTriggerSettings = z.infer<typeof dmTriggerSettingsSchema>;

export const approvalEmailSettingsSchema = z.object({
  to: z.string().email(),
  subjectPrefix: z.string().max(40).default('[Odile]'),
  /** relances max si pas de réponse */
  maxReminders: z.number().int().min(0).max(5).default(2),
});
export type ApprovalEmailSettings = z.infer<typeof approvalEmailSettingsSchema>;

export const designStudioSettingsSchema = z.object({
  enabled: z.boolean(),
  maxIterations: z.number().int().min(1).max(5),
  /** score minimal (0-100) exigé de chaque reviewer */
  passThreshold: z.number().int().min(0).max(100),
});
export type DesignStudioSettings = z.infer<typeof designStudioSettingsSchema>;

export const llmRoutingSchema = z.object({
  copywriting: z.enum(['anthropic', 'gemini', 'mock']),
  scoring: z.enum(['anthropic', 'gemini', 'mock']),
  vision: z.enum(['anthropic', 'gemini', 'mock']),
  visionFinal: z.enum(['anthropic', 'gemini', 'mock']),
});
export type LlmRouting = z.infer<typeof llmRoutingSchema>;

// ---------------------------------------------------------------------------
// Contenus générés
// ---------------------------------------------------------------------------

export const slideContentSchema = z.object({
  kind: z.enum(SLIDE_KINDS),
  /** petit texte au-dessus du titre (annotation manuscrite / badge) */
  annotation: z.string().max(80).optional(),
  badge: z.string().max(40).optional(),
  title: z.string().max(120),
  /** mot du titre à mettre en accent serif italique / couleur */
  accentWord: z.string().max(40).optional(),
  body: z.string().max(500).optional(),
  bigNumber: z.string().max(12).optional(),
  bullets: z.array(z.string().max(140)).max(5).optional(),
  toolName: z.string().max(60).optional(),
  toolUrl: z.string().url().optional(),
  ctaLabel: z.string().max(80).optional(),
  footer: z.string().max(120).optional(),
});
export type SlideContent = z.infer<typeof slideContentSchema>;

export const generatedPostSchema = z.object({
  hook: z.string().max(220),
  caption: z.string().max(2900),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]+$/u)).max(12),
  cta: z.string().max(280),
  slides: z.array(slideContentSchema).min(1).max(10),
  /** URL de l'outil/source à capturer pour la slide screenshot, si pertinent */
  screenshotUrl: z.string().url().nullable(),
  commentTrigger: z
    .object({ enabled: z.boolean(), keyword: z.string().max(40) })
    .optional(),
});
export type GeneratedPost = z.infer<typeof generatedPostSchema>;

export const reviewIssueSchema = z.object({
  severity: z.enum(['minor', 'major', 'blocking']),
  slideIdx: z.number().int().min(0).nullable(),
  /** champ visé : title, body, template.param, palette… */
  target: z.string().max(80),
  problem: z.string().max(300),
  fix: z.string().max(300),
});
export const reviewResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string().max(300),
  issues: z.array(reviewIssueSchema).max(10),
});
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const newsScoreSchema = z.object({
  id: z.number().int(),
  relevance: z.number().min(0).max(50),
  click: z.number().min(0).max(50),
  reason: z.string().max(300),
});
export const newsScoreBatchSchema = z.object({ scores: z.array(newsScoreSchema) });

// ---------------------------------------------------------------------------
// Payloads API dashboard
// ---------------------------------------------------------------------------

export const loginSchema = z.object({ password: z.string().min(1) });

export const patchPostSchema = z.object({
  caption: z.string().max(2900).optional(),
  hook: z.string().max(220).optional(),
  cta: z.string().max(280).optional(),
  hashtags: z.array(z.string()).max(12).optional(),
  channel: z.enum(CHANNELS).optional(),
  format: z.enum(POST_FORMATS).optional(),
  theme: z.enum(THEMES).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const putSlideSchema = z.object({ content: slideContentSchema });

export const regenerateSchema = z.object({
  scope: z.enum(['all', 'caption', 'slide']),
  slideIdx: z.number().int().min(0).optional(),
  instructions: z.string().max(500).optional(),
});

export const rejectSchema = z.object({ reason: z.string().max(500).optional() });

export const generateFromNewsSchema = z.object({
  channel: z.enum(CHANNELS).optional(),
  format: z.enum(POST_FORMATS).optional(),
  theme: z.enum(THEMES).optional(),
});

export type PostSummary = {
  id: number;
  platform: string;
  channel: (typeof CHANNELS)[number];
  format: (typeof POST_FORMATS)[number];
  theme: (typeof THEMES)[number];
  status: (typeof POST_STATUSES)[number];
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  createdAt: string;
  newsTitle?: string | null;
  newsUrl?: string | null;
  slideCount?: number;
};

export type ReviewRow = {
  id: number;
  iteration: number;
  reviewer: (typeof REVIEWERS)[number];
  score: number;
  verdict: string;
  issues: ReviewIssue[];
  passed: boolean;
  modelUsed: string;
  createdAt: string;
};

export type CommentRow = {
  id: number;
  platform: string;
  authorName: string;
  text: string;
  matchedKeyword: string | null;
  dmStatus: (typeof DM_STATUSES)[number];
  suggestedReply: string | null;
  externalPostUrl: string | null;
  createdTime: string;
};
