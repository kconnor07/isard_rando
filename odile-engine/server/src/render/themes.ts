import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, type ThemeId } from '@odile/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Racine templates/ du projet (odile-engine/templates). */
export const TEMPLATES_DIR = path.resolve(here, '../../../templates');

export const THEME_LABELS: Record<ThemeId, string> = {
  'odile-nuit': 'Odile Nuit — bleu nuit horizon',
  'violet-glow': 'Halo Bleu — orbes lumineux',
  'cyan-tech': 'Bleu Tech — dégradés électriques',
};

export function isTheme(id: string): id is ThemeId {
  return (THEMES as readonly string[]).includes(id);
}

export function themeCss(theme: string): string {
  const id = isTheme(theme) ? theme : 'odile-nuit';
  return fs.readFileSync(path.join(TEMPLATES_DIR, 'themes', `${id}.css`), 'utf8');
}

export function baseCss(): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, 'base.css'), 'utf8');
}

export function slideTemplate(kind: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, 'slides', `${kind}.eta`), 'utf8');
}

let fontCssCache: string | null = null;
/** @font-face avec polices embarquées en data URI (aucun accès réseau au rendu). */
export function fontFaceCss(): string {
  if (fontCssCache) return fontCssCache;
  const fontsDir = path.join(TEMPLATES_DIR, 'fonts');
  const face = (family: string, file: string, opts: { weight: string; style?: string }) => {
    const data = fs.readFileSync(path.join(fontsDir, file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:${opts.style ?? 'normal'};font-weight:${opts.weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  };
  fontCssCache = [
    face('Inter', 'inter-var.woff2', { weight: '100 900' }),
    face('Playfair Display', 'playfair-italic-var.woff2', { weight: '400 900', style: 'italic' }),
    face('Fragment Mono', 'fragment-mono.woff2', { weight: '400' }),
    face('Caveat', 'caveat-var.woff2', { weight: '400 700' }),
  ].join('\n');
  return fontCssCache;
}
