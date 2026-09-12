/**
 * Pied de marque des slides : quel bloc afficher (logo seul, carré aux
 * initiales + nom + handle, logo réduit + nom + handle, marque seule, rien)
 * — une seule règle partagée par le rendu final et l'aperçu des templates.
 */
import type { BrandSettings } from '@odile/shared';

export type BrandStyle = 'logo' | 'initiales' | 'logo-nom' | 'marque' | 'aucun';
export type TemplateBrandStyle = 'auto' | 'logo' | 'initiales' | 'logo-nom' | 'aucun';

/** Initiales du carré de marque : celles du réglage, sinon déduites du nom (« Odile AI » → OA). */
export function brandInitials(brand: Pick<BrandSettings, 'name'> & { initials?: string }): string {
  const forced = (brand.initials ?? '').trim();
  if (forced) return forced.slice(0, 3).toUpperCase();
  return brand.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Style effectif du pied de marque.
 * - `auto` suit le réglage de la marque (Réglages → Marque).
 * - sans logo, les styles qui en dépendent retombent sur les initiales.
 * - avec la chip auteur (nom + ligne déjà en haut), on évite le doublon :
 *   logo seul s'il existe, sinon le carré de marque seul.
 */
export function resolveBrandStyle(
  requested: TemplateBrandStyle | null | undefined,
  brand: { footerStyle?: BrandSettings['footerStyle'] },
  opts: { hasLogo: boolean; authorOn: boolean },
): BrandStyle {
  let style: BrandStyle = !requested || requested === 'auto' ? (brand.footerStyle ?? 'initiales') : requested;
  if (style === 'aucun') return style;
  if ((style === 'logo' || style === 'logo-nom') && !opts.hasLogo) style = 'initiales';
  if (opts.authorOn && (style === 'initiales' || style === 'logo-nom')) style = opts.hasLogo ? 'logo' : 'marque';
  return style;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** HTML du bloc de marque (chaîne vide pour `aucun`). */
export function brandBlockHtml(
  style: BrandStyle,
  brand: Pick<BrandSettings, 'name' | 'handle'> & { initials?: string },
  wordmarkUri: string | null,
): string {
  const mark = `<div class="brand-mark">${esc(brandInitials(brand))}</div>`;
  const logoIcon = wordmarkUri ? `<img class="brand-logo" src="${wordmarkUri}" alt="" />` : mark;
  const names = `<div class="brand-text"><div class="brand-name">${esc(brand.name)}</div><div class="brand-handle">${esc(brand.handle)}</div></div>`;
  switch (style) {
    case 'aucun':
      return '';
    case 'logo':
      return wordmarkUri ? `<img class="brand-wordmark" src="${wordmarkUri}" alt="${esc(brand.name)}" />` : `<div class="brand-id">${mark}${names}</div>`;
    case 'logo-nom':
      return `<div class="brand-id">${logoIcon}${names}</div>`;
    case 'marque':
      return `<div class="brand-id">${mark}</div>`;
    case 'initiales':
    default:
      return `<div class="brand-id">${mark}${names}</div>`;
  }
}
