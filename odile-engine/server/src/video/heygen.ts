/**
 * Client HeyGen — vidéos avatar.
 *
 * Trois appels suffisent : on demande la vidéo (`/v2/video/generate`), on suit son
 * avancement (`/v1/video_status.get`), on récupère le MP4. Deux listes servent au
 * dashboard à proposer TES avatars et TES voix plutôt que des identifiants écrits
 * en dur (`/v2/avatars`, `/v2/voices`).
 *
 * Un détail qui décide de l'architecture : **l'URL renvoyée par HeyGen expire au
 * bout de 7 jours**. Une vidéo programmée dans dix jours pointerait donc sur un
 * lien mort ; le moteur télécharge le MP4 et le sert lui-même (voir video/index.ts).
 */
import { getOauthApps } from '../db/oauthApps.js';
import { fetchJson, fetchWithRetry, HttpError } from '../lib/http.js';

export const HEYGEN = 'https://api.heygen.com';

export interface AvatarHeyGen {
  id: string;
  nom: string;
  type: 'avatar' | 'talking_photo';
  genre: string;
  apercu: string | null;
}
export interface VoixHeyGen {
  id: string;
  nom: string;
  langue: string;
  genre: string;
  apercu: string | null;
  /** la voix accepte-t-elle une émotion (enjouée, sérieuse…) */
  emotions: boolean;
}

export interface FondVideo {
  type: 'color' | 'image';
  /** couleur hexadécimale, ou URL publique de l'image */
  value: string;
}

export interface DemandeVideo {
  script: string;
  titre: string;
  avatarId: string;
  avatarType: 'avatar' | 'talking_photo';
  avatarStyle: string;
  voiceId: string;
  voiceSpeed: number;
  fond: FondVideo;
  sousTitres: boolean;
  largeur: number;
  hauteur: number;
  /** vidéo filigranée qui ne consomme pas de crédit */
  test: boolean;
}

export interface EtatVideo {
  statut: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  vignetteUrl: string | null;
  dureeMs: number | null;
  erreur: string | null;
}

function cle(): string {
  const key = getOauthApps().heygenApiKey;
  if (!key) throw new Error('Clé HeyGen absente — renseigne-la dans Connexions & santé');
  return key;
}

function entetes(): Record<string, string> {
  return { 'x-api-key': cle(), accept: 'application/json', 'content-type': 'application/json' };
}

/** HeyGen répond 200 avec un objet `error` renseigné : l'échec se lit dans le corps, pas dans le statut. */
function deballer<T>(reponse: { error?: unknown; data?: T; message?: string }): T {
  const err = reponse.error;
  if (err) {
    const detail =
      typeof err === 'string' ? err : ((err as { message?: string }).message ?? JSON.stringify(err).slice(0, 300));
    throw new Error(`HeyGen a refusé : ${detail}`);
  }
  if (!reponse.data) throw new Error(`HeyGen a répondu sans données${reponse.message ? ` (${reponse.message})` : ''}`);
  return reponse.data;
}

/** Les avatars du compte : avatars studio ou instantanés, puis photos animées. */
export async function listerAvatars(): Promise<AvatarHeyGen[]> {
  const data = deballer(
    await fetchJson<{
      error?: unknown;
      data?: {
        avatars?: { avatar_id: string; avatar_name?: string; gender?: string; preview_image_url?: string }[];
        talking_photos?: { talking_photo_id: string; talking_photo_name?: string; preview_image_url?: string }[];
      };
    }>(`${HEYGEN}/v2/avatars`, { headers: entetes(), timeoutMs: 20_000 }),
  );
  const avatars: AvatarHeyGen[] = (data.avatars ?? []).map((a) => ({
    id: a.avatar_id,
    nom: a.avatar_name?.trim() || a.avatar_id,
    type: 'avatar',
    genre: a.gender ?? '',
    apercu: a.preview_image_url ?? null,
  }));
  for (const tp of data.talking_photos ?? []) {
    avatars.push({
      id: tp.talking_photo_id,
      nom: tp.talking_photo_name?.trim() || tp.talking_photo_id,
      type: 'talking_photo',
      genre: '',
      apercu: tp.preview_image_url ?? null,
    });
  }
  return avatars;
}

/** Les voix du compte, françaises en tête : c'est la langue des posts. */
export async function listerVoix(): Promise<VoixHeyGen[]> {
  const data = deballer(
    await fetchJson<{
      error?: unknown;
      data?: {
        voices?: {
          voice_id: string;
          name?: string;
          language?: string;
          gender?: string;
          preview_audio?: string;
          emotion_support?: boolean;
        }[];
      };
    }>(`${HEYGEN}/v2/voices`, { headers: entetes(), timeoutMs: 20_000 }),
  );
  const voix: VoixHeyGen[] = (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    nom: v.name?.trim() || v.voice_id,
    langue: v.language ?? '',
    genre: v.gender ?? '',
    apercu: v.preview_audio ?? null,
    emotions: Boolean(v.emotion_support),
  }));
  const francais = (v: VoixHeyGen) => /fran|french/i.test(v.langue);
  return [...voix.filter(francais), ...voix.filter((v) => !francais(v))];
}

/** Demande la fabrication d'une vidéo ; renvoie l'identifiant à suivre. */
export async function demanderVideo(d: DemandeVideo): Promise<string> {
  const character =
    d.avatarType === 'talking_photo'
      ? { type: 'talking_photo', talking_photo_id: d.avatarId }
      : { type: 'avatar', avatar_id: d.avatarId, avatar_style: d.avatarStyle || 'normal' };
  const corps: Record<string, unknown> = {
    title: d.titre.slice(0, 100),
    caption: d.sousTitres,
    dimension: { width: d.largeur, height: d.hauteur },
    video_inputs: [
      {
        character,
        voice: { type: 'text', input_text: d.script, voice_id: d.voiceId, speed: d.voiceSpeed },
        background: d.fond.type === 'image' ? { type: 'image', url: d.fond.value } : { type: 'color', value: d.fond.value },
      },
    ],
  };
  if (d.test) corps.test = true;
  const data = deballer(
    await fetchJson<{ error?: unknown; data?: { video_id: string } }>(`${HEYGEN}/v2/video/generate`, {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify(corps),
      timeoutMs: 60_000,
    }),
  );
  if (!data.video_id) throw new Error('HeyGen n’a pas renvoyé d’identifiant de vidéo');
  return data.video_id;
}

/** Où en est la fabrication. */
export async function etatVideo(videoId: string): Promise<EtatVideo> {
  const res = await fetchJson<{
    data?: {
      status?: string;
      video_url?: string | null;
      thumbnail_url?: string | null;
      duration?: number | null;
      error?: unknown;
    };
    message?: string;
  }>(`${HEYGEN}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { 'x-api-key': cle(), accept: 'application/json' },
    timeoutMs: 20_000,
  });
  const d = res.data ?? {};
  const brut = d.error;
  const erreur = brut
    ? typeof brut === 'string'
      ? brut
      : ((brut as { message?: string; detail?: string }).message ?? (brut as { detail?: string }).detail ?? JSON.stringify(brut).slice(0, 300))
    : null;
  const statut = (d.status ?? 'pending') as EtatVideo['statut'];
  return {
    statut: ['pending', 'processing', 'completed', 'failed'].includes(statut) ? statut : 'processing',
    videoUrl: d.video_url ?? null,
    vignetteUrl: d.thumbnail_url ?? null,
    // HeyGen donne la durée en secondes ; le moteur raisonne en millisecondes comme LinkedIn.
    dureeMs: typeof d.duration === 'number' ? Math.round(d.duration * 1000) : null,
    erreur,
  };
}

/** Rapatrie le MP4 : l'adresse HeyGen expire au bout de 7 jours, la nôtre non. */
export async function telechargerVideo(url: string): Promise<Buffer> {
  const res = await fetchWithRetry(url, { timeoutMs: 120_000, retries: 2 });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return Buffer.from(await res.arrayBuffer());
}
