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
  // Sous vitest, jamais la base réelle : un test qui oublie DATA_DIR travaillerait
  // dans var/ et y effacerait les jetons LinkedIn/Meta de la machine.
  DATA_DIR: z.string().default(path.resolve(process.cwd(), process.env.VITEST ? `var-test-auto-${process.pid}` : 'var')),

  /** live = vrais appels LLM ; mock = réponses canées (tests sans clé) */
  LLM_MODE: z.enum(['live', 'mock']).default('live'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  /** facultatif : relève le plafond de la recherche GitHub (10 req/min sans clé suffisent à la veille) */
  GITHUB_TOKEN: z.string().optional(),
  /** facultatif : la clé HeyGen se saisit normalement dans Connexions & santé */
  HEYGEN_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_WRITER: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_FAST: z.string().default('claude-haiku-4-5'),
  GEMINI_MODEL_SCORING: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_MODEL_VISION: z.string().default('gemini-3.5-flash'),
  /** génération d'illustrations : Nano Banana Pro + variante rapide */
  GEMINI_MODEL_IMAGE: z.string().default('gemini-3-pro-image'),
  GEMINI_MODEL_IMAGE_FAST: z.string().default('gemini-3.1-flash-image'),
  GEMINI_MODEL_IMAGE_LEGACY: z.string().default('gemini-2.5-flash-image'),
  /** Freepik / Magnific API (optionnel) : Nano Banana Pro via leur plateforme */
  FREEPIK_API_KEY: z.string().optional(),
  FREEPIK_API_BASE: z.string().url().default('https://api.magnific.com'),
  FREEPIK_MODEL_IMAGE: z.string().default('nano-banana-pro-flash'),
  FREEPIK_MODEL_IMAGE_FAST: z.string().default('flux-2-klein'),

  /** dry = les publications écrivent leur payload dans var/outbox au lieu d'appeler les APIs */
  PUBLISH_MODE: z.enum(['live', 'dry']).default('dry'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // z.stringbool : « false » et « 0 » valent bien false (z.coerce.boolean les lisait comme true)
  SMTP_SECURE: z.stringbool().default(false),
  MAIL_FROM: z.string().default('Odile Engine <noreply@localhost>'),
  APPROVAL_EMAIL_TO: z.string().email().optional(),
  /** adresse publiée sur les pages « confidentialité » et « suppression des données » */
  CONTACT_EMAIL: z.string().email().default('contact@odileai.com'),

  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  /** version de l'API LinkedIn (AAAAMM) — chaque version vit ~1 an, à avancer régulièrement */
  LINKEDIN_VERSION: z.string().regex(/^\d{6}$/).default('202608'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** ID de configuration Facebook Login for Business (sinon dialogue OAuth classique) */
  META_CONFIG_ID: z.string().optional(),
  /** valeur arbitraire à recopier dans la config webhook Meta */
  META_VERIFY_TOKEN: z.string().default('odile-verify'),

  /** chemin explicite du binaire Chromium (sinon auto-détection) */
  CHROMIUM_PATH: z.string().optional(),
  /** suréchantillonnage du rendu des slides (2 = rendu en 2160×2700 puis réduit : typographie et dégradés plus nets) */
  RENDER_SCALE: z.coerce.number().min(1).max(3).default(2),
  /** désactive le lancement des crons (ex: conteneur de test) */
  DISABLE_SCHEDULER: z.stringbool().default(false),
});

/** Valeurs livrées dans .env.example : utilisables en local, jamais en production. */
const PLACEHOLDERS = {
  APP_SECRET: 'dev-secret-change-me-in-production!',
  ADMIN_PASSWORD: 'odile',
};

export interface SecretProblem {
  key: 'APP_SECRET' | 'ADMIN_PASSWORD';
  level: 'erreur' | 'avertissement';
  message: string;
}

/**
 * Contrôle des secrets en production : le moteur refuse de démarrer avec les valeurs
 * d'exemple, qui sont publiques (dépôt, documentation). APP_SECRET signe le cookie
 * d'administration et dérive la clé de chiffrement des jetons OAuth ; ADMIN_PASSWORD
 * est l'unique barrière du dashboard. Un secret court mais personnel ne bloque pas le
 * démarrage — il avertit — pour ne jamais verrouiller une instance déjà en service.
 */
export function checkProductionSecrets(env: { APP_SECRET: string; ADMIN_PASSWORD: string }): SecretProblem[] {
  const problems: SecretProblem[] = [];
  const placeholder = (v: string) => /change[-_ ]?me|changeme|à-changer|a-changer/i.test(v);

  if (env.APP_SECRET === PLACEHOLDERS.APP_SECRET || placeholder(env.APP_SECRET)) {
    problems.push({
      key: 'APP_SECRET',
      level: 'erreur',
      message:
        "valeur d'exemple encore en place. Génère un secret avec « openssl rand -base64 32 ». " +
        'Attention : le changer rend illisibles les jetons LinkedIn/Meta déjà enregistrés (il faudra reconnecter les comptes).',
    });
  } else if (env.APP_SECRET.length < 32) {
    problems.push({ key: 'APP_SECRET', level: 'avertissement', message: `${env.APP_SECRET.length} caractères — 32 au moins sont recommandés (openssl rand -base64 32).` });
  }

  if (env.ADMIN_PASSWORD === PLACEHOLDERS.ADMIN_PASSWORD || placeholder(env.ADMIN_PASSWORD)) {
    problems.push({ key: 'ADMIN_PASSWORD', level: 'erreur', message: "valeur d'exemple encore en place : le dashboard serait ouvert à tous." });
  } else if (env.ADMIN_PASSWORD.length < 12) {
    problems.push({ key: 'ADMIN_PASSWORD', level: 'avertissement', message: `${env.ADMIN_PASSWORD.length} caractères — 12 au moins sont recommandés.` });
  }
  return problems;
}

// Une variable laissée vide dans .env (« APPROVAL_EMAIL_TO= ») arrive comme chaîne vide et
// ferait échouer la validation : on la traite comme absente, donc comme « valeur par défaut ».
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  console.error('Configuration invalide (.env) :');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production') {
  const problems = checkProductionSecrets(parsed.data);
  for (const p of problems.filter((x) => x.level === 'avertissement')) {
    console.warn(`⚠️  ${p.key} : ${p.message}`);
  }
  const blocking = problems.filter((p) => p.level === 'erreur');
  if (blocking.length > 0) {
    console.error('Démarrage refusé : secrets d’exemple en production.');
    for (const p of blocking) console.error(`  - ${p.key} : ${p.message}`);
    console.error('  → édite le fichier .env sur le serveur, puis relance ./docker/deploy.sh');
    process.exit(1);
  }
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  dbPath: path.join(parsed.data.DATA_DIR, 'data.sqlite'),
  assetsDir: path.join(parsed.data.DATA_DIR, 'assets'),
  outboxDir: path.join(parsed.data.DATA_DIR, 'outbox'),
};
export type Config = typeof config;
