/**
 * Fabrication des vidéos avatar.
 *
 * Le rédacteur écrit le script, HeyGen le fait dire à l'avatar de la marque, et le
 * moteur rapatrie le MP4 pour le servir lui-même — l'adresse HeyGen expirant au
 * bout de 7 jours, un post programmé la semaine suivante pointerait sinon dans le
 * vide.
 *
 * L'attente se fait en deux temps : on patiente quelques minutes pendant la
 * fabrication du post (c'est le cas courant), et si HeyGen traîne, le post reste
 * « en attente de vidéo » et un passage régulier le termine (voir scheduler/jobs).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getDefaultTheme, getVideo } from '../db/settingsRepo.js';
import { heygenConfigured } from '../db/oauthApps.js';
import { logger } from '../lib/logger.js';
import { buildCustomThemeCss, getCustomTheme } from '../render/custom-theme.js';
import { saveAsset } from '../render/renderer.js';
import { demanderVideo, etatVideo, telechargerVideo } from './heygen.js';

/** Adresse publique du MP4 : c'est elle que Meta et Facebook téléchargent. */
export function urlVideo(assetId: string): string {
  return `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${assetId}.mp4`;
}

/** Couleur de fond par défaut : celle du template, pour que la vidéo reste dans la DA. */
function fondParDefaut(): string {
  const custom = getCustomTheme(getDefaultTheme());
  return custom?.bg1 ?? '#06050a';
}

/** Le fond demandé à HeyGen : couleur du template, ou image de la bibliothèque servie publiquement. */
function fondDeLaVideo(): { type: 'color' | 'image'; value: string } {
  const v = getVideo();
  if (v.backgroundType === 'image' && v.backgroundValue) {
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, v.backgroundValue)).get();
    if (asset) return { type: 'image', value: `${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${asset.id}.jpg` };
  }
  const couleur = v.backgroundType === 'couleur' && /^#[0-9a-f]{6}$/i.test(v.backgroundValue) ? v.backgroundValue : fondParDefaut();
  return { type: 'color', value: couleur };
}

/**
 * Script prêt à être prononcé : sans émoji, sans hashtag, sans URL — l'avatar les
 * lirait à voix haute. Le nom de la marque est laissé tel quel, il se prononce bien.
 */
export function scriptParle(brut: string, maxCaracteres = 1400): string {
  return brut
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    // Typographie française : « . » et « , » se collent, « ! ? ; : » gardent leur espace.
    // Les sous-titres incrustés par HeyGen reprennent ce texte tel quel.
    .replace(/[ \t]+([.,])/g, '$1')
    .replace(/[ \t]+([!?;:])/g, ' $1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxCaracteres);
}

export interface LancementVideo {
  lance: boolean;
  raison?: string;
  providerId?: string;
}

/** Demande la vidéo à HeyGen et retient l'identifiant à suivre. */
export async function lancerVideo(postId: number): Promise<LancementVideo> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const reglages = getVideo();
  if (!reglages.enabled) return { lance: false, raison: 'vidéos désactivées' };
  if (!heygenConfigured()) return { lance: false, raison: 'clé HeyGen absente' };
  if (!reglages.avatarId || !reglages.voiceId) return { lance: false, raison: 'avatar ou voix non choisis' };
  const script = scriptParle(post.videoScript ?? '');
  if (script.length < 40) return { lance: false, raison: 'script trop court' };

  const size = RENDER_SIZE_REEL;
  try {
    const providerId = await demanderVideo({
      script,
      titre: `${getBrand().name} — ${post.hook}`.slice(0, 100),
      avatarId: reglages.avatarId,
      avatarType: reglages.avatarType,
      avatarStyle: reglages.avatarStyle,
      voiceId: reglages.voiceId,
      voiceSpeed: reglages.voiceSpeed,
      fond: fondDeLaVideo(),
      sousTitres: reglages.captions,
      largeur: size.width,
      hauteur: size.height,
      test: reglages.testMode,
    });
    db.update(schema.posts)
      .set({ videoProviderId: providerId, videoStatus: 'pending', videoError: null, videoScript: script, updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, postId))
      .run();
    logger.info({ postId, providerId, test: reglages.testMode }, 'vidéo avatar demandée');
    return { lance: true, providerId };
  } catch (err) {
    const motif = err instanceof Error ? err.message : String(err);
    db.update(schema.posts)
      .set({ videoStatus: 'failed', videoError: motif.slice(0, 500), updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, postId))
      .run();
    logger.error({ postId, err: motif }, 'demande de vidéo refusée');
    return { lance: false, raison: motif };
  }
}

const RENDER_SIZE_REEL = { width: 1080, height: 1920 };

export type Aboutissement = 'prete' | 'en_cours' | 'echec' | 'sans_objet';

/** Vérifie une vidéo en cours ; rapatrie le MP4 dès qu'elle est prête. */
export async function finaliserVideo(postId: number): Promise<Aboutissement> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post || post.videoStatus !== 'pending' || !post.videoProviderId) return 'sans_objet';
  let etat;
  try {
    etat = await etatVideo(post.videoProviderId);
  } catch (err) {
    logger.warn({ postId, err: String(err).slice(0, 200) }, 'état de la vidéo illisible — nouvelle tentative au prochain passage');
    return 'en_cours';
  }
  if (etat.statut === 'pending' || etat.statut === 'processing') return 'en_cours';
  const now = new Date().toISOString();
  if (etat.statut === 'failed' || !etat.videoUrl) {
    const motif = etat.erreur ?? 'HeyGen a renvoyé un échec sans motif';
    db.update(schema.posts)
      .set({ videoStatus: 'failed', videoError: motif.slice(0, 500), updatedAt: now })
      .where(eq(schema.posts.id, postId))
      .run();
    logger.error({ postId, err: motif }, 'fabrication de la vidéo en échec');
    return 'echec';
  }
  try {
    const mp4 = await telechargerVideo(etat.videoUrl);
    const assetId = saveAsset(mp4, 'video', { postId, extraMeta: { provider: 'heygen', providerId: post.videoProviderId, dureeMs: etat.dureeMs } }, undefined, {
      ext: 'mp4',
      mime: 'video/mp4',
    });
    db.update(schema.posts)
      .set({ videoStatus: 'ready', videoAssetId: assetId, videoDurationMs: etat.dureeMs, videoError: null, updatedAt: now })
      .where(eq(schema.posts.id, postId))
      .run();
    logger.info({ postId, assetId, octets: mp4.length, dureeMs: etat.dureeMs }, 'vidéo rapatriée');
    return 'prete';
  } catch (err) {
    const motif = err instanceof Error ? err.message : String(err);
    db.update(schema.posts)
      .set({ videoStatus: 'failed', videoError: `Téléchargement impossible : ${motif}`.slice(0, 500), updatedAt: now })
      .where(eq(schema.posts.id, postId))
      .run();
    logger.error({ postId, err: motif }, 'téléchargement de la vidéo impossible');
    return 'echec';
  }
}

/**
 * Attend la vidéo pendant la fabrication du post, sans bloquer indéfiniment :
 * une vidéo d'une minute sort en général en deux à quatre minutes. Passé le délai,
 * le post reste « en attente » et le passage régulier prend le relais.
 */
export async function attendreVideo(postId: number, opts: { maxMs?: number; pasMs?: number } = {}): Promise<Aboutissement> {
  const maxMs = opts.maxMs ?? 6 * 60_000;
  const pasMs = opts.pasMs ?? 15_000;
  const limite = Date.now() + maxMs;
  for (;;) {
    const issue = await finaliserVideo(postId);
    if (issue !== 'en_cours') return issue;
    if (Date.now() + pasMs > limite) return 'en_cours';
    await sleep(pasMs);
  }
}

/** Les vidéos encore en fabrication (passage régulier). */
export async function suivreVideosEnCours(): Promise<{ suivies: number; pretes: number; echouees: number }> {
  const enCours = db.select().from(schema.posts).where(eq(schema.posts.videoStatus, 'pending')).all();
  const resume = { suivies: enCours.length, pretes: 0, echouees: 0 };
  for (const post of enCours) {
    const issue = await finaliserVideo(post.id);
    if (issue === 'prete') resume.pretes++;
    if (issue === 'echec') resume.echouees++;
  }
  return resume;
}

/** Un post « vidéo » est-il dû, selon le réglage « un post sur N » ? */
export function videoDue(nbPostsExistants: number): boolean {
  const v = getVideo();
  if (!v.enabled || v.everyNPosts <= 0) return false;
  if (!heygenConfigured() || !v.avatarId || !v.voiceId) return false;
  return nbPostsExistants % v.everyNPosts === 0;
}

/** Le CSS du template, utile pour vérifier qu'un fond image reste dans la DA. */
export function couleurDeMarque(): string {
  const custom = getCustomTheme(getDefaultTheme());
  return custom ? buildCustomThemeCss(custom).match(/--accent:\s*([^;]+);/)?.[1]?.trim() ?? '#1613b4' : '#1613b4';
}
