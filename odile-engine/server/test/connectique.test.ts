import { describe, expect, it } from 'vitest';

/**
 * Connectique, programmation, analytics : fonctions pures (aucune base, aucun réseau).
 */
describe('commentaire LinkedIn', async () => {
  const { commentary } = await import('../src/publishers/linkedin.js');
  it('échappe les caractères réservés du « little text » mais garde les hashtags cliquables', () => {
    expect(commentary('Devis (express) #IA #PME')).toBe('Devis \\(express\\) #IA #PME');
    expect(commentary('a | b {c} @d [e] <f> *g* _h_ ~i~ \\j')).toBe('a \\| b \\{c\\} \\@d \\[e\\] \\<f\\> \\*g\\* \\_h\\_ \\~i\\~ \\\\j');
  });
  it('respecte la limite de 3 000 caractères', () => {
    expect(commentary('x'.repeat(5000)).length).toBeLessThanOrEqual(3000);
  });
});

describe('clics : robots et aperçus de liens', async () => {
  const { isBotUserAgent } = await import('../src/api/routes/public.js');
  it('reconnaît les crawlers des réseaux sociaux et les outils', () => {
    expect(isBotUserAgent('LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
  });
  it('laisse passer les navigateurs', () => {
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBe(false);
  });
});

describe('créneaux en heure de Paris', async () => {
  const { parisLocalToUtc, parisParts, slotOccurrencesBetween } = await import('../src/lib/time.js');
  it('convertit une heure locale en instant UTC, été comme hiver', () => {
    expect(parisLocalToUtc('2026-07-15', 18, 30).toISOString()).toBe('2026-07-15T16:30:00.000Z'); // UTC+2
    expect(parisLocalToUtc('2026-01-15', 18, 30).toISOString()).toBe('2026-01-15T17:30:00.000Z'); // UTC+1
  });
  it('liste toutes les occurrences d’un créneau hebdomadaire dans une fenêtre', () => {
    const from = new Date('2026-09-14T00:00:00Z'); // lundi
    const to = new Date('2026-10-11T22:00:00Z');
    const jeudi = slotOccurrencesBetween({ dow: 4, time: '18:30' }, from, to);
    expect(jeudi).toHaveLength(4);
    for (const d of jeudi) {
      const p = parisParts(d);
      expect(p.dow).toBe(4);
      expect(p.hh).toBe(18);
      expect(p.mm).toBe(30);
    }
    expect(jeudi[0]!.toISOString()).toBe('2026-09-17T16:30:00.000Z');
  });
  it('n’invente rien hors fenêtre', () => {
    const from = new Date('2026-09-17T17:00:00Z'); // après le créneau de 18:30 Paris (16:30Z) ce jeudi
    const to = new Date('2026-09-20T00:00:00Z');
    expect(slotOccurrencesBetween({ dow: 4, time: '18:30' }, from, to)).toHaveLength(0);
  });
});

describe('score de performance', async () => {
  const { performanceScore } = await import('../src/publishers/metrics.js');
  it('vaut les clics seuls sans relevé, et pondère les interactions sinon', () => {
    expect(performanceScore(3, null)).toBe(3);
    expect(
      performanceScore(3, { reach: 100, impressions: null, likes: 10, comments: 2, shares: 1, saves: 4, engagement: 17, partial: [], raw: null }),
    ).toBe(3 + 5 + 4 + 8 + 3);
  });
});

describe('alertes de connexion', async () => {
  const { daysLeft } = await import('../src/publishers/refresh.js');
  it('mesure les jours restants et reconnaît un jeton sans expiration', () => {
    const now = Date.parse('2026-09-12T00:00:00Z');
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft('2026-09-22T00:00:00Z', now)).toBeCloseTo(10, 5);
    expect(daysLeft('2026-09-11T00:00:00Z', now)).toBeCloseTo(-1, 5);
  });
});
