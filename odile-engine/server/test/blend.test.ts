import { describe, expect, it } from 'vitest';
import { blendScore, freshnessFactor, topicAffinityFactor } from '../src/scorer/blend.js';
import { normalizeEngagement } from '../src/scraper/engagement.js';

const NOW = new Date('2026-09-01T12:00:00Z');

describe('freshnessFactor', () => {
  it('donne un bonus « à chaud » avant 6 h, puis 1.0 jusqu’à 12 h', () => {
    expect(freshnessFactor('2026-09-01T08:00:00Z', NOW)).toBe(1.1);
    expect(freshnessFactor('2026-09-01T02:00:00Z', NOW)).toBe(1.0);
  });
  it('descend à 0.75 à 48 h et à 0.6 après quatre jours', () => {
    expect(freshnessFactor('2026-08-30T12:00:00Z', NOW)).toBe(0.75);
    expect(freshnessFactor('2026-08-28T12:00:00Z', NOW)).toBe(0.6);
    expect(freshnessFactor('2026-08-20T12:00:00Z', NOW)).toBe(0.6);
  });
  it('interpole entre les deux', () => {
    const f = freshnessFactor('2026-08-31T06:00:00Z', NOW); // 30 h
    expect(f).toBeGreaterThan(0.75);
    expect(f).toBeLessThan(1.0);
    const g = freshnessFactor('2026-08-29T12:00:00Z', NOW); // 72 h
    expect(g).toBeGreaterThan(0.6);
    expect(g).toBeLessThan(0.75);
  });
  it('reste raisonnable sans date', () => {
    expect(freshnessFactor(null, NOW)).toBe(0.9);
  });
});

describe('topicAffinityFactor', () => {
  it('moyenne les affinités connues et borne le résultat', () => {
    expect(topicAffinityFactor(['chatbot', 'inconnu'], { chatbot: 1.2 })).toBe(1.2);
    expect(topicAffinityFactor(['a', 'b'], { a: 2.0, b: 2.0 })).toBe(1.3);
  });
  it('vaut 1.0 sans données', () => {
    expect(topicAffinityFactor(undefined, undefined)).toBe(1.0);
    expect(topicAffinityFactor(['x'], {})).toBe(1.0);
  });
});

describe('blendScore', () => {
  // Publié il y a 8 h : plein tarif, ni bonus « à chaud » ni décote
  const base = { scoreLLM: 80, sourceWeight: 1, publishedAt: '2026-09-01T04:00:00Z', now: NOW };
  it('score de base = scoreLLM frais sans bonus', () => {
    expect(blendScore(base)).toBe(80);
  });
  it("l'engagement ajoute au plus 15 points", () => {
    expect(blendScore({ ...base, engagement: 100 })).toBe(95);
  });
  it('borne le poids de source à 0.5-2.0', () => {
    expect(blendScore({ ...base, sourceWeight: 10 })).toBe(160);
    expect(blendScore({ ...base, sourceWeight: 0.1 })).toBe(40);
  });
  it('un sujet performant augmente le score', () => {
    const boosted = blendScore({ ...base, topics: ['facturation'], topicAffinity: { facturation: 1.3 } });
    expect(boosted).toBeGreaterThan(blendScore(base));
  });
});

describe('normalizeEngagement', () => {
  it('vaut 0 sans signaux', () => {
    expect(normalizeEngagement({ hnPoints: 0, hnComments: 0, redditScore: 0, redditComments: 0 })).toBe(0);
  });
  it('croît de façon logarithmique et plafonne à 100', () => {
    const low = normalizeEngagement({ hnPoints: 10, hnComments: 0, redditScore: 0, redditComments: 0 });
    const mid = normalizeEngagement({ hnPoints: 300, hnComments: 100, redditScore: 200, redditComments: 50 });
    const cap = normalizeEngagement({ hnPoints: 1e6, hnComments: 0, redditScore: 0, redditComments: 0 });
    expect(low).toBeGreaterThan(20);
    expect(mid).toBeGreaterThan(low);
    expect(cap).toBe(100);
  });
});
