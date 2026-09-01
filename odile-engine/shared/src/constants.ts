export const PLATFORMS = ['linkedin', 'instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CHANNELS = ['li_personal', 'li_org', 'ig'] as const;
export type Channel = (typeof CHANNELS)[number];

export const POST_FORMATS = ['carousel', 'static', 'li_image'] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export const POST_STATUSES = [
  'draft',
  'reviewing',
  'awaiting_approval',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'rejected',
  'failed',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const SLIDE_KINDS = ['hook', 'content', 'value_prop', 'screenshot', 'cta'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export const THEMES = ['odile-nuit', 'violet-glow', 'cyan-tech'] as const;
export type ThemeId = (typeof THEMES)[number];

export const REVIEWERS = ['art_director', 'colorimetry', 'copy', 'engagement'] as const;
export type ReviewerId = (typeof REVIEWERS)[number];

export const NEWS_STATUSES = ['new', 'scored', 'shortlisted', 'used', 'discarded'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

export const DM_STATUSES = ['none', 'pending', 'sent', 'failed', 'manual_suggested', 'handled'] as const;
export type DmStatus = (typeof DM_STATUSES)[number];

export const JOB_STATES = ['pending', 'running', 'done', 'failed', 'canceled'] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Dimensions des visuels par format (px). */
export const RENDER_SIZES: Record<PostFormat, { width: number; height: number }> = {
  carousel: { width: 1080, height: 1350 },
  static: { width: 1080, height: 1350 },
  li_image: { width: 1080, height: 1350 },
};

/**
 * Valeurs par défaut issues de l'étude docs/instagram-algorithme-2026.md :
 * les carrousels gardent le meilleur taux d'engagement (~0,55 %), sont ~23 %
 * plus souvent recommandés et retiennent 15-30 s d'attention contre 1-2 s
 * pour un post statique. Format par défaut : carrousel de 6 à 8 slides.
 */
export const DEFAULTS = {
  theme: 'odile-nuit' as ThemeId,
  format: 'carousel' as PostFormat,
  carouselSlides: { min: 5, max: 8 },
  cadenceDays: 2,
  publishSlots: {
    ig: [
      { dow: 2, time: '11:30' },
      { dow: 4, time: '18:30' },
      { dow: 6, time: '11:00' },
    ],
    li: [
      { dow: 2, time: '08:30' },
      { dow: 3, time: '08:30' },
      { dow: 4, time: '08:30' },
    ],
  },
  tone: {
    preset: 'expert_accessible',
    registre: 55,
    emojiLevel: 1,
    ctaStyle: 'question' as const,
  },
  dmTriggers: {
    keywords: ['OUTIL', 'GUIDE', 'INFO'],
    replyTemplate:
      'Merci pour ton commentaire ! 🙌 Voici le lien promis : {{link}} — dis-moi ce que tu en penses.',
  },
  designStudio: {
    enabled: true,
    maxIterations: 3,
    passThreshold: 75,
  },
} as const;

export const BRAND_DEFAULTS = {
  name: 'Odile AI',
  handle: '@odileai',
  siteUrl: 'https://odileai.com',
  accentColor: '#0099FF',
  tagline: 'Automatisez ce qui vous ralentit. Concentrez-vous sur ce qui vous fait grandir.',
} as const;
