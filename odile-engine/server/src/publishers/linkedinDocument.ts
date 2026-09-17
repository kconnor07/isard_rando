/**
 * Document LinkedIn : le carrousel natif du réseau.
 *
 * LinkedIn ne connaît pas le carrousel d'images d'Instagram. Son équivalent est le
 * DOCUMENT : un PDF que le lecteur feuillette sans quitter le fil. C'est le format
 * qui retient le plus longtemps — donc celui que l'algorithme pousse le plus — et il
 * n'existe que par l'API Documents, distincte des images et des vidéos.
 *
 * Deux temps, pas trois comme la vidéo : on déclare le fichier (`initializeUpload`),
 * puis on l'envoie d'un seul PUT à l'adresse renvoyée. Le document est ensuite posé
 * dans `content.media` avec son titre — LinkedIn affiche ce titre en tête du
 * document, sous la légende : c'est une deuxième accroche, pas un nom de fichier.
 *
 * Limites de l'API : PDF (entre autres), 100 Mo et 300 pages maximum.
 */
import fs from 'node:fs';
import { getBrowser } from '../render/browser.js';
import { saveAsset } from '../render/renderer.js';
import { fetchJson, fetchWithRetry, HttpError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { API, linkedInHeaders } from './linkedin.js';
import type { PublishInput } from './types.js';

interface InitDocument {
  value: { document: string; uploadUrl: string; uploadUrlExpiresAt?: number };
}

/**
 * Le PDF feuilletable, fabriqué à partir des slides déjà rendues.
 *
 * Une page par slide, exactement à la taille de l'image : aucune marge, aucun
 * rognage, aucune bande blanche — ce que l'on a validé dans le dashboard est ce que
 * LinkedIn affiche. Les images sont embarquées en base64 : le navigateur imprime
 * hors ligne, sans dépendre d'une adresse publique joignable.
 */
export async function fabriquerPdfDocument(args: {
  images: PublishInput['images'];
  largeur: number;
  hauteur: number;
  postId: number;
}): Promise<string> {
  if (args.images.length === 0) throw new Error('Aucune slide rendue : impossible de fabriquer le document PDF');
  const pages = args.images
    .map((image) => {
      const base64 = fs.readFileSync(image.path).toString('base64');
      const mime = image.path.endsWith('.jpg') || image.path.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      return `<div class="page"><img src="data:${mime};base64,${base64}" alt=""></div>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${args.largeur}px ${args.hauteur}px; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: ${args.largeur}px; height: ${args.hauteur}px; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  /* Un poil plus grand que la page : l'impression PDF arrondit la hauteur au demi-point
     près, et sans ce débord une ligne blanche apparaîtrait en bas de chaque page. */
  .page img { display: block; width: calc(100% + 2px); height: calc(100% + 2px); margin: -1px; object-fit: cover; }
</style></head><body>${pages}</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      width: `${args.largeur}px`,
      height: `${args.hauteur}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return saveAsset(Buffer.from(pdf), 'document', { postId: args.postId }, undefined, {
      ext: 'pdf',
      mime: 'application/pdf',
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Déclare puis envoie le PDF ; renvoie l'URN du document à poser dans le post. */
export async function envoyerDocumentLinkedIn(args: {
  token: string;
  owner: string;
  fichier: string;
}): Promise<string> {
  const init = await fetchJson<InitDocument>(`${API}/rest/documents?action=initializeUpload`, {
    method: 'POST',
    headers: linkedInHeaders(args.token),
    body: JSON.stringify({ initializeUploadRequest: { owner: args.owner } }),
    timeoutMs: 60_000,
  });
  const { document, uploadUrl } = init.value;
  const contenu = fs.readFileSync(args.fichier);
  const res = await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${args.token}`, 'content-type': 'application/pdf' },
    body: contenu,
    timeoutMs: 180_000,
    retries: 2,
  });
  if (!res.ok) throw new HttpError(res.status, uploadUrl, await res.text().catch(() => ''));
  await res.text().catch(() => undefined);
  logger.info({ document, octets: contenu.length }, 'document envoyé à LinkedIn');
  return document;
}

/**
 * Titre affiché en tête du document — une seconde accroche, lue avant la première page.
 * LinkedIn le tronque autour de 100 caractères.
 */
export function titreDocument(hook: string): string {
  const propre = hook.replace(/\s+/g, ' ').trim();
  return propre.length > 96 ? `${propre.slice(0, 95).trimEnd()}…` : propre || 'Document';
}
