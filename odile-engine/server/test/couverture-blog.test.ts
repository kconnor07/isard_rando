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

describe('refaire toutes les couvertures (simulation)', async () => {
  const fs = await import('node:fs');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { refaireLesCouvertures } = await import('../src/blog/couvertures.js');
  const { closeBrowser } = await import('../src/render/browser.js');
  const { eq } = await import('drizzle-orm');

  it('refait les images de tous les articles et n’annonce que les articles en ligne', async () => {
    process.env.PUBLISH_MODE = 'dry';
    setSetting('blog', { enabled: true, everyDays: 7, ville: 'Toulouse', collectionId: 'col-1', fields: { title: 'f1', body: 'f2', cover: 'f3' }, coverRatio: '1:1' });

    const creer = (statut: string, slug: string, itemId: string | null) =>
      db
        .insert(schema.articles)
        .values({
          status: statut as 'published',
          slug,
          title: `Titre de ${slug}`,
          brief: 'brief',
          content: JSON.stringify({ coverTitle: `Couverture ${slug}`, coverAccentWord: 'Couverture' }),
          framerItemId: itemId,
          coverAssetId: 'ancienne-image',
        })
        .returning()
        .get();

    const enLigne = creer('published', 'article-en-ligne', 'item-1');
    const brouillon = creer('awaiting_approval', 'article-en-attente', null);

    const resume = await refaireLesCouvertures();
    expect(resume.refaites).toBe(2);
    // En simulation, rien ne part chez Framer.
    expect(resume.misAJour).toBe(0);
    expect(resume.deploye).toBe(false);

    // Les deux articles ont une image neuve, au format réglé.
    for (const id of [enLigne.id, brouillon.id]) {
      const a = db.select().from(schema.articles).where(eq(schema.articles.id, id)).get()!;
      expect(a.coverAssetId).not.toBe('ancienne-image');
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, a.coverAssetId!)).get()!;
      expect({ width: asset.width, height: asset.height }).toEqual({ width: 1080, height: 1080 });
    }

    // Le payload de simulation ne liste que ce qui serait remplacé en ligne.
    const fichier = fs.readdirSync(config.outboxDir).filter((f) => f.startsWith('blog-couvertures-')).at(-1)!;
    const paye = JSON.parse(fs.readFileSync(`${config.outboxDir}/${fichier}`, 'utf8')) as { format: string; articles: { slug: string; itemId: string | null }[] };
    expect(paye.format).toBe('1:1');
    expect(paye.articles.map((a) => a.slug)).toEqual(['article-en-ligne']);
    expect(paye.articles[0]!.itemId).toBe('item-1');
    await closeBrowser();
  }, 120_000);
});
