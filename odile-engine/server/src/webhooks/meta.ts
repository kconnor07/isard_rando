import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { handleInstagramComment } from './commentDm.js';

interface CommentChangeValue {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}

/**
 * Plugin encapsulé : le POST du webhook Meta est vérifié par HMAC-SHA256 sur
 * le CORPS BRUT (le parser de ce plugin conserve le Buffer, sans toucher au
 * parsing JSON du reste de l'application).
 */
export async function metaWebhookPlugin(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // Vérification d'abonnement (echo du challenge)
  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/webhooks/meta', async (request, reply) => {
    const q = request.query;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.META_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send('Verify token invalide');
  });

  app.post('/webhooks/meta', async (request, reply) => {
    const raw = request.body as Buffer;
    const signature = request.headers['x-hub-signature-256'];
    if (!config.META_APP_SECRET || typeof signature !== 'string') {
      return reply.status(401).send('Signature absente');
    }
    const expected = `sha256=${createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      logger.warn('webhook Meta : signature invalide');
      return reply.status(401).send('Signature invalide');
    }

    // Réponse immédiate (Meta exige < 20 s) puis traitement
    reply.status(200).send('OK');
    try {
      const payload = JSON.parse(raw.toString()) as {
        entry?: { changes?: { field: string; value: CommentChangeValue }[] }[];
      };
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'comments' || !change.value?.id) continue;
          const value = change.value;
          const post = value.media?.id
            ? (db
                .select()
                .from(schema.posts)
                .all()
                .find((p) => p.externalPostId === value.media?.id) ?? null)
            : null;
          const inserted = db
            .insert(schema.comments)
            .values({
              platform: 'instagram',
              externalId: value.id,
              postId: post?.id ?? null,
              externalPostId: value.media?.id ?? null,
              externalPostUrl: post?.externalUrl ?? null,
              authorExternalId: value.from?.id ?? null,
              authorName: value.from?.username ?? '',
              text: value.text ?? '',
              createdTime: new Date().toISOString(),
              raw: JSON.stringify(value),
            })
            .onConflictDoNothing({ target: [schema.comments.platform, schema.comments.externalId] })
            .returning({ id: schema.comments.id })
            .all();
          if (inserted.length > 0) {
            await handleInstagramComment(inserted[0]!.id);
          }
        }
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'traitement du webhook Meta en échec');
    }
  });
}
