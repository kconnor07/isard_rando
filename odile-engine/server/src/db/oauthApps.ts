import type { OauthAppsInput } from '@odile/shared';
import { config } from '../config.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getSettingRaw, setSetting } from './settingsRepo.js';

/**
 * Clés des applications LinkedIn et Meta. Saisies depuis le dashboard (Connexions & santé),
 * elles sont stockées dans les réglages, secrets chiffrés ; à défaut, les variables du .env.
 * Pour un fournisseur, la paire du dashboard prime dès qu'un identifiant y est renseigné.
 */
const KEY = 'oauth_apps';

interface Stored {
  linkedinClientId: string;
  linkedinClientSecretEnc: string | null;
  metaAppId: string;
  metaAppSecretEnc: string | null;
  metaVerifyToken: string;
  metaConfigId: string;
  updatedAt: string | null;
}

function readStored(): Stored {
  const raw = getSettingRaw(KEY) as Partial<Stored> | undefined;
  return {
    linkedinClientId: typeof raw?.linkedinClientId === 'string' ? raw.linkedinClientId : '',
    linkedinClientSecretEnc: typeof raw?.linkedinClientSecretEnc === 'string' ? raw.linkedinClientSecretEnc : null,
    metaAppId: typeof raw?.metaAppId === 'string' ? raw.metaAppId : '',
    metaAppSecretEnc: typeof raw?.metaAppSecretEnc === 'string' ? raw.metaAppSecretEnc : null,
    metaVerifyToken: typeof raw?.metaVerifyToken === 'string' ? raw.metaVerifyToken : '',
    metaConfigId: typeof raw?.metaConfigId === 'string' ? raw.metaConfigId : '',
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

function safeDecrypt(enc: string | null): string {
  if (!enc) return '';
  try {
    return decryptSecret(enc);
  } catch {
    return '';
  }
}

export type AppSource = 'dashboard' | 'env' | 'aucune';

export interface OauthApps {
  linkedinClientId: string;
  linkedinClientSecret: string;
  metaAppId: string;
  metaAppSecret: string;
  metaVerifyToken: string;
  /** vide = dialogue OAuth classique ; renseigné = Facebook Login for Business */
  metaConfigId: string;
  source: { linkedin: AppSource; meta: AppSource };
}

export function getOauthApps(): OauthApps {
  const s = readStored();
  const liDash = Boolean(s.linkedinClientId);
  const metaDash = Boolean(s.metaAppId);
  const linkedinClientId = liDash ? s.linkedinClientId : (config.LINKEDIN_CLIENT_ID ?? '');
  const linkedinClientSecret = liDash ? safeDecrypt(s.linkedinClientSecretEnc) : (config.LINKEDIN_CLIENT_SECRET ?? '');
  const metaAppId = metaDash ? s.metaAppId : (config.META_APP_ID ?? '');
  const metaAppSecret = metaDash ? safeDecrypt(s.metaAppSecretEnc) : (config.META_APP_SECRET ?? '');
  return {
    linkedinClientId,
    linkedinClientSecret,
    metaAppId,
    metaAppSecret,
    metaVerifyToken: s.metaVerifyToken || config.META_VERIFY_TOKEN,
    // L'ID de configuration n'est pas un secret et se règle indifféremment depuis le
    // dashboard ou le .env : le champ du dashboard prime, le .env prend le relais s'il
    // est vide (sans quoi META_CONFIG_ID resterait lettre morte dès que les clés Meta
    // sont saisies dans le dashboard).
    metaConfigId: s.metaConfigId || config.META_CONFIG_ID || '',
    source: {
      linkedin: liDash ? 'dashboard' : linkedinClientId ? 'env' : 'aucune',
      meta: metaDash ? 'dashboard' : metaAppId ? 'env' : 'aucune',
    },
  };
}

/** Une app est utilisable quand identifiant et secret sont connus. */
export function linkedinAppConfigured(apps = getOauthApps()): boolean {
  return Boolean(apps.linkedinClientId && apps.linkedinClientSecret);
}
export function metaAppConfigured(apps = getOauthApps()): boolean {
  return Boolean(apps.metaAppId && apps.metaAppSecret);
}

/** Enregistre les clés ; un secret vide conserve celui déjà stocké, un identifiant vide efface la paire. */
export function setOauthApps(input: OauthAppsInput): void {
  const current = readStored();
  const next: Stored = {
    linkedinClientId: input.linkedinClientId,
    linkedinClientSecretEnc: !input.linkedinClientId
      ? null
      : input.linkedinClientSecret
        ? encryptSecret(input.linkedinClientSecret)
        : current.linkedinClientSecretEnc,
    metaAppId: input.metaAppId,
    metaAppSecretEnc: !input.metaAppId ? null : input.metaAppSecret ? encryptSecret(input.metaAppSecret) : current.metaAppSecretEnc,
    metaVerifyToken: input.metaVerifyToken,
    metaConfigId: input.metaConfigId,
    updatedAt: new Date().toISOString(),
  };
  setSetting(KEY, next);
}

/** Vue pour le dashboard : identifiants en clair (publics), secrets jamais renvoyés. */
export function maskedOauthApps() {
  const apps = getOauthApps();
  const stored = readStored();
  return {
    linkedin: {
      clientId: apps.linkedinClientId,
      secretSet: Boolean(apps.linkedinClientSecret),
      source: apps.source.linkedin,
      configured: linkedinAppConfigured(apps),
    },
    meta: {
      appId: apps.metaAppId,
      secretSet: Boolean(apps.metaAppSecret),
      verifyToken: apps.metaVerifyToken,
      configId: apps.metaConfigId,
      source: apps.source.meta,
      configured: metaAppConfigured(apps),
    },
    updatedAt: stored.updatedAt,
    urls: {
      linkedinRedirect: `${config.PUBLIC_URL}/oauth/linkedin/callback`,
      metaRedirect: `${config.PUBLIC_URL}/oauth/meta/callback`,
      metaWebhook: `${config.PUBLIC_URL}/webhooks/meta`,
    },
  };
}
