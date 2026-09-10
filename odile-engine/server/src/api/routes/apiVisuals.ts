import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../../db/client.js';
import { runJob } from '../../lib/jobRunner.js';
import { logger } from '../../lib/logger.js';
import { parseVisualOverrides } from '../../render/renderer.js';
import { listCandidates, runVisualAgent } from '../../visuals/agent.js';

const runSchema = z.object({
  more: z.boolean().default(false),
  screenshots: z.number().int().min(0).max(5).optional(),
  images: z.number().int().min(0).max(6).optional(),
});
const useSchema = z.object({
  slideIdx: z.number().int().min(0).default(0),
  as: z.enum(['hero', 'screenshot', 'float1', 'float2']),
});
const floatsSchema = z.object({
  clear: z.boolean().optional(),
  floatSize: z.number().int().min(10).max(60).optional(),
  floatLayout: z.enum(['coins', 'haut', 'bas', 'cotes']).optional(),
});

/** Passes en cours, par post (une seule à la fois). */
const running = new Map<number, { startedAt: string; more: boolean }>();

export function registerVisualRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/posts/:id/visuals', async (request) => {
    const postId = Number(request.params.id);
    return { running: running.has(postId), candidates: listCandidates(postId) };
  });

  /** Lance une passe en tâche de fond ; le dashboard suit via GET. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/visuals/run', async (request, reply) => {
    const postId = Number(request.params.id);
    const parsed = runSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (running.has(postId)) return reply.status(409).send({ error: 'Une passe est déjà en cours pour ce post' });
    running.set(postId, { startedAt: new Date().toISOString(), more: parsed.data.more });
    void runJob('agent-visuel', () => runVisualAgent(postId, parsed.data))
      .catch((err) => logger.error({ postId, err: String(err) }, 'agent visuel en échec'))
      .finally(() => running.delete(postId));
    return { started: true };
  });

  /** Pose une proposition sur une slide : illustration plein cadre, ou slide « capture ». */
  app.post<{ Params: { id: string; assetId: string } }>(
    '/api/posts/:id/visuals/:assetId/use',
    async (request, reply) => {
      const postId = Number(request.params.id);
      const parsed = useSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, request.params.assetId)).get();
      if (!asset || asset.kind !== 'candidate' || asset.postId !== postId) {
        return reply.status(404).send({ error: 'Proposition introuvable' });
      }
      const slide = db
        .select()
        .from(schema.slides)
        .where(and(eq(schema.slides.postId, postId), eq(schema.slides.idx, parsed.data.slideIdx)))
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      const now = new Date().toISOString();
      if (parsed.data.as === 'float1' || parsed.data.as === 'float2') {
        // Objet flottant du post : périphérie de toutes les slides
        const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
        const overrides = parseVisualOverrides(post.visualOverrides);
        overrides[parsed.data.as] = asset.id;
        db.update(schema.posts).set({ visualOverrides: JSON.stringify(overrides), updatedAt: now }).where(eq(schema.posts.id, postId)).run();
        db.update(schema.slides).set({ renderAssetId: null }).where(eq(schema.slides.postId, postId)).run();
        return { ok: true };
      }
      if (parsed.data.as === 'hero') {
        db.update(schema.slides)
          .set({ heroAssetId: asset.id, renderAssetId: null, updatedAt: now })
          .where(eq(schema.slides.id, slide.id))
          .run();
      } else {
        // Slide « capture » : la page dans un cadre navigateur, avec titre et texte
        const content = JSON.parse(slide.content) as Record<string, unknown>;
        let meta: { url?: string; label?: string } = {};
        try {
          meta = asset.meta ? (JSON.parse(asset.meta) as typeof meta) : {};
        } catch {
          meta = {};
        }
        content.kind = 'screenshot';
        if (!content.toolUrl && meta.url) content.toolUrl = meta.url;
        if (!content.toolName && meta.label) content.toolName = meta.label;
        db.update(schema.slides)
          .set({
            kind: 'screenshot',
            content: JSON.stringify(content),
            screenshotAssetId: asset.id,
            renderAssetId: null,
            updatedAt: now,
          })
          .where(eq(schema.slides.id, slide.id))
          .run();
      }
      return { ok: true };
    },
  );

  /** Objets flottants du post : taille, disposition, ou retrait. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/visuals/floats', async (request, reply) => {
    const postId = Number(request.params.id);
    const parsed = floatsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    const { clear, ...rest } = parsed.data;
    const overrides = clear ? {} : { ...parseVisualOverrides(post.visualOverrides), ...rest };
    db.update(schema.posts)
      .set({ visualOverrides: Object.keys(overrides).length ? JSON.stringify(overrides) : null, updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, postId))
      .run();
    db.update(schema.slides).set({ renderAssetId: null }).where(eq(schema.slides.postId, postId)).run();
    return { ok: true, overrides };
  });

  app.delete<{ Params: { id: string; assetId: string } }>(
    '/api/posts/:id/visuals/:assetId',
    async (request, reply) => {
      const postId = Number(request.params.id);
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, request.params.assetId)).get();
      if (!asset || asset.kind !== 'candidate' || asset.postId !== postId) {
        return reply.status(404).send({ error: 'Proposition introuvable' });
      }
      const used = db
        .select({ id: schema.slides.id })
        .from(schema.slides)
        .where(and(eq(schema.slides.postId, postId), eq(schema.slides.heroAssetId, asset.id)))
        .all().length
        + db
          .select({ id: schema.slides.id })
          .from(schema.slides)
          .where(and(eq(schema.slides.postId, postId), eq(schema.slides.screenshotAssetId, asset.id)))
          .all().length;
      const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
      const ov = parseVisualOverrides(post?.visualOverrides ?? null);
      if (used > 0 || ov.float1 === asset.id || ov.float2 === asset.id) {
        return reply.status(409).send({ error: 'Cette proposition est posée sur une slide ou en objet flottant.' });
      }
      db.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();
      return { ok: true };
    },
  );
}
