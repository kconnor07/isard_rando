import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  approvalEmailSettingsSchema,
  brandSettingsSchema,
  BRAND_DEFAULTS,
  cadenceSettingsSchema,
  DEFAULTS,
  designStudioSettingsSchema,
  dmTriggerSettingsSchema,
  llmRoutingSchema,
  publishSlotsSchema,
  toneSettingsSchema,
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
  getSetting('brand', brandSettingsSchema, { ...BRAND_DEFAULTS, logoAssetId: null });
export const getCadence = () =>
  getSetting('cadence', cadenceSettingsSchema, {
    days: DEFAULTS.cadenceDays,
    rotation: ['ig', 'li_personal'],
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
  });
export const getApprovalEmail = () =>
  getSetting('approval_email', approvalEmailSettingsSchema, {
    to: config.APPROVAL_EMAIL_TO ?? 'admin@localhost.local',
    subjectPrefix: '[Odile]',
    maxReminders: 2,
  });
export const getDesignStudio = () =>
  getSetting('design_studio', designStudioSettingsSchema, { ...DEFAULTS.designStudio });
export const getLlmRouting = () =>
  getSetting('llm_routing', llmRoutingSchema, {
    copywriting: 'anthropic',
    scoring: 'gemini',
    vision: 'gemini',
    visionFinal: 'anthropic',
  });
export const getDefaultTheme = (): string => {
  const raw = getSettingRaw('default_theme');
  return typeof raw === 'string' && raw ? raw : DEFAULTS.theme;
};
export const getDefaultFormat = (): string => {
  const raw = getSettingRaw('default_format');
  return typeof raw === 'string' && raw ? raw : DEFAULTS.format;
};
