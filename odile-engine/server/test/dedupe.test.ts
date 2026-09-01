import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, contentHash, titleSimilarity } from '../src/scraper/dedupe.js';

describe('canonicalizeUrl', () => {
  it('supprime les paramètres de tracking et normalise', () => {
    expect(
      canonicalizeUrl('http://www.Example.com/article/?utm_source=x&utm_medium=y&id=3&fbclid=abc'),
    ).toBe('https://example.com/article?id=3');
  });
  it('supprime le fragment et le slash final', () => {
    expect(canonicalizeUrl('https://site.fr/page/#section')).toBe('https://site.fr/page');
  });
  it('produit le même hash pour deux variantes de la même URL', () => {
    const a = contentHash(canonicalizeUrl('https://www.site.fr/a?utm_campaign=z'));
    const b = contentHash(canonicalizeUrl('http://site.fr/a/'));
    expect(a).toBe(b);
  });
});

describe('titleSimilarity', () => {
  it('détecte les titres quasi identiques', () => {
    const s = titleSimilarity(
      "OpenAI lance un nouvel outil d'automatisation pour les PME",
      "OpenAI lance un nouvel outil d'automatisation destiné aux PME",
    );
    expect(s).toBeGreaterThan(0.7);
  });
  it('distingue des sujets différents', () => {
    const s = titleSimilarity(
      'OpenAI lance un nouvel outil pour les PME',
      'La fusée Ariane 6 décolle de Kourou avec succès',
    );
    expect(s).toBeLessThan(0.2);
  });
});
