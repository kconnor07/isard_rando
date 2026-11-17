import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { cutoutStats, fitCutout, removeImageBackground, selectiveColor } from '../src/imagegen/cutout.js';
import { buildImagePrompt, CUTOUT_STYLES, IMAGE_STYLES } from '../src/imagegen/prompt.js';
import { buildSlideHtml, renderHtmlToPng } from '../src/render/renderer.js';
import { getBrand } from '../src/db/settingsRepo.js';
import { slideContentSchema } from '@odile/shared';

const BLEU = '#2f7bff';

/** Faux « personnage » : buste gris, peau orangée, lunettes bleues, sur fond transparent, coupé en bas. */
async function fauxPersonnage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
  <ellipse cx="400" cy="1000" rx="330" ry="360" fill="#555b66"/>
  <rect x="330" y="560" width="140" height="160" fill="#c98a5e"/>
  <ellipse cx="400" cy="400" rx="230" ry="260" fill="#d99a6c"/>
  <path d="M170 360 Q400 40 630 360 Q400 250 170 360Z" fill="#2a2420"/>
  <circle cx="310" cy="410" r="86" fill="none" stroke="#1f6bff" stroke-width="22"/>
  <circle cx="500" cy="410" r="86" fill="none" stroke="#1f6bff" stroke-width="22"/>
  <rect x="150" y="760" width="170" height="240" rx="24" fill="#3b82f6"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('style d’image « personnage »', () => {
  it('est un style détouré, proposé au catalogue', () => {
    expect(CUTOUT_STYLES).toContain('personnage');
    expect(IMAGE_STYLES.map((s) => s.id)).toContain('personnage');
  });

  it('le prompt demande un personnage noir et blanc avec la couleur d’accent, même en réglage monochrome', () => {
    const prompt = buildImagePrompt({
      idea: 'Un artisan débordé par ses devis',
      style: 'personnage',
      monochrome: true,
      palette: { accent: BLEU, bg1: '#040506', bg2: '#080b12', textColor: '#ffffff' },
    });
    expect(prompt).toContain('BLACK AND WHITE');
    expect(prompt).toContain(BLEU);
    expect(prompt).not.toContain('MONOCHROME');
  });

  it('la porte qualité accepte un personnage coupé en bas, refuse une tête coupée en haut', async () => {
    const perso = await fauxPersonnage();
    expect((await cutoutStats(perso, { personnage: true })).ok).toBe(true);
    expect((await cutoutStats(perso)).ok).toBe(false);
    const teteCoupee = await sharp(perso).extract({ left: 0, top: 300, width: 800, height: 700 }).png().toBuffer();
    expect((await cutoutStats(teteCoupee, { personnage: true })).ok).toBe(false);
  });

  it('le personnage est posé sur le bord bas de la toile', async () => {
    const toile = await fitCutout(await fauxPersonnage(), 1080, 1350, { bleedBottom: true });
    const { data, info } = await sharp(toile).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1350]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;
    expect(alpha(540, 1348)).toBeGreaterThan(200);
    expect(alpha(5, 5)).toBe(0);
  });

  it('couleur sélective : la peau passe en gris, le bleu reste (ramené à l’accent)', async () => {
    const out = await selectiveColor(await fauxPersonnage(), BLEU);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    const peau = px(400, 560);
    expect(Math.max(...peau) - Math.min(...peau)).toBeLessThan(4);
    const accessoire = px(230, 880);
    expect(accessoire[2]! - accessoire[0]!).toBeGreaterThan(100);
  });
});

describe('décor « studio »', async () => {
  const { templateSchema } = await import('../src/api/routes/apiTemplates.js');
  const { buildCustomThemeCss, slideStyleFor } = await import('../src/render/custom-theme.js');
  const parsed = templateSchema.parse({
    name: 'Studio noir & bleu', accent: BLEU, secondary: '#9fc2ff', bg1: '#040506', bg2: '#080b12', textColor: '#ffffff',
    decor: 'studio', backgroundOpacity: 35, grain: true, grainLevel: 55, titleWeight: 600, titleGradient: 'argent',
    accentStyle: 'plain', align: 'left', showAuthor: false, showLogo: true, brandStyle: 'logo', imageStyle: 'personnage',
    heroPlacement: 'droite', heroGlow: false,
  });
  const theme = {
    ...parsed, id: 'studio', createdAt: '', updatedAt: '',
    backgroundAssetId: null, secondary: parsed.secondary ?? null, bgTop: parsed.bgTop ?? null,
    floatAssetId1: null, floatAssetId2: null, floatAssetId3: null, floatAssetId4: null,
    bodyColor: parsed.bodyColor ?? null, titleColor: parsed.titleColor ?? null,
    padTop: parsed.padTop ?? null, padSide: parsed.padSide ?? null, padBottom: parsed.padBottom ?? null,
    badgeColor: parsed.badgeColor ?? null, bulletColor: parsed.bulletColor ?? null, annotationColor: parsed.annotationColor ?? null,
  } as Parameters<typeof buildCustomThemeCss>[0];

  it('pose la ligne méta, le quadrillage, le flou vers le bas et le mot clé à la couleur d’accent', () => {
    const css = buildCustomThemeCss(theme);
    expect(css).toContain('.slide .meta-top { display: grid; }');
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('backdrop-filter: blur(22px)');
    expect(css).toContain(`-webkit-text-fill-color: ${BLEU}`);
    expect(css).toContain('.slide.hero-contain.hero-place-droite .hero-image');
  });

  it('la slide porte la ligne méta (marque, site, compte)', () => {
    const content = slideContentSchema.parse({ kind: 'hook', title: 'Un titre net', accentWord: 'net' });
    const html = buildSlideHtml({ theme: 'odile-nuit', kind: content.kind, format: 'carousel', brand: getBrand(), slideNum: 1, slideTotal: 5, content });
    expect(html).toContain('class="meta-top"');
    expect(html).toContain('conçu par');
  });

  // Aperçu visuel à la demande : PREVIEW_DIR=/chemin npx vitest run test/studio-personnage.test.ts
  it.runIf(Boolean(process.env.PREVIEW_DIR))('aperçu', async () => {
    const dir = process.env.PREVIEW_DIR!;
    const persoPath = process.env.PREVIEW_HERO;
    const brut = persoPath ? await removeImageBackground(fs.readFileSync(persoPath)) : await fauxPersonnage();
    if (persoPath) console.log('porte qualité', await cutoutStats(brut, { personnage: true }));
    const hero = await selectiveColor(await fitCutout(brut, 1080, 1350, { bleedBottom: true }), BLEU);
    const css = buildCustomThemeCss(theme);
    const slides = [
      slideContentSchema.parse({ kind: 'hook', title: '4 réflexes simples pour un devis signé', accentWord: 'signé' }),
      slideContentSchema.parse({ kind: 'content', title: 'Répondez dans l’heure', accentWord: 'l’heure', bullets: ['Un client rappelle le premier qui répond', 'Un message type prêt à partir', 'Une relance à J+2, pas avant'] }),
    ];
    for (const [i, content] of slides.entries()) {
      const avecHero = i === 0;
      const perSlide = slideStyleFor(theme, {}, content.kind);
      const html = buildSlideHtml({
        theme: 'custom-studio', kind: content.kind, format: 'carousel', brand: { ...getBrand(), name: 'Odile AI', handle: '@odile.ai', authorLine: 'Agence IA pour TPE' },
        slideNum: i + 1, slideTotal: 5, content, themeCssOverride: css,
        heroDataUri: avecHero ? `data:image/png;base64,${hero.toString('base64')}` : null, heroContain: avecHero,
        slideClasses: perSlide.classes, slideStyle: perSlide.style, brandStyle: perSlide.brandStyle, authorOn: perSlide.authorOn,
      });
      fs.writeFileSync(path.join(dir, `studio-${i + 1}.png`), await renderHtmlToPng(html, { width: 1080, height: 1350 }));
    }
  }, 120_000);
});
