import type { ToneSettings } from '@odile/shared';

const PRESET_DESCRIPTIONS: Record<ToneSettings['preset'], string> = {
  expert_accessible:
    "Expert accessible : tu maîtrises ton sujet mais tu parles comme à un ami dirigeant de PME, sans jargon. Pédagogue, concret, crédible.",
  ami_entrepreneur:
    "Ami entrepreneur : chaleureux, direct, tutoiement naturel, anecdotes terrain, enthousiasme sincère mais jamais survendu.",
  provocateur_bienveillant:
    "Provocateur bienveillant : tu bouscules les idées reçues (« arrêtez de payer pour ça »), tu crées la tension, mais toujours pour aider, jamais pour humilier.",
  custom: 'Ton personnalisé : suis strictement les instructions spécifiques ci-dessous.',
};

/** Convertit les réglages de ton du dashboard en directives de prompt. */
export function toneToPrompt(tone: ToneSettings): string {
  const lines: string[] = [PRESET_DESCRIPTIONS[tone.preset]];

  if (tone.registre <= 30) {
    lines.push('Registre : pointu et technique assumé (audience avertie), vouvoiement.');
  } else if (tone.registre <= 60) {
    lines.push('Registre : professionnel décontracté, tutoiement léger accepté, vocabulaire simple.');
  } else {
    lines.push('Registre : très décontracté et complice, tutoiement franc, phrases courtes et parlées.');
  }

  const emoji = ['Aucun emoji.', '1 à 2 emojis maximum, bien placés.', '3 à 5 emojis pour rythmer.', 'Emojis généreux (sans excès ridicule).'][tone.emojiLevel] ?? '1 à 2 emojis maximum.';
  lines.push(`Emojis : ${emoji}`);

  const cta = {
    question: "CTA : termine par une question ouverte qui appelle un commentaire.",
    direct: "CTA : impératif direct et assumé (« Commente », « Télécharge », « Teste »).",
    curiosite: "CTA : joue la curiosité (« la suite en DM », « le nom de l'outil en commentaire »).",
  }[tone.ctaStyle];
  lines.push(cta);

  if (tone.customInstructions) lines.push(`Instructions spécifiques : ${tone.customInstructions}`);

  lines.push(
    "IMPORTANT — ton humain : écris comme une vraie personne, pas comme une IA. Interdits : « révolutionnaire », « game-changer », « dans un monde où », les tirets cadratins mécaniques, les listes de 3 adjectifs, l'enthousiasme artificiel. Autorisés : opinions tranchées, chiffres précis, phrases courtes, imperfections naturelles.",
  );
  return lines.join('\n');
}
