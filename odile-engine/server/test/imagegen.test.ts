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

  it('interdit toute teinte hors palette et tout texte', () => {
    expect(STYLE_GUIDE.toLowerCase()).toMatch(/hue outside the palette/);
    expect(STYLE_GUIDE.toLowerCase()).toMatch(/no text|any text/);
  });

  it('chaque style produit un guide distinct dans la palette', () => {
    const palette = { bg1: '#0b0616', bg2: '#1a0b33', accent: '#a78bfa', textColor: '#fdfdfd' };
    const full = buildImagePrompt({ idea: 'x', palette, style: 'full' });
    const objets = buildImagePrompt({ idea: 'x', palette, style: 'objets' });
    const chrome = buildImagePrompt({ idea: 'x', palette, style: 'chrome' });
    expect(full).toContain('full-frame');
    expect(objets).toContain('made to be cut out');
    expect(objets).toContain('solid #0b0616');
    expect(chrome).toContain('liquid chrome');
    for (const p of [full, objets, chrome]) expect(p).toContain('#a78bfa');
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
