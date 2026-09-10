import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { THEMES } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { isLightHex, rgba } from '../lib/color.js';

export type CustomTheme = typeof schema.customThemes.$inferSelect;

/** Préfixe des identifiants de thèmes maison (les intégrés n'en ont pas). */
export const CUSTOM_PREFIX = 'custom:';

export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function customThemeId(slug: string): string {
  return `${CUSTOM_PREFIX}${slug}`;
}

/** Un identifiant de thème est-il utilisable ? (intégré, ou template maison existant) */
export function themeExists(themeId: string): boolean {
  if (isCustomThemeId(themeId)) return getCustomTheme(themeId) !== null;
  return (THEMES as readonly string[]).includes(themeId);
}

export function getCustomTheme(themeId: string): CustomTheme | null {
  if (!isCustomThemeId(themeId)) return null;
  const slug = themeId.slice(CUSTOM_PREFIX.length);
  return db.select().from(schema.customThemes).where(eq(schema.customThemes.id, slug)).get() ?? null;
}

function assetDataUri(assetId: string | null): string | null {
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  return `data:${asset.mime};base64,${fs.readFileSync(asset.path).toString('base64')}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const FONTS: Record<CustomTheme['titleFont'], string> = {
  inter: "'Inter', system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  fragment: "'Fragment Mono', monospace",
};

/** Ancrages des décors selon la position choisie (orbe principal / orbe secondaire / halo). */
const POSITIONS: Record<CustomTheme['decorPosition'], { d1: string; d2: string; halo: string; angles: [number, number] }> = {
  'haut-droite': {
    d1: 'top: -50%; right: -28%;',
    d2: 'bottom: -32%; left: -24%;',
    halo: 'top: -18%; left: 50%; transform: translateX(-50%);',
    angles: [155, 345],
  },
  'haut-gauche': {
    d1: 'top: -50%; left: -28%;',
    d2: 'bottom: -32%; right: -24%;',
    halo: 'top: -18%; left: 50%; transform: translateX(-50%);',
    angles: [205, 25],
  },
  'bas-droite': {
    d1: 'bottom: -50%; right: -28%;',
    d2: 'top: -32%; left: -24%;',
    halo: 'bottom: -18%; left: 50%; transform: translateX(-50%);',
    angles: [25, 205],
  },
  'bas-gauche': {
    d1: 'bottom: -50%; left: -28%;',
    d2: 'top: -32%; right: -24%;',
    halo: 'bottom: -18%; left: 50%; transform: translateX(-50%);',
    angles: [335, 155],
  },
  centre: {
    d1: 'top: 50%; left: 50%; transform: translate(-50%, -50%);',
    d2: 'display: none;',
    halo: 'top: 42%; left: 50%; transform: translate(-50%, -50%);',
    angles: [180, 0],
  },
};

const RADII: Record<CustomTheme['radius'], { pill: string; card: string }> = {
  pill: { pill: '999px', card: '24px' },
  rounded: { pill: '22px', card: '16px' },
  sharp: { pill: '6px', card: '6px' },
};

const PADDINGS: Record<CustomTheme['padding'], string> = {
  serre: '84px 76px 140px',
  normal: '104px 96px 150px',
  aere: '128px 120px 172px',
};

/**
 * CSS d'un template maison, généré à partir de ses paramètres typés (jamais
 * de CSS libre). Même grammaire que les thèmes intégrés : tokens, fond, décor,
 * typographie, matière, illustration.
 */
export function buildCustomThemeCss(theme: CustomTheme): string {
  const light = isLightHex(theme.textColor); // texte clair ⇒ thème sombre
  const veil = light ? '255, 255, 255' : '11, 11, 14';
  const shade = light ? '#000000' : theme.bg2;
  const accent = theme.accent;
  const secondary = theme.secondary ?? theme.accent;
  const bgImage = assetDataUri(theme.backgroundAssetId);
  const opacity = clamp(theme.backgroundOpacity, 0, 100) / 100;
  const glass = clamp(theme.glass, 0, 100) / 50; // 1 = réglage d'origine
  const decorOpacity = clamp(theme.decorIntensity, 0, 100) / 100;
  const titleScale = clamp(theme.titleScale, 60, 140) / 100;
  const vignette = clamp(theme.vignette, 0, 100) / 100;
  const pos = POSITIONS[theme.decorPosition] ?? POSITIONS['haut-droite'];
  const radii = RADII[theme.radius] ?? RADII.pill;
  const grain = theme.grain ? (clamp(theme.grainLevel, 0, 100) / 100) * (light ? 0.55 : 1) : 0;

  // --- Décor -----------------------------------------------------------
  const decor =
    theme.decor === 'orbes'
      ? `
.decor-1 {
  position: absolute; z-index: 2; ${pos.d1}
  width: 1300px; height: 1300px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%,
    ${theme.bg1} 0%, ${theme.bg2} 46%,
    ${rgba(accent, 0.55)} 82%, ${rgba(accent, 0.95)} 94%, ${rgba('#ffffff', 0.9)} 100%);
  box-shadow: 0 0 3px ${rgba('#ffffff', 0.6)}, 0 0 120px ${rgba(accent, 0.35)};
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.d2}
  width: 980px; height: 980px; border-radius: 50%;
  background: radial-gradient(circle at 62% 34%,
    ${theme.bg1} 0%, ${theme.bg2} 52%, ${rgba(accent, 0.4)} 88%, ${rgba(accent, 0.8)} 100%);
  box-shadow: 0 0 90px ${rgba(accent, 0.2)};
}
.decor-3 { position: absolute; inset: 0; z-index: 3;
  background: linear-gradient(172deg, ${rgba('#ffffff', 0.05)} 0%, transparent 32%); }`
      : theme.decor === 'halo'
        ? `
.decor-1 {
  position: absolute; z-index: 2; ${pos.halo}
  width: 1150px; height: 1150px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(accent, 0.5)} 0%, transparent 72%);
  filter: blur(28px);
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.d2}
  width: 820px; height: 820px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(secondary, 0.26)} 0%, transparent 70%);
  filter: blur(34px);
}
.decor-3 { display: none; }`
        : theme.decor === 'degrade'
          ? `
.decor-1 { position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(${pos.angles[0]}deg, ${rgba(accent, 0.34)} 0%, transparent 55%); }
.decor-2 { position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(${pos.angles[1]}deg, ${rgba(secondary, 0.2)} 0%, transparent 48%); }
.decor-3 { display: none; }`
          : `
.decor-1, .decor-2, .decor-3 { display: none; }`;

  // --- Typographie -------------------------------------------------------
  const accentStyle =
    theme.accentStyle === 'plain'
      ? `.title .accent { font-family: inherit; font-style: normal; font-weight: inherit; letter-spacing: inherit; }`
      : theme.accentStyle === 'underline'
        ? `.title .accent { font-family: inherit; font-style: normal; font-weight: inherit; letter-spacing: inherit;
  color: ${theme.textColor}; text-decoration: underline; text-decoration-color: ${accent};
  text-decoration-thickness: 0.07em; text-underline-offset: 0.1em; }`
        : theme.accentStyle === 'highlight'
          ? `.title .accent { font-family: inherit; font-style: normal; font-weight: inherit; letter-spacing: inherit;
  color: ${theme.textColor}; background: ${rgba(accent, 0.32)}; padding: 0 0.1em; border-radius: 0.12em;
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }`
          : '';

  const align =
    theme.align === 'left'
      ? `.safe, .kind-hook .safe, .kind-cta .safe { align-items: flex-start; text-align: left; }
.badge, .kind-hook .badge, .kind-cta .badge { align-self: flex-start; }
.kind-cta .safe > div { align-items: flex-start !important; }
.body { align-self: flex-start !important; }`
      : theme.align === 'center'
        ? `.safe { align-items: center; text-align: center; }
.badge { align-self: center; }
.bullets li { justify-content: center; }`
        : '';

  // --- Image de fond -----------------------------------------------------
  const bgPosition = { centre: 'center', haut: 'center top', bas: 'center bottom' }[theme.bgPosition] ?? 'center';
  const blur = clamp(theme.bgBlur, 0, 60);
  const bgLayer = bgImage
    ? `
/* Image de fond de la bibliothèque */
.bg::after {
  content: ''; position: absolute; inset: ${blur ? `-${blur * 2}px` : '0'}; z-index: 1;
  background-image: url(${bgImage});
  background-size: ${theme.bgFit}; background-position: ${bgPosition}; background-repeat: no-repeat;
  opacity: ${opacity};
  ${blur ? `filter: blur(${blur}px);` : ''}
  ${theme.bgBlend !== 'normal' ? `mix-blend-mode: ${theme.bgBlend};` : ''}
}`
    : '';
  const vignetteLayer = vignette
    ? `
.bg::before {
  content: ''; position: absolute; inset: 0; z-index: 2;
  background: radial-gradient(ellipse 85% 75% at 50% 45%, transparent 38%, ${rgba(shade, vignette)} 100%);
}`
    : '';

  // --- Cadre, pied -------------------------------------------------------
  const frame =
    theme.frame !== 'aucun'
      ? `
.slide::after {
  content: ''; position: absolute; inset: 44px; z-index: 8; pointer-events: none;
  border: 2px solid ${rgba(theme.frame === 'accent' ? accent : theme.textColor, 0.42)};
  border-radius: ${theme.radius === 'sharp' ? '4px' : '30px'};
}`
      : '';
  const footer = `${theme.showLogo ? '' : '.brand-wordmark, .brand-id { display: none; } .brand-footer { justify-content: flex-end; }'}
${theme.showCounter ? '' : '.slide-counter { display: none; }'}`;

  return `/* Template maison « ${theme.name.replace(/\*\//g, '')} » — CSS généré */
:root {
  --accent: ${accent};
  --secondary: ${secondary};
  --text: ${theme.textColor};
  --muted: ${rgba(theme.textColor, 0.66)};
  --glass: rgba(${veil}, ${((light ? 0.05 : 0.07) * glass).toFixed(3)});
  --glass-border: rgba(${veil}, ${((light ? 0.14 : 0.16) * glass).toFixed(3)});
}

.slide { background: ${theme.bg1}; color: ${theme.textColor}; }
.safe { padding: ${PADDINGS[theme.padding] ?? PADDINGS.normal}; }

.bg {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(${clamp(theme.gradientAngle, 0, 360)}deg, ${theme.bg1} 0%, ${theme.bg2} 100%);
}${bgLayer}${vignetteLayer}
${decor}
.decor-1, .decor-2, .decor-3 { opacity: ${decorOpacity}; }

/* Typographie */
.title {
  color: ${theme.textColor};
  font-family: ${FONTS[theme.titleFont] ?? FONTS.inter};
  font-weight: ${clamp(theme.titleWeight, 400, 900)};
  font-size: ${Math.round(104 * titleScale)}px;
  ${theme.titleCase === 'upper' ? 'text-transform: uppercase; letter-spacing: 0.01em;' : ''}
}
.kind-content .title, .kind-screenshot .title { font-size: ${Math.round(88 * titleScale)}px; }
${accentStyle}
${align}
.body, .bullets li { color: ${rgba(theme.textColor, 0.72)}; }
.annotation { color: ${rgba(theme.textColor, 0.9)}; }
.big-number { background: linear-gradient(135deg, ${theme.textColor} 10%, ${secondary} 90%); -webkit-background-clip: text; background-clip: text; }

/* Matière */
.badge, .keyword-chip, .cta-button, .slide-counter { border-radius: ${radii.pill}; }
.notif-card, .browser-frame { border-radius: ${radii.card}; }
.keyword-chip { background: rgba(${veil}, ${(0.09 * glass).toFixed(3)}); border-color: rgba(${veil}, ${(0.2 * glass).toFixed(3)}); }
${frame}
${footer}
${
  light
    ? ''
    : `
/* Texte sombre : le verre et le logo s'inversent pour rester lisibles */
.brand-wordmark { filter: invert(1); }
.keyword-chip { box-shadow: inset 0 1.5px 0 rgba(255, 255, 255, 0.5), 0 24px 60px -28px rgba(11, 11, 14, 0.3); }
.notif-card { background: rgba(255, 255, 255, 0.85); border-color: rgba(11, 11, 14, 0.1); }
.notif-title { color: #0b0b0e; }
.notif-body { color: rgba(11, 11, 14, 0.65); }
.hero-grade { background: none; }`
}

/* Illustration : la vignette fond les bords dans le fond du template, et le
   voile (mix-blend-mode color) la teinte à l'accent — comme le bleu des
   thèmes intégrés — pour une image toujours harmonisée avec la palette. */
.hero-scrim {
  background:
    radial-gradient(115% 100% at 50% 36%, ${rgba(theme.bg1, 0)} ${light ? '52%' : '46%'}, ${rgba(theme.bg1, light ? 0.9 : 0.94)} 100%),
    linear-gradient(180deg,
      ${rgba(theme.bg1, 0.18)} 0%,
      ${rgba(theme.bg1, 0.05)} 30%,
      ${rgba(theme.bg1, 0.55)} 62%,
      ${rgba(theme.bg1, 0.92)} 100%);
}
${
  light
    ? `.hero-grade {
  background: linear-gradient(160deg,
    ${rgba(accent, 0.5)} 0%,
    ${rgba(theme.bg2, 0.55)} 55%,
    ${rgba(accent, 0.45)} 100%);
}`
    : ''
}
.grain { opacity: ${grain.toFixed(3)}; ${light ? '' : 'mix-blend-mode: multiply;'} }
`;
}
