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

export const SLIDE_KINDS = [
  'hook',
  'content',
  'value_prop',
  'screenshot',
  'cta',
  'notifications',
  'echo',
] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/**
 * Bibliothèque d'archétypes de composition, dérivée de l'analyse des
 * références visuelles du client (codes de mise en page/effets adaptés à la
 * marque Odile). Le writer en choisit un par post, avec rotation imposée.
 */
export interface Archetype {
  id: string;
  label: string;
  description: string;
  needsImage: boolean;
  /** guide de composition injecté dans le prompt de génération d'image */
  imageComposition?: string;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'objet_halo',
    label: 'Objet 3D suspendu + halo',
    description:
      "Un objet métaphorique unique (pièce, sablier, clé, rouage, pince mécanique…) suspendu au centre, halo lumineux circulaire derrière, ambiance studio sombre. Le titre vient sous l'objet.",
    needsImage: true,
    imageComposition:
      'a single striking 3D object as the sole subject, suspended mid-air in the upper two-thirds of the frame, centered, giant glowing circular halo behind it, dark studio atmosphere, dramatic volumetric light, empty lower third for text',
  },
  {
    id: 'notifications',
    label: 'Pile de notifications',
    description:
      "Trois cartes de notification empilées (« Paiement reçu », « Devis signé », « RDV confirmé »…) avec un effet de profondeur et de glow — la preuve sociale du résultat concret. Slide kind « notifications ».",
    needsImage: false,
  },
  {
    id: 'geste_lumiere',
    label: 'Métaphore photo + tracé lumineux',
    description:
      "Photo réaliste d'une main/geste humain interagissant avec un élément lumineux dessiné (flèche de croissance, courbe, fil de lumière). Texte minimal dans un coin.",
    needsImage: true,
    imageComposition:
      'photorealistic human hand or gesture interacting with a glowing hand-drawn light trail (rising arrow, curve), light painting effect, monochromatic scene, subject in lower right two-thirds, generous negative space top-left for a headline',
  },
  {
    id: 'portrait_duotone',
    label: 'Portrait duotone dramatique',
    description:
      "Silhouette ou portrait en contre-jour, rayons de lumière traversants, rendu duotone (bleu électrique sur marine profond). Regard/attitude qui interpelle. Titre court en bas.",
    needsImage: true,
    imageComposition:
      'dramatic backlit human silhouette or portrait, visible light rays cutting through haze, strong rim light, deep shadows, duotone treatment, cinematic contrast, face partly in shadow, lower third left free for text',
  },
  {
    id: 'chiffre_3d',
    label: 'Gros chiffre 3D matière',
    description:
      "Le chiffre clé du post en énorme, rendu en matière 3D (verre, chrome, néon) qui domine la slide — ou en dégradé CSS via bigNumber si pas d'image.",
    needsImage: true,
    imageComposition:
      'one giant extruded 3D number or percentage as the hero subject, glossy glass and chrome material with neon glow edges, floating over a dark gradient backdrop, soft reflections on an invisible floor, space below for a caption',
  },
  {
    id: 'mockup_outil',
    label: 'Mockup appareil',
    description:
      "L'outil montré en situation dans un cadre navigateur/laptop incliné avec ombre portée et glow — utilise la slide « screenshot » avec capture réelle.",
    needsImage: false,
  },
  {
    id: 'scene_epique',
    label: 'Scène épique métaphorique',
    description:
      "Décor cinématique qui raconte l'enjeu : fusée au décollage, échiquier dramatique, sommet de montagne, phare dans la tempête, couronne… Un seul sujet fort.",
    needsImage: true,
    imageComposition:
      'epic cinematic scene with one strong metaphorical subject (rocket launch, chess king, mountain summit, lighthouse…), atmospheric depth, volumetric light beams, mist, high production value, subject occupying two-thirds, clear area for headline',
  },
  {
    id: 'typo_stickers',
    label: 'Typo mixte + stickers',
    description:
      "Composition 100 % typographique : titre sans-serif bold avec mots serif italiques accentués, badges pill, mots surlignés, tampon incliné, souligné manuscrit. Aucune image.",
    needsImage: false,
  },
  {
    id: 'echo_process',
    label: 'Texte répété + bandeau',
    description:
      "Un mot-clé répété en couches d'opacité décroissante en fond, barré d'un bandeau tampon incliné portant le message principal. Slide kind « echo ».",
    needsImage: false,
  },
];

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
  imageGen: {
    enabled: true,
    imagesPerPost: 1,
    styleNotes: '',
    quality: 'pro' as const,
  },
} as const;

export const BRAND_DEFAULTS = {
  name: 'Odile AI',
  handle: '@odileai',
  siteUrl: 'https://odileai.com',
  accentColor: '#0099FF',
  tagline: 'Automatisez ce qui vous ralentit. Concentrez-vous sur ce qui vous fait grandir.',
} as const;
