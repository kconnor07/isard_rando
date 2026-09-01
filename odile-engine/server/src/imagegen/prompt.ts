import { ARCHETYPES } from '@odile/shared';

/**
 * Guide de style permanent : tout visuel généré doit être immédiatement
 * reconnaissable comme un visuel Odile — bleu électrique sur marine profond,
 * cinématique, premium. Le texte vit dans la couche HTML, JAMAIS dans l'image.
 */
export const STYLE_GUIDE = `Premium social media advertising visual, cinematic photorealistic 3D render quality.
COLOR PALETTE (strict): deep navy / near-black background (#050510), electric blue (#0099FF) as the ONLY accent color — rim lights, glows, halos and light trails are electric blue or cool white. Subtle cool cyan-blue gradients allowed.
ABSOLUTELY FORBIDDEN: warm tones, orange, red, yellow, gold, green; any text, letters, numbers as typography, words, logos, watermarks, user interfaces, buttons.
LIGHTING: dramatic studio lighting, volumetric light, strong rim light, deep shadows, subtle atmospheric haze, faint film grain.
COMPOSITION: one single strong subject, generous negative space reserved for a headline overlay, balanced vertical 4:5 composition, high-end production value like a top-tier brand campaign.`;

export interface ImagePromptArgs {
  idea: string;
  archetypeId?: string | null;
  styleNotes?: string;
  instructions?: string;
}

/** Assemble le prompt final envoyé au générateur d'images. */
export function buildImagePrompt(args: ImagePromptArgs): string {
  const archetype = ARCHETYPES.find((a) => a.id === args.archetypeId);
  const parts = [
    `SUBJECT: ${args.idea}`,
    archetype?.imageComposition ? `COMPOSITION TEMPLATE: ${archetype.imageComposition}` : null,
    STYLE_GUIDE,
    args.styleNotes ? `BRAND ART DIRECTION NOTES: ${args.styleNotes}` : null,
    args.instructions ? `SPECIFIC REVISION REQUEST: ${args.instructions}` : null,
  ];
  return parts.filter(Boolean).join('\n\n');
}
