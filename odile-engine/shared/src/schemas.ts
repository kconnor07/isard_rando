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
  /** photo / avatar de la chip auteur (asset de la bibliothèque) — sinon le logo */
  avatarAssetId: z.string().nullable().default(null),
  /** ligne sous le nom dans la chip auteur (« IA · Automatisation · PME ») — sinon le handle */
  authorLine: z.string().max(60).default(''),
  /** pied de marque par défaut : logo seul, carré aux initiales + nom + handle, ou logo réduit + nom + handle */
  footerStyle: z.enum(['logo', 'initiales', 'logo-nom']).default('initiales'),
  /** initiales du carré de marque (sinon déduites du nom : « Odile AI » → OA) */
  initials: z.string().max(3).default(''),
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

export const imageGenSettingsSchema = z.object({
  enabled: z.boolean(),
  /** poser automatiquement l'illustration de l'accroche (sinon elle est seulement proposée par l'agent visuel) */
  autoPlace: z.boolean().default(false),
  /** nombre max d'illustrations générées par post */
  imagesPerPost: z.number().int().min(0).max(2),
  /** notes de style libres ajoutées au prompt (ex: « plus minimaliste ») */
  styleNotes: z.string().max(500).default(''),
  /** pro = Nano Banana Pro (qualité max), fast = variante rapide/économique */
  quality: z.enum(['pro', 'fast']),
  /** toutes les images (illustrations, studio, bibliothèque) en noir et blanc */
  monochrome: z.boolean().default(false),
  /** style d'illustration : auto = selon l'archétype / la slide, sinon imposé */
  style: z.enum(['auto', 'full', 'objets', 'chrome']).default('auto'),
  /** image de référence (asset de la bibliothèque) par style : guide le rendu, pas le sujet */
  references: z
    .object({
      full: z.string().max(30).nullable().optional(),
      objets: z.string().max(30).nullable().optional(),
      chrome: z.string().max(30).nullable().optional(),
    })
    .default({}),
  /** consignes libres ajoutées au prompt, par style */
  notesByStyle: z
    .object({
      full: z.string().max(400).optional(),
      objets: z.string().max(400).optional(),
      chrome: z.string().max(400).optional(),
    })
    .default({}),
  /** fournisseur : auto = Freepik/Magnific si clé présente, sinon Gemini direct */
  provider: z.enum(['auto', 'gemini', 'freepik']).default('auto'),
  /** modèle Freepik/Magnific par défaut (catalogue `/api/images/models`) */
  model: z.string().max(60).default('nano-banana-pro-flash'),
  /** modèle par style d'image (vide = modèle par défaut) */
  modelByStyle: z
    .object({
      full: z.string().max(60).optional(),
      objets: z.string().max(60).optional(),
      chrome: z.string().max(60).optional(),
    })
    .default({}),
});
export type ImageGenSettings = z.infer<typeof imageGenSettingsSchema>;

/** Agent visuel : captures d'écran + images proposées pour chaque post */
export const visualAgentSettingsSchema = z.object({
  enabled: z.boolean(),
  /** lancé automatiquement dans le pipeline de chaque veille */
  autoRun: z.boolean(),
  /** captures d'écran proposées par passe */
  screenshots: z.number().int().min(0).max(5),
  /** images générées par passe */
  images: z.number().int().min(0).max(6),
});
export type VisualAgentSettings = z.infer<typeof visualAgentSettingsSchema>;

export const generateImageSchema = z.object({
  instructions: z.string().max(500).optional(),
  quality: z.enum(['pro', 'fast']).optional(),
});

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
  /** icône (catalogue ICONS) affichée dans un badge rond au-dessus du titre */
  icon: z.string().max(24).optional(),
  title: z.string().max(120),
  /** sous-titre sous le titre, sur deux tons (« le tueur silencieux des | conversions ») */
  subtitle: z.string().max(90).optional(),
  /** mot du titre à mettre en accent serif italique / couleur */
  accentWord: z.string().max(40).optional(),
  body: z.string().max(500).optional(),
  bigNumber: z.string().max(12).optional(),
  bullets: z.array(z.string().max(140)).max(5).optional(),
  toolName: z.string().max(60).optional(),
  toolUrl: z.string().url().optional(),
  ctaLabel: z.string().max(80).optional(),
  footer: z.string().max(120).optional(),
  /** concept d'illustration IA (archétypes A1/A3/A4/A5/A7) — FR, une scène précise */
  imageIdea: z.string().max(300).optional(),
  /** kind "notifications" : les cartes empilées */
  notifications: z
    .array(z.object({ title: z.string().max(60), body: z.string().max(120) }))
    .max(3)
    .optional(),
  /** kind "echo" : le mot répété en fond (le title sert de bandeau) */
  echoWord: z.string().max(24).optional(),
});
export type SlideContent = z.infer<typeof slideContentSchema>;

export const generatedPostSchema = z.object({
  /** archétype de composition choisi (id du registre ARCHETYPES) */
  archetype: z.string().max(40).optional(),
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

/** Thème intégré, ou template maison (« custom:<slug> ») créé depuis le dashboard */
export const themeIdSchema = z.union([
  z.enum(THEMES),
  z.string().regex(/^custom:[a-z0-9][a-z0-9-]{0,40}$/),
]);

export const patchPostSchema = z.object({
  caption: z.string().max(2900).optional(),
  hook: z.string().max(220).optional(),
  cta: z.string().max(280).optional(),
  hashtags: z.array(z.string()).max(12).optional(),
  channel: z.enum(CHANNELS).optional(),
  format: z.enum(POST_FORMATS).optional(),
  theme: themeIdSchema.optional(),
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
  theme: themeIdSchema.optional(),
});

export type PostSummary = {
  id: number;
  platform: string;
  channel: (typeof CHANNELS)[number];
  format: (typeof POST_FORMATS)[number];
  theme: string;
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
