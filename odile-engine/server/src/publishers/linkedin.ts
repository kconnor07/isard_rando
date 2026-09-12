import fs from 'node:fs';
import { config } from '../config.js';
import { fetchJson, fetchWithRetry, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { getStoredToken } from './tokens.js';
import type { Publisher, PublishInput, PublishResult } from './types.js';

export const API = 'https://api.linkedin.com';
/** Version d'API LinkedIn (format AAAAMM) : chaque version vit ~1 an — `LINKEDIN_VERSION` dans .env pour avancer sans redéployer le code. */
export const LINKEDIN_VERSION = config.LINKEDIN_VERSION;

export function linkedInHeaders(token: string): Record<string, string> {
  return headers(token);
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'linkedin-version': LINKEDIN_VERSION,
    'x-restli-protocol-version': '2.0.0',
    'content-type': 'application/json',
  };
}

/**
 * Commentaire (texte du post), format « little text » de LinkedIn — 3 000 caractères max.
 * Les caractères réservés sont échappés ; le « # » ne l'est pas : un « #motclé » en clair
 * devient un hashtag cliquable (l'API le convertit elle-même en {hashtag|\#|motclé}).
 */
export function commentary(caption: string): string {
  return caption.slice(0, 2990).replace(/([\\|{}@[\]()<>*_~])/g, '\\$1');
}

async function uploadImage(token: string, owner: string, filePath: string): Promise<string> {
  const init = await fetchJson<{ value: { uploadUrl: string; image: string } }>(
    `${API}/rest/images?action=initializeUpload`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    },
  );
  const res = await fetchWithRetry(init.value.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: fs.readFileSync(filePath),
  });
  if (!res.ok) throw new HttpError(res.status, init.value.uploadUrl, await res.text());
  await res.text().catch(() => undefined);
  return init.value.image;
}

/**
 * Publie sur LinkedIn (profil personnel ou page entreprise selon le canal).
 * 1 image (li_image) ou multi-images (carrousel LinkedIn).
 */
export class LinkedInPublisher implements Publisher {
  readonly name = 'linkedin';

  async publish(input: PublishInput): Promise<PublishResult> {
    const isOrg = input.post.channel === 'li_org';
    const stored = getStoredToken('linkedin', isOrg ? 'li_org' : 'li_person');
    if (!stored) {
      throw new Error(
        `Aucun jeton LinkedIn ${isOrg ? 'page entreprise' : 'personnel'} — connecte le compte dans Réglages → Connexions`,
      );
    }
    const owner = isOrg
      ? `urn:li:organization:${stored.externalId}`
      : `urn:li:person:${stored.externalId}`;

    const imageUrns: string[] = [];
    for (const image of input.images) {
      imageUrns.push(await uploadImage(stored.accessToken, owner, image.path));
    }

    const body: Record<string, unknown> = {
      author: owner,
      commentary: commentary(input.caption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (imageUrns.length === 1) {
      body.content = { media: { id: imageUrns[0], altText: input.post.hook.slice(0, 120) } };
    } else if (imageUrns.length > 1) {
      body.content = {
        multiImage: { images: imageUrns.map((id) => ({ id, altText: input.post.hook.slice(0, 120) })) },
      };
    }

    const res = await fetchWithRetry(`${API}/rest/posts`, {
      method: 'POST',
      headers: headers(stored.accessToken),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `${API}/rest/posts`, text);
    const postUrn = res.headers.get('x-restli-id') ?? '';
    logger.info({ postUrn }, 'post LinkedIn publié');
    return {
      externalPostId: postUrn,
      externalUrl: postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : null,
      raw: { status: res.status },
    };
  }
}

/** Payload « à blanc » pour le mode dry-run (contrôle visuel dans var/outbox). */
export function linkedInDryPayload(input: PublishInput): unknown {
  const isOrg = input.post.channel === 'li_org';
  return {
    endpoint: `${API}/rest/posts`,
    headers: { 'linkedin-version': LINKEDIN_VERSION, 'x-restli-protocol-version': '2.0.0' },
    body: {
      author: isOrg ? 'urn:li:organization:<ORG_ID>' : 'urn:li:person:<PERSON_ID>',
      commentary: commentary(input.caption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED' },
      lifecycleState: 'PUBLISHED',
      content:
        input.images.length === 1
          ? { media: { id: 'urn:li:image:<UPLOAD_1>', altText: input.post.hook.slice(0, 120) } }
          : { multiImage: { images: input.images.map((_, i) => ({ id: `urn:li:image:<UPLOAD_${i + 1}>` })) } },
    },
    uploads: input.images.map((i) => ({ file: i.path, via: 'POST /rest/images?action=initializeUpload puis PUT' })),
  };
}
