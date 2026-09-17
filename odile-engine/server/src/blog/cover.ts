/**
 * Image de couverture d'un article, aux couleurs du template par défaut.
 *
 * Rien n'est réinventé : mêmes polices, même feuille de base, même CSS de thème
 * que les slides (buildCustomThemeCss), même style d'accroche (slideStyleFor).
 * Seul un calque de mise en page paysage s'ajoute.
 *
 * DEUX PIÈGES, et ce que le module en fait :
 *
 * 1. Les proportions. Un site ne montre pas une couverture comme un réseau
 *    social : la carte d'un article, la bannière d'en-tête et l'aperçu de partage
 *    n'ont pas le même cadre. Le format se règle donc (Réglages du blog), au lieu
 *    d'être figé sur le 1,91:1 des réseaux.
 *
 * 2. Le rognage responsive. Framer — comme tout site moderne — affiche l'image en
 *    `cover` : elle remplit son cadre et déborde. Un titre qui occupe toute la
 *    largeur se retrouve donc amputé dès que l'écran change de forme. D'où la
 *    ZONE SÛRE : tout ce qui est écrit tient dans un carré centré, la plus petite
 *    forme qu'un recadrage puisse produire. Le décor, lui, peut déborder : c'est
 *    son rôle.
 */
import type { BlogSettings } from '@odile/shared';
import { getBlog, getBrand, getDefaultTheme } from '../db/settingsRepo.js';
import { buildCustomThemeCss, getCustomTheme, slideStyleFor } from '../render/custom-theme.js';
import { assetDataUri, escapeHtml, frTypo, renderHtmlToPng, saveAsset } from '../render/renderer.js';
import { baseCss, defaultBrandLogoDataUri, fontFaceCss, themeCss } from '../render/themes.js';

export type CoverRatio = BlogSettings['coverRatio'];

/**
 * Canevas de rendu par format (le rendu est ensuite suréchantillonné ×2).
 * La largeur reste à 1200 px pour que la typographie garde les mêmes proportions
 * d'un format à l'autre ; seul le carré part sur 1080, comme les slides.
 */
export const COVER_SIZES: Record<CoverRatio, { width: number; height: number }> = {
  '16:9': { width: 1200, height: 675 },
  '1.91:1': { width: 1200, height: 628 },
  '3:2': { width: 1200, height: 800 },
  '4:3': { width: 1200, height: 900 },
  '1:1': { width: 1080, height: 1080 },
};

/** Format par défaut (Open Graph), conservé pour les appels qui n'en précisent pas. */
export const COVER_SIZE = COVER_SIZES['16:9'];

export function tailleCouverture(ratio: CoverRatio = '16:9'): { width: number; height: number } {
  return COVER_SIZES[ratio] ?? COVER_SIZES['16:9'];
}

/** Titre avec son mot fort mis en accent, comme sur une slide d'accroche. */
function titreAccentue(titre: string, motFort: string): string {
  const t = escapeHtml(frTypo(titre));
  const mot = motFort.trim();
  if (!mot) return t;
  const idx = t.toLowerCase().indexOf(escapeHtml(mot).toLowerCase());
  if (idx === -1) return t;
  return `${t.slice(0, idx)}<span class="accent">${t.slice(idx, idx + mot.length)}</span>${t.slice(idx + mot.length)}`;
}

export interface CoverOptions {
  title: string;
  accentWord: string;
  kicker?: string;
  ratio?: CoverRatio;
  texte?: BlogSettings['coverText'];
  zoneSure?: boolean;
}

export function coverHtml(args: CoverOptions): string {
  const ratio = args.ratio ?? '16:9';
  const texte = args.texte ?? 'titre';
  const zoneSure = args.zoneSure ?? true;
  const { width, height } = tailleCouverture(ratio);
  const themeId = getDefaultTheme();
  const custom = getCustomTheme(themeId);
  const couleurs = custom ? buildCustomThemeCss(custom) : themeCss(themeId);
  const style = slideStyleFor(custom, {}, 'hook');
  const brand = getBrand();
  const logo = assetDataUri(brand.logoAssetId) ?? defaultBrandLogoDataUri();
  const classes = ['slide', 'kind-hook', 'format-carousel', `brand-style-${style.brandStyle}`, ...style.classes].join(' ');

  // ZONE SÛRE. Un site affiche l'image en « cover » : elle remplit son cadre et
  // déborde, différemment selon la largeur de l'écran. Le texte tient donc dans
  // l'intersection des recadrages plausibles — un carré centré en largeur, une
  // bande 4:3 en hauteur. Le décor, lui, occupe toute l'image : qu'il soit rogné
  // ne coûte rien, c'est même ce qu'on lui demande.
  const marge = Math.round(width * 0.06);
  const boiteL = zoneSure ? Math.min(width - 2 * marge, height) : width - 2 * marge;
  const boiteH = zoneSure ? Math.min(height, Math.round((width * 3) / 4)) : height;
  const insetX = Math.round((width - boiteL) / 2);
  const insetY = Math.round((height - boiteH) / 2);
  const padding = Math.round(boiteL * 0.07);
  const interieur = boiteL - 2 * padding;
  // Le titre suit la largeur de sa colonne : une colonne étroite ne doit pas
  // produire quatre mots par ligne (le FIT_SCRIPT réduit ensuite s'il le faut).
  const tailleTitre = Math.max(34, Math.min(66, Math.round(interieur * 0.105)));
  // Place réservée au pied de marque, sous le texte : sans elle, le logo et le
  // titre se chevauchent dès que la zone sûre resserre la boîte.
  const hauteurPied = padding + Math.round(tailleTitre * 1.9);
  // Le décor est ancré sur 1080×1350 : on le recentre sans le déformer.
  const decalageDecor = Math.round((height - 1350) / 2 + 180);

  const paysage = `
html, body, .slide { width: ${width}px; height: ${height}px; }
.decor-1, .decor-2, .decor-3, .slide::before { transform: translate(${Math.round((width - 1080) / 2)}px, ${decalageDecor}px) scale(0.9); transform-origin: 50% 50%; }
.safe { position: absolute; z-index: 6; left: ${insetX}px; right: ${insetX}px; top: ${insetY}px; bottom: ${insetY}px;
        padding: ${padding}px ${padding}px ${hauteurPied}px; }
.stack { max-width: 100%; gap: ${Math.round(tailleTitre * 0.42)}px; }
.title { font-size: ${tailleTitre}px; line-height: 1.05; text-wrap: balance; }
.kicker { font-family: 'Fragment Mono', monospace; font-size: ${Math.max(14, Math.round(tailleTitre * 0.29))}px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.7; }
/* Le pied de marque vit lui aussi dans la zone sûre : un logo rogné, c'est pire que pas de logo. */
.brand-footer { left: ${insetX + padding}px; right: ${insetX + padding}px; bottom: ${insetY + padding}px; }
.author-chip, .verified-badge, .counter { display: none; }
`;
  const contenu =
    texte === 'aucun'
      ? ''
      : texte === 'mention'
        ? args.kicker
          ? `<div class="kicker">${escapeHtml(args.kicker)}</div>`
          : ''
        : `${args.kicker ? `<div class="kicker">${escapeHtml(args.kicker)}</div>` : ''}
    <h1 class="title">${titreAccentue(args.title, args.accentWord)}</h1>`;

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
    ${contenu}
  </div></div>
  <footer class="brand-footer">
    <div class="brand-id">${logo ? `<img class="brand-wordmark" src="${logo}" alt="${escapeHtml(brand.name)}">` : `<span>${escapeHtml(brand.name)}</span>`}</div>
  </footer>
  <div class="grain"></div>
</div>
</body></html>`;
}

/** Rend la couverture et l'enregistre comme asset (PNG, servi en JPEG par /public-assets). */
export async function fabriquerCouverture(args: {
  title: string;
  accentWord: string;
  kicker?: string;
  articleId: number;
  reglages?: BlogSettings;
}): Promise<string> {
  const reglages = args.reglages ?? getBlog();
  const taille = tailleCouverture(reglages.coverRatio);
  const html = coverHtml({
    title: args.title,
    accentWord: args.accentWord,
    kicker: args.kicker,
    ratio: reglages.coverRatio,
    texte: reglages.coverText,
    zoneSure: reglages.coverSafeZone,
  });
  const png = await renderHtmlToPng(html, taille, { scale: 2 });
  return saveAsset(png, 'cover', { extraMeta: { articleId: args.articleId, ratio: reglages.coverRatio } }, taille);
}
