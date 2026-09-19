import fs from 'node:fs';
import { config } from '../config.js';
import { fetchJson, fetchWithRetry, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { compteDuPost, jetonDuCompte, mentionsConnues } from './linkedinAccounts.js';
import { documentDuPost, envoyerDocumentLinkedIn, titreDocument } from './linkedinDocument.js';
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

/** Une entité LinkedIn à identifier dans le texte : son nom tel qu'il y apparaît, son URN. */
export interface MentionLinkedIn {
  nom: string;
  urn: string;
}

function escapeLittle(text: string): string {
  return text.replace(/([\\|{}@[\]()<>*_~])/g, '\\$1');
}

/**
 * Commentaire (texte du post), format « little text » de LinkedIn — 3 000 caractères max.
 * Les caractères réservés sont échappés ; le « # » ne l'est pas : un « #motclé » en clair
 * devient un hashtag cliquable (l'API le convertit elle-même en {hashtag|\#|motclé}).
 *
 * Les `mentions` transforment un nom écrit en clair en identification cliquable —
 * `@[Odile AI](urn:li:organization:…)` — la première fois qu'il apparaît. C'est ainsi
 * qu'un post personnel identifie la page entreprise, ou un collègue dont le profil
 * est connecté au moteur.
 */
export function commentary(caption: string, mentions: MentionLinkedIn[] = []): string {
  const texte = caption.slice(0, 2990);
  const utiles = mentions.filter((m) => m.nom.trim().length >= 2 && m.urn.startsWith('urn:li:'));
  if (utiles.length === 0) return escapeLittle(texte);

  // Chaque nom n'est identifié qu'une fois, à sa première apparition ; les plages
  // sont posées du début à la fin sans se chevaucher.
  const plages: { debut: number; fin: number; urn: string }[] = [];
  for (const m of utiles) {
    // Le nom LinkedIn peut porter un émoji (« Khaled 💻 Aboubakar ») que le texte n'a
    // pas : on cherche les mots du nom, séparés par n'importe quoi de décoratif.
    const mots = m.nom
      .trim()
      .split(/[\s\p{Extended_Pictographic}\p{S}]+/u)
      .filter(Boolean)
      .map((mot) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (mots.length === 0) continue;
    const motif = new RegExp(mots.join('[\\s\\p{Extended_Pictographic}\\p{S}]*'), 'giu');
    let trouve: RegExpExecArray | null;
    while ((trouve = motif.exec(texte)) !== null) {
      const pos = trouve.index;
      const fin = pos + trouve[0].length;
      if (fin === pos) {
        motif.lastIndex++;
        continue;
      }
      const libre = !plages.some((p) => pos < p.fin && fin > p.debut);
      // Mot entier seulement : « Odile » ne doit pas identifier « Odilette ».
      const avant = pos === 0 ? ' ' : texte[pos - 1]!;
      const apres = fin >= texte.length ? ' ' : texte[fin]!;
      if (libre && !/[\p{L}\p{N}]/u.test(avant) && !/[\p{L}\p{N}]/u.test(apres)) {
        plages.push({ debut: pos, fin, urn: m.urn });
        break;
      }
    }
  }
  if (plages.length === 0) return escapeLittle(texte);
  plages.sort((a, b) => a.debut - b.debut);

  let sortie = '';
  let curseur = 0;
  for (const p of plages) {
    sortie += escapeLittle(texte.slice(curseur, p.debut));
    sortie += `@[${escapeLittle(texte.slice(p.debut, p.fin))}](${p.urn})`;
    curseur = p.fin;
  }
  sortie += escapeLittle(texte.slice(curseur));
  return sortie;
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

interface MentionDeclaree {
  nom: string;
  type?: 'entreprise' | 'personne';
  vanityName?: string;
}

/**
 * Qui identifier dans le texte d'un post.
 *
 * Toujours : la page entreprise et les profils connectés au moteur (URN connus).
 * Quand le rédacteur l'a demandé : une entreprise de notoriété, retrouvée par son
 * `vanityName` — cette recherche exige le droit `rw_organization_admin` ; s'il manque,
 * LinkedIn refuse et le nom reste écrit en clair, ce qui n'abîme rien. Les personnes
 * restent du texte : LinkedIn n'offre aucune recherche de profil aux applications.
 */
export async function mentionsDuPost(
  post: { mentions?: string | null },
  token: string,
): Promise<MentionLinkedIn[]> {
  const mentions = mentionsConnues();
  let declarees: MentionDeclaree[] = [];
  try {
    declarees = post.mentions ? (JSON.parse(post.mentions) as MentionDeclaree[]) : [];
  } catch {
    declarees = [];
  }
  for (const m of declarees.slice(0, 4)) {
    const vanity = m.vanityName?.trim().replace(/^.*\/company\//, '').replace(/\/.*$/, '');
    if ((m.type ?? 'entreprise') !== 'entreprise' || !vanity || !m.nom?.trim()) continue;
    try {
      const res = await fetchJson<{ elements?: { id?: number | string }[] }>(
        `${API}/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(vanity)}`,
        { headers: headers(token) },
      );
      const id = res.elements?.[0]?.id;
      if (id) mentions.push({ nom: m.nom.trim(), urn: `urn:li:organization:${id}` });
    } catch (err) {
      logger.debug({ vanity, err: String(err).slice(0, 120) }, 'entreprise non identifiable — nom laissé en clair');
    }
  }
  return mentions;
}

/** Tranche imposée par LinkedIn pour l'envoi d'une vidéo : 4 Mo. */
const TRANCHE_VIDEO = 4 * 1024 * 1024;

interface InitVideo {
  value: {
    video: string;
    uploadToken: string;
    uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[];
  };
}

/**
 * Envoie un MP4 à LinkedIn et renvoie l'URN de la vidéo.
 *
 * Le parcours est en trois temps : on déclare le fichier (`initializeUpload`), on
 * envoie chaque tranche à l'adresse fournie en relevant son ETag, puis on scelle
 * l'ensemble (`finalizeUpload`) avec la liste des ETags — dans l'ordre des tranches,
 * sans quoi LinkedIn reconstitue un fichier illisible.
 */
export async function envoyerVideoLinkedIn(args: {
  token: string;
  owner: string;
  fichier: string;
}): Promise<string> {
  const taille = fs.statSync(args.fichier).size;
  const init = await fetchJson<InitVideo>(`${API}/rest/videos?action=initializeUpload`, {
    method: 'POST',
    headers: headers(args.token),
    body: JSON.stringify({
      initializeUploadRequest: { owner: args.owner, fileSizeBytes: taille, uploadCaptions: false, uploadThumbnail: false },
    }),
    timeoutMs: 60_000,
  });
  const { video, uploadToken, uploadInstructions } = init.value;
  const contenu = fs.readFileSync(args.fichier);
  const etags: string[] = [];
  for (const tranche of uploadInstructions) {
    const morceau = contenu.subarray(tranche.firstByte, Math.min(tranche.lastByte + 1, contenu.length));
    const res = await fetchWithRetry(tranche.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: morceau,
      timeoutMs: 180_000,
      retries: 2,
    });
    if (!res.ok) throw new HttpError(res.status, tranche.uploadUrl, await res.text().catch(() => ''));
    const etag = res.headers.get('etag');
    await res.text().catch(() => undefined);
    if (!etag) throw new Error('LinkedIn n’a pas renvoyé d’ETag pour une tranche de la vidéo');
    etags.push(etag.replace(/^"|"$/g, ''));
  }
  await fetchWithRetry(`${API}/rest/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: headers(args.token),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds: etags } }),
    timeoutMs: 60_000,
  }).then(async (res) => {
    if (!res.ok) throw new HttpError(res.status, `${API}/rest/videos?action=finalizeUpload`, await res.text());
    await res.text().catch(() => undefined);
  });
  logger.info({ video, tranches: etags.length, octets: taille }, 'vidéo envoyée à LinkedIn');
  return video;
}

/**
 * Publie sur LinkedIn (profil personnel ou page entreprise selon le canal).
 * 1 image (li_image), multi-images (carrousel LinkedIn) ou vidéo native.
 */
export class LinkedInPublisher implements Publisher {
  readonly name = 'linkedin';

  async publish(input: PublishInput): Promise<PublishResult> {
    const isOrg = input.post.channel === 'li_org';
    // Le post sait sur quel compte il part : celui choisi à la rédaction, ou le
    // premier compte actif du canal si la clé est vide ou périmée.
    const compte = compteDuPost(input.post);
    const stored = compte ? jetonDuCompte(compte) : null;
    if (!compte || !stored) {
      throw new Error(
        `Aucun jeton LinkedIn ${isOrg ? 'page entreprise' : 'personnel'} — connecte le compte dans Réglages → Connexions`,
      );
    }
    const owner = compte.actor;

    // Vidéo : LinkedIn la lit dans le fil, c'est le format le plus regardé après le document.
    const videoUrn = input.video
      ? await envoyerVideoLinkedIn({ token: stored.accessToken, owner, fichier: input.video.path })
      : null;
    // Document : les slides déjà rendues assemblées en PDF feuilletable — le carrousel
    // natif de LinkedIn, qui n'a rien à voir avec une suite d'images.
    const documentUrn =
      !videoUrn && input.post.format === 'li_doc'
        ? await envoyerDocumentLinkedIn({
            token: stored.accessToken,
            owner,
            // Le même fichier que le dashboard a permis de feuilleter (refait si une slide a changé)
            fichier: (await documentDuPost(input.post.id)).path,
          })
        : null;
    const imageUrns: string[] = [];
    if (!videoUrn && !documentUrn) {
      for (const image of input.images) {
        imageUrns.push(await uploadImage(stored.accessToken, owner, image.path));
      }
    }

    // Identifications réelles : la page entreprise, les collègues connectés, et les
    // entreprises de notoriété que le rédacteur a désignées — jamais soi-même. Les noms
    // écrits en clair deviennent des liens cliquables ; les autres restent du texte.
    const mentions = (await mentionsDuPost(input.post, stored.accessToken)).filter((m) => m.urn !== owner);
    const body: Record<string, unknown> = {
      author: owner,
      commentary: commentary(input.caption, mentions),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (videoUrn) {
      body.content = { media: { id: videoUrn, title: input.post.hook.slice(0, 120) } };
    } else if (documentUrn) {
      // Le titre du document s'affiche au-dessus de la première page : une seconde
      // accroche, pas un nom de fichier.
      body.content = { media: { id: documentUrn, title: titreDocument(input.post.hook) } };
    } else if (imageUrns.length === 1) {
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
    logger.info({ postUrn, compte: compte.name, acteur: owner }, 'post LinkedIn publié');
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
  // En simulation, on nomme le compte qui publierait vraiment : c'est précisément
  // ce qu'on vient vérifier quand plusieurs profils sont connectés.
  const compte = compteDuPost(input.post);
  const auteur = compte?.actor ?? (isOrg ? 'urn:li:organization:<ORG_ID>' : 'urn:li:person:<PERSON_ID>');
  const nomDuCompte = compte?.name ?? (isOrg ? 'page entreprise (non connectée)' : 'profil (non connecté)');
  if (input.video) {
    return {
      endpoint: `${API}/rest/posts`,
      uploads: [
        { call: `POST ${API}/rest/videos?action=initializeUpload`, body: { initializeUploadRequest: { owner: '<OWNER>', fileSizeBytes: '<taille>' } } },
        { call: 'PUT <uploadUrl> par tranches de 4 Mo', relever: 'ETag de chaque tranche' },
        { call: `POST ${API}/rest/videos?action=finalizeUpload`, body: { finalizeUploadRequest: { video: 'urn:li:video:<ID>', uploadedPartIds: ['<etags>'] } } },
      ],
      compte: nomDuCompte,
      body: {
        author: auteur,
        commentary: commentary(input.caption),
        content: { media: { id: 'urn:li:video:<ID>', title: input.post.hook.slice(0, 120) } },
      },
    };
  }
  if (input.post.format === 'li_doc') {
    return {
      endpoint: `${API}/rest/posts`,
      uploads: [
        { call: `POST ${API}/rest/documents?action=initializeUpload`, body: { initializeUploadRequest: { owner: '<OWNER>' } } },
        { call: 'PUT <uploadUrl> — le PDF en une fois', pages: input.images.length },
      ],
      compte: nomDuCompte,
      body: {
        author: auteur,
        commentary: commentary(input.caption),
        content: { media: { id: 'urn:li:document:<ID>', title: titreDocument(input.post.hook) } },
      },
    };
  }
  return {
    endpoint: `${API}/rest/posts`,
    headers: { 'linkedin-version': LINKEDIN_VERSION, 'x-restli-protocol-version': '2.0.0' },
    compte: nomDuCompte,
    body: {
      author: auteur,
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
