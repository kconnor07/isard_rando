import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from './instagram.js';
import { getStoredToken } from './tokens.js';
import { nommerRessource } from '../webhooks/commentDm.js';
import { PROMESSE_DM } from '../writer/conformite.js';
import type { PublishInput } from './types.js';

/** Publier sur une Page exige cette permission, distincte de celles d'Instagram. */
export const PAGE_PUBLISH_SCOPE = 'pages_manage_posts';

export interface MirrorResult {
  postId: string;
  url: string | null;
}

/**
 * La légende de la recopie Facebook.
 *
 * Le moteur ne lit que les commentaires Instagram : Meta n'envoie pas les
 * commentaires de Page au même webhook, et personne ne répondrait à quelqu'un qui
 * commente « GUIDE » sur Facebook. Laisser l'appel à l'action tel quel serait donc
 * une promesse que rien ne tient. On le remplace par un renvoi vers la publication
 * Instagram, là où le mot-clé fonctionne vraiment.
 */
export function captionFacebook(args: {
  caption: string;
  motcle: string | null;
  /** ce qui est promis, nommé : « le guide « … » » */
  ressource: string;
  urlInstagram: string | null;
  /** hashtags du post, posés APRÈS le renvoi (jamais entre le texte et lui) */
  hashtags?: string[];
}): string {
  const { caption, motcle, ressource, urlInstagram } = args;
  const tags = (args.hashtags ?? []).join(' ');
  const avecTags = (t: string) => (tags ? `${t}\n\n${tags}` : t);
  if (!motcle) return avecTags(caption);
  // « Commente X », « Commentez « X » », et toute promesse de message privé : rien de
  // tout cela ne se tient sur une Page (Meta n'y relaie aucun commentaire).
  const cle = motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const motif = new RegExp(`commente[sz]?\\s*[«"'“]?\\s*${cle}`, 'i');
  const promesse = new RegExp(`${PROMESSE_DM.source}|abonne-toi`, 'i');
  const nettoye = caption
    .split('\n')
    .filter((ligne) => !motif.test(ligne) && !promesse.test(ligne))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const renvoi = urlInstagram
    ? `👉 Pour recevoir ${ressource}, commente ${motcle} sous cette publication sur Instagram : ${urlInstagram}`
    : `👉 Pour recevoir ${ressource}, commente ${motcle} sous cette publication sur notre Instagram.`;
  return avecTags(`${nettoye}\n\n${renvoi}`);
}

/** La légende Facebook d'un post Instagram, calculée d'un seul endroit (miroir automatique ou recopie manuelle). */
export function legendePourFacebook(
  post: { caption: string; hashtags: string; commentTriggerKeyword: string | null; resourceKind?: string | null; resourceTitle?: string | null },
  urlInstagram: string | null,
): string {
  let hashtags: string[] = [];
  try {
    hashtags = JSON.parse(post.hashtags) as string[];
  } catch {
    hashtags = [];
  }
  return captionFacebook({ caption: post.caption, motcle: post.commentTriggerKeyword, ressource: nommerRessource(post), urlInstagram, hashtags });
}

/**
 * Recopie d'une publication Instagram sur la Page Facebook liée.
 *
 * Une image : photo publiée directement avec sa légende. Plusieurs : chaque image
 * est déposée sans être publiée, puis attachée à une seule publication — c'est la
 * forme Facebook la plus proche d'un carrousel Instagram.
 *
 * Les images sont les mêmes JPEG publics que ceux servis à Instagram : Facebook les
 * télécharge depuis PUBLIC_URL, aucun envoi de fichier n'est nécessaire.
 */
export async function mirrorToFacebookPage(input: PublishInput): Promise<MirrorResult> {
  // Une vidéo ne se recopie pas comme une photo : la Page a son propre point d'entrée,
  // et Facebook télécharge le MP4 depuis l'adresse que le moteur sert.
  if (input.video) return publierVideoFacebook(input);
  const page = getStoredToken('meta', 'fb_page');
  if (!page) throw new Error('Aucune Page Facebook connectée — connecte Instagram depuis Connexions & santé');
  if (page.scopes && !page.scopes.split(',').includes(PAGE_PUBLISH_SCOPE)) {
    throw new Error(
      `Permission ${PAGE_PUBLISH_SCOPE} non accordée — ajoute-la aux autorisations de l'app Meta, puis reconnecte le compte`,
    );
  }
  const pageId = page.externalId;
  const token = page.accessToken;
  const message = input.caption.slice(0, 60000);

  if (input.images.length === 1) {
    const photo = await fetchJson<{ id: string; post_id?: string }>(`${GRAPH}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.images[0]!.publicUrl, caption: message, access_token: token }),
    });
    const postId = photo.post_id ?? photo.id;
    logger.info({ postId }, 'publication recopiée sur la Page Facebook');
    return { postId, url: `https://www.facebook.com/${postId}` };
  }

  const mediaIds: string[] = [];
  for (const image of input.images) {
    const photo = await fetchJson<{ id: string }>(`${GRAPH}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: image.publicUrl, published: false, access_token: token }),
    });
    mediaIds.push(photo.id);
  }
  const feed = await fetchJson<{ id: string }>(`${GRAPH}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      attached_media: mediaIds.map((id) => ({ media_fbid: id })),
      access_token: token,
    }),
  });
  logger.info({ postId: feed.id, images: mediaIds.length }, 'carrousel recopié sur la Page Facebook');
  return { postId: feed.id, url: `https://www.facebook.com/${feed.id}` };
}

/** Vidéo publiée sur la Page (Facebook télécharge le MP4 depuis `file_url`). */
async function publierVideoFacebook(input: PublishInput): Promise<MirrorResult> {
  const page = getStoredToken('meta', 'fb_page');
  if (!page) throw new Error('Aucune Page Facebook connectée — connecte Instagram depuis Connexions & santé');
  const video = input.video!;
  const res = await fetchJson<{ id: string }>(`${GRAPH}/${page.externalId}/videos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      file_url: video.publicUrl,
      description: input.caption.slice(0, 60000),
      title: input.post.hook.slice(0, 120),
      access_token: page.accessToken,
    }),
    timeoutMs: 120_000,
  });
  logger.info({ videoId: res.id }, 'vidéo publiée sur la Page Facebook');
  return { postId: res.id, url: `https://www.facebook.com/${res.id}` };
}

/** Payload « à blanc » pour le mode dry-run. */
export function facebookMirrorDryPayload(input: PublishInput): unknown {
  if (input.video) {
    return {
      call: `POST ${GRAPH}/<PAGE_ID>/videos`,
      body: {
        file_url: input.video.publicUrl,
        description: input.caption.slice(0, 200),
        title: input.post.hook.slice(0, 120),
      },
    };
  }
  const message = input.caption.slice(0, 60000);
  return input.images.length === 1
    ? { call: `POST ${GRAPH}/<PAGE_ID>/photos`, body: { url: input.images[0]!.publicUrl, caption: message } }
    : {
        steps: [
          ...input.images.map((img) => ({
            call: `POST ${GRAPH}/<PAGE_ID>/photos`,
            body: { url: img.publicUrl, published: false },
          })),
          {
            call: `POST ${GRAPH}/<PAGE_ID>/feed`,
            body: { message, attached_media: input.images.map((_, i) => ({ media_fbid: `<photo_${i}>` })) },
          },
        ],
      };
}
