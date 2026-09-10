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
export async function fitCutout(png: Buffer, width = 1080, height = 1350): Promise<Buffer> {
  const trimmed = await sharp(png)
    .trim({ threshold: 6 })
    .png()
    .toBuffer()
    .catch(() => png);
  const inner = await sharp(trimmed)
    .resize(Math.round(width * 0.84), Math.round(height * 0.84), { fit: 'inside' })
    .png()
    .toBuffer();
  const meta = await sharp(inner).metadata();
  const w = meta.width ?? width;
  const h = meta.height ?? height;
  const left = Math.floor((width - w) / 2);
  const top = Math.floor((height - h) / 2);
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
export async function cutoutStats(png: Buffer): Promise<CutoutStats> {
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
  const touchesEdge = Object.values(edge).some((n) => n > 8);
  return { coverage, touchesEdge, ok: coverage >= 0.04 && coverage <= 0.7 && !touchesEdge };
}
