import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_DEFAULTS, RENDER_SIZES, brandSettingsSchema } from '@odile/shared';
import { buildSlideHtml } from '../src/render/renderer.js';
import { TEMPLATES_DIR } from '../src/render/themes.js';

const brand = brandSettingsSchema.parse({ ...BRAND_DEFAULTS, logoAssetId: null, avatarAssetId: null, authorLine: '' });
const slide = (format: 'reel' | 'carousel') =>
  buildSlideHtml({
    theme: 'odile-nuit',
    kind: 'hook',
    content: { kind: 'hook', title: 'Odile, c’est quoi ?', accentWord: 'quoi', body: 'En 35 secondes.' },
    format,
    brand,
    slideNum: 1,
    slideTotal: 1,
    heroDataUri: 'data:image/png;base64,iVBORw0KGgo=',
  });

/** Carré central d'une couverture 9:16 : ce que la grille du profil Instagram garde (1:1 hier, 3:4 aujourd'hui). */
const carre = (() => {
  const { width, height } = RENDER_SIZES.reel;
  return { haut: (height - width) / 2, bas: height - (height - width) / 2 };
})();

describe('couverture de Reel lisible dans la grille du profil', () => {
  it('la slide porte la classe de son format', () => {
    expect(slide('reel')).toMatch(/class="slide[^"]*\bformat-reel\b/);
    expect(slide('carousel')).toMatch(/class="slide[^"]*\bformat-carousel\b/);
    // (la feuille de style inlinée cite « .format-reel » : on ne regarde que les classes de la slide)
    expect(slide('carousel')).not.toMatch(/class="slide[^"]*\bformat-reel\b/);
  });
  it('les marges du Reel gardent le bloc de texte dans le carré central, avec ou sans illustration', () => {
    const css = fs.readFileSync(path.join(TEMPLATES_DIR, 'base.css'), 'utf8');
    const px = (re: RegExp) => {
      const m = css.match(re);
      expect(m, re.source).not.toBeNull();
      return Number(m![1]);
    };
    const haut = px(/\.format-reel \.safe \{[^}]*padding-top: (\d+)px/);
    const bas = px(/\.format-reel \.safe \{[^}]*padding-bottom: (\d+)px/);
    const basHero = px(/\.format-reel\.has-hero \.safe \{[^}]*padding-bottom: (\d+)px/);
    const { height } = RENDER_SIZES.reel;
    expect(haut).toBeGreaterThanOrEqual(carre.haut);
    expect(height - bas).toBeLessThanOrEqual(carre.bas);
    expect(height - basHero).toBeLessThanOrEqual(carre.bas);
    // et il reste de la place pour un titre de deux lignes + un corps
    expect(height - haut - basHero).toBeGreaterThanOrEqual(900);
  });
});
