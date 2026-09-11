/**
 * Couleur signature (« pop ») des illustrations : UNE teinte vive et saturée
 * portée par le sujet (la cape jaune-vert sur un ciel bleu nuit), reprise
 * ensuite par le mot accentué du titre. Choix automatique selon l'accent du
 * template, ou extraction de la couleur dominante saturée d'une image rendue.
 */
import sharp from 'sharp';

export interface PopPreset {
  id: string;
  hex: string;
  label: string;
}

/** Couleurs signature proposées dans l'éditeur de templates. */
export const POP_PRESETS: PopPreset[] = [
  { id: 'lime', hex: '#d9ee4a', label: 'Jaune-vert' },
  { id: 'ambre', hex: '#ffb02e', label: 'Ambre' },
  { id: 'orange', hex: '#ff7a1a', label: 'Orange' },
  { id: 'corail', hex: '#ff6a3d', label: 'Corail' },
  { id: 'magenta', hex: '#ff3fa4', label: 'Magenta' },
  { id: 'cyan', hex: '#3ef2ff', label: 'Cyan' },
  { id: 'rouge', hex: '#ff3b3b', label: 'Rouge' },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Teinte (0-360) et saturation d'un hex, ou null. */
export function hueOf(hex: string): { h: number; s: number; v: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s, v] = rgbToHsv(...rgb);
  return { h, s, v };
}

/**
 * Couleur signature automatique : une teinte complémentaire « éditoriale »
 * selon l'accent du template (bleu → jaune-vert, violet → ambre, cyan → corail,
 * rouge/orange → cyan, jaune/vert → magenta). Accent neutre → jaune-vert.
 */
export function autoPopColor(accentHex: string): string {
  const hsv = hueOf(accentHex);
  if (!hsv || hsv.s < 0.15) return '#d9ee4a';
  const h = hsv.h;
  if (h >= 190 && h < 250) return '#d9ee4a';
  if (h >= 250 && h < 300) return '#ffb02e';
  if (h >= 160 && h < 190) return '#ff6a3d';
  if (h >= 300 || h < 40) return '#3ef2ff';
  return '#ff3fa4';
}

/** Réglage du template (`auto` / `aucune` / hex) → hex ou null. */
export function resolvePopColor(setting: string | null | undefined, accentHex: string): string | null {
  const s = (setting ?? 'auto').trim().toLowerCase();
  if (s === 'aucune' || s === 'none') return null;
  if (s === 'auto' || s === '') return autoPopColor(accentHex);
  return hexToRgb(s) ? (s.startsWith('#') ? s : `#${s}`) : autoPopColor(accentHex);
}

/**
 * Couleur dominante saturée d'une image (hors teintes de la palette, pour ne
 * pas retomber sur le bleu du fond). Null si l'image n'a pas de couleur vive
 * assez présente (≥ 1,5 % des pixels).
 */
export async function extractPopColor(
  image: Buffer,
  opts: { exclude?: string[]; minShare?: number } = {},
): Promise<string | null> {
  const { data, info } = await sharp(image).resize(120, 120, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const excluded = (opts.exclude ?? [])
    .map((hex) => hueOf(hex))
    .filter((h): h is { h: number; s: number; v: number } => Boolean(h && h.s >= 0.2))
    .map((h) => h.h);
  const BINS = 24;
  const weight = new Float64Array(BINS);
  const count = new Uint32Array(BINS);
  const sumR = new Float64Array(BINS);
  const sumG = new Float64Array(BINS);
  const sumB = new Float64Array(BINS);
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const [h, s, v] = rgbToHsv(r, g, b);
    if (s < 0.45 || v < 0.45) continue;
    if (excluded.some((eh) => Math.min(Math.abs(h - eh), 360 - Math.abs(h - eh)) < 22)) continue;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    weight[bin] = (weight[bin] ?? 0) + s * v;
    count[bin] = (count[bin] ?? 0) + 1;
    sumR[bin] = (sumR[bin] ?? 0) + r;
    sumG[bin] = (sumG[bin] ?? 0) + g;
    sumB[bin] = (sumB[bin] ?? 0) + b;
  }
  let best = -1;
  for (let b = 0; b < BINS; b++) if (best < 0 || weight[b]! > weight[best]!) best = b;
  if (best < 0 || count[best]! / total < (opts.minShare ?? 0.015)) return null;
  const n = count[best]!;
  // Moyenne du bin, légèrement poussée en saturation pour un mot de titre bien lisible
  const [h, s, v] = rgbToHsv(sumR[best]! / n, sumG[best]! / n, sumB[best]! / n);
  return hsvToHex(h, Math.min(1, s * 1.15), Math.max(v, 0.85));
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Écart de teinte (0-180°) entre deux couleurs ; 180 si l'une est neutre. */
export function hueDistance(a: string, b: string): number {
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (!ha || !hb || ha.s < 0.2 || hb.s < 0.2) return 180;
  const d = Math.abs(ha.h - hb.h);
  return Math.min(d, 360 - d);
}

/**
 * Couleur signature retenue pour le titre : la couleur détectée si elle est
 * bien celle demandée (même famille de teinte), sinon la couleur demandée —
 * jamais une teinte accidentelle (peau, bois, feu) sur le mot accentué.
 */
export function acceptPopColor(detected: string | null, requested: string | null, tolerance = 40): string | null {
  if (!requested) return null;
  if (detected && hueDistance(detected, requested) <= tolerance) return detected;
  return requested;
}
