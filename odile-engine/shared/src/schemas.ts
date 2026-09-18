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
  /**
   * Émojis dans les visuels : « aucun » les retire des slides et les laisse dans la
   * légende, où l'appareil du lecteur les dessine (émojis Apple sur iPhone).
   * « systeme » garde ceux de la police du serveur (Noto, style Google).
   */
  emojiStyle: z.enum(['aucun', 'systeme']).default('aucun'),
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
  /**
   * Publier chaque post sur tous les comptes connectés à la fois : chaque profil
   * LinkedIn de l'équipe, la page entreprise, Instagram — et la Page Facebook dans
   * la foulée. Un seul sujet, une seule validation, autant de publications que de
   * comptes. La rotation ne sert alors qu'à choisir le texte de départ.
   */
  broadcast: z.boolean().default(false),
  /**
   * Un post LinkedIn sur N part en document PDF — le carrousel natif du réseau,
   * feuilleté dans le fil. C'est le format qui retient le plus longtemps, donc celui
   * que l'algorithme pousse le plus. 0 = jamais.
   */
  docEveryNPosts: z.number().int().min(0).max(20).default(3),
});
export type CadenceSettings = z.infer<typeof cadenceSettingsSchema>;

export const dmTriggerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string().min(1).max(40)).max(20),
  /**
   * Message qui porte le lien. Placeholders disponibles partout : `{{link}}` (lien
   * court tracké), `{{ressource}}` (le titre de ce qui a été promis — « le guide
   * … »), `{{motcle}}` (le mot commenté), `{{rdv}}` (lien de rendez-vous).
   * Nommer la ressource change tout : un lien raccourci sans libellé se lit comme
   * du spam, « voici le guide « Automatiser vos devis » » se lit comme une réponse.
   */
  replyTemplate: z.string().min(1).max(900),
  /**
   * Ce vers quoi pointe le lien envoyé en privé. « article » = la source du post ;
   * « fixe » = une adresse à soi (page de contact, prise de rendez-vous…). Le
   * rédacteur en est informé : la promesse de la dernière slide doit correspondre
   * à ce que la personne reçoit, sans quoi le DM déçoit.
   */
  linkTarget: z.enum(['article', 'fixe']).default('article'),
  /** adresse visée quand linkTarget vaut « fixe » */
  fixedUrl: z.string().max(400).default(''),
  /** ce que cette adresse offre, en quelques mots — sert de promesse au rédacteur */
  fixedLabel: z.string().max(80).default(''),
  /**
   * Prise de rendez-vous : l'unique porte de sortie du tunnel. Elle apparaît à la
   * fin du guide PDF et dans le message de qualification — le moment où la personne
   * vient de recevoir ce qu'elle a demandé est celui où son intérêt est le plus fort.
   * Vide : le guide renvoie vers le site de la marque.
   */
  rdvUrl: z.string().max(400).default(''),
  /** libellé du bouton de rendez-vous, dans le guide et les messages */
  rdvLabel: z.string().max(80).default('Prendre 20 minutes'),
  /**
   * Exiger l'abonnement avant d'envoyer le lien. Meta ne prévient pas d'un nouvel
   * abonné et n'expose pas la liste des abonnés : l'état d'abonnement n'est lisible
   * que pour une personne qui a écrit au compte. Le parcours se fait donc en deux
   * temps : le premier message demande seulement de répondre (il ne réclame rien,
   * puisqu'on ignore encore si la personne suit), et c'est cette réponse qui rend
   * l'abonnement lisible — lien pour un abonné, demande d'abonnement sinon.
   */
  requireFollow: z.boolean().default(false),
  /** premier message : demande de s'abonner puis de répondre */
  askFollowTemplate: z.string().max(900).default(
    'Coucou ☀️ j’ai bien vu ton commentaire ! Réponds-moi juste un petit mot ici et je t’envoie tout de suite ce que je t’ai promis 💛',
  ),
  /** message envoyé une fois l'abonnement constaté, avec le lien */
  thanksTemplate: z.string().max(900).default(
    'Merci d’être là, ça compte beaucoup ☀️ Voici {{ressource}} : {{link}} — dis-moi ce que tu veux automatiser en premier, je te réponds 💛',
  ),
  /** relance quand la personne répond sans s'être abonnée */
  remindTemplate: z.string().max(900).default(
    'Il me manque juste ton abonnement pour t’envoyer le lien 💛 un petit clic, un mot ici, et il part dans la foulée ☀️',
  ),
  /**
   * Réponse publique sous le commentaire. Elle ne dépend que de
   * `instagram_manage_comments` : elle part même quand la messagerie de l'app
   * Meta n'est pas encore ouverte, et elle montre aux autres lecteurs qu'on répond.
   */
  publicReply: z.boolean().default(true),
  /**
   * Phrases postées sous le commentaire quand le message privé est parti. Elles
   * renvoient vers les DM et ne portent jamais le lien : tout se passe en privé.
   * Une phrase différente à chaque commentaire — un compte qui répond la même
   * chose vingt fois de suite a l'air d'un robot.
   */
  publicReplyVariants: z
    .array(z.string().min(1).max(300))
    .max(30)
    .default([
      'C’est parti dans tes messages privés 💌',
      'Je t’ai glissé ça en DM ✨',
      'Regarde tes messages, tout y est 👀',
      'Direction tes DM 📩',
      'Je viens de t’écrire en privé 🤍',
      'Un petit cadeau t’attend en DM 🎁',
      'File voir tes messages privés 🚀',
      'Réponse envoyée en privé, bonne lecture 💫',
    ]),
  /**
   * Phrases postées quand le message privé n'a pas pu partir. Elles invitent la
   * personne à écrire la première : promettre un DM qui n'arrivera pas serait pire
   * que se taire, et un message reçu ouvre la fenêtre de réponse côté Instagram.
   */
  publicReplyFallbackVariants: z
    .array(z.string().min(1).max(300))
    .max(30)
    .default([
      'Écris-moi en message privé, je t’envoie tout 💌',
      'Envoie-moi un petit DM et c’est à toi ✨',
      'Passe par mes messages privés, je t’attends 📩',
      'Un mot en privé et je te réponds tout de suite 🤍',
      'Glisse-moi un DM, j’ai tout préparé 🎁',
    ]),
  /**
   * LinkedIn n'ouvre sa messagerie à aucune app : pas de DM possible, ni pour nous
   * ni pour personne. Le lien de la ressource promise part donc SOUS le commentaire,
   * en réponse à la personne — seul canal automatisable — et un message privé prêt
   * à coller est proposé par email pour qui veut ajouter la touche personnelle.
   * `{{prenom}}` est remplacé par le prénom quand LinkedIn le donne, retiré sinon.
   */
  linkedinReplyVariants: z
    .array(z.string().min(1).max(400))
    .max(30)
    .default([
      'Merci {{prenom}}, voici {{ressource}} : {{link}}. Si vous voulez qu’on regarde votre cas, écrivez-moi.',
      'Avec plaisir {{prenom}} 🙂 {{ressource}} est ici : {{link}} — dites-moi ce que vous automatiseriez en premier.',
      'C’est envoyé {{prenom}} : {{ressource}} → {{link}}. Bonne lecture, et vos retours m’intéressent.',
      'Voilà {{prenom}} — {{ressource}} : {{link}}. Une question sur votre organisation ? Je réponds en message.',
      'Merci pour votre commentaire {{prenom}}. {{ressource}} : {{link}}',
      'Le voici {{prenom}} : {{ressource}} → {{link}}. Dites-moi si ça correspond à ce que vous cherchiez.',
      'Avec plaisir {{prenom}}, {{ressource}} vous attend ici : {{link}}',
    ]),
  /**
   * LinkedIn : ce que le mot-clé donne, maintenant que le lien de la ressource est
   * dans la description du post.
   *
   * « ressource » : le mot-clé renvoie la même chose que le lien — simple, mais la
   * personne qui a déjà cliqué n'a aucune raison de commenter.
   * « diagnostic » : le lien donne la ressource tout de suite, et le mot-clé ouvre
   * autre chose, de plus haut — un regard sur SON cas. Les deux chemins ne se
   * marchent plus dessus, et celui qui commente se signale comme prospect.
   */
  linkedinOffer: z.enum(['ressource', 'diagnostic']).default('diagnostic'),
  /** mots à commenter sur LinkedIn quand le mot-clé ouvre le diagnostic */
  diagnosticKeywords: z.array(z.string().min(3).max(14)).max(20).default(['DIAGNOSTIC', 'CAS', 'AUDIT']),
  /** ce que le diagnostic offre, en une ligne — sert de promesse au rédacteur et aux réponses */
  diagnosticPromise: z
    .string()
    .max(160)
    .default('un regard sur votre organisation et ce qui peut y être automatisé, en 20 minutes'),
  /**
   * Réponses postées sous le commentaire quand le mot-clé ouvre le diagnostic.
   * Elles ne redonnent JAMAIS le lien de la ressource (il est dans le post) : elles
   * rappellent où il se trouve et proposent le rendez-vous. `{{rdv}}` = le lien de
   * prise de rendez-vous des réglages.
   */
  diagnosticReplyVariants: z
    .array(z.string().min(1).max(400))
    .max(30)
    .default([
      'Merci {{prenom}} 🙂 {{ressource}} est en lien dans le post. Et si vous voulez qu’on regarde votre cas : {{rdv}}',
      'Avec plaisir {{prenom}}. Le lien est dans la description. Pour un regard sur votre organisation, 20 minutes ici : {{rdv}}',
      'Bonne lecture {{prenom}} — le lien est juste au-dessus. Si vous voulez qu’on cherche ensemble ce qui peut être automatisé chez vous : {{rdv}}',
      'Merci pour votre commentaire {{prenom}}. {{ressource}} vous attend en description ; pour votre cas précis, c’est ici : {{rdv}}',
      'C’est noté {{prenom}} 🙂 Le lien est dans le post, et votre cas mérite mieux qu’un lien : {{rdv}}',
    ]),
  /**
   * Message de qualification, envoyé UNE fois quand la personne répond après avoir
   * reçu son lien. C'est le seul moment où Meta rouvre une fenêtre de 24 h, et le
   * seul endroit du parcours où l'on apprend à qui on parle.
   */
  qualifyTemplate: z.string().max(900).default(
    'Avec plaisir ☀️ Pour te dire si ça s’applique chez toi : tu es plutôt artisan/commerce, cabinet, ou PME de services ? Si tu veux qu’on regarde ton cas de près, c’est ici : {{rdv}}',
  ),
});
export type DmTriggerSettings = z.infer<typeof dmTriggerSettingsSchema>;

/** Plafond quotidien de consommation des modèles de langage. */
export const llmBudgetSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** budget du jour, en euros (0 = illimité) */
  dailyEuros: z.number().min(0).max(500).default(2),
});
export type LlmBudgetSettings = z.infer<typeof llmBudgetSettingsSchema>;

/**
 * Vidéos avatar (HeyGen).
 *
 * Le moteur écrit le script, HeyGen le fait dire à l'avatar de la marque, et le
 * MP4 part en Reel Instagram, en vidéo native LinkedIn et sur la Page Facebook.
 * L'avatar et la voix se choisissent dans le dashboard : la liste vient du compte
 * HeyGen connecté, jamais d'identifiants écrits en dur.
 */
export const videoSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** un post sur N part en vidéo (0 = jamais automatiquement, la vidéo reste manuelle) */
  everyNPosts: z.number().int().min(0).max(20).default(3),
  /** avatar du compte HeyGen : « avatar » (studio, instantané) ou « talking_photo » (photo animée) */
  avatarType: z.enum(['avatar', 'talking_photo']).default('avatar'),
  avatarId: z.string().max(120).default(''),
  /** cadrage HeyGen : normal, circle, closeUp… */
  avatarStyle: z.string().max(40).default('normal'),
  voiceId: z.string().max(120).default(''),
  voiceSpeed: z.number().min(0.5).max(1.5).default(1),
  /** fond de la vidéo : couleur (par défaut celle du template) ou image de la bibliothèque */
  backgroundType: z.enum(['couleur', 'image']).default('couleur'),
  /** couleur hexadécimale, ou identifiant d'asset quand le fond est une image */
  backgroundValue: z.string().max(120).default(''),
  /** sous-titres incrustés par HeyGen — indispensables : la majorité regarde sans le son */
  captions: z.boolean().default(true),
  /** longueur visée du script parlé, en secondes (≈ 15 caractères par seconde en français) */
  targetSeconds: z.number().int().min(15).max(90).default(45),
  /** mode test HeyGen : vidéo filigranée, sans consommer de crédit */
  testMode: z.boolean().default(false),
});
export type VideoSettings = z.infer<typeof videoSettingsSchema>;

/** Recopie automatique de chaque publication Instagram sur la Page Facebook liée. */
export const fbMirrorSettingsSchema = z.object({
  enabled: z.boolean().default(false),
});
export type FbMirrorSettings = z.infer<typeof fbMirrorSettingsSchema>;

/**
 * Amplification : ce qui se passe SOUS un post LinkedIn une fois publié.
 *
 * Deux gestes, que toutes les équipes qui percent sur LinkedIn font à la main :
 * — le commentaire d'amorce, posté par le compte auteur juste après la publication.
 *   Il porte le lien de la source (interdit dans le post lui-même, où il fait chuter
 *   la portée) et rappelle le mot-clé à commenter ;
 * — les commentaires des autres comptes de l'équipe, une demi-heure plus tard. Un
 *   commentaire précoce compte bien plus qu'un like dans le classement LinkedIn, et
 *   ouvre le post aux réseaux des collègues.
 */
export const amplificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** commentaire d'amorce du compte auteur : source + rappel du mot-clé */
  firstComment: z.boolean().default(true),
  /** délai avant l'amorce, en minutes — assez court pour être le premier commentaire */
  firstCommentDelayMinutes: z.number().int().min(1).max(120).default(4),
  /** les autres comptes connectés commentent le post */
  crossComment: z.boolean().default(true),
  /** délai avant le premier commentaire d'un collègue, en minutes */
  delayMinutes: z.number().int().min(5).max(360).default(25),
  /** écart entre deux collègues, en minutes : ils n'arrivent pas tous à la même seconde */
  spacingMinutes: z.number().int().min(5).max(180).default(20),
  /** nombre maximum de comptes qui commentent un même post */
  maxAccounts: z.number().int().min(1).max(5).default(2),
});
export type AmplificationSettings = z.infer<typeof amplificationSettingsSchema>;

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
  // Les posts d'avant la suppression de la slide « écho » gardent kind: 'echo'
  // en base : on les relit en value_prop plutôt que de les rendre illisibles.
  kind: z.preprocess((v) => (v === 'echo' ? 'value_prop' : v), z.enum(SLIDE_KINDS)),
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
});
export type SlideContent = z.infer<typeof slideContentSchema>;

/** Ce que le post promet en message privé, et que le moteur doit livrer. */
export const ressourcePromiseSchema = z.object({
  kind: z.enum(['article', 'guide', 'outil']),
  /** titre de la ressource, tel qu'annoncé dans le post */
  title: z.string().max(120),
  /** adresse officielle de l'outil (kind « outil » uniquement) */
  toolUrl: z.string().max(400).nullable().optional(),
});
export type RessourcePromise = z.infer<typeof ressourcePromiseSchema>;

/** Guide livré en PDF : structure imposée au rédacteur. */
export const guideSchema = z.object({
  title: z.string().max(120),
  subtitle: z.string().max(200),
  intro: z.string().max(900),
  sections: z
    .array(
      z.object({
        title: z.string().max(120),
        body: z.string().max(1400),
        steps: z.array(z.string().max(240)).max(6).default([]),
      }),
    )
    .min(3)
    .max(7),
  checklist: z.array(z.string().max(160)).min(3).max(8),
  closing: z.string().max(500),
});
export type Guide = z.infer<typeof guideSchema>;

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
  /**
   * La ressource promise par le CTA, que le moteur devra livrer vraiment :
   * « guide » = un PDF qu'il fabrique, « outil » = l'adresse officielle de l'outil
   * dont parle le post, « article » = la source elle-même.
   */
  resource: ressourcePromiseSchema.optional(),
  /**
   * Texte que l'avatar prononce, quand le post est une vidéo. L'accroche tient dans
   * la première phrase : sur un Reel, les deux premières secondes décident de tout.
   */
  videoScript: z.string().max(1400).optional(),
  /**
   * Entreprises ou personnes de notoriété nommées dans le texte, quand l'actualité
   * s'y prête — jamais obligatoire. Les entreprises portent leur `vanityName`
   * LinkedIn (la fin de l'URL de leur page) : c'est ce qui permet de les identifier
   * pour de vrai. Les personnes restent nommées en clair : LinkedIn n'offre aucune
   * recherche de profil aux applications.
   */
  mentions: z
    .array(
      z.object({
        nom: z.string().min(2).max(80),
        type: z.enum(['entreprise', 'personne']).default('entreprise'),
        vanityName: z.string().max(100).optional(),
      }),
    )
    .max(4)
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
  /** texte prononcé par l'avatar : corrigeable avant de relancer la vidéo */
  videoScript: z.string().max(1400).nullable().optional(),
  /** mot à commenter : un seul mot, sans quoi le détecteur ne reconnaîtra rien */
  commentTriggerKeyword: z
    .string()
    .trim()
    .regex(/^[A-Za-zÀ-ÿ]{3,14}$/, 'un seul mot de 3 à 14 lettres, sans chiffre ni ponctuation')
    .nullable()
    .optional(),
  caption: z.string().max(2900).optional(),
  hook: z.string().max(220).optional(),
  cta: z.string().max(280).optional(),
  hashtags: z.array(z.string()).max(12).optional(),
  channel: z.enum(CHANNELS).optional(),
  /** compte LinkedIn qui publie (clé de connexion) ; null = premier de la rotation */
  liAccountKey: z.string().max(80).nullable().optional(),
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

/** Clés des apps LinkedIn / Meta (et l'accès Framer) saisies depuis le dashboard — un secret vide conserve l'existant */
export const oauthAppsSchema = z.object({
  /** Clé d'API HeyGen (vidéos avatar) : réglages HeyGen → API */
  heygenApiKey: z.string().trim().max(400).optional(),
  /** Adresse du projet Framer (https://framer.com/projects/…) — l'API serveur s'y connecte */
  framerProjectUrl: z.string().trim().max(300).default(''),
  /** Clé d'API Framer : réglages du site → Général → API keys */
  framerApiKey: z.string().trim().max(400).optional(),
  linkedinClientId: z.string().trim().max(200).default(''),
  linkedinClientSecret: z.string().trim().max(400).optional(),
  metaAppId: z.string().trim().max(200).default(''),
  metaAppSecret: z.string().trim().max(400).optional(),
  metaVerifyToken: z.string().trim().max(200).default(''),
  /** Facebook Login for Business : la configuration porte permissions et actifs (Page + compte Instagram) */
  metaConfigId: z.string().trim().max(200).default(''),
});
export type OauthAppsInput = z.infer<typeof oauthAppsSchema>;

/** Programmation à une date précise (ISO 8601 avec fuseau) */
export const schedulePostSchema = z.object({ at: z.string().datetime({ offset: true }) });

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
  /** publié en mode simulation : rien n'est parti sur les réseaux */
  simulated?: boolean;
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


// ---------------------------------------------------------------------------
// Blog du site (Framer) — articles SEO/GEO
// ---------------------------------------------------------------------------

/** Correspondance entre ce que le moteur produit et les champs de la collection Framer (ids de champs). */
export const blogFieldMapSchema = z.object({
  title: z.string().default(''),
  body: z.string().default(''),
  excerpt: z.string().default(''),
  cover: z.string().default(''),
  date: z.string().default(''),
  metaTitle: z.string().default(''),
  metaDescription: z.string().default(''),
  keywords: z.string().default(''),
  /** champ texte où déposer le JSON-LD (à injecter côté site par un composant) */
  jsonLd: z.string().default(''),
  author: z.string().default(''),
});

export const blogSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** un article tous les N jours */
  everyDays: z.number().int().min(1).max(60).default(7),
  /** ancrage local : la ville et ses zones, tissées dans chaque article */
  ville: z.string().max(60).default('Toulouse'),
  zones: z.array(z.string().max(60)).max(20).default(['Toulouse', 'Blagnac', 'Colomiers', 'Labège', 'Haute-Garonne', 'Occitanie']),
  /** cibles : qui doit se reconnaître dans l'article */
  cibles: z.array(z.string().max(80)).max(20).default(['artisans et TPE', 'commerces', 'cabinets (comptables, avocats, santé)', 'PME industrielles', 'sociétés de services']),
  authorName: z.string().max(80).default('Alexis Duquenoy'),
  /** pages du site vers lesquelles tisser des liens internes */
  sitePages: z.array(z.object({ label: z.string().max(80), path: z.string().max(200) })).max(20).default([]),
  /** collection Framer visée et correspondance des champs */
  collectionId: z.string().max(100).default(''),
  fields: blogFieldMapSchema.prefault({}),
  /** déposer l'article en brouillon dans Framer (à publier depuis Framer) plutôt que publié et déployé */
  publishAsDraft: z.boolean().default(false),
  /**
   * Proportions de l'image de couverture, à accorder à ce que le site affiche.
   * 16:9 convient à la plupart des gabarits Framer ; 1.91:1 est le format des
   * aperçus de partage ; 1:1 ne se fait jamais rogner nulle part.
   */
  coverRatio: z.enum(['16:9', '1.91:1', '3:2', '4:3', '1:1']).default('16:9'),
  /**
   * Ce que porte la couverture. « aucun » quand le site affiche déjà le titre
   * en toutes lettres à côté de l'image : deux fois le même titre, c'est une fois
   * de trop, et plus rien ne peut être coupé.
   */
  coverText: z.enum(['titre', 'mention', 'aucun']).default('titre'),
  /**
   * Zone sûre : tout ce qui est écrit reste dans un carré centré. Un site
   * responsive recadre l'image selon la largeur de l'écran — sans cette marge,
   * un titre qui occupe toute la largeur se retrouve amputé sur mobile.
   */
  coverSafeZone: z.boolean().default(true),
});
export type BlogSettings = z.infer<typeof blogSettingsSchema>;

/** Article rédigé par le modèle : structure pensée pour le référencement naturel ET les moteurs génératifs. */
export const articleSchema = z.object({
  title: z.string().min(10).max(90),
  slug: z.string().min(3).max(90).regex(/^[a-z0-9-]+$/),
  metaTitle: z.string().min(10).max(65),
  metaDescription: z.string().min(50).max(160),
  excerpt: z.string().min(40).max(320),
  /** titre court de l'image de couverture (≤ 8 mots) et son mot fort */
  coverTitle: z.string().min(4).max(70),
  coverAccentWord: z.string().max(30).default(''),
  /** la réponse directe, en tête d'article : ce que les moteurs génératifs citent */
  keyTakeaways: z.array(z.string().min(10).max(220)).min(3).max(6),
  sections: z
    .array(
      z.object({
        h2: z.string().min(4).max(120),
        paragraphs: z.array(z.string().min(20).max(1400)).min(1).max(6),
        bullets: z.array(z.string().min(3).max(240)).max(8).default([]),
        h3s: z
          .array(z.object({ h3: z.string().min(3).max(120), paragraphs: z.array(z.string().min(20).max(1200)).min(1).max(4) }))
          .max(5)
          .default([]),
      }),
    )
    .min(3)
    .max(9),
  faq: z.array(z.object({ question: z.string().min(8).max(200), answer: z.string().min(30).max(700) })).min(3).max(7),
  sources: z.array(z.object({ title: z.string().min(3).max(160), url: z.string().url() })).max(8).default([]),
  keywords: z.array(z.string().min(2).max(60)).min(3).max(10),
  /** comment l'ancrage local est tissé (pour relecture) */
  localAngle: z.string().max(400).default(''),
  internalLinks: z.array(z.object({ label: z.string().max(80), path: z.string().max(200) })).max(5).default([]),
});
export type Article = z.infer<typeof articleSchema>;
