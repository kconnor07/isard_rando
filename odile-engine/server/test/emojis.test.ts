import { describe, expect, it } from 'vitest';

describe('émojis hors des visuels', async () => {
  const { stripEmoji, hasEmoji } = await import('../src/render/emoji.js');

  it('retire l’émoji et l’espace qui le précède', () => {
    expect(stripEmoji('Ce que ça change 🚀')).toBe('Ce que ça change');
  });
  it('préserve les séparateurs entre segments', () => {
    expect(stripEmoji('Devis signé ✅ · Relance ⏱️ · CRM 📊')).toBe('Devis signé · Relance · CRM');
  });
  it('gère les séquences composées : familles, drapeaux, teintes', () => {
    expect(stripEmoji('👨‍👩‍👧‍👦 Famille, 🇫🇷 France, 👍🏽 pouce')).toBe('Famille, France, pouce');
  });
  it('ne touche pas un texte sans émoji, accents et fine insécable compris', () => {
    const texte = 'Devis Express : signé ? Oui — en 3 minutes.';
    expect(stripEmoji(texte)).toBe(texte);
    expect(hasEmoji(texte)).toBe(false);
  });
  it('un texte réduit à un émoji devient vide plutôt qu’un espace', () => {
    expect(stripEmoji('✅')).toBe('');
  });
});

describe('réglage de marque', async () => {
  const { buildSlideHtml } = await import('../src/render/renderer.js');
  const { getBrand } = await import('../src/db/settingsRepo.js');
  const content = { kind: 'content' as const, title: 'Résultat 🚀', bullets: ['Devis signé ✅'] };

  it('par défaut les visuels sortent sans émoji', () => {
    const html = buildSlideHtml({ theme: 'odile-nuit', kind: 'content', content, format: 'carousel', brand: getBrand(), slideNum: 1, slideTotal: 1 });
    expect(html).toContain('Résultat');
    expect(html).not.toContain('🚀');
    expect(html).not.toContain('✅');
  });
  it('« systeme » les conserve pour qui les veut dans l’image', () => {
    const brand = { ...getBrand(), emojiStyle: 'systeme' as const };
    const html = buildSlideHtml({ theme: 'odile-nuit', kind: 'content', content, format: 'carousel', brand, slideNum: 1, slideTotal: 1 });
    expect(html).toContain('🚀');
  });
});
