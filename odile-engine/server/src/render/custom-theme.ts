import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { THEMES } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { isLightHex, rgba } from '../lib/color.js';

export type CustomTheme = typeof schema.customThemes.$inferSelect;

/** Préfixe des identifiants de thèmes maison (les intégrés n'en ont pas). */
export const CUSTOM_PREFIX = 'custom:';

export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function customThemeId(slug: string): string {
  return `${CUSTOM_PREFIX}${slug}`;
}

/** Un identifiant de thème est-il utilisable ? (intégré, ou template maison existant) */
export function themeExists(themeId: string): boolean {
  if (isCustomThemeId(themeId)) return getCustomTheme(themeId) !== null;
  return (THEMES as readonly string[]).includes(themeId);
}

export function getCustomTheme(themeId: string): CustomTheme | null {
  if (!isCustomThemeId(themeId)) return null;
  const slug = themeId.slice(CUSTOM_PREFIX.length);
  return db.select().from(schema.customThemes).where(eq(schema.customThemes.id, slug)).get() ?? null;
}

function assetDataUri(assetId: string | null): string | null {
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  return `data:${asset.mime};base64,${fs.readFileSync(asset.path).toString('base64')}`;
}


/**
 * Traduit un template maison en CSS de thème, dans la même grammaire que les
 * thèmes intégrés (aucun CSS libre n'est saisi par l'utilisateur : seuls des
 * paramètres typés sont interpolés).
 */
export function buildCustomThemeCss(theme: CustomTheme): string {
  const light = isLightHex(theme.textColor);
  const veil = light ? '255, 255, 255' : '11, 11, 14';
  const bgImage = assetDataUri(theme.backgroundAssetId);
  const opacity = Math.min(100, Math.max(0, theme.backgroundOpacity)) / 100;

  const decor =
    theme.decor === 'orbes'
      ? `
.decor-1 {
  position: absolute; z-index: 2; top: -50%; right: -28%;
  width: 1300px; height: 1300px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%,
    ${theme.bg1} 0%, ${theme.bg2} 46%,
    ${rgba(theme.accent, 0.55)} 82%, ${rgba(theme.accent, 0.95)} 94%, ${rgba('#ffffff', 0.9)} 100%);
  box-shadow: 0 0 3px ${rgba('#ffffff', 0.6)}, 0 0 120px ${rgba(theme.accent, 0.35)};
}
.decor-2 {
  position: absolute; z-index: 2; bottom: -32%; left: -24%;
  width: 980px; height: 980px; border-radius: 50%;
  background: radial-gradient(circle at 62% 34%,
    ${theme.bg1} 0%, ${theme.bg2} 52%, ${rgba(theme.accent, 0.4)} 88%, ${rgba(theme.accent, 0.8)} 100%);
  box-shadow: 0 0 90px ${rgba(theme.accent, 0.2)};
}
.decor-3 { position: absolute; inset: 0; z-index: 3;
  background: linear-gradient(172deg, ${rgba('#ffffff', 0.05)} 0%, transparent 32%); }`
      : theme.decor === 'halo'
        ? `
.decor-1 {
  position: absolute; z-index: 2; top: -18%; left: 50%; transform: translateX(-50%);
  width: 1150px; height: 1150px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(theme.accent, 0.5)} 0%, transparent 72%);
  filter: blur(28px);
}
.decor-2 {
  position: absolute; z-index: 2; bottom: -22%; right: -12%;
  width: 820px; height: 820px; border-radius: 50%;
  background: radial-gradient(circle closest-side, ${rgba(theme.accent, 0.26)} 0%, transparent 70%);
  filter: blur(34px);
}
.decor-3 { display: none; }`
        : theme.decor === 'degrade'
          ? `
.decor-1 { position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(155deg, ${rgba(theme.accent, 0.34)} 0%, transparent 55%); }
.decor-2 { position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(345deg, ${rgba(theme.accent, 0.2)} 0%, transparent 48%); }
.decor-3 { display: none; }`
          : `
.decor-1, .decor-2, .decor-3 { display: none; }`;

  return `/* Template maison « ${theme.name.replace(/\*\//g, '')} » — CSS généré */
:root {
  --accent: ${theme.accent};
  --secondary: ${theme.accent};
  --text: ${theme.textColor};
  --muted: ${rgba(theme.textColor, 0.66)};
  --glass: rgba(${veil}, ${light ? 0.07 : 0.05});
  --glass-border: rgba(${veil}, ${light ? 0.16 : 0.14});
}

.slide { background: ${theme.bg1}; color: ${theme.textColor}; }

.bg {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(168deg, ${theme.bg1} 0%, ${theme.bg2} 100%);
}
${bgImage ? `
/* Image de fond de la bibliothèque */
.bg::after {
  content: ''; position: absolute; inset: 0;
  background-image: url(${bgImage});
  background-size: cover; background-position: center;
  opacity: ${opacity};
}` : ''}
${decor}

.title { color: ${theme.textColor}; }
.body, .bullets li { color: ${rgba(theme.textColor, 0.72)}; }
.annotation { color: ${rgba(theme.textColor, 0.9)}; }
${light ? '' : `
/* Texte sombre : le verre et le logo s'inversent pour rester lisibles */
.brand-wordmark { filter: invert(1); }
.keyword-chip {
  background: rgba(11, 11, 14, 0.06);
  border-color: rgba(11, 11, 14, 0.16);
  box-shadow: inset 0 1.5px 0 rgba(255, 255, 255, 0.5), 0 24px 60px -28px rgba(11, 11, 14, 0.3);
}
.notif-card { background: rgba(255, 255, 255, 0.85); border-color: rgba(11, 11, 14, 0.1); }
.notif-title { color: #0b0b0e; }
.notif-body { color: rgba(11, 11, 14, 0.65); }
.hero-grade { background: none; }`}

/* Illustration : la vignette fond les bords dans le fond du template, et le
   voile (mix-blend-mode color) la teinte à l'accent — comme le bleu des
   thèmes intégrés — pour une image toujours harmonisée avec la palette. */
.hero-scrim {
  background:
    radial-gradient(115% 100% at 50% 36%, ${rgba(theme.bg1, 0)} ${light ? '52%' : '46%'}, ${rgba(theme.bg1, light ? 0.9 : 0.94)} 100%),
    linear-gradient(180deg,
      ${rgba(theme.bg1, 0.18)} 0%,
      ${rgba(theme.bg1, 0.05)} 30%,
      ${rgba(theme.bg1, 0.55)} 62%,
      ${rgba(theme.bg1, 0.92)} 100%);
}
${light ? `.hero-grade {
  background: linear-gradient(160deg,
    ${rgba(theme.accent, 0.5)} 0%,
    ${rgba(theme.bg2, 0.55)} 55%,
    ${rgba(theme.accent, 0.45)} 100%);
}` : ''}
.grain { opacity: ${theme.grain ? (light ? 0.5 : 0.16) : 0}; ${light ? '' : 'mix-blend-mode: multiply;'} }
`;
}
