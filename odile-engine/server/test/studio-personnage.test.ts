import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chromaKeyCutout, cutoutStats, fitCutout, removeImageBackground, solidifyAlpha } from '../src/imagegen/cutout.js';
import { buildImagePrompt, CUTOUT_STYLES, IMAGE_STYLES } from '../src/imagegen/prompt.js';
import { buildSlideHtml, renderHtmlToPng } from '../src/render/renderer.js';
import { getBrand } from '../src/db/settingsRepo.js';
import { slideContentSchema } from '@odile/shared';

const BLEU = '#1613b4';

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

  it('le prompt demande un personnage en couleurs, même en réglage monochrome', () => {
    const prompt = buildImagePrompt({
      idea: 'Un artisan débordé par ses devis',
      style: 'personnage',
      monochrome: true,
      palette: { accent: BLEU, bg1: '#040506', bg2: '#080b12', textColor: '#ffffff' },
    });
    expect(prompt).toContain('full natural colours');
    expect(prompt).toContain('visual gag');
    expect(prompt).toContain('Odile');
    expect(prompt).not.toContain('BLACK AND WHITE');
    expect(prompt).not.toContain('MONOCHROME');
  });

  it('avec une image de référence, l’avatar est repris tel quel et la consigne « guide de rendu » ne s’applique pas', () => {
    const prompt = buildImagePrompt({ idea: 'Des devis en retard', style: 'personnage', hasReference: true });
    expect(prompt).toContain('shown in the reference image');
    expect(prompt).not.toContain('NOT its subject');
  });

  it('la porte qualité accepte un personnage coupé en bas, refuse une tête coupée en haut', async () => {
    const perso = await fauxPersonnage();
    expect((await cutoutStats(perso, { personnage: true })).ok).toBe(true);
    expect((await cutoutStats(perso)).ok).toBe(false);
    const teteCoupee = await sharp(perso).extract({ left: 0, top: 300, width: 800, height: 700 }).png().toBuffer();
    expect((await cutoutStats(teteCoupee, { personnage: true })).ok).toBe(false);
  });

  it('durcit le détourage : les restes à demi transparents disparaissent', async () => {
    const brut = await sharp(Buffer.from([10, 10, 10, 60, 10, 10, 10, 150, 10, 10, 10, 230, 10, 10, 10, 255]), { raw: { width: 4, height: 1, channels: 4 } })
      .png()
      .toBuffer();
    const { data } = await sharp(await solidifyAlpha(brut)).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[7]).toBeGreaterThan(60);
    expect(data[7]).toBeLessThan(200);
    expect(data[11]).toBe(255);
    expect(data[15]).toBe(255);
  });

  it('détourage par la couleur du fond : la feuille blanche tenue en main est gardée, le fond et les poches partent', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500">
  <rect width="400" height="500" fill="#7f7f7f"/>
  <ellipse cx="240" cy="520" rx="150" ry="260" fill="#1d4ed8"/>
  <circle cx="240" cy="180" r="90" fill="#e8b08a"/>
  <rect x="40" y="150" width="130" height="170" fill="#f4f4f4"/>
  <circle cx="240" cy="400" r="30" fill="#7f7f7f"/>
</svg>`;
    const out = await chromaKeyCutout(await sharp(Buffer.from(svg)).png().toBuffer());
    expect(out).not.toBeNull();
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;
    expect(alpha(10, 10)).toBe(0); // fond
    expect(alpha(100, 230)).toBe(255); // feuille blanche
    expect(alpha(240, 180)).toBe(255); // visage
    expect(alpha(240, 400)).toBe(0); // poche fermée de la couleur du fond
  });

  it('détourage par la couleur du fond : renonce si le fond n’est pas uni', async () => {
    const bruit = await sharp({ create: { width: 200, height: 250, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 70 } } }).png().toBuffer();
    expect(await chromaKeyCutout(bruit)).toBeNull();
  });

  it('le personnage est posé sur le bord bas de la toile', async () => {
    const toile = await fitCutout(await fauxPersonnage(), 1080, 1350, { bleedBottom: true });
    const { data, info } = await sharp(toile).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1350]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;
    expect(alpha(540, 1348)).toBeGreaterThan(200);
    expect(alpha(5, 5)).toBe(0);
  });
});

describe('template « personnage »', async () => {
  const { templateSchema } = await import('../src/api/routes/apiTemplates.js');
  const { buildCustomThemeCss, slideStyleFor } = await import('../src/render/custom-theme.js');
  // Réglages du template de la marque (disques bleus + grille de points), seul le style d'image change
  const reglages = {
    name: 'template odile personnage', accent: BLEU, secondary: '#525252', bg1: '#06050a', bg2: '#050307', textColor: '#fdfdfd',
    decor: 'disques', decorPosition: 'haut-gauche', backgroundOpacity: 35, grain: true, grainLevel: 25,
    titleWeight: 700, titleScale: 92, titleTracking: -38, titleGradient: 'argent', accentStyle: 'highlight', align: 'center',
    showLogo: true, brandStyle: 'logo', counterStyle: 'pilule', showVerifiedBadge: true, ctaStyle: 'chevron', ctaArrow: 'aucune',
    radius: 'pill', glass: 50, bodyScale: 105, bodyWeight: 500, subtitleScale: 105,
  };
  const theme = (extra: Record<string, unknown>) => {
    const parsed = templateSchema.parse({ ...reglages, ...extra });
    return {
      ...parsed, id: 'perso', createdAt: '', updatedAt: '',
      backgroundAssetId: null, secondary: parsed.secondary ?? null, bgTop: parsed.bgTop ?? null,
      floatAssetId1: null, floatAssetId2: null, floatAssetId3: null, floatAssetId4: null,
      bodyColor: parsed.bodyColor ?? null, titleColor: parsed.titleColor ?? null,
      padTop: parsed.padTop ?? null, padSide: parsed.padSide ?? null, padBottom: parsed.padBottom ?? null,
      badgeColor: parsed.badgeColor ?? null, bulletColor: parsed.bulletColor ?? null, annotationColor: parsed.annotationColor ?? null,
    } as Parameters<typeof buildCustomThemeCss>[0];
  };

  it('garde le fond du template et n’ajoute que la mise en page du personnage', () => {
    const sans = buildCustomThemeCss(theme({ imageStyle: 'objets' }));
    const avec = buildCustomThemeCss(theme({ imageStyle: 'personnage' }));
    expect(sans).not.toContain('.slide.hero-contain.hero-place-centre .hero-image');
    expect(avec).toContain('.slide.hero-contain.hero-place-centre .hero-image');
    expect(avec).toContain('backdrop-filter: blur(34px)');
    expect(avec).toContain('.slide.hero-contain.hero-place-centre .brand-top');
    // Tout le reste (fond, décor, typographie) est identique
    expect(avec.startsWith(sans.trimEnd())).toBe(true);
  });

  // Aperçu visuel à la demande : PREVIEW_DIR=/chemin npx vitest run test/studio-personnage.test.ts
  it.runIf(Boolean(process.env.PREVIEW_DIR))('aperçu', async () => {
    const dir = process.env.PREVIEW_DIR!;
    const persoPath = process.env.PREVIEW_HERO;
    const source = persoPath ? fs.readFileSync(persoPath) : null;
    const brut = source ? ((await chromaKeyCutout(source)) ?? (await solidifyAlpha(await removeImageBackground(source)))) : await fauxPersonnage();
    const hero = await fitCutout(brut, 1080, 1350, { bleedBottom: true });
    const t = theme({ imageStyle: 'personnage' });
    const css = buildCustomThemeCss(t);
    const slides = [
      slideContentSchema.parse({ kind: 'hook', title: 'Ton graphiste facture 200€ ce visuel ?', accentWord: '200€', annotation: 'ChatGPT change la donne' }),
      slideContentSchema.parse({ kind: 'content', title: 'Répondez dans l’heure', accentWord: 'l’heure', bullets: ['Un client rappelle le premier qui répond', 'Un message type prêt à partir', 'Une relance à J+2, pas avant'] }),
    ];
    for (const [i, content] of slides.entries()) {
      const avecHero = i === 0;
      const perSlide = slideStyleFor(t, avecHero ? { heroPlacement: 'centre' } : {}, content.kind);
      const html = buildSlideHtml({
        theme: 'custom-perso', kind: content.kind, format: 'carousel', brand: getBrand(),
        slideNum: i + 1, slideTotal: 5, content, themeCssOverride: css,
        heroDataUri: avecHero ? `data:image/png;base64,${hero.toString('base64')}` : null, heroContain: avecHero,
        slideClasses: perSlide.classes, slideStyle: perSlide.style, brandStyle: perSlide.brandStyle, authorOn: perSlide.authorOn,
      });
      if (process.env.PREVIEW_HTML) fs.writeFileSync(path.join(dir, `studio-${i + 1}.html`), html);
      fs.writeFileSync(path.join(dir, `studio-${i + 1}.png`), await renderHtmlToPng(html, { width: 1080, height: 1350 }));
    }
  }, 120_000);
});
