import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-cover-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('couverture d’article', async () => {
  const { coverHtml, COVER_SIZES, tailleCouverture } = await import('../src/blog/cover.js');

  /**
   * Les quatre retraits de la zone de texte, lus dans le CSS produit. La feuille de
   * base définit déjà `.safe` : c'est la dernière règle qui gagne, donc celle de la
   * mise en page de couverture.
   */
  const zone = (html: string) => {
    const blocs = [...html.matchAll(/\.safe \{[^}]*\}/g)].map((m) => m[0]).filter((b) => b.includes('left:'));
    const bloc = blocs.at(-1) ?? '';
    const px = (nom: string) => Number(new RegExp(`${nom}: (-?\\d+)px`).exec(bloc)?.[1] ?? NaN);
    return { gauche: px('left'), droite: px('right'), haut: px('top'), bas: px('bottom') };
  };
  const piedBas = (html: string) => {
    const blocs = [...html.matchAll(/\.brand-footer \{[^}]*\}/g)].map((m) => m[0]).filter((b) => b.includes('bottom:'));
    return Number(/bottom: (-?\d+)px/.exec(blocs.at(-1) ?? '')?.[1] ?? NaN);
  };

  it('propose un canevas par format, du panoramique au carré', () => {
    expect(Object.keys(COVER_SIZES)).toEqual(['16:9', '1.91:1', '3:2', '4:3', '1:1']);
    for (const [ratio, taille] of Object.entries(COVER_SIZES)) {
      expect(tailleCouverture(ratio as keyof typeof COVER_SIZES)).toEqual(taille);
      expect(taille.width).toBeGreaterThanOrEqual(1080);
    }
    // Les proportions annoncées sont bien celles du canevas.
    expect(COVER_SIZES['16:9'].width / COVER_SIZES['16:9'].height).toBeCloseTo(16 / 9, 2);
    expect(COVER_SIZES['1:1'].width).toBe(COVER_SIZES['1:1'].height);
  });

  it('garde le texte dans la zone que même un recadrage ne peut pas atteindre', () => {
    for (const ratio of Object.keys(COVER_SIZES) as (keyof typeof COVER_SIZES)[]) {
      const { width, height } = tailleCouverture(ratio);
      const html = coverHtml({ title: 'Un titre de couverture assez long pour tenir sur trois lignes', accentWord: 'titre', kicker: 'Toulouse', ratio });
      const z = zone(html);
      const largeurTexte = width - z.gauche - z.droite;
      const hauteurTexte = height - z.haut - z.bas;
      // Jamais plus large que le carré centré (le recadrage le plus étroit)…
      expect(largeurTexte).toBeLessThanOrEqual(Math.min(width, height));
      // … ni plus haut que la bande 4:3 (le recadrage le plus bas).
      expect(hauteurTexte).toBeLessThanOrEqual(Math.min(height, Math.round((width * 3) / 4)));
      // Centrée, à un pixel d'arrondi près.
      expect(Math.abs(z.gauche - z.droite)).toBeLessThanOrEqual(1);
      expect(Math.abs(z.haut - z.bas)).toBeLessThanOrEqual(1);
      // Le logo reste lui aussi dans la zone sûre.
      expect(piedBas(html)).toBeGreaterThanOrEqual(z.bas);
    }
  });

  it('sans zone sûre, le texte reprend toute la largeur utile', () => {
    const { width } = tailleCouverture('16:9');
    const z = zone(coverHtml({ title: 'Un titre', accentWord: '', ratio: '16:9', zoneSure: false }));
    expect(width - z.gauche - z.droite).toBeGreaterThan(width * 0.85);
  });

  it('l’image peut ne porter que la mention, ou rien du tout', () => {
    const complet = coverHtml({ title: 'Automatiser ses devis', accentWord: 'devis', kicker: 'Toulouse', ratio: '16:9' });
    expect(complet).toContain('class="title"');
    expect(complet).toContain('TOULOUSE'.toLowerCase() === '' ? '' : 'Toulouse');

    const mention = coverHtml({ title: 'Automatiser ses devis', accentWord: 'devis', kicker: 'Toulouse', ratio: '16:9', texte: 'mention' });
    expect(mention).not.toContain('class="title"');
    expect(mention).toContain('Toulouse');

    const muet = coverHtml({ title: 'Automatiser ses devis', accentWord: 'devis', kicker: 'Toulouse', ratio: '16:9', texte: 'aucun' });
    expect(muet).not.toContain('class="title"');
    expect(muet).not.toContain('Automatiser ses devis');
    // Le template reste le même : décor, logo et couleurs de la marque.
    expect(muet).toContain('decor-1');
    expect(muet).toContain('brand-footer');
  });
});
