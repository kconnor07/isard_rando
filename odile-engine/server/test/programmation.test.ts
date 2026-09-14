import { describe, expect, it } from 'vitest';

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
