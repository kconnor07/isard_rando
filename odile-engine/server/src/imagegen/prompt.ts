import { ARCHETYPES } from '@odile/shared';
import { isLightHex } from '../lib/color.js';

/**
 * Prompts d'illustration. Trois styles, tous fondus à la palette du template :
 * - full   : scène cinématique plein cadre, sujet en haut, bas calme pour le titre ;
 * - objets : un objet 3D isolé sur fond uni (couleur du template) → détouré ensuite ;
 * - chrome : rendu chrome & verre irisé, halo accent, espace sous l'objet.
 * Le texte vit dans la couche HTML, JAMAIS dans l'image.
 */

export type ImageStyle = 'full' | 'objets' | 'chrome';
export const IMAGE_STYLES: { id: ImageStyle; label: string; hint: string }[] = [
  { id: 'full', label: 'Plein cadre', hint: 'Scène cinématique, sujet en haut, titre en bas' },
  { id: 'objets', label: 'Objets détourés', hint: 'Objet 3D isolé, détouré, fondu à la palette' },
  { id: 'chrome', label: 'Chrome & verre', hint: 'Rendu 3D chrome / verre irisé, halo accent' },
];

/** Palette d'un thème (template maison ou thème intégré). */
export interface ThemePalette {
  bg1: string;
  bg2: string;
  accent: string;
  textColor: string;
}

/** Palettes des thèmes intégrés (les templates maison fournissent la leur). */
const BUILTIN_PALETTES: Record<string, ThemePalette> = {
  'odile-nuit': { bg1: '#050510', bg2: '#0a2a66', accent: '#0099FF', textColor: '#fdfdfd' },
  'violet-glow': { bg1: '#05030a', bg2: '#140a2e', accent: '#0099FF', textColor: '#fdfdfd' },
  'cyan-tech': { bg1: '#02070d', bg2: '#041c38', accent: '#3db5ff', textColor: '#fdfdfd' },
  'verre-bleu': { bg1: '#010207', bg2: '#0a1a3a', accent: '#4d9fff', textColor: '#fdfdfd' },
  'encre-blanche': { bg1: '#050506', bg2: '#141418', accent: '#ffffff', textColor: '#fdfdfd' },
  'papier-blanc': { bg1: '#f4f4f6', bg2: '#e6e4de', accent: '#0066cc', textColor: '#0b0b0e' },
};
const DEFAULT_PALETTE = BUILTIN_PALETTES['odile-nuit']!;

export function resolvePalette(theme?: string | null, palette?: ThemePalette | null): ThemePalette {
  return palette ?? (theme ? BUILTIN_PALETTES[theme] : undefined) ?? DEFAULT_PALETTE;
}

/** Style d'image naturel pour un archétype de composition. */
export function styleForArchetype(archetypeId?: string | null): ImageStyle {
  switch (archetypeId) {
    case 'objet_halo':
      return 'chrome';
    case 'chiffre_3d':
    case 'mockup_outil':
      return 'objets';
    default:
      return 'full';
  }
}

const NO_TEXT =
  'ABSOLUTELY FORBIDDEN: any text, letters, numbers as typography, words, captions, titles, signatures, logos, watermarks, user interfaces, buttons; any hue outside the palette. The image contains no writing of any kind.';

/** Guide de style d'un mode, dans la palette donnée. */
export function styleGuide(style: ImageStyle, p: ThemePalette): string {
  const dark = isLightHex(p.textColor); // texte clair ⇒ fond sombre
  const atmosphere = dark ? 'dark cosmic or deep studio atmosphere' : 'bright, airy high-key atmosphere';
  switch (style) {
    case 'full':
      return `Premium social media key visual (no text, no captions anywhere), cinematic photorealistic quality, full-frame scene, ${atmosphere}.
COLOR PALETTE (strict): background from ${p.bg1} to ${p.bg2}, ${p.accent} as the ONLY accent color — rim lights, glows, atmosphere and light trails — plus neutral white highlights.
COMPOSITION: one hero subject in the upper two thirds of the frame, seen from behind or in three-quarter view, a vast environment around it (space, horizon, haze); the lower third is empty — plain ${dark ? 'dark' : 'light'} atmosphere only, no objects, no ground details, no writing.
LIGHTING: strong contrast, dramatic rim light in ${p.accent}, volumetric haze, ${dark ? 'deep shadows' : 'soft shadows'}, ultra sharp subject, faint film grain.
EDGES: all four edges of the frame fade smoothly into ${p.bg1} — no bright elements touching the borders — so the image melts into the layout.
${NO_TEXT}`;
    case 'objets':
      return `Premium 3D product-style render of a single object, made to be cut out.
BACKGROUND (strict): perfectly uniform, flat, solid ${p.bg1} — no gradient, no floor, no cast shadow on the background, no environment, nothing else in the frame.
OBJECT: glossy 3D materials (glass, chrome, polished metal, ceramic) tinted with ${p.accent} and ${p.bg2}, soft studio reflections, slightly floating and tilted, centered, entirely inside the frame with a generous margin all around, clean sharp silhouette.
LIGHTING: soft studio key light plus a ${p.accent} rim light, ${dark ? 'deep contrast' : 'gentle contrast'}, ultra sharp, faint film grain.
${NO_TEXT}`;
    case 'chrome':
      return `Premium 3D render in liquid chrome and iridescent glass, ${atmosphere}.
OBJECT: a symbolic object made of mirror chrome and thick glass with refractions, dispersion and ${p.accent} / ${p.bg2} iridescent reflections, hyper detailed, centered in the upper 60% of the frame.
BACKGROUND: deep ${p.bg1} with a large ${p.accent} volumetric glow behind the object and subtle light rays; the lower 35% is empty — plain ${dark ? 'dark' : 'clean'} background only, no writing.
LIGHTING: studio lighting, strong specular highlights, high contrast, ultra sharp, faint film grain.
EDGES: all four edges fade smoothly into ${p.bg1}.
${NO_TEXT}`;
  }
}

/** Guide historique (bleu Odile, plein cadre) — conservé pour référence et tests. */
export const STYLE_GUIDE = styleGuide('full', DEFAULT_PALETTE);

/** Variante monochrome : imposée par le thème « encre-blanche » ou le réglage N&B. */
export const STYLE_GUIDE_MONO = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): pure BLACK AND WHITE — near-black background (#050506), neutral greys, white rim lights and highlights. Absolutely NO color of any kind, not even a tint: a fully desaturated, monochrome image.
ABSOLUTELY FORBIDDEN: any hue whatsoever (blue, orange, red, green, purple included); any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: dramatic studio lighting, volumetric light, strong white rim light, deep shadows, subtle atmospheric haze, faint film grain — editorial black-and-white photography feel.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into near-black — soft dark falloff, no bright elements touching the borders.`;

/** Variante monochrome claire : fond papier. */
export const STYLE_GUIDE_MONO_LIGHT = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): pure BLACK AND WHITE on a near-white paper background (#f4f4f6) — neutral greys, deep black shadows, white highlights. Absolutely NO color of any kind, not even a tint: a fully desaturated, monochrome image.
ABSOLUTELY FORBIDDEN: any hue whatsoever (blue, orange, red, green, purple included); any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: soft high-key studio lighting, gentle shadows, subtle atmospheric haze, faint film grain — editorial black-and-white photography feel.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into near-white (#f4f4f6) — soft light falloff, no dark elements touching the borders.`;

/** Guide « plein cadre » dans la palette d'un template (compatibilité). */
export function styleGuideForPalette(p: ThemePalette): string {
  return styleGuide('full', p);
}

export interface ImagePromptArgs {
  idea: string;
  archetypeId?: string | null;
  styleNotes?: string;
  instructions?: string;
  /** thème du post (palette intégrée ; « encre-blanche » impose le monochrome) */
  theme?: string | null;
  /** palette d'un template maison : prime sur le thème */
  palette?: ThemePalette | null;
  /** noir et blanc imposé (réglage « Illustrations en noir et blanc ») */
  monochrome?: boolean;
  /** style d'image ; sinon déduit de l'archétype */
  style?: ImageStyle | null;
}

/** Assemble le prompt final envoyé au générateur d'images. */
export function buildImagePrompt(args: ImagePromptArgs): string {
  const archetype = ARCHETYPES.find((a) => a.id === args.archetypeId);
  const palette = resolvePalette(args.theme, args.palette);
  const light = !isLightHex(palette.textColor);
  const mono = args.monochrome || args.theme === 'encre-blanche';
  const style = args.style ?? styleForArchetype(args.archetypeId);
  const guide = mono ? (light ? STYLE_GUIDE_MONO_LIGHT : STYLE_GUIDE_MONO) : styleGuide(style, palette);
  const parts = [
    `SUBJECT: ${args.idea}`,
    archetype?.imageComposition && style === 'full' ? `COMPOSITION TEMPLATE: ${archetype.imageComposition}` : null,
    guide,
    args.styleNotes ? `BRAND ART DIRECTION NOTES: ${args.styleNotes}` : null,
    args.instructions ? `SPECIFIC REVISION REQUEST: ${args.instructions}` : null,
  ];
  return parts.filter(Boolean).join('\n\n');
}
