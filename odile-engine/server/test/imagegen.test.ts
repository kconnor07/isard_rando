import { describe, expect, it } from 'vitest';
import { buildImagePrompt, STYLE_GUIDE } from '../src/imagegen/prompt.js';

describe('buildImagePrompt', () => {
  it('contient la palette, l’interdiction de texte et le concept', () => {
    const prompt = buildImagePrompt({
      idea: 'Un chronomètre en verre suspendu dans un halo bleu',
      archetypeId: 'objet_halo',
    });
    expect(prompt).toContain('#0099FF');
    expect(prompt).toContain('#050510');
    expect(prompt.toLowerCase()).toContain('forbidden');
    expect(prompt).toContain('chronomètre');
    expect(prompt).toContain('halo');
  });

  it('intègre le guide de composition de l’archétype et les notes de style', () => {
    const prompt = buildImagePrompt({
      idea: 'Une main et une flèche lumineuse',
      archetypeId: 'geste_lumiere',
      styleNotes: 'ambiance très minimaliste',
      instructions: 'moins de brume',
    });
    expect(prompt).toContain('light trail');
    expect(prompt).toContain('minimaliste');
    expect(prompt).toContain('moins de brume');
  });

  it('interdit explicitement les tons chauds', () => {
    expect(STYLE_GUIDE.toLowerCase()).toMatch(/orange/);
    expect(STYLE_GUIDE.toLowerCase()).toMatch(/no text|any text/);
  });

  it('un template maison impose sa palette à la place du bleu Odile', () => {
    const prompt = buildImagePrompt({
      idea: 'Un rouage en verre',
      theme: 'custom:ambre-studio',
      palette: { bg1: '#0a0a0a', bg2: '#2a1000', accent: '#ff8a00', textColor: '#fdfdfd' },
    });
    expect(prompt).toContain('#ff8a00');
    expect(prompt).toContain('#0a0a0a');
    expect(prompt).not.toContain('#0099FF');
    expect(prompt.toLowerCase()).toContain('forbidden');
    expect(prompt.toLowerCase()).toContain('any text');
  });

  it('un template clair (texte sombre) demande une lumière douce et des bords clairs', () => {
    const prompt = buildImagePrompt({
      idea: 'Une plume',
      palette: { bg1: '#f6f4ef', bg2: '#e9e4d8', accent: '#1d4ed8', textColor: '#0b0b0e' },
    });
    expect(prompt).toContain('high-key');
    expect(prompt).toContain('into #f6f4ef');
  });

  it('papier-blanc obtient une illustration monochrome claire', () => {
    const prompt = buildImagePrompt({ idea: 'Une plume', theme: 'papier-blanc' });
    expect(prompt).toContain('#f4f4f6');
    expect(prompt).not.toContain('#0099FF');
  });
});
