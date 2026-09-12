/**
 * Objets flottants : détourages posés en périphérie des slides (pièces 3D,
 * produits…). CSS partagé entre les templates maison (objets du template) et
 * le rendu d'un post (objets choisis par l'agent visuel pour ce post).
 * Jusqu'à 4 emplacements ; « 4-coins » les pose aux quatre angles.
 */

export type FloatLayout = 'coins' | 'haut' | 'bas' | 'cotes' | '4-coins';

interface Anchor {
  /** côté horizontal et vertical de l'ancrage */
  h: 'left' | 'right';
  v: 'top' | 'bottom';
  /** décalages (en % de la largeur) quand l'objet reste dans le cadre / déborde */
  inset: [number, number];
  bleed: [number, number];
  /** sens de l'inclinaison */
  tilt: 1 | -1;
  /** miroir horizontal (variété quand un même objet est réutilisé) */
  flip?: boolean;
}

const TL: Anchor = { h: 'left', v: 'top', inset: [6, 4], bleed: [-9, -5], tilt: -1 };
const TR: Anchor = { h: 'right', v: 'top', inset: [6, 4], bleed: [-9, -5], tilt: 1, flip: true };
const BL: Anchor = { h: 'left', v: 'bottom', inset: [6, 5], bleed: [-9, -5], tilt: 1, flip: true };
const BR: Anchor = { h: 'right', v: 'bottom', inset: [6, 5], bleed: [-9, -5], tilt: -1 };
const ML: Anchor = { h: 'left', v: 'top', inset: [-2, 34], bleed: [-12, 34], tilt: -1 };
const MR: Anchor = { h: 'right', v: 'top', inset: [-2, 34], bleed: [-12, 34], tilt: 1, flip: true };

const LAYOUTS: Record<FloatLayout, Anchor[]> = {
  coins: [TL, BR, TR, BL],
  haut: [TL, TR, BL, BR],
  bas: [BL, BR, TL, TR],
  cotes: [ML, MR, TL, BR],
  '4-coins': [TL, TR, BL, BR],
};
/** Avec la chip auteur en haut à gauche, on libère ce coin. */
const MIRRORED: Partial<Record<FloatLayout, Anchor[]>> = {
  coins: [TR, BL, BR, TL],
  haut: [TR, BR, BL, TL],
  '4-coins': [TR, BL, BR, { ...TL, inset: [6, 14], bleed: [-9, 12] }],
};

export interface FloatCssOpts {
  uris: (string | null)[];
  size: number;
  layout: FloatLayout;
  mirrored?: boolean;
  darkTheme?: boolean;
  /** les objets débordent du cadre */
  bleed?: boolean;
  /** inclinaison en degrés, 0-30 */
  tilt?: number;
  /** le coin haut-droit est occupé (badge vérifié) : l'objet miroir y laisse la place */
  topRightBusy?: boolean;
}

export function floatCss(opts: FloatCssOpts): string {
  let anchors = (opts.mirrored ? MIRRORED[opts.layout] : undefined) ?? LAYOUTS[opts.layout] ?? LAYOUTS.coins;
  if (opts.mirrored && opts.topRightBusy && (opts.layout === 'coins' || opts.layout === 'haut')) {
    // Chip auteur à gauche ET badge vérifié à droite : le 1er objet descend, le coin haut-droit reste rentré
    anchors = [BL, BR, { ...TR, inset: [6, 14], bleed: [-9, 12] }, TL];
  }
  const width = Math.round((1080 * Math.min(60, Math.max(10, opts.size))) / 100);
  const tilt = Math.min(30, Math.max(0, opts.tilt ?? 12));
  const shadow = opts.darkTheme === false
    ? 'drop-shadow(0 24px 36px rgba(11, 11, 14, 0.28))'
    : 'drop-shadow(0 34px 44px rgba(0, 0, 0, 0.55))';
  const used = opts.uris.slice(0, 4).map((uri, i) => (uri ? anchors[i] : undefined)).filter((a): a is Anchor => Boolean(a));
  const bottomRight = used.some((a) => a.v === 'bottom' && a.h === 'right');
  const bottomLeft = used.some((a) => a.v === 'bottom' && a.h === 'left');
  // Un objet dans un coin bas : le logo et le compteur se regroupent de l'autre côté (ou au centre)
  const footer =
    bottomRight && bottomLeft
      ? '.floats-on .brand-footer { justify-content: center; gap: 28px; }\n.floats-on.brand-bas-centre .slide-counter { position: static; margin-left: 28px; }'
      : bottomRight
        ? '.floats-on .brand-footer { justify-content: flex-start; gap: 28px; }\n.floats-on.brand-bas-centre .slide-counter { right: auto; left: 0; }'
        : bottomLeft
          ? '.floats-on .brand-footer { justify-content: flex-end; gap: 28px; }'
          : '';
  return [footer, ...opts.uris
    .slice(0, 4)
    .map((uri, i) => {
      const a = anchors[i];
      if (!uri || !a) return '';
      // Débordement : proportionnel à l'objet (≈ un quart sort du cadre), pas au canevas
      const pos = opts.bleed
        ? `${a.h}: ${a.bleed[0] < 0 ? -Math.round(width * 0.24) : Math.round((a.bleed[0] * 1080) / 100)}px; ${a.v}: ${a.bleed[1] < 0 ? -Math.round(width * 0.2) : Math.round((a.bleed[1] * 1350) / 100)}px;`
        : `${a.h}: ${a.inset[0]}%; ${a.v}: ${a.inset[1]}%;`;
      const transform = `rotate(${a.tilt * tilt}deg)${a.flip ? ' scaleX(-1)' : ''}`;
      return `.floats-on .float-${i + 1} { display: block; ${pos} width: ${width}px; height: ${width}px; transform: ${transform};
  background-image: url(${uri}); background-size: contain; background-position: center; background-repeat: no-repeat;
  filter: ${shadow}; }`;
    })]
    .filter(Boolean)
    .join('\n');
}

export type FloatSlides = 'centrees' | 'accroche' | 'toutes';
/** Kinds de slides dont la mise en page est centrée : les objets aux coins n'y gênent pas le texte. */
export const CENTERED_KINDS = new Set(['hook', 'value_prop', 'cta', 'echo']);

/** Cette slide reçoit-elle les objets flottants ? */
export function floatsOnSlide(kind: string, mode: FloatSlides = 'centrees'): boolean {
  if (mode === 'toutes') return true;
  if (mode === 'accroche') return kind === 'hook';
  return CENTERED_KINDS.has(kind);
}
