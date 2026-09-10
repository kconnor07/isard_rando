/**
 * Objets flottants : détourages posés en périphérie des slides (pièces 3D,
 * produits…). CSS partagé entre les templates maison (objets du template) et
 * le rendu d'un post (objets choisis par l'agent visuel pour ce post).
 */

export type FloatLayout = 'coins' | 'haut' | 'bas' | 'cotes';

const ANCHORS: Record<FloatLayout, [string, string]> = {
  coins: ['top: -4%; left: -9%; transform: rotate(-14deg);', 'bottom: -3%; right: -9%; transform: rotate(12deg);'],
  haut: ['top: -5%; left: -8%; transform: rotate(-10deg);', 'top: -5%; right: -8%; transform: rotate(10deg);'],
  bas: ['bottom: -4%; left: -8%; transform: rotate(10deg);', 'bottom: -4%; right: -8%; transform: rotate(-10deg);'],
  cotes: ['top: 34%; left: -12%; transform: rotate(-8deg);', 'top: 34%; right: -12%; transform: rotate(8deg);'],
};
/** Avec la chip auteur en haut à gauche, on libère ce coin. */
const MIRRORED: Partial<Record<FloatLayout, [string, string]>> = {
  coins: ['top: -4%; right: -9%; transform: rotate(14deg);', 'bottom: -3%; left: -9%; transform: rotate(-12deg);'],
  haut: ['top: 16%; right: -10%; transform: rotate(10deg);', 'top: 16%; left: -10%; transform: rotate(-10deg); display: none;'],
};

export function floatCss(opts: {
  uris: [string | null, string | null];
  size: number;
  layout: FloatLayout;
  mirrored?: boolean;
  darkTheme?: boolean;
}): string {
  const anchors = (opts.mirrored ? MIRRORED[opts.layout] : undefined) ?? ANCHORS[opts.layout] ?? ANCHORS.coins;
  const width = Math.round((1080 * Math.min(60, Math.max(10, opts.size))) / 100);
  const shadow = opts.darkTheme === false
    ? 'drop-shadow(0 24px 36px rgba(11, 11, 14, 0.28))'
    : 'drop-shadow(0 34px 44px rgba(0, 0, 0, 0.55))';
  return opts.uris
    .map((uri, i) =>
      uri
        ? `.float-${i + 1} { display: block; ${anchors[i]} width: ${width}px; height: ${width}px;
  background-image: url(${uri}); background-size: contain; background-position: center; background-repeat: no-repeat;
  filter: ${shadow}; }`
        : '',
    )
    .join('\n');
}
