import { ARCHETYPES } from '@odile/shared';
import { isLightHex } from '../lib/color.js';

/**
 * Guide de style permanent : tout visuel généré doit être immédiatement
 * reconnaissable comme un visuel Odile — bleu électrique sur marine profond,
 * cinématique, premium. Le texte vit dans la couche HTML, JAMAIS dans l'image.
 */
export const STYLE_GUIDE = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): deep navy / near-black background (#050510), electric blue (#0099FF) as the ONLY accent color — rim lights, glows, halos and light trails are electric blue or cool white. Subtle cool cyan-blue gradients allowed.
ABSOLUTELY FORBIDDEN: warm tones, orange, red, yellow, gold, green, purple, violet, magenta; any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: dramatic studio lighting, volumetric light, strong rim light, deep shadows, subtle atmospheric haze, faint film grain.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into near-black deep navy (#050510) — soft dark falloff, no bright elements touching the borders — so the image melts seamlessly into a dark layout around it.`;

/** Variante monochrome : imposée par le thème « encre-blanche ». */
export const STYLE_GUIDE_MONO = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): pure BLACK AND WHITE — near-black background (#050506), neutral greys, white rim lights and highlights. Absolutely NO color of any kind, not even a tint: a fully desaturated, monochrome image.
ABSOLUTELY FORBIDDEN: any hue whatsoever (blue, orange, red, green, purple included); any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: dramatic studio lighting, volumetric light, strong white rim light, deep shadows, subtle atmospheric haze, faint film grain — editorial black-and-white photography feel.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into near-black — soft dark falloff, no bright elements touching the borders.`;

/** Variante monochrome claire : imposée par le thème « papier-blanc ». */
export const STYLE_GUIDE_MONO_LIGHT = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): pure BLACK AND WHITE on a near-white paper background (#f4f4f6) — neutral greys, deep black shadows, white highlights. Absolutely NO color of any kind, not even a tint: a fully desaturated, monochrome image.
ABSOLUTELY FORBIDDEN: any hue whatsoever (blue, orange, red, green, purple included); any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: soft high-key studio lighting, gentle shadows, subtle atmospheric haze, faint film grain — editorial black-and-white photography feel.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into near-white (#f4f4f6) — soft light falloff, no dark elements touching the borders.`;

/** Palette d'un template maison (onglet Templates). */
export interface ThemePalette {
  bg1: string;
  bg2: string;
  accent: string;
  textColor: string;
}

/**
 * Guide de style d'un template maison : même grammaire visuelle que le guide
 * Odile, mais sa palette remplace le bleu électrique — l'illustration reste
 * harmonisée avec les couleurs choisies par l'utilisateur.
 */
export function styleGuideForPalette(p: ThemePalette): string {
  const dark = isLightHex(p.textColor); // texte clair ⇒ fond sombre
  return `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): ${dark ? 'deep' : 'bright, airy'} background ${p.bg1} (a subtle gradient toward ${p.bg2} is allowed), ${p.accent} as the ONLY accent color — rim lights, glows, halos and light trails are ${p.accent} or ${dark ? 'cool white' : 'deep black'}.
ABSOLUTELY FORBIDDEN: any hue other than ${p.accent} (no other color whatsoever, only neutral greys besides it); any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: ${dark ? 'dramatic studio lighting, volumetric light, strong rim light, deep shadows' : 'soft high-key studio lighting, gentle shadows'}, subtle atmospheric haze, faint film grain.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.
EDGES: all four edges of the frame fade smoothly into ${p.bg1} — soft falloff, no ${dark ? 'bright' : 'dark'} elements touching the borders — so the image melts seamlessly into the layout around it.`;
}

export interface ImagePromptArgs {
  idea: string;
  archetypeId?: string | null;
  styleNotes?: string;
  instructions?: string;
  /** thème du post : « encre-blanche » / « papier-blanc » imposent le monochrome */
  theme?: string | null;
  /** palette d'un template maison : prime sur le thème */
  palette?: ThemePalette | null;
  /** noir et blanc imposé (réglage « Illustrations en noir et blanc ») */
  monochrome?: boolean;
}

/** Le fond du thème est-il clair ? (papier-blanc, ou template au texte sombre) */
function hasLightBackground(args: ImagePromptArgs): boolean {
  if (args.palette) return !isLightHex(args.palette.textColor);
  return args.theme === 'papier-blanc';
}

/** Assemble le prompt final envoyé au générateur d'images. */
export function buildImagePrompt(args: ImagePromptArgs): string {
  const archetype = ARCHETYPES.find((a) => a.id === args.archetypeId);
  const guide = args.monochrome
    ? hasLightBackground(args)
      ? STYLE_GUIDE_MONO_LIGHT
      : STYLE_GUIDE_MONO
    : args.palette
      ? styleGuideForPalette(args.palette)
      : args.theme === 'encre-blanche'
        ? STYLE_GUIDE_MONO
        : args.theme === 'papier-blanc'
          ? STYLE_GUIDE_MONO_LIGHT
          : STYLE_GUIDE;
  const parts = [
    `SUBJECT: ${args.idea}`,
    archetype?.imageComposition ? `COMPOSITION TEMPLATE: ${archetype.imageComposition}` : null,
    guide,
    args.styleNotes ? `BRAND ART DIRECTION NOTES: ${args.styleNotes}` : null,
    args.instructions ? `SPECIFIC REVISION REQUEST: ${args.instructions}` : null,
  ];
  return parts.filter(Boolean).join('\n\n');
}
