import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { THEMES } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { isLightHex, rgba } from '../lib/color.js';
import { CENTERED_KINDS, floatCss } from './floats.js';
import type { VisualOverrides } from './renderer.js';
import type { TemplateBrandStyle } from './brand.js';

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

/** Disques nets (décor « disques ») : ancrages en px, canevas 1080×1350 ; les arcs sont concentriques. */
const DISC_SIZE = 1180;
const ARC_GROW = 190;
type DiscAnchor = { top?: number; bottom?: number; left?: number; right?: number };
const DISC_POS: Record<CustomTheme['decorPosition'], [DiscAnchor, DiscAnchor | null]> = {
  'haut-droite': [{ top: -760, right: -560 }, { bottom: -700, left: -560 }],
  'haut-gauche': [{ top: -760, left: -560 }, { bottom: -700, right: -560 }],
  'bas-droite': [{ bottom: -760, right: -560 }, { top: -700, left: -560 }],
  'bas-gauche': [{ bottom: -760, left: -560 }, { top: -700, right: -560 }],
  centre: [{ top: -980, left: -50 }, null],
};
/** Lame de verre du décor « verre » : au coin opposé au grand orbe */
const BLADE_POS: Record<CustomTheme['decorPosition'], string> = {
  'haut-droite': 'right: -42%; bottom: -30%;',
  'haut-gauche': 'left: -42%; bottom: -30%; transform: rotate(14deg);',
  'bas-droite': 'right: -42%; top: -30%;',
  'bas-gauche': 'left: -42%; top: -30%; transform: rotate(14deg);',
  centre: 'right: -46%; bottom: -34%;',
};
/** Bulles de verre liquide : grande bulle, bulle secondaire, capsule (partiellement dans le cadre). */
const LIQUID_POS: Record<CustomTheme['decorPosition'], { d1: string; d2: string; d3: string }> = {
  'haut-droite': { d1: 'top: -18%; right: -26%;', d2: 'bottom: -14%; left: -22%;', d3: 'top: 57%; right: -8%; transform: rotate(-26deg);' },
  'haut-gauche': { d1: 'top: -18%; left: -26%;', d2: 'bottom: -14%; right: -22%;', d3: 'top: 57%; left: -8%; transform: rotate(26deg);' },
  'bas-droite': { d1: 'bottom: -18%; right: -26%;', d2: 'top: -14%; left: -22%;', d3: 'top: 14%; right: -8%; transform: rotate(-26deg);' },
  'bas-gauche': { d1: 'bottom: -18%; left: -26%;', d2: 'top: -14%; right: -22%;', d3: 'top: 14%; left: -8%; transform: rotate(26deg);' },
  centre: { d1: 'top: 50%; left: 50%; transform: translate(-50%, -52%);', d2: 'display: none;', d3: 'bottom: -6%; right: -10%; transform: rotate(-22deg);' },
};
/** Centre (px, canevas 1080×1350) du disque des décors « éclipse » / « rayons » selon la position. */
const DISC_CENTER: Record<CustomTheme['decorPosition'], { x: number; y: number }> = {
  'haut-droite': { x: 1090, y: -110 },
  'haut-gauche': { x: -10, y: -110 },
  'bas-droite': { x: 1090, y: 1460 },
  'bas-gauche': { x: -10, y: 1460 },
  centre: { x: 540, y: 1720 },
};
/** Cœur du soleil « rayons » : sur le bord du cadre, entre la marque et le compteur, jamais sous le texte. */
const SUN_CENTER: Record<CustomTheme['decorPosition'], { x: number; y: number }> = {
  'haut-droite': { x: 700, y: -60 },
  'haut-gauche': { x: 380, y: -60 },
  'bas-droite': { x: 700, y: 1400 },
  'bas-gauche': { x: 380, y: 1400 },
  centre: { x: 540, y: 1400 },
};
/** Centre de la sphère du décor « orbite » (dans le cadre, hors de la zone de texte centrale). */
const SPHERE_CENTER: Record<CustomTheme['decorPosition'], { x: number; y: number }> = {
  'haut-droite': { x: 880, y: 230 },
  'haut-gauche': { x: 200, y: 230 },
  'bas-droite': { x: 880, y: 1070 },
  'bas-gauche': { x: 200, y: 1070 },
  centre: { x: 540, y: 250 },
};
/** Origine (%) des courbes de niveau du décor « vagues ». */
const WAVE_ORIGIN: Record<CustomTheme['decorPosition'], { x: number; y: number }> = {
  'haut-droite': { x: 92, y: -8 },
  'haut-gauche': { x: 8, y: -8 },
  'bas-droite': { x: 92, y: 108 },
  'bas-gauche': { x: 8, y: 108 },
  centre: { x: 50, y: 112 },
};
/** Inclinaison et décalage vertical du faisceau « prisme ». */
const BEAM: Record<CustomTheme['decorPosition'], { angle: number; dy: number }> = {
  'haut-droite': { angle: -32, dy: -280 },
  'haut-gauche': { angle: 32, dy: -280 },
  'bas-droite': { angle: 32, dy: 300 },
  'bas-gauche': { angle: -32, dy: 300 },
  centre: { angle: -22, dy: 0 },
};
/** Bloc « position + taille » d'un élément centré en (x, y). */
function centered(c: { x: number; y: number }, size: number): string {
  return `left: ${c.x - size / 2}px; top: ${c.y - size / 2}px; width: ${size}px; height: ${size}px;`;
}
/** Points sur une orbite elliptique inclinée (rayon a, aplatissement k, rotation θ), en px. */
function orbitPoints(c: { x: number; y: number }, a: number, k: number, theta: number, ts: number[]): { x: number; y: number }[] {
  const th = (theta * Math.PI) / 180;
  return ts.map((t) => {
    const ex = a * Math.cos(t), ey = a * k * Math.sin(t);
    return { x: Math.round(c.x + ex * Math.cos(th) - ey * Math.sin(th)), y: Math.round(c.y + ex * Math.sin(th) + ey * Math.cos(th)) };
  });
}
const COLUMN_X: Record<CustomTheme['decorPosition'], number> = { 'haut-droite': 60, 'haut-gauche': 40, 'bas-droite': 60, 'bas-gauche': 40, centre: 50 };
const COLUMN_Y: Record<CustomTheme['decorPosition'], number> = { 'haut-droite': 38, 'haut-gauche': 38, 'bas-droite': 62, 'bas-gauche': 62, centre: 48 };
/** Mélange linéaire de deux hex (t = part de b). */
function mix(a: string, b: string, t: number): string {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const c = (i: number) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t);
  return `#${[0, 2, 4].map((i) => c(i).toString(16).padStart(2, '0')).join('')}`;
}
function discCss(a: DiscAnchor, grow = 0): string {
  return (Object.entries(a) as [string, number][]).map(([k, v]) => `${k}: ${v - grow}px;`).join(' ');
}

const RADII: Record<CustomTheme['radius'], { pill: string; card: string }> = {
  pill: { pill: '999px', card: '24px' },
  rounded: { pill: '22px', card: '16px' },
  sharp: { pill: '6px', card: '6px' },
};

const LINE_HEIGHTS: Record<CustomTheme['lineHeight'], { title: string; body: string; bullets: string }> = {
  serre: { title: '0.96', body: '1.26', bullets: '1.2' },
  normal: { title: '1.04', body: '1.4', bullets: '1.32' },
  aere: { title: '1.14', body: '1.56', bullets: '1.46' },
};
const BULLET_GLYPHS: Record<CustomTheme['bulletGlyph'], string> = { fleche: '→', point: '•', coche: '✓', numero: '', tiret: '—' };
const ANNOTATION_FONTS: Record<CustomTheme['annotationFont'], string> = {
  caveat: "'Caveat', cursive",
  inter: "'Inter', system-ui, sans-serif",
  fragment: "'Fragment Mono', monospace",
};

const PADDINGS: Record<CustomTheme['padding'], { top: number; side: number; bottom: number }> = {
  serre: { top: 84, side: 76, bottom: 164 },
  normal: { top: 104, side: 96, bottom: 176 },
  aere: { top: 128, side: 120, bottom: 196 },
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
      : theme.decor === 'verre'
        ? `
/* Verre : grandes courbes de verre sombres aux arêtes lumineuses + lame diagonale (grammaire « Verre Bleu ») */
.decor-1 {
  position: absolute; z-index: 2; ${pos.d1}
  width: 1350px; height: 1350px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%,
    ${theme.bg1} 0%, ${mix(theme.bg1, theme.bg2, 0.5)} 38%, ${theme.bg2} 62%,
    ${rgba(accent, 0.7)} 82%, ${rgba(secondary, 0.9)} 94%, ${rgba('#ffffff', 0.85)} 100%);
  box-shadow: 0 0 3px ${rgba('#ffffff', 0.75)}, 0 0 40px ${rgba(accent, 0.45)}, 0 0 140px ${rgba(accent, 0.3)};
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.d2}
  width: 1400px; height: 1400px; border-radius: 50%;
  background: radial-gradient(circle at 68% 72%,
    ${theme.bg1} 0%, ${mix(theme.bg1, theme.bg2, 0.5)} 40%, ${theme.bg2} 64%,
    ${rgba(accent, 0.7)} 84%, ${rgba(secondary, 0.9)} 95%, ${rgba('#ffffff', 0.85)} 100%);
  box-shadow: 0 0 3px ${rgba('#ffffff', 0.75)}, 0 0 40px ${rgba(accent, 0.4)}, 0 0 140px ${rgba(accent, 0.28)};
}
.decor-3 {
  position: absolute; z-index: 3; ${BLADE_POS[theme.decorPosition]}
  width: 1250px; height: 1250px; border-radius: 50%;
  transform: rotate(-14deg);
  background: radial-gradient(circle at 20% 18%,
    ${rgba(theme.bg1, 0.98)} 0%, ${rgba(theme.bg2, 0.95)} 45%,
    ${rgba(accent, 0.6)} 74%, ${rgba(secondary, 0.75)} 92%, ${rgba('#ffffff', 0.8)} 100%);
  box-shadow: 0 0 2px ${rgba('#ffffff', 0.8)}, 0 0 60px ${rgba(accent, 0.3)};
}
.has-hero .decor-1, .has-hero .decor-2, .has-hero .decor-3 { opacity: 0.15; }`
      : theme.decor === 'liquide'
        ? `
/* Verre liquide : bulles de verre translucides, arête lumineuse, reflet spéculaire, ombre colorée */
.decor-1, .decor-2, .decor-3 {
  position: absolute; z-index: 2; border-radius: 50%;
  background: ${
    light
      ? `radial-gradient(circle at 30% 26%, ${rgba('#ffffff', 0.2)} 0%, ${rgba(accent, 0.26)} 30%, ${rgba(secondary, 0.14)} 58%, ${rgba(theme.bg2, 0.05)} 80%)`
      : `radial-gradient(circle at 30% 26%, ${rgba('#ffffff', 0.72)} 0%, ${rgba('#ffffff', 0.5)} 34%, ${rgba(accent, 0.22)} 70%, ${rgba('#ffffff', 0.3)} 100%)`
  };
  border: 1.5px solid ${rgba('#ffffff', light ? 0.32 : 0.85)};
  box-shadow:
    inset 0 2px 0 ${rgba('#ffffff', light ? 0.55 : 0.95)},
    inset 0 -46px 90px ${rgba(accent, light ? 0.34 : 0.16)},
    inset 0 0 0 1px ${rgba('#ffffff', 0.08)},
    0 70px 150px -40px ${rgba(accent, light ? 0.6 : 0.35)},
    0 0 2px ${rgba('#ffffff', 0.6)};
  backdrop-filter: blur(12px) saturate(1.25);
  -webkit-backdrop-filter: blur(12px) saturate(1.25);
}
.decor-1 { ${LIQUID_POS[theme.decorPosition].d1} width: 940px; height: 940px; }
.decor-2 { ${LIQUID_POS[theme.decorPosition].d2} width: 680px; height: 680px; }
.decor-3 { ${LIQUID_POS[theme.decorPosition].d3} width: 600px; height: 236px; border-radius: 999px;
  background: linear-gradient(120deg, ${rgba('#ffffff', light ? 0.24 : 0.7)} 0%, ${rgba(secondary, light ? 0.2 : 0.3)} 55%, ${rgba(accent, light ? 0.14 : 0.2)} 100%); }
/* Reflet spéculaire en haut à gauche de chaque bulle */
.decor-1::before, .decor-2::before, .decor-3::before {
  content: ''; position: absolute; left: 12%; top: 8%; width: 48%; height: 24%; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 50%, ${rgba('#ffffff', light ? 0.5 : 0.85)} 0%, transparent 70%);
  filter: blur(7px);
}
.decor-3::before { left: 8%; top: 12%; width: 40%; height: 34%; }
.has-hero .decor-1, .has-hero .decor-2, .has-hero .decor-3 { opacity: 0.35; }`
      : theme.decor === 'eclipse'
        ? (() => {
            const c = DISC_CENTER[theme.decorPosition];
            return `
/* Éclipse : disque net à bord incandescent, double anneau, rayons fins, arcs concentriques, grille de points (famille « Signal ») */
.decor-1 {
  position: absolute; z-index: 2; border-radius: 50%; ${centered(c, 1100)}
  background: radial-gradient(circle at 50% 50%, ${theme.bg1} 0%, ${theme.bg2} 46%, ${rgba(accent, 0.7)} 70%, ${accent} 86%, ${rgba('#ffffff', 0.8)} 95%, #ffffff 100%);
  box-shadow: 0 0 50px 8px ${rgba(accent, 0.6)}, 0 0 220px 90px ${rgba(accent, 0.28)};
}
.decor-1::before, .decor-1::after { content: ''; position: absolute; border-radius: 50%; border: 1.5px solid ${rgba(theme.textColor, 0.34)}; inset: -74px; }
.decor-1::after { inset: -178px; border-width: 1px; border-color: ${rgba(theme.textColor, 0.18)}; }
.decor-2 {
  position: absolute; inset: 0; z-index: 2;
  background: repeating-conic-gradient(from 0deg at ${c.x}px ${c.y}px, ${rgba(accent, 0.18)} 0deg 2.4deg, transparent 2.4deg 11deg);
  -webkit-mask-image: radial-gradient(circle at ${c.x}px ${c.y}px, transparent 560px, #000 640px, transparent 1500px);
  mask-image: radial-gradient(circle at ${c.x}px ${c.y}px, transparent 560px, #000 640px, transparent 1500px);
}
.decor-3 {
  position: absolute; inset: 0; z-index: 3;
  background: repeating-radial-gradient(circle at ${c.x}px ${c.y}px, transparent 0 200px, ${rgba(theme.textColor, 0.09)} 200px 201.5px);
  -webkit-mask-image: radial-gradient(circle at ${c.x}px ${c.y}px, transparent 640px, #000 760px, transparent 1600px);
  mask-image: radial-gradient(circle at ${c.x}px ${c.y}px, transparent 640px, #000 760px, transparent 1600px);
}
.slide::before {
  content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background-image: radial-gradient(${rgba(accent, 0.55)} 1.6px, transparent 1.9px);
  background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(ellipse 78% 78% at 50% 50%, #000 20%, transparent 100%);
  mask-image: radial-gradient(ellipse 78% 78% at 50% 50%, #000 20%, transparent 100%);
}`;
          })()
        : theme.decor === 'prisme'
          ? (() => {
              const b = BEAM[theme.decorPosition];
              return `
/* Prisme : faisceau diagonal diffus, arête de lumière nette, second faisceau, grille fine, anneau au coin opposé */
.decor-1 {
  position: absolute; z-index: 2; width: 2600px; height: 320px; left: 50%; top: 50%;
  transform: translate(-50%, calc(-50% + ${b.dy}px)) rotate(${b.angle}deg);
  background: linear-gradient(90deg, transparent 0%, ${rgba(accent, 0.42)} 22%, ${rgba(secondary, 0.7)} 47%, ${rgba('#ffffff', 0.55)} 52%, ${rgba(accent, 0.48)} 78%, transparent 100%);
  filter: blur(30px);
}
.decor-2 {
  position: absolute; z-index: 3; width: 2400px; height: 2px; left: 50%; top: 50%;
  transform: translate(-50%, calc(-50% + ${b.dy}px)) rotate(${b.angle}deg);
  background: linear-gradient(90deg, transparent 0%, ${rgba('#ffffff', 0.85)} 30%, #ffffff 50%, ${rgba('#ffffff', 0.85)} 70%, transparent 100%);
  box-shadow: 0 0 16px ${rgba('#ffffff', 0.9)}, 0 0 70px ${rgba(secondary, 0.9)}, 0 0 140px ${rgba(accent, 0.7)};
}
.decor-2::before {
  content: ''; position: absolute; left: 10%; right: 10%; top: ${b.dy >= 0 ? '-190px' : '150px'}; height: 90px;
  background: linear-gradient(90deg, transparent 0%, ${rgba(secondary, 0.35)} 40%, ${rgba(accent, 0.45)} 60%, transparent 100%);
  filter: blur(22px);
}
.decor-3 {
  position: absolute; inset: 0; z-index: 2;
  background:
    repeating-linear-gradient(0deg, transparent 0 79px, ${rgba(theme.textColor, 0.07)} 79px 80px),
    repeating-linear-gradient(90deg, transparent 0 79px, ${rgba(theme.textColor, 0.07)} 79px 80px);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000 10%, transparent 80%);
  mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000 10%, transparent 80%);
}
.decor-3::after {
  content: ''; position: absolute; width: 560px; height: 560px; border-radius: 50%;
  ${b.angle < 0 ? (b.dy < 0 ? 'left: -200px; bottom: -160px;' : 'right: -200px; top: -160px;') : b.dy < 0 ? 'right: -200px; bottom: -160px;' : 'left: -200px; top: -160px;'}
  border: 1.5px solid ${rgba(accent, 0.5)};
  box-shadow: inset 0 0 90px ${rgba(accent, 0.28)}, 0 0 60px ${rgba(accent, 0.2)};
}`;
            })()
          : theme.decor === 'orbite'
            ? (() => {
                const c = SPHERE_CENTER[theme.decorPosition];
                const sats = orbitPoints(c, 700, 0.3, -18, [0.9, 2.6, 4.4]);
                const satsCss = sats
                  .map((p, i) => `radial-gradient(circle at ${p.x}px ${p.y}px, #ffffff 0 ${i === 1 ? 7 : 5}px, ${rgba(accent, 0.9)} ${i === 1 ? 8 : 6}px, transparent ${i === 1 ? 26 : 20}px)`)
                  .join(',\n    ');
                return `
/* Orbite : sphère lumineuse, trois orbites elliptiques inclinées et leurs satellites, ciel étoilé */
.decor-1 {
  position: absolute; z-index: 3; border-radius: 50%; ${centered(c, 380)}
  background: radial-gradient(circle at 32% 28%, #ffffff 0%, ${rgba('#ffffff', 0.9)} 5%, ${secondary} 20%, ${accent} 46%, ${mix(accent, theme.bg1, 0.7)} 78%, ${theme.bg1} 100%);
  box-shadow: 0 0 60px ${rgba(accent, 0.55)}, 0 0 180px ${rgba(accent, 0.3)}, inset -40px -50px 90px ${rgba(theme.bg1, 0.75)};
}
.decor-2 {
  position: absolute; z-index: 2; border-radius: 50%; ${centered(c, 1400)}
  border: 1.5px solid ${rgba(theme.textColor, 0.3)};
  transform: rotate(-18deg) rotateX(72.5deg);
}
.decor-2::before, .decor-2::after { content: ''; position: absolute; border-radius: 50%; border: 1px solid ${rgba(theme.textColor, 0.2)}; }
.decor-2::before { inset: -190px; }
.decor-2::after { inset: -400px; border-color: ${rgba(accent, 0.34)}; }
.decor-3 {
  position: absolute; inset: 0; z-index: 3;
  background:
    ${satsCss},
    radial-gradient(${rgba('#ffffff', 0.55)} 1.2px, transparent 1.6px),
    radial-gradient(${rgba('#ffffff', 0.35)} 0.9px, transparent 1.3px);
  background-size: auto, auto, auto, 190px 230px, 130px 170px;
  background-position: 0 0, 0 0, 0 0, 40px 70px, 90px 20px;
}`;
              })()
            : theme.decor === 'grille'
              ? (() => {
                  const ceiling = theme.decorPosition === 'haut-droite' || theme.decorPosition === 'haut-gauche';
                  return `
/* Grille : sol (ou plafond) quadrillé en perspective, horizon lumineux, repères aux coins, points fins */
.decor-1 {
  position: absolute; z-index: 2; left: -30%; right: -30%; ${ceiling ? 'top: -6%;' : 'bottom: -6%;'} height: 70%;
  transform-origin: 50% ${ceiling ? '0%' : '100%'};
  transform: perspective(900px) rotateX(${ceiling ? '-60deg' : '60deg'});
  background:
    repeating-linear-gradient(90deg, ${rgba(accent, 0.55)} 0 2px, transparent 2px 72px),
    repeating-linear-gradient(0deg, ${rgba(accent, 0.55)} 0 2px, transparent 2px 72px);
  -webkit-mask-image: linear-gradient(${ceiling ? '0deg' : '180deg'}, transparent 0%, #000 55%);
  mask-image: linear-gradient(${ceiling ? '0deg' : '180deg'}, transparent 0%, #000 55%);
}
.decor-2 {
  position: absolute; z-index: 2; left: -20%; right: -20%; ${ceiling ? 'top: 0;' : 'bottom: 0;'} height: 58%;
  background: radial-gradient(ellipse 70% 62% at 50% ${ceiling ? '0%' : '100%'}, ${rgba(accent, 0.5)} 0%, ${rgba(secondary, 0.18)} 40%, transparent 70%);
  filter: blur(26px);
}
.decor-3 { position: absolute; inset: 0; z-index: 3; }
.decor-3::before, .decor-3::after {
  content: ''; position: absolute; width: 76px; height: 76px;
  border: 0 solid ${rgba(theme.textColor, 0.5)};
}
.decor-3::before { left: 56px; top: 56px; border-left-width: 2px; border-top-width: 2px; }
.decor-3::after { right: 56px; bottom: 56px; border-right-width: 2px; border-bottom-width: 2px; }
.slide::before {
  content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background-image: radial-gradient(${rgba(theme.textColor, 0.35)} 1.2px, transparent 1.5px);
  background-size: 36px 36px;
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 10%, transparent 85%);
  mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 10%, transparent 85%);
}`;
                })()
              : theme.decor === 'rayons'
                ? (() => {
                    const core = SUN_CENTER[theme.decorPosition];
                    return `
/* Rayons : soleil art déco — cœur incandescent, larges rayons alternés, arcs concentriques */
.decor-1 {
  position: absolute; z-index: 3; border-radius: 50%; ${centered(core, 240)}
  background: radial-gradient(circle at 50% 50%, #ffffff 0%, ${rgba('#ffffff', 0.95)} 18%, ${secondary} 40%, ${accent} 70%, ${rgba(accent, 0)} 100%);
  box-shadow: 0 0 80px 20px ${rgba(accent, 0.7)}, 0 0 260px 120px ${rgba(accent, 0.3)};
}
.decor-2 {
  position: absolute; inset: 0; z-index: 2;
  background:
    repeating-conic-gradient(from 0deg at ${core.x}px ${core.y}px, ${rgba(accent, 0.2)} 0deg 7deg, transparent 7deg 15deg),
    repeating-conic-gradient(from 4deg at ${core.x}px ${core.y}px, ${rgba('#ffffff', 0.05)} 0deg 2deg, transparent 2deg 15deg);
  -webkit-mask-image: radial-gradient(circle at ${core.x}px ${core.y}px, #000 0, #000 300px, transparent 1500px);
  mask-image: radial-gradient(circle at ${core.x}px ${core.y}px, #000 0, #000 300px, transparent 1500px);
}
.decor-3 {
  position: absolute; inset: 0; z-index: 2;
  background: repeating-radial-gradient(circle at ${core.x}px ${core.y}px, transparent 0 170px, ${rgba(theme.textColor, 0.1)} 170px 171.5px);
  -webkit-mask-image: radial-gradient(circle at ${core.x}px ${core.y}px, transparent 300px, #000 400px, transparent 1500px);
  mask-image: radial-gradient(circle at ${core.x}px ${core.y}px, transparent 300px, #000 400px, transparent 1500px);
}`;
                  })()
                : theme.decor === 'vagues'
                  ? (() => {
                      const o = WAVE_ORIGIN[theme.decorPosition];
                      const o2 = { x: 100 - o.x, y: 100 - o.y };
                      return `
/* Vagues : courbes de niveau elliptiques en deux teintes (carte topographique), halo à l'origine */
.decor-1 {
  position: absolute; inset: 0; z-index: 2;
  background: repeating-radial-gradient(ellipse 980px 620px at ${o.x}% ${o.y}%, transparent 0 44px, ${rgba(accent, 0.4)} 44px 46px);
  -webkit-mask-image: radial-gradient(ellipse 85% 85% at ${o.x}% ${o.y}%, #000 15%, transparent 75%);
  mask-image: radial-gradient(ellipse 85% 85% at ${o.x}% ${o.y}%, #000 15%, transparent 75%);
}
.decor-2 {
  position: absolute; inset: 0; z-index: 2;
  background: repeating-radial-gradient(ellipse 760px 480px at ${o2.x}% ${o2.y}%, transparent 0 38px, ${rgba(secondary, 0.24)} 38px 39.5px);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at ${o2.x}% ${o2.y}%, #000 10%, transparent 70%);
  mask-image: radial-gradient(ellipse 70% 70% at ${o2.x}% ${o2.y}%, #000 10%, transparent 70%);
}
.decor-3 {
  position: absolute; z-index: 2; width: 1000px; height: 1000px; border-radius: 50%; left: calc(${o.x}% - 500px); top: calc(${o.y}% - 500px);
  background: radial-gradient(circle closest-side, ${rgba(accent, 0.42)} 0%, transparent 70%);
  filter: blur(40px);
}`;
                    })()
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
          : theme.decor === 'points'
            ? `
.decor-1 {
  position: absolute; z-index: 2; ${pos.halo}
  width: 1200px; height: 1200px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(accent, 0.42)} 0%, transparent 72%);
  filter: blur(30px);
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.d2}
  width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(secondary, 0.22)} 0%, transparent 70%);
  filter: blur(36px);
}
/* Grille de points, fondue vers les bords */
.decor-3 {
  position: absolute; inset: 0; z-index: 3;
  background-image: radial-gradient(${rgba(accent, 0.55)} 1.7px, transparent 1.9px);
  background-size: 26px 26px;
  opacity: 0.75;
  -webkit-mask-image: radial-gradient(ellipse 75% 65% at 50% 45%, #000 20%, transparent 85%);
  mask-image: radial-gradient(ellipse 75% 65% at 50% 45%, #000 20%, transparent 85%);
}`
            : theme.decor === 'anneaux'
              ? `
/* Anneaux concentriques, très fins, autour du centre */
.decor-1 {
  position: absolute; inset: -40%; z-index: 2;
  background: repeating-radial-gradient(circle at 50% 48%, transparent 0 150px, ${rgba(theme.textColor, 0.07)} 150px 152px);
  -webkit-mask-image: radial-gradient(circle at 50% 48%, #000 25%, transparent 62%);
  mask-image: radial-gradient(circle at 50% 48%, #000 25%, transparent 62%);
}
.decor-2 {
  position: absolute; z-index: 2; top: 50%; left: 50%; transform: translate(-50%, -54%);
  width: 1000px; height: 1000px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(accent, 0.3)} 0%, transparent 70%);
  filter: blur(46px);
}
.decor-3 { position: absolute; inset: 0; z-index: 3;
  background: linear-gradient(180deg, ${rgba(accent, 0.16)} 0%, transparent 38%); }`
              : theme.decor === 'arcs'
                ? `
/* Grands arcs lumineux : un cercle fin dont le bord rayonne */
.decor-1 {
  position: absolute; z-index: 2; ${pos.d1}
  width: 1500px; height: 1500px; border-radius: 50%;
  border: 2px solid ${rgba(theme.textColor, 0.16)};
  background: radial-gradient(circle at 50% 50%, transparent 58%, ${rgba(accent, 0.22)} 100%);
  box-shadow: inset 0 0 180px ${rgba(accent, 0.45)}, 0 0 140px ${rgba(accent, 0.28)};
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.d2}
  width: 1100px; height: 1100px; border-radius: 50%;
  border: 2px solid ${rgba(theme.textColor, 0.12)};
  background: radial-gradient(circle at 50% 50%, transparent 62%, ${rgba(secondary, 0.18)} 100%);
  box-shadow: inset 0 0 140px ${rgba(secondary, 0.35)}, 0 0 100px ${rgba(secondary, 0.2)};
}
.decor-3 {
  position: absolute; inset: 0; z-index: 3;
  background-image: radial-gradient(${rgba(accent, 0.4)} 1.4px, transparent 1.6px);
  background-size: 24px 24px;
  opacity: 0.55;
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, #000 10%, transparent 80%);
  mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, #000 10%, transparent 80%);
}`
                : theme.decor === 'disques'
                  ? `
/* Disques nets à bord lumineux + arcs fins concentriques (référence « Latência ») */
.decor-1, .decor-2 {
  position: absolute; z-index: 2; width: ${DISC_SIZE}px; height: ${DISC_SIZE}px; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, ${theme.bg1} 0%, ${theme.bg2} 45%, ${rgba(accent, 0.75)} 68%, ${accent} 84%, ${rgba('#ffffff', 0.75)} 94%, #ffffff 100%);
  box-shadow: 0 0 40px 6px ${rgba(accent, 0.55)}, 0 0 160px 60px ${rgba(accent, 0.32)};
}
.decor-1 { ${discCss(DISC_POS[theme.decorPosition][0])} }
.decor-2 { ${DISC_POS[theme.decorPosition][1] ? discCss(DISC_POS[theme.decorPosition][1]!) : 'display: none;'} }
/* Arcs fins concentriques aux disques (pseudo-éléments d'un calque plein cadre) */
.decor-3 { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.decor-3::before, .decor-3::after {
  content: ''; position: absolute; width: ${DISC_SIZE + 2 * ARC_GROW}px; height: ${DISC_SIZE + 2 * ARC_GROW}px; border-radius: 50%;
  border: 1.5px solid ${rgba(theme.textColor, 0.34)};
}
.decor-3::before { ${discCss(DISC_POS[theme.decorPosition][0], ARC_GROW)} }
.decor-3::after { ${DISC_POS[theme.decorPosition][1] ? discCss(DISC_POS[theme.decorPosition][1]!, ARC_GROW) : 'display: none;'} }
/* Grille de points fine, fondue vers les bords */
.slide::before {
  content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background-image: radial-gradient(${rgba(accent, 0.6)} 1.7px, transparent 2px);
  background-size: 21px 21px;
  -webkit-mask-image: radial-gradient(ellipse 78% 78% at 50% 50%, #000 25%, transparent 100%);
  mask-image: radial-gradient(ellipse 78% 78% at 50% 50%, #000 25%, transparent 100%);
}`
                  : theme.decor === 'colonne'
                    ? `
/* Colonne de lumière verticale + fines stries (référence « System Token ») */
.decor-1 {
  position: absolute; z-index: 2; left: 50%; top: -8%; width: 1000px; height: 116%; transform: translateX(-50%);
  background: radial-gradient(ellipse 28% 54% at ${COLUMN_X[theme.decorPosition]}% ${COLUMN_Y[theme.decorPosition]}%,
    ${rgba('#ffffff', 0.2)} 0%, ${rgba(accent, 0.8)} 16%, ${rgba(accent, 0.45)} 34%, ${rgba(secondary, 0.28)} 50%, ${rgba(theme.bg2, 0.4)} 70%, transparent 100%);
}
.decor-2 {
  position: absolute; inset: 0; z-index: 2;
  background: repeating-linear-gradient(90deg, transparent 0 52px, ${rgba(theme.textColor, 0.035)} 52px 54px);
  -webkit-mask-image: radial-gradient(ellipse 60% 70% at 50% 45%, #000 20%, transparent 90%);
  mask-image: radial-gradient(ellipse 60% 70% at 50% 45%, #000 20%, transparent 90%);
}
.decor-3 { display: none; }`
                    : theme.decor === 'anneaux-larges'
                      ? `
/* Grands anneaux fins centrés derrière le texte (référence « 87 % ») */
.decor-1 {
  position: absolute; inset: -30%; z-index: 2;
  background: repeating-radial-gradient(circle at 50% 44%, transparent 0 168px, ${rgba(theme.textColor, 0.075)} 168px 170px);
  -webkit-mask-image: radial-gradient(circle at 50% 44%, #000 20%, transparent 60%);
  mask-image: radial-gradient(circle at 50% 44%, #000 20%, transparent 60%);
}
.decor-2 {
  position: absolute; z-index: 2; ${pos.halo}
  width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(accent, 0.18)} 0%, transparent 70%);
  filter: blur(40px);
}
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
          : theme.accentStyle === 'argent'
            ? `.title .accent { font-family: inherit; font-style: normal; font-weight: inherit; letter-spacing: inherit;
  background: linear-gradient(180deg, ${theme.textColor} 0%, ${rgba(theme.textColor, 0.78)} 55%, ${rgba(theme.textColor, 0.42)} 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }`
            : '';
  const accentLine = theme.accentLine ? `.title .accent { display: block; }` : '';
  const accentWord = theme.accentWordColor && theme.accentStyle !== 'argent'
    ? `.title .accent { color: ${theme.accentWordColor}; -webkit-text-fill-color: ${theme.accentWordColor}; }`
    : '';

  // L'alignement est porté par la classe de slide (slideStyleFor) : rien à émettre ici.
  const align = '';

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
  const cornerInk = rgba(theme.textColor, 0.5);
  const frame =
    theme.frame === 'coins'
      ? `
/* Repères aux quatre coins (marques de coupe) */
.slide::after {
  content: ''; position: absolute; inset: 44px; z-index: 8; pointer-events: none;
  background:
    linear-gradient(${cornerInk}, ${cornerInk}) left top / 64px 2px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) left top / 2px 64px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) right top / 64px 2px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) right top / 2px 64px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) left bottom / 64px 2px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) left bottom / 2px 64px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) right bottom / 64px 2px no-repeat,
    linear-gradient(${cornerInk}, ${cornerInk}) right bottom / 2px 64px no-repeat;
}`
      : theme.frame !== 'aucun'
        ? `
.slide::after {
  content: ''; position: absolute; inset: 44px; z-index: 8; pointer-events: none;
  border: 2px solid ${rgba(theme.frame === 'accent' ? accent : theme.textColor, 0.42)};
  border-radius: ${theme.radius === 'sharp' ? '4px' : '30px'};
}`
        : '';
  const footer = theme.showCounter ? '' : '.slide-counter { display: none; }';

  // --- Pack premium ----------------------------------------------------------
  const titleGradient =
    theme.titleGradient === 'accent'
      ? `.title { background: linear-gradient(100deg, ${theme.textColor} 15%, ${accent} 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.title .accent { color: ${accent}; }`
      : theme.titleGradient === 'argent'
        ? `.title { background: linear-gradient(180deg, ${theme.textColor} 20%, ${rgba(theme.textColor, 0.45)} 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }`
        : theme.titleGradient === 'horizontal'
          ? `.title { background: linear-gradient(90deg, ${theme.textColor} 0%, ${theme.textColor} 28%, ${secondary} 62%, ${accent} 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.title .accent { color: ${accent}; }`
          : '';
  const ctaInk = isLightHex(accent) ? '#0b0b0e' : '#ffffff';
  const ctaStyle =
    theme.ctaStyle === 'plein'
      ? `.cta-button, .keyword-chip { background: ${accent}; border-color: transparent; color: ${ctaInk}; backdrop-filter: none; box-shadow: 0 24px 60px -24px ${rgba(accent, 0.7)}; }`
      : theme.ctaStyle === 'degrade'
        ? `.cta-button, .keyword-chip { background: linear-gradient(90deg, #ffffff 0%, ${accent} 100%); border-color: transparent; color: #0b0b0e; backdrop-filter: none; box-shadow: 0 24px 60px -24px ${rgba(accent, 0.7)}; }`
        : '';
  // Bouton « verre liquide » : verre blanc translucide, arête lumineuse, reflet en haut, ombre à l'accent
  const liquidCta =
    theme.ctaStyle === 'liquide'
      ? `
.cta-button, .keyword-chip {
  position: relative; overflow: hidden; color: ${theme.textColor};
  background: linear-gradient(160deg, ${rgba('#ffffff', light ? 0.26 : 0.72)} 0%, ${rgba('#ffffff', light ? 0.09 : 0.5)} 55%, ${rgba(accent, 0.16)} 100%);
  border: 1.5px solid ${rgba('#ffffff', light ? 0.5 : 0.9)};
  backdrop-filter: blur(26px) saturate(1.5); -webkit-backdrop-filter: blur(26px) saturate(1.5);
  box-shadow:
    inset 0 2px 0 ${rgba('#ffffff', light ? 0.6 : 0.95)},
    inset 0 -2px 8px ${rgba('#ffffff', 0.08)},
    inset 0 0 0 1px ${rgba(accent, 0.18)},
    0 28px 70px -22px ${rgba(accent, 0.6)},
    0 0 0 1px ${rgba(accent, 0.14)};
}
.cta-button::before, .keyword-chip::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(180deg, ${rgba('#ffffff', light ? 0.32 : 0.55)} 0%, ${rgba('#ffffff', 0.06)} 42%, transparent 62%);
}
.cta-button::after { position: relative; }
.cta-button > *, .keyword-chip > * { position: relative; }`
      : '';
  // Panneau de verre derrière le bloc de texte (dépoli ou liquide) : la pile devient une carte
  const panelInset = theme.panel === 'liquide' ? '-60px -68px' : '-52px -60px';
  const panelRadius = theme.panel === 'liquide' ? '72px' : theme.radius === 'sharp' ? '10px' : '48px';
  // Verre dépoli : blanc translucide dans les deux cas (sur fond clair, une carte givrée blanche — jamais un voile gris)
  const panel =
    theme.panel === 'verre'
      ? `
.stack { position: relative; }
.stack::before {
  content: ''; position: absolute; inset: ${panelInset}; z-index: -1; border-radius: ${panelRadius}; pointer-events: none;
  background: linear-gradient(160deg, ${rgba('#ffffff', light ? 0.1 : 0.5)} 0%, ${rgba('#ffffff', light ? 0.04 : 0.34)} 60%, ${rgba('#ffffff', light ? 0.07 : 0.42)} 100%);
  border: 1px solid ${rgba('#ffffff', light ? 0.2 : 0.8)};
  backdrop-filter: blur(30px) saturate(1.3); -webkit-backdrop-filter: blur(30px) saturate(1.3);
  box-shadow: inset 0 1.5px 0 ${rgba('#ffffff', light ? 0.28 : 0.95)}, inset 0 -1px 0 ${rgba('#ffffff', 0.05)}, 0 40px 100px -30px ${rgba('#000000', light ? 0.6 : 0.22)}${light ? '' : `, 0 0 0 1px ${rgba(theme.bg2, 0.12)}`};
}
.has-hero .stack::before { background: linear-gradient(160deg, ${rgba('#ffffff', light ? 0.14 : 0.58)} 0%, ${rgba('#ffffff', light ? 0.07 : 0.4)} 100%); }`
      : theme.panel === 'liquide'
        ? `
.stack { position: relative; }
.stack::before {
  content: ''; position: absolute; inset: ${panelInset}; z-index: -1; border-radius: ${panelRadius}; pointer-events: none;
  background: linear-gradient(155deg, ${rgba('#ffffff', light ? 0.2 : 0.58)} 0%, ${rgba('#ffffff', light ? 0.06 : 0.4)} 40%, ${rgba(accent, light ? 0.12 : 0.1)} 100%);
  border: 1.5px solid ${rgba('#ffffff', light ? 0.45 : 0.85)};
  backdrop-filter: blur(34px) saturate(1.5); -webkit-backdrop-filter: blur(34px) saturate(1.5);
  box-shadow:
    inset 0 2px 0 ${rgba('#ffffff', light ? 0.6 : 0.95)},
    inset 0 -2px 10px ${rgba('#ffffff', 0.1)},
    inset 0 0 0 1px ${rgba(accent, 0.16)},
    0 50px 120px -30px ${rgba(light ? '#000000' : theme.bg2, light ? 0.65 : 0.35)},
    0 0 0 1px ${rgba(accent, 0.12)},
    0 0 90px -20px ${rgba(accent, light ? 0.45 : 0.25)};
}
.stack::after {
  content: ''; position: absolute; inset: ${panelInset}; z-index: -1; border-radius: ${panelRadius}; pointer-events: none;
  background:
    linear-gradient(180deg, ${rgba('#ffffff', light ? 0.22 : 0.4)} 0%, ${rgba('#ffffff', 0.05)} 22%, transparent 48%),
    radial-gradient(60% 40% at 18% 8%, ${rgba('#ffffff', light ? 0.35 : 0.55)} 0%, transparent 60%);
}`
        : '';
  const bigWeight = [300, 500, 900].includes(theme.bigNumberWeight) ? theme.bigNumberWeight : 900;
  const bigNumber = `:root { --big-weight: ${bigWeight}; }${bigWeight === 300 ? '\n.big-number { font-size: 320px; letter-spacing: -0.05em; }' : ''}`;
  const pad = PADDINGS[theme.padding] ?? PADDINGS.normal;
  const inset = clamp(theme.footerInset, 40, 160);
  const author = theme.showAuthor
    ? `.author-chip { display: inline-flex; }
.author-avatar { background: ${accent}; }
.author-check { color: ${accent}; }
/* La pilule de marque « haut-centre » cède la place à la chip auteur : elle passe à droite */
.brand-haut-centre .brand-top { left: auto; right: ${inset}px; transform: none; }
.brand-haut-centre.verified-on .brand-top { right: ${inset + 108}px; }`
    : '';
  // --- Personnalisation fine ------------------------------------------------
  const bodyScale = clamp(theme.bodyScale, 60, 140) / 100;
  const bodyColor = rgba(theme.bodyColor ?? theme.textColor, clamp(theme.bodyOpacity, 40, 100) / 100);
  const lh = LINE_HEIGHTS[theme.lineHeight] ?? LINE_HEIGHTS.normal;
  const subtitleScale = clamp(theme.subtitleScale, 60, 140) / 100;
  const badgeColor = theme.badgeColor ?? accent;
  const bulletColor = theme.bulletColor ?? accent;
  const iconSize = clamp(theme.iconBadgeSize, 60, 140) / 100;
  const annotationScale = clamp(theme.annotationScale, 60, 140) / 100;
  const ctaSize = clamp(theme.ctaSize, 60, 130) / 100;
  const logoSize = clamp(theme.logoSize, 50, 160) / 100;
  const counterSize = clamp(theme.counterSize, 60, 140) / 100;
  const decorScale = clamp(theme.decorScale, 60, 140) / 100;
  const badge =
    theme.badgeStyle === 'plein'
      ? `.badge { background: ${badgeColor}; border-color: transparent; color: ${isLightHex(badgeColor) ? '#0b0b0e' : '#ffffff'}; backdrop-filter: none; }
.badge::before { background: ${isLightHex(badgeColor) ? '#0b0b0e' : '#ffffff'}; box-shadow: none; }`
      : theme.badgeStyle === 'contour'
        ? `.badge { background: transparent; border-color: ${rgba(badgeColor, 0.7)}; color: ${theme.textColor}; }
.badge::before { background: ${badgeColor}; box-shadow: 0 0 18px ${badgeColor}; }`
        : theme.badgeStyle === 'texte'
          ? `.badge { background: transparent; border-color: transparent; padding-left: 0; padding-right: 0; color: ${badgeColor}; backdrop-filter: none; }
.badge::before { display: none; }`
          : `.badge { border-color: ${rgba(badgeColor, 0.45)}; }
.badge::before { background: ${badgeColor}; box-shadow: 0 0 18px ${badgeColor}; }`;
  const bullets =
    theme.bulletGlyph === 'numero'
      ? `.bullets { counter-reset: puce; }
.bullets li::before { counter-increment: puce; content: counter(puce, decimal-leading-zero); font-family: 'Fragment Mono', monospace; font-size: 0.72em; padding-top: 0.22em; color: ${bulletColor}; }`
      : `.bullets li::before { content: '${BULLET_GLYPHS[theme.bulletGlyph] ?? '→'}'; color: ${bulletColor}; }`;
  const fine = `
/* Personnalisation fine */
.stack { gap: ${clamp(theme.blockGap, 8, 80)}px; }
.safe { justify-content: ${{ centre: 'center', haut: 'flex-start', bas: 'flex-end' }[theme.verticalAlign] ?? 'center'}; }
.title { line-height: ${lh.title}; letter-spacing: ${(clamp(theme.titleTracking, -60, 40) / 1000).toFixed(3)}em;${theme.titleColor ? ` color: ${theme.titleColor};` : ''} }
.body { font-family: ${FONTS[theme.bodyFont] ?? FONTS.inter}; font-size: ${Math.round(42 * bodyScale)}px; font-weight: ${clamp(theme.bodyWeight, 400, 700)}; line-height: ${lh.body}; color: ${bodyColor}; }
.bullets li { font-size: ${Math.round(44 * bodyScale)}px; font-weight: ${Math.max(500, clamp(theme.bodyWeight, 400, 700))}; line-height: ${lh.bullets}; color: ${bodyColor}; }
.body strong { color: ${theme.bodyColor ?? theme.textColor}; }
.subtitle { font-size: ${Math.round(60 * subtitleScale)}px; }
${theme.subtitleTone === 'plein' ? `.subtitle .tone-1 { background: none; -webkit-background-clip: initial; background-clip: initial; color: ${theme.textColor}; }` : ''}
${badge}
${bullets}
.icon-badge { width: ${Math.round(96 * iconSize)}px; height: ${Math.round(96 * iconSize)}px; }
.icon-badge svg { width: ${Math.round(46 * iconSize)}px; height: ${Math.round(46 * iconSize)}px; }
.annotation { font-family: ${ANNOTATION_FONTS[theme.annotationFont] ?? ANNOTATION_FONTS.caveat}; font-size: ${Math.round(52 * annotationScale)}px; transform: rotate(${clamp(theme.annotationTilt, -12, 12)}deg);${theme.annotationColor ? ` color: ${theme.annotationColor}; opacity: 1;` : ''}${theme.annotationFont !== 'caveat' ? ' font-weight: 600; letter-spacing: 0.02em;' : ''} }
.cta-button { font-size: ${Math.round(46 * ctaSize)}px; padding: ${Math.round(34 * ctaSize)}px ${Math.round(64 * ctaSize)}px; }
.cta-chevron .cta-button { font-size: ${Math.round(34 * ctaSize)}px; padding: ${Math.round(14 * ctaSize)}px ${Math.round(40 * ctaSize)}px ${Math.round(14 * ctaSize)}px ${Math.round(14 * ctaSize)}px; }
.keyword-chip { font-size: ${Math.round(40 * ctaSize)}px; padding: ${Math.round(26 * ctaSize)}px ${Math.round(54 * ctaSize)}px; }
.brand-wordmark { height: ${Math.round(74 * logoSize)}px; }
.brand-bas-centre .brand-wordmark { height: ${Math.round(46 * logoSize)}px; }
.brand-haut-centre .brand-top .brand-wordmark { height: ${Math.round(40 * logoSize)}px; }
.brand-mark, .brand-logo { width: ${Math.round(64 * logoSize)}px; height: ${Math.round(64 * logoSize)}px; font-size: ${Math.round(30 * logoSize)}px; }
.brand-name { font-size: ${Math.round(30 * logoSize)}px; }
.brand-handle { font-size: ${Math.round(24 * logoSize)}px; }
.brand-footer { left: ${clamp(theme.footerInset, 40, 160)}px; right: ${clamp(theme.footerInset, 40, 160)}px; bottom: ${clamp(theme.footerBottom, 24, 120)}px; }
.author-chip { left: ${clamp(theme.footerInset, 40, 160)}px; }
.verified-badge { right: ${clamp(theme.footerInset, 40, 160)}px; }
.slide-counter { font-size: ${Math.round(26 * counterSize)}px; }
.counter-pilule .slide-counter { font-size: ${Math.round(25 * counterSize)}px; padding: ${Math.round(14 * counterSize)}px ${Math.round(30 * counterSize)}px; }
${decorScale !== 1 ? `.decor-1, .decor-2 { scale: ${decorScale.toFixed(2)}; }` : ''}
${clamp(theme.heroScrim, 0, 100) !== 100 ? `.hero-scrim { opacity: ${(clamp(theme.heroScrim, 0, 100) / 100).toFixed(2)}; }` : ''}
`;

  const floats = floatCss({
    uris: [
      assetDataUri(theme.floatAssetId1),
      assetDataUri(theme.floatAssetId2),
      assetDataUri(theme.floatAssetId3),
      assetDataUri(theme.floatAssetId4),
    ],
    size: theme.floatSize,
    layout: theme.floatLayout,
    mirrored: theme.showAuthor,
    topRightBusy: theme.showVerifiedBadge,
    darkTheme: light,
    bleed: theme.floatBleed,
    tilt: theme.floatTilt,
  });

  return `/* Template maison « ${theme.name.replace(/\*\//g, '')} » — CSS généré */
:root {
  --accent: ${accent};
  --secondary: ${secondary};
  --text: ${theme.textColor};
  --muted: ${rgba(theme.textColor, 0.66)};
  --glass: rgba(${veil}, ${((light ? 0.05 : 0.07) * glass).toFixed(3)});
  --glass-border: rgba(${veil}, ${((light ? 0.14 : 0.16) * glass).toFixed(3)});
  --on-accent: ${ctaInk};
}

.slide { background: ${theme.bg1}; color: ${theme.textColor}; }
.safe { padding: ${(theme.padTop ?? pad.top) + (theme.showAuthor ? 96 : 0)}px ${theme.padSide ?? pad.side}px ${theme.padBottom ?? pad.bottom}px; }

.bg {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(${clamp(theme.gradientAngle, 0, 360)}deg, ${theme.bgTop ? `${theme.bgTop} 0%, ${theme.bg1} ${clamp(theme.bgTopSpread, 5, 45)}%` : `${theme.bg1} 0%`}, ${theme.bg2} 100%);
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
${accentLine}
${titleGradient}
${accentWord}
${align}
${bigNumber}
.body, .bullets li { color: ${rgba(theme.textColor, 0.88)}; }
.annotation { color: ${rgba(theme.textColor, 0.9)}; }
.big-number { background: linear-gradient(135deg, ${theme.textColor} 10%, ${secondary} 90%); -webkit-background-clip: text; background-clip: text; }

/* Matière */
.badge, .keyword-chip, .cta-button, .slide-counter { border-radius: ${radii.pill}; }
.notif-card, .browser-frame { border-radius: ${radii.card}; }
.keyword-chip { background: rgba(${veil}, ${(0.09 * glass).toFixed(3)}); border-color: rgba(${veil}, ${(0.2 * glass).toFixed(3)}); }
${ctaStyle}
${liquidCta}
${panel}
${frame}
${footer}
${author}
${fine}
${floats}
${
  light
    ? ''
    : `
/* Texte sombre : le verre et le logo s'inversent pour rester lisibles */
.brand-wordmark, .brand-logo { filter: invert(1); }
.has-hero .annotation { background: rgba(255, 255, 255, 0.74); color: ${theme.textColor}; opacity: 1; box-shadow: 0 8px 30px -12px rgba(11, 11, 14, 0.35); }
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
    radial-gradient(115% 100% at 50% 36%, ${rgba(theme.bg1, 0)} ${light ? '58%' : '56%'}, ${rgba(theme.bg1, light ? 0.9 : 0.94)} 100%),
    linear-gradient(180deg,
      ${rgba(theme.bg1, 0.12)} 0%,
      ${rgba(theme.bg1, 0.04)} calc(var(--text-top, 760px) - 300px),
      ${rgba(theme.bg1, 0.52)} calc(var(--text-top, 760px) - 90px),
      ${rgba(theme.bg1, 0.84)} calc(var(--text-top, 760px) + 140px),
      ${rgba(theme.bg1, 0.96)} 100%);
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


/** Indicateurs de rendu portés par les classes de la slide (voile, CTA, placement de l'objet, marque…). */
export interface SlideStyle {
  classes: string[];
  /** variables CSS inline (échelle de l'objet détouré) */
  style: string;
  /** pied de marque demandé (auto = réglage de la marque) */
  brandStyle: TemplateBrandStyle;
  /** chip auteur affichée */
  authorOn: boolean;
}

export function slideStyleFor(theme: CustomTheme | null, overrides: VisualOverrides = {}, kind = 'content'): SlideStyle {
  const placement = overrides.heroPlacement ?? theme?.heroPlacement ?? 'centre';
  const size = clamp(overrides.heroSize ?? theme?.heroSize ?? 100, 60, 140) / 100;
  // Alignement : réglage du template, sinon centré sur les slides centrées (accroche, chiffre, CTA, écho)
  const align = theme?.align && theme.align !== 'auto' ? theme.align : CENTERED_KINDS.has(kind) ? 'center' : 'left';
  const classes = [
    `align-${align}`,
    theme?.ctaStyle === 'chevron' ? 'cta-chevron' : theme?.ctaStyle === 'liquide' ? 'cta-liquide' : '',
    theme?.panel && theme.panel !== 'aucun' ? `panel-${theme.panel}` : '',
    `cta-arrow-${theme?.ctaArrow ?? 'droite'}`,
    `grade-${theme?.heroGrade ?? 'vif'}`,
    `hero-place-${placement}`,
    (theme?.heroGlow ?? true) ? 'hero-glow-on' : '',
    theme?.showVerifiedBadge ? 'verified-on' : '',
    `brand-${theme?.brandPosition ?? 'bas'}`,
    `counter-${theme?.counterStyle ?? 'mono'}`,
  ].filter(Boolean);
  return {
    classes,
    style: `--hero-scale: ${size.toFixed(2)};`,
    brandStyle: theme ? (theme.showLogo ? theme.brandStyle : 'aucun') : 'auto',
    authorOn: theme?.showAuthor ?? false,
  };
}
