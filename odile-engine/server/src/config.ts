import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3080),
  /** URL publique HTTPS (webhooks Meta + images publiques + liens email) */
  PUBLIC_URL: z.string().url().default('http://localhost:3080'),
  /** Secret maître : signatures HMAC + chiffrement des tokens OAuth. 32+ caractères. */
  APP_SECRET: z.string().min(16).default('dev-secret-change-me-in-production!'),
  ADMIN_PASSWORD: z.string().min(4).default('odile'),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), 'var')),

  /** live = vrais appels LLM ; mock = réponses canées (tests sans clé) */
  LLM_MODE: z.enum(['live', 'mock']).default('live'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_WRITER: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_FAST: z.string().default('claude-haiku-4-5'),
  GEMINI_MODEL_SCORING: z.string().default('gemini-2.5-flash-lite'),
  GEMINI_MODEL_VISION: z.string().default('gemini-2.5-flash'),
  /** génération d'illustrations : Nano Banana Pro + variante rapide */
  GEMINI_MODEL_IMAGE: z.string().default('gemini-3-pro-image'),
  GEMINI_MODEL_IMAGE_FAST: z.string().default('gemini-3.1-flash-image'),
  GEMINI_MODEL_IMAGE_LEGACY: z.string().default('gemini-2.5-flash-image'),

  /** dry = les publications écrivent leur payload dans var/outbox au lieu d'appeler les APIs */
  PUBLISH_MODE: z.enum(['live', 'dry']).default('dry'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  MAIL_FROM: z.string().default('Odile Engine <noreply@localhost>'),
  APPROVAL_EMAIL_TO: z.string().email().optional(),

  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** valeur arbitraire à recopier dans la config webhook Meta */
  META_VERIFY_TOKEN: z.string().default('odile-verify'),

  /** chemin explicite du binaire Chromium (sinon auto-détection) */
  CHROMIUM_PATH: z.string().optional(),
  /** désactive le lancement des crons (ex: conteneur de test) */
  DISABLE_SCHEDULER: z.coerce.boolean().default(false),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide (.env) :');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  dbPath: path.join(parsed.data.DATA_DIR, 'data.sqlite'),
  assetsDir: path.join(parsed.data.DATA_DIR, 'assets'),
  outboxDir: path.join(parsed.data.DATA_DIR, 'outbox'),
};
export type Config = typeof config;
