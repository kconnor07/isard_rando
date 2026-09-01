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
});
