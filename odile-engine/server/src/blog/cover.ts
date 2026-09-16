/**
 * Image de couverture d'un article, aux couleurs du template par défaut.
 *
 * Rien n'est réinventé : mêmes polices, même feuille de base, même CSS de thème
 * que les slides (buildCustomThemeCss), même style d'accroche (slideStyleFor).
 * Seul un calque de mise en page paysage s'ajoute — le canevas des slides est
 * 1080×1350, une couverture d'article est 1200×630 (format Open Graph).
 */
import { getBrand, getDefaultTheme } from '../db/settingsRepo.js';
import { buildCustomThemeCss, getCustomTheme, slideStyleFor } from '../render/custom-theme.js';
import { assetDataUri, escapeHtml, frTypo, renderHtmlToPng, saveAsset } from '../render/renderer.js';
import { baseCss, defaultBrandLogoDataUri, fontFaceCss, themeCss } from '../render/themes.js';

export const COVER_SIZE = { width: 1200, height: 630 };

/** Titre avec son mot fort mis en accent, comme sur une slide d'accroche. */
function titreAccentue(titre: string, motFort: string): string {
  const t = escapeHtml(frTypo(titre));
  const mot = motFort.trim();
  if (!mot) return t;
  const idx = t.toLowerCase().indexOf(escapeHtml(mot).toLowerCase());
  if (idx === -1) return t;
  return `${t.slice(0, idx)}<span class="accent">${t.slice(idx, idx + mot.length)}</span>${t.slice(idx + mot.length)}`;
}

export function coverHtml(args: { title: string; accentWord: string; kicker?: string }): string {
  const themeId = getDefaultTheme();
  const custom = getCustomTheme(themeId);
  const couleurs = custom ? buildCustomThemeCss(custom) : themeCss(themeId);
  const style = slideStyleFor(custom, {}, 'hook');
  const brand = getBrand();
  const logo = assetDataUri(brand.logoAssetId) ?? defaultBrandLogoDataUri();
  const classes = ['slide', 'kind-hook', 'format-carousel', `brand-style-${style.brandStyle}`, ...style.classes].join(' ');
  const paysage = `
html, body, .slide { width: ${COVER_SIZE.width}px; height: ${COVER_SIZE.height}px; }
/* Le décor est ancré sur 1080×1350 : on le recadre sans le déformer */
.decor-1, .decor-2, .decor-3, .slide::before { transform: translate(120px, -260px) scale(0.9); transform-origin: 50% 50%; }
.safe { position: absolute; z-index: 6; left: 84px; right: 84px; top: 0; bottom: 0; padding: 64px 0 120px; }
.stack { max-width: 100%; gap: 28px; }
.title { font-size: 62px; line-height: 1.04; text-wrap: balance; }
.kicker { font-family: 'Fragment Mono', monospace; font-size: 18px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.7; }
.brand-footer { left: 84px; right: 84px; bottom: 44px; }
.author-chip, .verified-badge, .counter { display: none; }
`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
${fontFaceCss()}
${baseCss()}
${couleurs}
${paysage}
</style></head><body>
<div class="${classes}" style="${style.style}">
  <div class="bg"></div>
  <div class="decor-1"></div><div class="decor-2"></div><div class="decor-3"></div>
  <div class="safe"><div class="stack">
    ${args.kicker ? `<div class="kicker">${escapeHtml(args.kicker)}</div>` : ''}
    <h1 class="title">${titreAccentue(args.title, args.accentWord)}</h1>
  </div></div>
  <footer class="brand-footer">
    <div class="brand-id">${logo ? `<img class="brand-wordmark" src="${logo}" alt="${escapeHtml(brand.name)}">` : `<span>${escapeHtml(brand.name)}</span>`}</div>
  </footer>
  <div class="grain"></div>
</div>
</body></html>`;
}

/** Rend la couverture et l'enregistre comme asset (PNG, servi en JPEG par /public-assets). */
export async function fabriquerCouverture(args: { title: string; accentWord: string; kicker?: string; articleId: number }): Promise<string> {
  const png = await renderHtmlToPng(coverHtml(args), COVER_SIZE, { scale: 2 });
  return saveAsset(png, 'cover', { extraMeta: { articleId: args.articleId } }, COVER_SIZE);
}
