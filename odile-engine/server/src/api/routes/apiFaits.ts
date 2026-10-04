/**
 * La banque de faits vécus (Réglages) et leur intégration dans un post qui attend
 * son fait : « [FAIT VÉCU : …] » remplacé par ce que la personne a réellement vu.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../../db/client.js';
import { ajouterFait, faitSchema, integrerLeFait, listerFaits, modifierFait, noterUsage, registreDuCompte, supprimerFait } from '../../writer/faits.js';
import { faitACompleter } from '../../writer/reglesLinkedIn.js';

const integrationSchema = z.union([
  z.object({ faitId: z.number().int().positive() }),
  faitSchema.pick({ texte: true, source: true, dateFait: true, accordClient: true }).extend({ enregistrer: z.boolean().default(true) }),
]);

export function registerFaitRoutes(app: FastifyInstance): void {
  app.get('/api/faits', async () => listerFaits());

  app.post('/api/faits', async (request, reply) => {
    const parsed = faitSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    return ajouterFait(parsed.data);
  });

  app.patch<{ Params: { id: string } }>('/api/faits/:id', async (request, reply) => {
    const parsed = faitSchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const fait = modifierFait(Number(request.params.id), parsed.data);
    if (!fait) return reply.status(404).send({ error: 'Fait introuvable' });
    return fait;
  });

  app.delete<{ Params: { id: string } }>('/api/faits/:id', async (request, reply) => {
    if (!supprimerFait(Number(request.params.id))) return reply.status(404).send({ error: 'Fait introuvable' });
    return { ok: true };
  });

  /** Remplace l'emplacement « [FAIT VÉCU : …] » d'un post par un fait réel. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/fait', async (request, reply) => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, Number(request.params.id))).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (!faitACompleter(post.caption)) return reply.status(409).send({ error: 'Ce post n’attend aucun fait vécu' });
    const parsed = integrationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    let fait: { id: number | null; texte: string; accordClient: boolean };
    if ('faitId' in parsed.data) {
      const trouve = db.select().from(schema.faits).where(eq(schema.faits.id, parsed.data.faitId)).get();
      if (!trouve) return reply.status(404).send({ error: 'Fait introuvable' });
      fait = { id: trouve.id, texte: trouve.texte, accordClient: trouve.accordClient };
    } else {
      const saisi = parsed.data;
      const enregistre = saisi.enregistrer
        ? ajouterFait({ texte: saisi.texte, source: saisi.source, dateFait: saisi.dateFait ?? null, accordClient: saisi.accordClient, compte: post.liAccountKey, actif: true })
        : null;
      fait = { id: enregistre?.id ?? null, texte: saisi.texte, accordClient: saisi.accordClient };
    }
    const caption = await integrerLeFait(post.caption, fait, registreDuCompte(post.liAccountKey));
    if (faitACompleter(caption)) return reply.status(422).send({ error: 'Le fait n’a pas pu être intégré : remplacez l’emplacement à la main dans le texte' });
    db.update(schema.posts)
      .set({ caption, faitId: fait.id ?? post.faitId, updatedAt: new Date().toISOString() })
      .where(eq(schema.posts.id, post.id))
      .run();
    if (fait.id) noterUsage(fait.id);
    return { ok: true, caption };
  });
}
