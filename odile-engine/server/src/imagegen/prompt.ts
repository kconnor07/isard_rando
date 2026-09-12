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
/** Styles dont l'objet est détouré après génération (fond uni → PNG transparent). */
export const CUTOUT_STYLES: ImageStyle[] = ['objets', 'chrome'];
export const isCutoutStyle = (style: ImageStyle): boolean => CUTOUT_STYLES.includes(style);
export const IMAGE_STYLES: { id: ImageStyle; label: string; hint: string }[] = [
  { id: 'full', label: 'Plein cadre', hint: 'Scène cinématique, sujet en haut, titre en bas' },
  { id: 'objets', label: 'Objets détourés', hint: 'Objet 3D isolé, détouré, fondu à la palette' },
  { id: 'chrome', label: 'Chrome & verre', hint: 'Objet 3D chrome / verre irisé, détouré — le halo vient du template' },
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
  'ABSOLUTELY FORBIDDEN: any text, letters, numbers as typography, words, captions, titles, signatures, logos, watermarks, user interfaces, buttons; any hue outside the palette (and the signature colour, if one is given). The image contains no writing of any kind.';

/**
 * Fond des objets à détourer : gris neutre 50 %, sans lien avec la palette.
 * Le détourage local sépare mal un objet sombre d'un fond sombre ; le gris
 * moyen contraste avec les objets clairs comme sombres et ne teinte pas les
 * reflets (contrairement à un vert chroma).
 */
export const CUTOUT_BACKGROUND = '#7f7f7f';

/** Guide de style d'un mode, dans la palette donnée (+ couleur signature éventuelle). */
export function styleGuide(style: ImageStyle, p: ThemePalette, pop?: string | null): string {
  const dark = isLightHex(p.textColor); // texte clair ⇒ fond sombre
  const atmosphere = dark ? 'dark cosmic or deep studio atmosphere' : 'bright, airy high-key atmosphere';
  switch (style) {
    case 'full':
      return `Premium social media key visual (no text, no captions anywhere), cinematic photorealistic quality, full-frame scene, ${atmosphere}, vivid and punchy colours, deep blacks, crisp highlights.
COLOR PALETTE (strict): background from ${p.bg1} to ${p.bg2}, ${p.accent} for rim lights, glows, atmosphere and light trails, plus neutral white highlights.${
        pop
          ? `
SIGNATURE COLOUR: the hero subject carries ONE vivid, highly saturated signature colour, ${pop} (its garment, cape, shell, glow or material), strongly lit so it pops against the palette. Nothing else in the image uses that colour.`
          : ''
      }
COMPOSITION: one hero subject in the upper two thirds of the frame, fairly small (25–40 % of the frame height), seen from behind or in three-quarter view, a vast environment around it (space, horizon glow at 55–65 % of the height, haze); the lower third is empty — plain ${dark ? 'dark' : 'light'} atmosphere only, no objects, no ground details, no writing.
LIGHTING: strong contrast, dramatic rim light in ${p.accent}, volumetric haze, ${dark ? 'deep shadows' : 'soft shadows'}, ultra sharp subject, faint film grain.
EDGES: all four edges of the frame fade smoothly into ${p.bg1} — no bright elements touching the borders — so the image melts into the layout.
${NO_TEXT}`;
    case 'objets':
      return `Premium 3D product-style render of a single object, made to be cut out.
BACKGROUND (strict): perfectly uniform, flat, solid neutral mid-grey ${CUTOUT_BACKGROUND} (a chroma-key grey) — no gradient, no floor, no cast shadow on the background, no vignette, no environment, nothing else in the frame.
OBJECT: glossy 3D materials (glass, chrome, polished metal, ceramic) tinted with ${p.accent} and ${p.bg2}${pop ? `, with a discreet ${pop} highlight` : ''}, soft studio reflections, slightly floating and tilted, centered, entirely inside the frame with a generous margin all around (nothing touches the borders), clean sharp silhouette.
LIGHTING: soft studio key light plus a ${p.accent} rim light, ${dark ? 'deep contrast' : 'gentle contrast'}, ultra sharp, faint film grain.
${NO_TEXT}`;
    case 'chrome':
      return `Premium 3D render of a single symbolic object in liquid chrome and iridescent glass, made to be cut out.
OBJECT: mirror chrome and thick glass with refractions, dispersion and ${p.accent} / ${p.bg2}${pop ? ` / ${pop}` : ''} iridescent reflections, hyper detailed, ultra sharp, slightly tilted, centered, entirely inside the frame with a generous margin all around (nothing touches the borders), clean sharp silhouette.
BACKGROUND (strict): perfectly uniform, flat, solid neutral mid-grey ${CUTOUT_BACKGROUND} (a chroma-key grey) — no glow, no gradient, no floor, no cast shadow on the background, no vignette, no environment, nothing else in the frame.
LIGHTING: studio lighting with a ${p.accent} rim light and strong specular highlights, ${dark ? 'high contrast' : 'gentle contrast'}, faint film grain.
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
  /** une image de référence accompagne la requête : on précise son rôle */
  hasReference?: boolean;
  /** consignes propres au style (réglages) */
  styleSpecificNotes?: string;
  /** couleur signature vive portée par le sujet (plein cadre) ou en reflet (objets) */
  popColor?: string | null;
  /** série d'objets : même matière, même lumière que l'image de référence (le 1er objet) */
  seriesOf?: string;
}

/** Assemble le prompt final envoyé au générateur d'images. */
export function buildImagePrompt(args: ImagePromptArgs): string {
  const archetype = ARCHETYPES.find((a) => a.id === args.archetypeId);
  const palette = resolvePalette(args.theme, args.palette);
  const light = !isLightHex(palette.textColor);
  const mono = args.monochrome || args.theme === 'encre-blanche';
  const style = args.style ?? styleForArchetype(args.archetypeId);
  // Un objet à détourer garde son guide (fond gris neutre) même en monochrome : la scène N&B plein cadre ne se détoure pas
  const guide = mono && !isCutoutStyle(style) ? (light ? STYLE_GUIDE_MONO_LIGHT : STYLE_GUIDE_MONO) : styleGuide(style, palette, mono ? null : args.popColor);
  const parts = [
    `SUBJECT: ${args.idea}`,
    mono && isCutoutStyle(style)
      ? 'MONOCHROME: the object is fully desaturated (chrome, glass, greys, white highlights), no hue at all; the background stays the flat neutral mid-grey.'
      : null,
    archetype?.imageComposition && style === 'full' ? `COMPOSITION TEMPLATE: ${archetype.imageComposition}` : null,
    guide,
    args.seriesOf
      ? `SAME SERIES: this object belongs to the same set as the reference image (« ${args.seriesOf} ») — identical material, finish, lighting, camera angle and background; only the object itself changes.`
      : args.hasReference
        ? 'REFERENCE IMAGE: match its rendering quality, lighting, contrast, depth and mood — NOT its subject, characters or text. Keep the subject described above.'
        : null,
    args.styleNotes ? `BRAND ART DIRECTION NOTES: ${args.styleNotes}` : null,
    args.styleSpecificNotes ? `STYLE NOTES: ${args.styleSpecificNotes}` : null,
    args.instructions ? `SPECIFIC REVISION REQUEST: ${args.instructions}` : null,
  ];
  return parts.filter(Boolean).join('\n\n');
}
