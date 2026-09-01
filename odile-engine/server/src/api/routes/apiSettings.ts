import fs from 'node:fs';
import { desc, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approvalEmailSettingsSchema,
  brandSettingsSchema,
  cadenceSettingsSchema,
  designStudioSettingsSchema,
  dmTriggerSettingsSchema,
  llmRoutingSchema,
  publishSlotsSchema,
  THEMES,
  toneSettingsSchema,
} from '@odile/shared';
import { config } from '../../config.js';
import { db, schema } from '../../db/client.js';
import {
  getApprovalEmail,
  getBrand,
  getCadence,
  getDefaultFormat,
  getDefaultTheme,
  getDesignStudio,
  getDmTriggers,
  getLlmRouting,
  getPublishSlots,
  getTone,
  setSetting,
} from '../../db/settingsRepo.js';
import { anthropicProvider } from '../../llm/anthropic.js';
import { geminiProvider } from '../../llm/gemini.js';
import { sendMail, verifySmtp } from '../../mailer/smtp.js';
import { saveAsset } from '../../render/renderer.js';

const SETTINGS_MAP: Record<string, { schema: z.ZodType; read: () => unknown }> = {
  tone: { schema: toneSettingsSchema, read: getTone },
  brand: { schema: brandSettingsSchema, read: getBrand },
  cadence: { schema: cadenceSettingsSchema, read: getCadence },
  publish_slots: { schema: publishSlotsSchema, read: getPublishSlots },
  dm_triggers: { schema: dmTriggerSettingsSchema, read: getDmTriggers },
  approval_email: { schema: approvalEmailSettingsSchema, read: getApprovalEmail },
  design_studio: { schema: designStudioSettingsSchema, read: getDesignStudio },
  llm_routing: { schema: llmRoutingSchema, read: getLlmRouting },
  default_theme: { schema: z.enum(THEMES), read: getDefaultTheme },
  default_format: { schema: z.enum(['carousel', 'static', 'li_image']), read: getDefaultFormat },
};

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', async () => {
    return Object.fromEntries(Object.entries(SETTINGS_MAP).map(([k, v]) => [k, v.read()]));
  });

  app.get<{ Params: { key: string } }>('/api/settings/:key', async (request, reply) => {
    const entry = SETTINGS_MAP[request.params.key];
    if (!entry) return reply.status(404).send({ error: 'Clé inconnue' });
    return { key: request.params.key, value: entry.read() };
  });

  app.put<{ Params: { key: string } }>('/api/settings/:key', async (request, reply) => {
    const entry = SETTINGS_MAP[request.params.key];
    if (!entry) return reply.status(404).send({ error: 'Clé inconnue' });
    const parsed = entry.schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    setSetting(request.params.key, parsed.data);
    return { ok: true, value: parsed.data };
  });

  app.post('/api/settings/brand/logo', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Fichier manquant' });
    const buffer = await file.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) return reply.status(400).send({ error: 'Logo > 2 Mo' });
    const assetId = saveAsset(buffer, 'logo', {});
    setSetting('brand', { ...getBrand(), logoAssetId: assetId });
    return { ok: true, assetId };
  });

  app.post('/api/settings/test-email', async () => {
    const to = getApprovalEmail().to;
    const result = await sendMail({
      kind: 'test',
      to,
      subject: '[Odile] Email de test',
      html: '<p>✅ La configuration email d’Odile Engine fonctionne.</p>',
      text: 'La configuration email d’Odile Engine fonctionne.',
    });
    return { ok: result.ok, to };
  });

  app.get('/api/setup/health', async () => {
    const smtp = await verifySmtp();
    const tokens = db.select().from(schema.oauthTokens).all().map((t) => ({
      provider: t.provider,
      subject: t.subject,
      externalId: t.externalId,
      expiresAt: t.expiresAt,
      meta: t.meta ? JSON.parse(t.meta) : null,
    }));
    let chromium = { ok: false, detail: '' };
    try {
      const { getBrowser } = await import('../../render/browser.js');
      await getBrowser();
      chromium = { ok: true, detail: 'Chromium opérationnel' };
    } catch (err) {
      chromium = { ok: false, detail: String(err).slice(0, 200) };
    }
    const lastRuns = db
      .select()
      .from(schema.jobRuns)
      .where(isNotNull(schema.jobRuns.finishedAt))
      .orderBy(desc(schema.jobRuns.id))
      .limit(12)
      .all();
    const lastWebhook = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.platform, 'instagram'))
      .orderBy(desc(schema.comments.id))
      .limit(1)
      .get();
    return {
      publicUrl: config.PUBLIC_URL,
      publishMode: config.PUBLISH_MODE,
      llmMode: config.LLM_MODE,
      llm: {
        anthropic: anthropicProvider.isConfigured(),
        gemini: geminiProvider.isConfigured(),
      },
      smtp,
      chromium,
      oauth: {
        linkedinConfigured: Boolean(config.LINKEDIN_CLIENT_ID),
        metaConfigured: Boolean(config.META_APP_ID),
        tokens,
      },
      lastWebhookCommentAt: lastWebhook?.fetchedAt ?? null,
      lastJobRuns: lastRuns.map((r) => ({
        job: r.jobName,
        ok: r.ok,
        finishedAt: r.finishedAt,
        summary: r.summary ? JSON.parse(r.summary) : null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, request.params.id)).get();
    if (!asset || !fs.existsSync(asset.path)) return reply.status(404).send({ error: 'Asset introuvable' });
    reply.type(asset.mime);
    return reply.send(fs.createReadStream(asset.path));
  });
}
