import { desc, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
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

/**
 * Prochain créneau de publication libre pour une plateforme (lead time 2 h min).
 */
export function nextPublishSlot(platform: 'linkedin' | 'instagram', now = new Date()): Date {
  const slots = getPublishSlots();
  const list = platform === 'instagram' ? slots.ig : slots.li;
  const after = new Date(now.getTime() + 2 * 3600 * 1000);
  if (list.length === 0) return after;

  const taken = db
    .select({ scheduledAt: schema.publishJobs.scheduledAt })
    .from(schema.publishJobs)
    .where(inArray(schema.publishJobs.state, ['pending', 'running']))
    .all()
    .map((j) => new Date(j.scheduledAt).getTime());

  // On explore quatre semaines de créneaux, pas seulement la première : si tous les
  // créneaux de la semaine sont pris, la publication doit glisser au prochain créneau
  // LIBRE, pas sept jours après le premier (ce qui sautait des créneaux disponibles).
  const candidates = Array.from({ length: 4 }, (_, semaine) => list.map((slot) => nextSlotOccurrence(slot, after, semaine)))
    .flat()
    .sort((a, b) => a.getTime() - b.getTime());
  for (const c of candidates) {
    const clash = taken.some((t) => Math.abs(t - c.getTime()) < 30 * 60 * 1000);
    if (!clash) return c;
  }
  return candidates[candidates.length - 1] ?? after;
}
