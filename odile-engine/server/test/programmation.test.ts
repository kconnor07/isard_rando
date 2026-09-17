import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-prog-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('créneaux de publication', async () => {
  const { nextSlotOccurrence, parisParts } = await import('../src/lib/time.js');

  /** Le créneau tombe-t-il bien le bon jour, à la bonne heure, heure de Paris ? */
  const verifier = (slot: { dow: number; time: string }, apres: Date) => {
    const d = nextSlotOccurrence(slot, apres);
    const p = parisParts(d);
    const [hh, mm] = slot.time.split(':').map(Number);
    expect(p.dow).toBe(slot.dow);
    expect(p.hh).toBe(hh);
    expect(p.mm).toBe(mm);
    expect(d.getTime()).toBeGreaterThan(apres.getTime());
    // Et jamais plus d'une semaine plus tard
    expect(d.getTime() - apres.getTime()).toBeLessThanOrEqual(7 * 86400000 + 3600000);
    return d;
  };

  it('trouve un créneau aligné sur le quart d’heure', () => {
    verifier({ dow: 2, time: '09:30' }, new Date('2026-09-14T08:00:00Z'));
  });

  it('trouve AUSSI un créneau qui ne tombe pas sur un quart d’heure', () => {
    // L'ancien balayage avançait de 15 min en 15 min : 9 h 07 n'était jamais
    // atteint et la publication glissait de 48 h, sans que rien ne le signale.
    verifier({ dow: 4, time: '09:07' }, new Date('2026-09-14T08:00:00Z'));
    verifier({ dow: 0, time: '18:43' }, new Date('2026-09-14T08:00:00Z'));
  });

  it('passe à la semaine suivante quand l’heure du jour est déjà passée', () => {
    const lundi9h = new Date('2026-09-14T09:00:00Z'); // lundi, 11 h à Paris
    const d = verifier({ dow: 1, time: '08:00' }, lundi9h);
    expect(d.getTime() - lundi9h.getTime()).toBeGreaterThan(6 * 86400000);
  });

  it('reste juste de part et d’autre du changement d’heure', () => {
    // Dernier dimanche d'octobre 2026 : Paris repasse en UTC+1.
    verifier({ dow: 1, time: '09:00' }, new Date('2026-10-24T12:00:00Z'));
    // Dernier dimanche de mars 2026 : passage à UTC+2.
    verifier({ dow: 1, time: '09:00' }, new Date('2026-03-27T12:00:00Z'));
  });

  it('les semaines suivantes sont bien espacées de sept jours', () => {
    const apres = new Date('2026-09-14T08:00:00Z');
    const s = { dow: 3, time: '17:45' };
    const s0 = nextSlotOccurrence(s, apres, 0);
    const s1 = nextSlotOccurrence(s, apres, 1);
    expect(Math.round((s1.getTime() - s0.getTime()) / 86400000)).toBe(7);
    expect(parisParts(s1).hh).toBe(17);
    expect(parisParts(s1).mm).toBe(45);
  });
});

describe('programmation des posts', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { schedulePost, unschedulePost } = await import('../src/approvals/service.js');
  const { eq } = await import('drizzle-orm');

  const creer = (args: { platform: 'linkedin' | 'instagram'; channel: string; cle: string | null; hook: string }) =>
    db
      .insert(schema.posts)
      .values({
        platform: args.platform,
        channel: args.channel as 'li_personal',
        liAccountKey: args.cle,
        format: args.platform === 'linkedin' ? 'li_image' : 'carousel',
        theme: 'custom:t',
        status: 'awaiting_approval',
        hook: args.hook,
        caption: 'texte',
        cta: 'Commente GUIDE',
        hashtags: '[]',
      })
      .returning()
      .get();

  const dans = (heures: number) => new Date(Date.now() + heures * 3600000).toISOString();
  let moi1 = 0;

  beforeAll(() => {
    moi1 = creer({ platform: 'linkedin', channel: 'li_personal', cle: 'moi', hook: 'Premier post de Moi' }).id;
    expect(schedulePost(moi1, dans(48)).ok).toBe(true);
  });

  it('le même compte ne peut pas publier deux fois dans la même demi-heure', () => {
    const autre = creer({ platform: 'linkedin', channel: 'li_personal', cle: 'moi', hook: 'Second post de Moi' });
    const memeInstant = db.select().from(schema.posts).where(eq(schema.posts.id, moi1)).get()!.scheduledAt!;
    const refus = schedulePost(autre.id, memeInstant);
    expect(refus.ok).toBe(false);
    expect(refus.message).toContain('Premier post de Moi');
    // À dix minutes près, c'est toujours non.
    expect(schedulePost(autre.id, new Date(new Date(memeInstant).getTime() + 10 * 60000).toISOString()).ok).toBe(false);
    // Deux heures plus tard, c'est oui.
    expect(schedulePost(autre.id, new Date(new Date(memeInstant).getTime() + 2 * 3600000).toISOString()).ok).toBe(true);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, autre.id)).get()!.status).toBe('scheduled');
  });

  it('deux comptes différents peuvent partir à la même minute', () => {
    const alexis = creer({ platform: 'linkedin', channel: 'li_personal', cle: 'alexis', hook: 'Post d’Alexis' });
    const insta = creer({ platform: 'instagram', channel: 'ig', cle: null, hook: 'Post Instagram' });
    const memeInstant = db.select().from(schema.posts).where(eq(schema.posts.id, moi1)).get()!.scheduledAt!;
    expect(schedulePost(alexis.id, memeInstant).ok).toBe(true);
    expect(schedulePost(insta.id, memeInstant).ok).toBe(true);
  });

  it('les dates impossibles sont refusées avec une phrase claire', () => {
    const p = creer({ platform: 'instagram', channel: 'ig', cle: null, hook: 'Post à programmer' });
    expect(schedulePost(p.id, new Date(Date.now() - 3600000).toISOString()).message).toContain('passée');
    expect(schedulePost(p.id, 'pas une date').message).toContain('invalide');
    expect(schedulePost(999999, dans(24)).message).toContain('introuvable');
  });

  it('déprogrammer annule le job et ramène le post en attente', () => {
    const p = creer({ platform: 'instagram', channel: 'ig', cle: null, hook: 'Post à déprogrammer' });
    expect(schedulePost(p.id, dans(72)).ok).toBe(true);
    expect(unschedulePost(p.id).ok).toBe(true);
    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, p.id)).get()!;
    expect(relu.status).toBe('awaiting_approval');
    expect(relu.scheduledAt).toBeNull();
    const jobs = db.select().from(schema.publishJobs).where(eq(schema.publishJobs.postId, p.id)).all();
    expect(jobs.every((j) => j.state === 'canceled')).toBe(true);
  });
});
