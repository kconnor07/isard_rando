import { desc, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { compteDuPost } from '../publishers/linkedinAccounts.js';
import { getCadence, getPublishSlots } from '../db/settingsRepo.js';
import { nextSlotOccurrence } from '../lib/time.js';

/**
 * Faut-il générer un brouillon aujourd'hui ?
 * - jamais si un brouillon attend déjà une validation (on ne spamme pas l'humain) ;
 * - oui si aucun post « vivant » n'a été créé depuis `cadence.days` jours.
 */
const PENDING_STATES = ['draft', 'reviewing', 'awaiting_approval'] as const;

/**
 * Ce qui attend une décision : les sujets, pas les lignes en base.
 *
 * Un post diffusé sur quatre comptes fait quatre lignes et une seule validation.
 * Compter les lignes gonflait le badge (« 44 à valider » pour onze sujets) et
 * faisait croire à un retard qui n'existait pas.
 */
export function sujetsEnAttente(): { sujets: number; posts: number } {
  const pending = db
    .select({ id: schema.posts.id, groupe: schema.posts.broadcastGroup })
    .from(schema.posts)
    .where(inArray(schema.posts.status, [...PENDING_STATES]))
    .all();
  return { sujets: new Set(pending.map((p) => p.groupe ?? `post-${p.id}`)).size, posts: pending.length };
}

export function shouldDraftToday(now = new Date()): { due: boolean; reason: string } {
  const attente = sujetsEnAttente();
  if (attente.posts > 0) {
    const copies = attente.posts > attente.sujets ? ` (${attente.posts} posts, copies comprises)` : '';
    return { due: false, reason: `${attente.sujets} sujet(s) déjà en attente de validation${copies}` };
  }

  const cadence = getCadence();
  const lastActive = db
    .select()
    .from(schema.posts)
    .where(inArray(schema.posts.status, ['approved', 'scheduled', 'publishing', 'published']))
    .orderBy(desc(schema.posts.createdAt))
    .limit(1)
    .get();
  if (!lastActive) return { due: true, reason: 'Aucun post existant' };

  const ageMs = now.getTime() - new Date(lastActive.createdAt).getTime();
  const limitMs = cadence.days * 24 * 3600 * 1000;
  return ageMs >= limitMs
    ? { due: true, reason: `Dernier post il y a ${(ageMs / 86400000).toFixed(1)} j (cadence ${cadence.days} j)` }
    : { due: false, reason: `Dernier post trop récent (${(ageMs / 86400000).toFixed(1)} j < ${cadence.days} j)` };
}

/** La surface qui publiera : un profil ou une page LinkedIn (par sa clé), ou Instagram. */
export interface SurfaceDeCreneau {
  platform: 'linkedin' | 'instagram';
  /** li_personal | li_org | ig — la page et les profils ne partagent pas leurs créneaux */
  channel?: string | null;
  liAccountKey?: string | null;
}

/** Clé de comparaison de deux surfaces : Instagram d'un côté, chaque compte LinkedIn (profil ou page) de l'autre. */
export function cleDeSurface(s: SurfaceDeCreneau): string {
  if (s.platform !== 'linkedin') return 'ig';
  const channel = s.channel ?? 'li_personal';
  return `${channel}:${compteDuPost({ channel, liAccountKey: s.liAccountKey ?? null })?.key ?? s.liAccountKey ?? ''}`;
}

/**
 * Prochain créneau de publication libre (lead time 2 h min).
 *
 * Les créneaux appartiennent à chaque compte, pas à la plateforme : un mardi 8 h 30
 * pris par Khaled reste libre pour Alexis et pour la page — chacun a sa cadence, et
 * une diffusion sur trois comptes ne s'étale plus sur deux semaines. Sans surface
 * (anciens appels), tout job en attente compte comme pris.
 */
export function nextPublishSlot(platform: 'linkedin' | 'instagram', now = new Date(), surface?: SurfaceDeCreneau): Date {
  const slots = getPublishSlots();
  const list = platform === 'instagram' ? slots.ig : slots.li;
  const after = new Date(now.getTime() + 2 * 3600 * 1000);
  if (list.length === 0) return after;

  const taken = surface ? creneauxPrisPar(surface) : creneauxPrisTous();
  // Deux posts trop proches sur un même compte se volent la portée : le second
  // coupe la diffusion du premier avant qu'il ait circulé (sur LinkedIn, un post
  // vit 48 à 72 h). Sans surface (anciens appels), seule la même demi-heure compte.
  const ecart = surface ? ecartMinimal(surface.platform) : 30 * 60 * 1000;

  // On explore quatre semaines de créneaux, pas seulement la première : si tous les
  // créneaux de la semaine sont pris, la publication doit glisser au prochain créneau
  // LIBRE, pas sept jours après le premier (ce qui sautait des créneaux disponibles).
  const candidates = Array.from({ length: 4 }, (_, semaine) => list.map((slot) => nextSlotOccurrence(slot, after, semaine)))
    .flat()
    .sort((a, b) => a.getTime() - b.getTime());
  for (const c of candidates) {
    const clash = taken.some((t) => Math.abs(t - c.getTime()) < ecart);
    if (!clash) return c;
  }
  return candidates[candidates.length - 1] ?? after;
}

/**
 * L'écart minimal entre deux posts d'un même compte : 20 h sur LinkedIn (au-delà
 * d'un post par jour, chaque post perd une part de sa portée — rapport van der
 * Blom 2026), 12 h sur Instagram.
 */
export function ecartMinimal(platform: 'linkedin' | 'instagram'): number {
  return (platform === 'linkedin' ? 20 : 12) * 3600 * 1000;
}

/**
 * Le post du même compte qui tombe trop près de celui-ci (programmé, en cours ou
 * déjà paru), ou null. Sert à l'écran de validation : un glisser-déposer dans le
 * calendrier peut rapprocher deux posts que l'allocation aurait espacés.
 */
export function voisinTropProche(post: {
  id: number;
  platform: string;
  channel: string;
  liAccountKey: string | null;
  scheduledAt: string | null;
}): { id: number; quand: string } | null {
  if (!post.scheduledAt) return null;
  const platform = post.platform === 'instagram' ? 'instagram' : 'linkedin';
  const cle = cleDeSurface({ platform, channel: post.channel, liAccountKey: post.liAccountKey });
  const t0 = new Date(post.scheduledAt).getTime();
  const ecart = ecartMinimal(platform);
  const voisins = db
    .select({ id: schema.posts.id, platform: schema.posts.platform, channel: schema.posts.channel, liAccountKey: schema.posts.liAccountKey, scheduledAt: schema.posts.scheduledAt, publishedAt: schema.posts.publishedAt })
    .from(schema.posts)
    .where(inArray(schema.posts.status, ['scheduled', 'publishing', 'published']))
    .all();
  for (const v of voisins) {
    if (v.id === post.id) continue;
    const quand = v.publishedAt ?? v.scheduledAt;
    if (!quand || Math.abs(new Date(quand).getTime() - t0) >= ecart) continue;
    if (cleDeSurface({ platform: v.platform as 'linkedin' | 'instagram', channel: v.channel, liAccountKey: v.liAccountKey }) !== cle) continue;
    return { id: v.id, quand };
  }
  return null;
}

function creneauxPrisTous(): number[] {
  return db
    .select({ scheduledAt: schema.publishJobs.scheduledAt })
    .from(schema.publishJobs)
    .where(inArray(schema.publishJobs.state, ['pending', 'running']))
    .all()
    .map((j) => new Date(j.scheduledAt).getTime());
}

/** Les heures déjà prises par cette surface : posts programmés, en cours, ou parus ces derniers jours. */
function creneauxPrisPar(surface: SurfaceDeCreneau): number[] {
  const cle = cleDeSurface(surface);
  return db
    .select({ platform: schema.posts.platform, channel: schema.posts.channel, liAccountKey: schema.posts.liAccountKey, scheduledAt: schema.posts.scheduledAt, publishedAt: schema.posts.publishedAt, status: schema.posts.status })
    .from(schema.posts)
    .where(inArray(schema.posts.status, ['scheduled', 'publishing', 'published']))
    .all()
    .filter((p) => (p.status === 'published' ? p.publishedAt : p.scheduledAt) && cleDeSurface({ platform: p.platform as 'linkedin' | 'instagram', channel: p.channel, liAccountKey: p.liAccountKey }) === cle)
    .map((p) => new Date((p.status === 'published' ? p.publishedAt : p.scheduledAt)!).getTime());
}
