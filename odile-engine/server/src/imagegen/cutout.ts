import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from '../lib/logger.js';

const require = createRequire(import.meta.url);

/** Dossier des modèles ONNX embarqués dans le paquet (indépendant du cwd). */
function modelsPublicPath(): string {
  // Le paquet n'exporte que son entrée : on part de dist/index.cjs
  const entry = require.resolve('@imgly/background-removal-node');
  return `file://${path.dirname(entry)}/`;
}

// Un seul modèle en mémoire à la fois : les demandes sont sérialisées.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Détoure le sujet principal d'une image (modèle isnet, exécuté localement,
 * sans service externe). Sortie : PNG avec canal alpha, même taille.
 */
export async function removeImageBackground(input: Buffer): Promise<Buffer> {
  const run = async () => {
    const { removeBackground } = await import('@imgly/background-removal-node');
    const t0 = Date.now();
    // Le modèle attend un Blob typé : on normalise toute entrée en PNG
    const png0 = await sharp(input).png().toBuffer();
    const bytes = png0.buffer.slice(png0.byteOffset, png0.byteOffset + png0.byteLength) as ArrayBuffer;
    const blob = await removeBackground(new Blob([bytes], { type: 'image/png' }), {
      publicPath: modelsPublicPath(),
      model: 'medium',
      output: { format: 'image/png', quality: 0.92 },
    });
    const png = Buffer.from(await blob.arrayBuffer());
    logger.info({ ms: Date.now() - t0, bytes: png.length }, 'arrière-plan retiré');
    return png;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Pose un détourage sur une toile transparente aux dimensions des slides :
 * l'objet est rogné à ses bords utiles puis centré avec une marge, entier.
 */
export async function fitCutout(png: Buffer, width = 1080, height = 1350, opts: { bleedBottom?: boolean } = {}): Promise<Buffer> {
  const trimmed = await sharp(png)
    .trim({ threshold: 6 })
    .png()
    .toBuffer()
    .catch(() => png);
  const inner = await sharp(trimmed)
    // Personnage : pleine toile, posé sur le bord bas (il « sort » du cadre) ; objet : marge de 8 %
    .resize(Math.round(width * (opts.bleedBottom ? 1 : 0.84)), Math.round(height * (opts.bleedBottom ? 1 : 0.84)), { fit: 'inside' })
    .png()
    .toBuffer();
  const meta = await sharp(inner).metadata();
  const w = meta.width ?? width;
  const h = meta.height ?? height;
  const left = Math.floor((width - w) / 2);
  const top = opts.bleedBottom ? height - h : Math.floor((height - h) / 2);
  return sharp(inner)
    .extend({
      top,
      bottom: height - h - top,
      left,
      right: width - w - left,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export interface CutoutStats {
  /** part des pixels opaques (0-1) */
  coverage: number;
  /** l'objet touche un bord du cadre (rogné par la génération) */
  touchesEdge: boolean;
  ok: boolean;
}

/**
 * Porte qualité d'un détourage : assez de matière (4 à 70 % du cadre) et un
 * objet entier (aucun bord touché). Sinon on regénère une fois.
 */
export async function cutoutStats(png: Buffer, opts: { personnage?: boolean } = {}): Promise<CutoutStats> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let opaque = 0;
  const edge = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * info.channels + 3]!;
      if (a < 128) continue;
      opaque++;
      if (y < 2) edge.top++;
      if (y >= h - 2) edge.bottom++;
      if (x < 2) edge.left++;
      if (x >= w - 2) edge.right++;
    }
  }
  const coverage = opaque / (w * h);
  // Un personnage cadré à la taille touche le bas (et peut frôler un côté) : seul le haut doit rester libre
  const touchesEdge = opts.personnage ? edge.top > 8 : Object.values(edge).some((n) => n > 8);
  const max = opts.personnage ? 0.9 : 0.7;
  const min = opts.personnage ? 0.15 : 0.04;
  return { coverage, touchesEdge, ok: coverage >= min && coverage <= max && !touchesEdge };
}

/**
 * Couleur sélective : tout passe en noir et blanc, sauf les pixels dont la teinte
 * est proche de `keepHex` (ils sont ramenés à cette teinte exacte). Garantit le
 * rendu « personnage noir et blanc + éléments à la couleur d'accent », même si le
 * modèle a coloré la peau ou les vêtements.
 */
export async function selectiveColor(png: Buffer, keepHex: string, opts: { toleranceDeg?: number; tint?: number } = {}): Promise<Buffer> {
  const toleranceDeg = opts.toleranceDeg ?? 42;
  // Part de teinte d'accent dans les gris (0 = noir et blanc pur) : le personnage s'accorde au fond
  const tint = Math.min(1, Math.max(0, opts.tint ?? 0));
  const m = /^#?([0-9a-f]{6})$/i.exec(keepHex.trim());
  if (!m) return sharp(png).grayscale().png().toBuffer();
  const kr = parseInt(m[1]!.slice(0, 2), 16);
  const kg = parseInt(m[1]!.slice(2, 4), 16);
  const kb = parseInt(m[1]!.slice(4, 6), 16);
  const hueOfRgb = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
  };
  const keep = hueOfRgb(kr, kg, kb);
  const keepLum = Math.max(1, 0.299 * kr + 0.587 * kg + 0.114 * kb);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const px = hueOfRgb(r, g, b);
    const dist = Math.min(Math.abs(px.h - keep.h), 360 - Math.abs(px.h - keep.h));
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    // Poids de la couleur : pleine dans la tolérance et bien saturée, fondue aux abords (pas de liseré)
    const hueW = dist <= toleranceDeg ? 1 : Math.max(0, 1 - (dist - toleranceDeg) / 14);
    const satW = Math.min(1, Math.max(0, (px.s - 0.22) / 0.2));
    const w = hueW * satW;
    // Gris de base : neutre, ou tiré vers la teinte d'accent à lumière égale
    const kl = lum / keepLum;
    const gr = lum + (Math.min(255, kr * kl) - lum) * tint;
    const gg = lum + (Math.min(255, kg * kl) - lum) * tint;
    const gb = lum + (Math.min(255, kb * kl) - lum) * tint;
    if (w <= 0) {
      data[i] = Math.round(gr);
      data[i + 1] = Math.round(gg);
      data[i + 2] = Math.round(gb);
      continue;
    }
    // Ramené à la teinte d'accent, en gardant la lumière du pixel
    const k = px.v / Math.max(keep.v, 0.01);
    const tr = Math.min(255, kr * k);
    const tg = Math.min(255, kg * k);
    const tb = Math.min(255, kb * k);
    data[i] = Math.round(gr + (tr - gr) * w);
    data[i + 1] = Math.round(gg + (tg - gg) * w);
    data[i + 2] = Math.round(gb + (tb - gb) * w);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}
