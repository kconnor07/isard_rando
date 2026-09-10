import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getImageGen } from '../db/settingsRepo.js';
import type { FreepikReference } from './providers/freepikCatalog.js';
import type { ImageStyle } from './prompt.js';

/**
 * Image de référence d'un style (réglages › Illustrations IA) : un asset de la
 * bibliothèque qui guide le rendu — lumière, contraste, profondeur — sans
 * imposer son sujet. Base64 pour les modèles qui l'acceptent, URL publique
 * (https uniquement) pour les autres.
 */
export function referenceFor(style: ImageStyle): FreepikReference | null {
  const assetId = getImageGen().references[style];
  if (!assetId) return null;
  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).get();
  if (!asset || !fs.existsSync(asset.path)) return null;
  const publicBase = config.PUBLIC_URL.replace(/\/$/, '');
  const ext = asset.mime === 'image/png' ? 'png' : 'jpg';
  return {
    base64: fs.readFileSync(asset.path).toString('base64'),
    mime: asset.mime,
    publicUrl: publicBase.startsWith('https://') ? `${publicBase}/public-assets/${asset.id}.${ext}` : undefined,
  };
}

/** Consignes propres à un style (réglages). */
export function notesFor(style: ImageStyle): string | undefined {
  const notes = getImageGen().notesByStyle[style];
  return notes && notes.trim() ? notes.trim() : undefined;
}
