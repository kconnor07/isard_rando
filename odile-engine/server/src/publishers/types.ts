import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';

export interface PublishInput {
  post: typeof schema.posts.$inferSelect;
  /** slides ordonnées avec le chemin de leur PNG rendu */
  images: { idx: number; assetId: string; path: string; publicUrl: string }[];
  caption: string;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl: string | null;
  raw?: unknown;
}

export interface Publisher {
  readonly name: string;
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Charge les images rendues d'un post + leurs URLs publiques (pour Meta). */
export function collectPublishImages(postId: number): PublishInput['images'] {
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  const images: PublishInput['images'] = [];
  for (const slide of slides) {
    if (!slide.renderAssetId) throw new Error(`Slide ${slide.idx} sans rendu — lancer le rendu d'abord`);
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, slide.renderAssetId)).get();
    if (!asset || !fs.existsSync(asset.path)) throw new Error(`Asset manquant pour la slide ${slide.idx}`);
    images.push({
      idx: slide.idx,
      assetId: asset.id,
      path: asset.path,
      publicUrl: `${config.PUBLIC_URL}/public-assets/${asset.id}.png`,
    });
  }
  return images;
}

/** Caption finale : texte + hashtags. */
export function buildCaption(post: typeof schema.posts.$inferSelect): string {
  const hashtags = (JSON.parse(post.hashtags) as string[]).join(' ');
  return hashtags ? `${post.caption}\n\n${hashtags}` : post.caption;
}

/**
 * Publisher factice (PUBLISH_MODE=dry) : écrit le payload exact qui serait
 * envoyé à l'API dans var/outbox/, et fabrique des identifiants.
 */
export class DryRunPublisher implements Publisher {
  readonly name: string;
  constructor(
    private wrapped: string,
    private payloadBuilder: (input: PublishInput) => unknown,
  ) {
    this.name = `dry:${wrapped}`;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const payload = this.payloadBuilder(input);
    const file = path.join(config.outboxDir, `publish-${input.post.id}-${this.wrapped}-${Date.now()}.json`);
    fs.mkdirSync(config.outboxDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ publisher: this.wrapped, post: input.post.id, payload }, null, 2));
    return {
      externalPostId: `dry-${this.wrapped}-${input.post.id}`,
      externalUrl: `file://${file}`,
      raw: { dryRun: true, file },
    };
  }
}
