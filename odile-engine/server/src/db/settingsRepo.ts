import { eq, desc} from 'drizzle-orm';
import { z } from 'zod';
import {
  approvalEmailSettingsSchema,
  brandSettingsSchema,
  BRAND_DEFAULTS,
  cadenceSettingsSchema,
  DEFAULTS,
  designStudioSettingsSchema,
  dmTriggerSettingsSchema,
  imageGenSettingsSchema,
  llmRoutingSchema,
  publishSlotsSchema,
  toneSettingsSchema,
  visualAgentSettingsSchema,
  fbMirrorSettingsSchema,
  blogSettingsSchema,
  videoSettingsSchema,
  llmBudgetSettingsSchema,
} from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from './client.js';

export function getSettingRaw(key: string): unknown {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

export function getSetting<T>(key: string, schemaZ: z.ZodType<T>, fallback: T): T {
  const raw = getSettingRaw(key);
  if (raw === undefined) return fallback;
  const parsed = schemaZ.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export function setSetting(key: string, value: unknown): void {
  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({ key, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: JSON.stringify(value), updatedAt: now },
    })
    .run();
}

// ---------------------------------------------------------------------------
// Accès typés aux blocs de réglages, avec valeurs par défaut
// ---------------------------------------------------------------------------

export const getTone = () => getSetting('tone', toneSettingsSchema, { ...DEFAULTS.tone, customInstructions: '' });
export const getBrand = () =>
  getSetting('brand', brandSettingsSchema, { ...BRAND_DEFAULTS, logoAssetId: null, avatarAssetId: null, authorLine: '' });
export const getCadence = () =>
  getSetting('cadence', cadenceSettingsSchema, {
    days: DEFAULTS.cadenceDays,
    rotation: ['ig', 'li_personal'],
    broadcast: false,
  });
export const getPublishSlots = () =>
  getSetting('publish_slots', publishSlotsSchema, {
    ig: [...DEFAULTS.publishSlots.ig],
    li: [...DEFAULTS.publishSlots.li],
  });
export const getDmTriggers = () =>
  getSetting('dm_triggers', dmTriggerSettingsSchema, {
    enabled: true,
    keywords: [...DEFAULTS.dmTriggers.keywords],
    replyTemplate: DEFAULTS.dmTriggers.replyTemplate,
    // La porte d'abonnement est fermée par défaut : elle ajoute un aller-retour,
    // c'est un choix éditorial et non un réglage technique.
    requireFollow: false,
    askFollowTemplate: dmTriggerSettingsSchema.shape.askFollowTemplate.parse(undefined),
    thanksTemplate: dmTriggerSettingsSchema.shape.thanksTemplate.parse(undefined),
    remindTemplate: dmTriggerSettingsSchema.shape.remindTemplate.parse(undefined),
    publicReply: true,
    publicReplyVariants: dmTriggerSettingsSchema.shape.publicReplyVariants.parse(undefined),
    publicReplyFallbackVariants: dmTriggerSettingsSchema.shape.publicReplyFallbackVariants.parse(undefined),
    linkedinReplyVariants: dmTriggerSettingsSchema.shape.linkedinReplyVariants.parse(undefined),
    linkTarget: 'article',
    fixedUrl: '',
    fixedLabel: '',
  });
/** Plafond quotidien de consommation IA (2 € par jour par défaut). */
export const getLlmBudget = () => getSetting('llm_budget', llmBudgetSettingsSchema, { enabled: true, dailyEuros: 2 });
/** Vidéos avatar HeyGen : désactivées tant que l'avatar et la voix ne sont pas choisis. */
export const getVideo = () => getSetting('video', videoSettingsSchema, videoSettingsSchema.parse({}));
/** Blog du site Framer : désactivé tant que la collection n'est pas choisie. */
export const getBlog = () => getSetting('blog', blogSettingsSchema, blogSettingsSchema.parse({}));
/** Recopie des publications Instagram sur la Page Facebook (désactivée par défaut). */
export const getFbMirror = () => getSetting('fb_mirror', fbMirrorSettingsSchema, { enabled: false });
export const getApprovalEmail = () =>
  getSetting('approval_email', approvalEmailSettingsSchema, {
    to: config.APPROVAL_EMAIL_TO ?? 'admin@localhost.local',
    subjectPrefix: '[Odile]',
    maxReminders: 2,
  });
export const getVisualAgent = () =>
  getSetting('visual_agent', visualAgentSettingsSchema, { ...DEFAULTS.visualAgent });
export const getDesignStudio = () =>
  getSetting('design_studio', designStudioSettingsSchema, { ...DEFAULTS.designStudio });
export const getImageGen = () =>
  getSetting('image_gen', imageGenSettingsSchema, { ...DEFAULTS.imageGen });

const topicAffinitySchema = z.record(z.string(), z.number().min(0.5).max(2));
/** Multiplicateurs d'affinité par sujet, appris des clics (job learn hebdo). */
export const getTopicAffinity = (): Record<string, number> =>
  getSetting('topic_affinity', topicAffinitySchema, {});
export const setTopicAffinity = (value: Record<string, number>): void =>
  setSetting('topic_affinity', value);
export const getLlmRouting = () =>
  getSetting('llm_routing', llmRoutingSchema, {
    copywriting: 'anthropic',
    scoring: 'gemini',
    vision: 'gemini',
    visionFinal: 'anthropic',
  });
/** Valeur de réglage qui suit le dernier template créé plutôt qu'un thème figé. */
export const THEME_DERNIER = 'dernier';

/**
 * Le template maison le plus récemment créé, sous sa forme utilisable comme
 * thème : « custom:<slug> ». L'identifiant nu ne désigne rien pour le rendu.
 */
export const dernierTemplate = (): string | null => {
  const slug = db
    .select({ id: schema.customThemes.id })
    .from(schema.customThemes)
    .orderBy(desc(schema.customThemes.createdAt))
    .limit(1)
    .get()?.id;
  return slug ? `custom:${slug}` : null;
};

/**
 * Thème des posts générés. Par défaut — et tant qu'aucun thème n'est épinglé —
 * c'est le dernier template créé qui sert : un template fraîchement dessiné
 * s'applique aux publications suivantes sans réglage supplémentaire.
 */
export const getDefaultTheme = (): string => {
  const raw = getSettingRaw('default_theme');
  const epingle = typeof raw === 'string' && raw ? raw : THEME_DERNIER;
  if (epingle !== THEME_DERNIER) return epingle;
  return dernierTemplate() ?? DEFAULTS.theme;
};
export const getDefaultFormat = (): string => {
  const raw = getSettingRaw('default_format');
  return typeof raw === 'string' && raw ? raw : DEFAULTS.format;
};
