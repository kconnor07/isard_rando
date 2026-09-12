import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { acceptPopColor, autoPopColor, extractPopColor, resolvePopColor } from '../src/imagegen/color.js';
import { cutoutStats } from '../src/imagegen/cutout.js';
import { buildImagePrompt, CUTOUT_BACKGROUND, styleGuide } from '../src/imagegen/prompt.js';
import { floatCss, floatsOnSlide } from '../src/render/floats.js';
import { iconSvg, ICON_IDS } from '../src/render/icons.js';
import { buildBodyHtml, buildSubtitleHtml } from '../src/render/renderer.js';

describe('couleur signature', () => {
  it('choisit une complémentaire éditoriale selon la teinte de l’accent', () => {
    expect(autoPopColor('#0099ff')).toBe('#d9ee4a'); // bleu → jaune-vert
    expect(autoPopColor('#a78bfa')).toBe('#ffb02e'); // violet → ambre
    expect(autoPopColor('#ff7a1a')).toBe('#3ef2ff'); // orange → cyan
    expect(autoPopColor('#ffffff')).toBe('#d9ee4a'); // neutre → jaune-vert
  });
  it('respecte le réglage du template', () => {
    expect(resolvePopColor('aucune', '#0099ff')).toBeNull();
    expect(resolvePopColor('auto', '#0099ff')).toBe('#d9ee4a');
    expect(resolvePopColor('#ff3fa4', '#0099ff')).toBe('#ff3fa4');
    expect(resolvePopColor('pas-une-couleur', '#0099ff')).toBe('#d9ee4a');
  });
  it('extrait la teinte vive dominante hors palette', async () => {
    // Ciel bleu nuit + une cape jaune-vert (12 % de l’image)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="250">
      <rect width="200" height="250" fill="#0a2a66"/>
      <rect x="70" y="60" width="60" height="100" fill="#d4e34a"/>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const pop = await extractPopColor(png, { exclude: ['#0099ff', '#0a2a66'] });
    expect(pop).toMatch(/^#[0-9a-f]{6}$/);
    // teinte jaune-vert : beaucoup de rouge et de vert, peu de bleu
    const n = Number.parseInt(pop!.slice(1), 16);
    expect((n >> 16) & 255).toBeGreaterThan(150);
    expect((n >> 8) & 255).toBeGreaterThan(150);
    expect(n & 255).toBeLessThan(120);
  });
  it('ne renvoie rien sur une image sans couleur vive', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0a2a66"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    expect(await extractPopColor(png, { exclude: ['#0a2a66'] })).toBeNull();
  });
});

describe('prompts', () => {
  it('les objets à détourer sont générés sur gris neutre, jamais sur le fond du template', () => {
    const p = { bg1: '#06050a', bg2: '#0d0716', accent: '#a78bfa', textColor: '#fdfdfd' };
    expect(styleGuide('objets', p)).toContain(CUTOUT_BACKGROUND);
    expect(styleGuide('chrome', p)).toContain(CUTOUT_BACKGROUND);
    expect(styleGuide('objets', p)).not.toContain('solid #06050a');
  });
  it('le plein cadre impose une couleur signature unique quand elle est demandée', () => {
    const prompt = buildImagePrompt({ idea: 'un homme de dos devant la Terre', style: 'full', theme: 'odile-nuit', popColor: '#d9ee4a' });
    expect(prompt).toContain('SIGNATURE COLOUR');
    expect(prompt).toContain('#d9ee4a');
    expect(prompt).toContain('25–40 %');
  });
  it('une série reprend la matière du premier objet', () => {
    const prompt = buildImagePrompt({ idea: 'un jeton frappé d’une coche', style: 'objets', theme: 'odile-nuit', hasReference: true, seriesOf: 'Jetons devis' });
    expect(prompt).toContain('SAME SERIES');
    expect(prompt).toContain('Jetons devis');
  });
});

describe('détourage : porte qualité', () => {
  const canvas = (inner: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="250">${inner}</svg>`)).png().toBuffer();
  it('accepte un objet entier de taille raisonnable', async () => {
    const stats = await cutoutStats(await canvas('<circle cx="100" cy="125" r="60" fill="#fff"/>'));
    expect(stats.ok).toBe(true);
    expect(stats.touchesEdge).toBe(false);
  });
  it('refuse un objet rogné par le bord ou trop petit', async () => {
    expect((await cutoutStats(await canvas('<rect x="120" y="0" width="80" height="120" fill="#fff"/>'))).touchesEdge).toBe(true);
    expect((await cutoutStats(await canvas('<circle cx="100" cy="125" r="8" fill="#fff"/>'))).ok).toBe(false);
  });
});

describe('objets flottants', () => {
  it('pose jusqu’à quatre objets, qui débordent ou restent dans le cadre', () => {
    const uris: (string | null)[] = ['data:a', 'data:b', 'data:c', 'data:d'];
    const bleed = floatCss({ uris, size: 30, layout: '4-coins', bleed: true, tilt: 14 });
    expect(bleed).toContain('.floats-on .float-4 {');
    // débordement proportionnel à l'objet (324 px de large → 78 px dehors), pas au canevas
    expect(bleed).toContain('left: -78px');
    expect(bleed).toContain('top: -65px');
    expect(bleed).toContain('rotate(-14deg)');
    const inside = floatCss({ uris, size: 30, layout: '4-coins', bleed: false, tilt: 0 });
    expect(inside).toContain('left: 6%');
    expect(inside).not.toContain('-78px');
    expect(floatCss({ uris: ['data:a', null], size: 30, layout: 'coins' })).not.toContain('.float-2');
  });
  it('les objets vont sur les slides centrées par défaut, pas sur le contenu aligné à gauche', () => {
    expect(floatsOnSlide('hook')).toBe(true);
    expect(floatsOnSlide('value_prop')).toBe(true);
    expect(floatsOnSlide('content')).toBe(false);
    expect(floatsOnSlide('content', 'toutes')).toBe(true);
    expect(floatsOnSlide('cta', 'accroche')).toBe(false);
  });
});

describe('couleur signature retenue', () => {
  it('garde la couleur détectée si elle est de la même famille, sinon la demandée', () => {
    expect(acceptPopColor('#c4d900', '#d9ee4a')).toBe('#c4d900');
    expect(acceptPopColor('#ff7a1a', '#d9ee4a')).toBe('#d9ee4a');
    expect(acceptPopColor('#ff7a1a', null)).toBeNull();
    expect(acceptPopColor(null, '#d9ee4a')).toBe('#d9ee4a');
  });
});

describe('primitives de rendu', () => {
  it('sous-titre sur deux tons, avec ou sans séparateur', () => {
    expect(buildSubtitleHtml('le tueur silencieux des | conversions')).toBe('<span class="tone-1">le tueur silencieux des</span><span class="tone-2">conversions</span>');
    expect(buildSubtitleHtml('des devis signés plus vite')).toContain('<span class="tone-2">vite</span>');
    expect(buildSubtitleHtml('')).toBe('');
  });
  it('corps de texte : gras balisé, HTML échappé', () => {
    expect(buildBodyHtml('des TPE perdent **faute de réponse.** <b>')).toBe('des TPE perdent <strong>faute de réponse.</strong> &lt;b&gt;');
  });
  it('catalogue d’icônes : SVG inline pour chaque identifiant, rien pour un inconnu', () => {
    expect(ICON_IDS.length).toBeGreaterThanOrEqual(20);
    for (const id of ICON_IDS) expect(iconSvg(id)).toContain('<svg');
    expect(iconSvg('licorne')).toBeNull();
  });
});

describe('rédacteur : archétype et image d’accroche', async () => {
  const { normalizeArchetype, writerResponseSchema } = await import('../src/writer/generate.js');
  const post = {
    hook: 'x', caption: 'x', hashtags: ['#ia'], cta: 'x', screenshotUrl: null,
    slides: [{ kind: 'hook', title: 'Titre', imageIdea: 'Un chronomètre en verre suspendu dans une brume légère' }],
  };
  it('normalise le libellé ou la casse vers l’id exact', () => {
    expect(normalizeArchetype('Objet 3D suspendu + halo')).toBe('objet_halo');
    expect(normalizeArchetype('OBJET_HALO')).toBe('objet_halo');
    expect(normalizeArchetype('scene epique')).toBe('scene_epique');
    expect(normalizeArchetype('inconnu')).toBe('inconnu');
  });
  it('refuse une réponse sans archétype ou sans idée d’image sur l’accroche quand les images sont activées', () => {
    expect(writerResponseSchema(1).safeParse({ ...post, archetype: 'objet_halo' }).success).toBe(true);
    expect(writerResponseSchema(1).safeParse({ ...post }).success).toBe(false);
    expect(writerResponseSchema(1).safeParse({ ...post, archetype: 'objet_halo', slides: [{ kind: 'hook', title: 'Titre' }] }).success).toBe(false);
    expect(writerResponseSchema(0).safeParse({ ...post, archetype: 'typo_stickers', slides: [{ kind: 'hook', title: 'Titre' }] }).success).toBe(true);
  });
});

describe('pied de marque', async () => {
  const { brandBlockHtml, brandInitials, resolveBrandStyle } = await import('../src/render/brand.js');
  it('déduit les initiales du nom, ou prend celles du réglage', () => {
    expect(brandInitials({ name: 'Odile AI' })).toBe('OA');
    expect(brandInitials({ name: 'Odile AI', initials: 'od' })).toBe('OD');
    expect(brandInitials({ name: 'Menuiserie Dupont Fils', initials: '' })).toBe('MD');
  });
  it('auto suit le réglage de la marque ; sans logo on retombe sur les initiales', () => {
    expect(resolveBrandStyle('auto', { footerStyle: 'initiales' }, { hasLogo: true, authorOn: false })).toBe('initiales');
    expect(resolveBrandStyle('auto', { footerStyle: 'logo' }, { hasLogo: true, authorOn: false })).toBe('logo');
    expect(resolveBrandStyle('logo', { footerStyle: 'initiales' }, { hasLogo: false, authorOn: false })).toBe('initiales');
    expect(resolveBrandStyle('aucun', { footerStyle: 'logo' }, { hasLogo: true, authorOn: false })).toBe('aucun');
  });
  it('évite le doublon nom + handle quand la chip auteur est affichée', () => {
    expect(resolveBrandStyle('initiales', {}, { hasLogo: true, authorOn: true })).toBe('logo');
    expect(resolveBrandStyle('initiales', {}, { hasLogo: false, authorOn: true })).toBe('marque');
    expect(resolveBrandStyle('logo-nom', {}, { hasLogo: true, authorOn: true })).toBe('logo');
  });
  it('produit le bloc « OA · Odile AI · @odileai » ou le logo seul', () => {
    const brand = { name: 'Odile AI', handle: '@odileai' };
    const initiales = brandBlockHtml('initiales', brand, 'data:image/png;base64,x');
    expect(initiales).toContain('class="brand-mark">OA<');
    expect(initiales).toContain('class="brand-handle">@odileai<');
    expect(brandBlockHtml('logo', brand, 'data:image/png;base64,x')).toMatch(/^<img class="brand-wordmark"/);
    expect(brandBlockHtml('logo-nom', brand, 'data:image/png;base64,x')).toContain('class="brand-logo"');
    expect(brandBlockHtml('aucun', brand, 'data:image/png;base64,x')).toBe('');
    expect(brandBlockHtml('initiales', { name: 'A <b>', handle: '"q"' }, null)).not.toContain('<b>');
  });
});

describe('personnalisation fine des templates', async () => {
  const { templateSchema } = await import('../src/api/routes/apiTemplates.js');
  const { buildCustomThemeCss } = await import('../src/render/custom-theme.js');
  const base = { name: 'test', accent: '#0099ff', bg1: '#050508', bg2: '#0a1024', textColor: '#fdfdfd', decor: 'orbes', backgroundOpacity: 35, grain: true };
  const theme = (extra: Record<string, unknown>) => {
    const parsed = templateSchema.parse({ ...base, ...extra });
    return {
      ...parsed, id: 't', createdAt: '', updatedAt: '',
      backgroundAssetId: null, secondary: parsed.secondary ?? null, bgTop: parsed.bgTop ?? null,
      floatAssetId1: null, floatAssetId2: null, floatAssetId3: null, floatAssetId4: null,
      bodyColor: parsed.bodyColor ?? null, titleColor: parsed.titleColor ?? null,
      padTop: parsed.padTop ?? null, padSide: parsed.padSide ?? null, padBottom: parsed.padBottom ?? null,
      badgeColor: parsed.badgeColor ?? null, bulletColor: parsed.bulletColor ?? null, annotationColor: parsed.annotationColor ?? null,
    } as Parameters<typeof buildCustomThemeCss>[0];
  };
  it('les valeurs par défaut reproduisent le rendu d’origine', () => {
    const css = buildCustomThemeCss(theme({}));
    expect(css).toContain('.stack { gap: 36px; }');
    expect(css).toContain('.safe { justify-content: center; }');
    expect(css).toContain('.safe { padding: 104px 96px 150px; }');
    expect(css).toContain('.body { font-family: \'Inter\', system-ui, sans-serif; font-size: 42px; font-weight: 500; line-height: 1.4;');
    expect(css).toContain(".bullets li::before { content: '→'; color: #0099ff; }");
    expect(css).not.toContain('scale:');
  });
  it('traduit chaque réglage en CSS borné', () => {
    const css = buildCustomThemeCss(theme({
      bodyScale: 120, bodyWeight: 700, bodyOpacity: 60, bodyColor: '#ffcc00', lineHeight: 'aere', titleTracking: 10, titleColor: '#ff00ff',
      blockGap: 12, verticalAlign: 'bas', padTop: 200, padSide: 60, padBottom: 300, badgeStyle: 'plein', badgeColor: '#ffffff',
      bulletGlyph: 'numero', ctaSize: 80, logoSize: 150, footerInset: 120, footerBottom: 40, decorScale: 120, bgTop: '#b9a8ec', bgTopSpread: 30, heroScrim: 40,
    }));
    expect(css).toContain('.stack { gap: 12px; }');
    expect(css).toContain('.safe { justify-content: flex-end; }');
    expect(css).toContain('.safe { padding: 200px 60px 300px; }');
    expect(css).toContain('letter-spacing: 0.010em; color: #ff00ff;');
    expect(css).toContain('font-size: 50px; font-weight: 700; line-height: 1.56; color: rgba(255, 204, 0, 0.6)');
    expect(css).toContain('.badge { background: #ffffff; border-color: transparent; color: #0b0b0e;');
    expect(css).toContain('counter(puce, decimal-leading-zero)');
    expect(css).toContain('.cta-button { font-size: 37px; padding: 27px 51px; }');
    expect(css).toContain('.brand-wordmark { height: 111px; }');
    expect(css).toContain('.brand-footer { left: 120px; right: 120px; bottom: 40px; }');
    expect(css).toContain('.decor-1, .decor-2 { scale: 1.20; }');
    expect(css).toContain('#b9a8ec 0%, #050508 30%');
    expect(css).toContain('.hero-scrim { opacity: 0.40; }');
  });
  it('refuse les valeurs hors bornes', () => {
    expect(templateSchema.safeParse({ ...base, blockGap: 500 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, bodyColor: 'rouge' }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, padTop: 10 }).success).toBe(false);
  });
});
