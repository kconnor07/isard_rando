/** Utilitaires couleur sans dépendance, partagés par le rendu et les prompts. */

function parseHex(hex: string): number | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return Number.isFinite(n) ? n : null;
}

/** `#0099ff` + alpha 0-1 → `rgba(0, 153, 255, a)` */
export function rgba(hex: string, alpha: number): string {
  const n = parseHex(hex);
  if (n === null) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Couleur claire ? (luminance perçue > 140/255) */
export function isLightHex(hex: string): boolean {
  const n = parseHex(hex);
  if (n === null) return true;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 140;
}
