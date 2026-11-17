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
 * Durcit le détourage : les restes à demi transparents (objets d'arrière-plan mal effacés)
 * disparaissent, la silhouette devient pleine, les bords gardent un léger fondu.
 */
export async function solidifyAlpha(png: Buffer, low = 96, high = 208): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += info.channels) {
    const a = data[i]!;
    data[i] = a <= low ? 0 : a >= high ? 255 : Math.round(((a - low) / (high - low)) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

/**
 * Détourage par la couleur du fond, pour une image générée sur fond uni (gris neutre) :
 * tout ce qui touche les bords et a la couleur du fond disparaît, ainsi que les poches
 * fermées de cette même couleur (entre un bras et le buste). Contrairement au détourage
 * par reconnaissance du sujet, les accessoires tenus par le personnage (feuille blanche,
 * écran…) sont gardés. Renvoie null si le fond n'est pas assez uni pour s'y fier.
 */
export async function chromaKeyCutout(input: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const n = w * h;
  // Couleur du fond : médiane d'un liseré en haut et sur la moitié haute des côtés
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    rs.push(data[i]!);
    gs.push(data[i + 1]!);
    bs.push(data[i + 2]!);
  };
  for (let y = 0; y < 6; y++) for (let x = 0; x < w; x += 3) sample(x, y);
  for (let y = 6; y < h * 0.5; y += 3) for (let x = 0; x < 6; x++) { sample(x, y); sample(w - 1 - x, y); }
  const median = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  const br = median([...rs]);
  const bg = median([...gs]);
  const bb = median([...bs]);
  const d2 = (i: number) => {
    const dr = data[i]! - br;
    const dg = data[i + 1]! - bg;
    const db = data[i + 2]! - bb;
    return dr * dr + dg * dg + db * db;
  };
  // Fond pas assez uni (dégradé marqué, décor) : on ne s'y fie pas
  let proches = 0;
  for (let k = 0; k < rs.length; k++) {
    const dr = rs[k]! - br;
    const dg = gs[k]! - bg;
    const db = bs[k]! - bb;
    if (dr * dr + dg * dg + db * db <= 34 * 34) proches++;
  }
  if (proches / rs.length < 0.9) return null;

  const LARGE = 40 * 40; // depuis les bords
  const STRICT = 20 * 20; // poches fermées
  const fond = new Uint8Array(n);
  const file = new Int32Array(n);
  const propager = (graines: number[], tol: number): number[] => {
    let tete = 0;
    let queue = 0;
    const vus: number[] = [];
    for (const g of graines) {
      if (fond[g] || d2(g * ch) > tol) continue;
      fond[g] = 1;
      file[queue++] = g;
    }
    while (tete < queue) {
      const p = file[tete++]!;
      vus.push(p);
      const x = p % w;
      const voisins = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const v of voisins) {
        if (v < 0 || fond[v] || d2(v * ch) > tol) continue;
        fond[v] = 1;
        file[queue++] = v;
      }
    }
    return vus;
  };
  const bords: number[] = [];
  for (let x = 0; x < w; x++) bords.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) bords.push(y * w, y * w + w - 1);
  propager(bords, LARGE);
  // Poches fermées de la couleur du fond : retirées si elles sont assez grandes
  for (let p = 0; p < n; p++) {
    if (fond[p] || d2(p * ch) > STRICT) continue;
    const poche = propager([p], STRICT);
    if (poche.length < 400) for (const q of poche) fond[q] = 2; // petit aplat gris du sujet : gardé
  }
  const alpha = Buffer.alloc(n);
  let opaque = 0;
  for (let p = 0; p < n; p++) {
    if (fond[p] !== 1) {
      alpha[p] = 255;
      opaque++;
    }
  }
  const part = opaque / n;
  if (part < 0.1 || part > 0.92) return null;
  // Bord adouci et très légèrement rentré (pas de liseré gris)
  const doux = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
    .blur(1.1)
    .linear(1.9, -200)
    // sharp rend trois canaux après un flou : on n'en garde qu'un
    .extractChannel(0)
    .raw()
    .toBuffer();
  return sharp(data, { raw: { width: w, height: h, channels: ch } })
    .joinChannel(doux, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}
