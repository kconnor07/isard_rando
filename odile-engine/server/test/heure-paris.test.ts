import { describe, expect, it } from 'vitest';

/**
 * Le calendrier du dashboard découpe ses journées à l'heure de Paris, pas à celle
 * du navigateur. Ces fonctions vivent côté web ; elles sont testées ici, avec le
 * reste du moteur, parce qu'une erreur de fuseau se paie en publications décalées.
 */
describe('heure de Paris (calendrier)', async () => {
  const { parisYmd, parisHm, parisToUtc, ymdPlus, ymdDow, lundiDe, periode, pourChampLocal, depuisChampLocal } = await import(
    '../../web/src/lib/paris.js'
  );

  it('découpe les jours à l’heure de Paris, pas en UTC', () => {
    // 23 h 30 UTC le 16 septembre = 1 h 30 le 17 à Paris (heure d'été).
    expect(parisYmd('2026-09-16T23:30:00.000Z')).toBe('2026-09-17');
    expect(parisHm('2026-09-16T23:30:00.000Z')).toBe('01:30');
    // En hiver, une heure d'écart seulement.
    expect(parisYmd('2026-01-16T23:30:00.000Z')).toBe('2026-01-17');
    expect(parisHm('2026-01-16T23:30:00.000Z')).toBe('00:30');
  });

  it('convertit une heure murale de Paris en instant réel, été comme hiver', () => {
    expect(parisToUtc('2026-07-14', 9, 0).toISOString()).toBe('2026-07-14T07:00:00.000Z');
    expect(parisToUtc('2026-12-14', 9, 0).toISOString()).toBe('2026-12-14T08:00:00.000Z');
    // Aller-retour : ce qui est saisi dans le champ ressort identique.
    const champ = '2026-10-25T02:30';
    expect(pourChampLocal(depuisChampLocal(champ))).toBe(champ);
  });

  it('compte les jours sans se faire piéger par le changement d’heure', () => {
    // Le 25 octobre 2026, la nuit dure 25 h : +1 jour doit rester +1 jour.
    expect(ymdPlus('2026-10-24', 1)).toBe('2026-10-25');
    expect(ymdPlus('2026-10-25', 1)).toBe('2026-10-26');
    expect(ymdPlus('2026-03-28', 1)).toBe('2026-03-29');
    expect(ymdPlus('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('place les jours dans la semaine et nomme la période', () => {
    expect(ymdDow('2026-09-17')).toBe(3); // jeudi
    expect(lundiDe('2026-09-17')).toBe('2026-09-14');
    expect(lundiDe('2026-09-14')).toBe('2026-09-14');
    expect(periode('2026-09-14', '2026-10-11')).toBe('14 sept. — 11 oct. 2026');
    expect(periode('2026-12-28', '2027-01-24')).toBe('28 déc. 2026 — 24 janv. 2027');
  });
});
