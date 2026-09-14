/**
 * Émojis dans les visuels.
 *
 * Les slides sont rendues par Chromium sur le serveur : les émojis y prennent la
 * forme de la police installée dans le conteneur (Noto Color Emoji, style Google).
 * La police Apple Color Emoji ne peut pas être embarquée — sa licence la réserve
 * aux appareils Apple — donc aucun réglage ne peut donner des émojis Apple dans
 * l'image elle-même.
 *
 * Le réglage « aucun » les retire des visuels et les laisse dans la légende, où
 * ils sont dessinés par l'appareil du lecteur : émojis Apple sur iPhone, Android
 * sur Android. C'est la seule façon d'obtenir le rendu Apple, et elle est native.
 */

/** Séquence émoji complète : base, sélecteur de variante, modificateurs de teinte, liaisons ZWJ, drapeaux. */
const EMOJI = String.raw`(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*)`;
const ESPACES = String.raw`[ \t\u00A0\u202F]`;
/** Un ou plusieurs émojis avec les espaces qui les entourent : c'est le tout qui disparaît. */
const BLOC = new RegExp(`${ESPACES}*(?:${EMOJI}${ESPACES}*)+`, 'gu');
const UN_EMOJI = new RegExp(EMOJI, 'u');

/** Y a-t-il au moins un émoji ? (utile pour ne transformer que ce qui le mérite) */
export function hasEmoji(text: string): boolean {
  return UN_EMOJI.test(text);
}

/**
 * Retire les émojis d'un texte destiné à une slide, et referme le trou : l'espace
 * qui les entourait redevient un espace simple au milieu d'une phrase, et rien du
 * tout en début ou en fin de ligne (« Devis signé ✅ · Relance ⏱️ » → « Devis signé
 * · Relance »).
 *
 * Un texte sans émoji ressort identique au caractère près — en particulier les
 * espaces fines insécables de la typographie française (« signé ? »), qu'un
 * nettoyage trop large écraserait.
 */
export function stripEmoji(text: string): string {
  if (!hasEmoji(text)) return text;
  const sansEmoji = text.replace(BLOC, (bloc, decalage: number) => {
    const avant = text.slice(0, decalage).replace(/\n[^]*$/, '');
    const apres = text.slice(decalage + bloc.length).replace(/^[^]*?\n/, (m) => (m.includes('\n') ? '\n' : m));
    const debutDeLigne = avant === '' || avant.endsWith('\n');
    const finDeLigne = apres === '' || apres.startsWith('\n');
    return debutDeLigne || finDeLigne ? '' : ' ';
  });
  return sansEmoji
    .split('\n')
    .map((ligne) => ligne.replace(/\s*[·•]\s*$/, '').replace(/^\s*[·•]\s*/, '').trim())
    .join('\n')
    .trim();
}
