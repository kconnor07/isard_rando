import { desc, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getCadence, getPublishSlots } from '../db/settingsRepo.js';
import { nextSlotOccurrence } from '../lib/time.js';

/**
 * Faut-il générer un brouillon aujourd'hui ?
 * - jamais si un brouillon attend déjà une validation (on ne spamme pas l'humain) ;
 * - oui si aucun post « vivant » n'a été créé depuis `cadence.days` jours.
 */
export function shouldDraftToday(now = new Date()): { due: boolean; reason: string } {
  const pendingStates = ['draft', 'reviewing', 'awaiting_approval'] as const;
  const pending = db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(inArray(schema.posts.status, [...pendingStates]))
    .all();
  if (pending.length > 0) {
    return { due: false, reason: `${pending.length} post(s) déjà en attente de validation` };
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
