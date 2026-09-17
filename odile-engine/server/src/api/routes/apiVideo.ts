import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db, schema } from '../../db/client.js';
import { heygenConfigured } from '../../db/oauthApps.js';
import { getBrand, getVideo } from '../../db/settingsRepo.js';
import { logger } from '../../lib/logger.js';
import { demanderVideo, etatVideo, listerAvatars, listerVoix } from '../../video/heygen.js';
import { finaliserVideo, lancerVideo, scriptParle, urlVideo } from '../../video/index.js';

export function registerVideoRoutes(app: FastifyInstance): void {
  /** Les avatars et les voix du compte HeyGen — pour choisir dans les réglages plutôt que coller un identifiant. */
  app.get('/api/video/comptes', async (_request, reply) => {
    if (!heygenConfigured()) {
      return reply.status(400).send({ error: 'Clé HeyGen absente — renseigne-la dans Connexions & santé' });
    }
    try {
      const [avatars, voix] = await Promise.all([listerAvatars(), listerVoix()]);
      return { avatars, voix };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Essai : une phrase de dix secondes avec l'avatar et la voix choisis. En mode test
   * HeyGen, la vidéo porte un filigrane et ne consomme aucun crédit.
   */
  app.post<{ Body: { texte?: string } }>('/api/video/essai', async (request, reply) => {
    const reglages = getVideo();
    if (!heygenConfigured()) return reply.status(400).send({ error: 'Clé HeyGen absente' });
    if (!reglages.avatarId || !reglages.voiceId) {
      return reply.status(400).send({ error: 'Choisis d’abord un avatar et une voix, puis enregistre les réglages' });
    }
    const brand = getBrand();
    const texte = scriptParle(
      request.body?.texte?.trim() ||
        `Bonjour, je suis l'avatar de ${brand.name}. Voilà à quoi ressemblera une vidéo publiée par le moteur : ma voix, mon cadrage, et les sous-titres.`,
      400,
    );
    try {
      const providerId = await demanderVideo({
        script: texte,
        titre: `Essai ${brand.name}`,
        avatarId: reglages.avatarId,
        avatarType: reglages.avatarType,
        avatarStyle: reglages.avatarStyle,
        voiceId: reglages.voiceId,
        voiceSpeed: reglages.voiceSpeed,
        fond: { type: 'color', value: /^#[0-9a-f]{6}$/i.test(reglages.backgroundValue) ? reglages.backgroundValue : '#06050a' },
        sousTitres: reglages.captions,
        largeur: 1080,
        hauteur: 1920,
        // Un essai ne doit jamais coûter de crédit, quel que soit le réglage.
        test: true,
      });
      logger.info({ providerId }, 'vidéo d’essai demandée');
      return { providerId };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Avancement d'une vidéo chez HeyGen (essai du dashboard). */
  app.get<{ Params: { id: string } }>('/api/video/essai/:id', async (request, reply) => {
    try {
      const etat = await etatVideo(request.params.id);
      return etat;
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Relance la vidéo d'un post (script corrigé, avatar changé, échec précédent). */
  app.post<{ Params: { id: string } }>('/api/posts/:id/video', async (request, reply) => {
    const id = Number(request.params.id);
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (['publishing', 'published'].includes(post.status)) {
      return reply.status(400).send({ error: 'Ce post est déjà publié' });
    }
    if (!post.videoScript?.trim()) {
      return reply.status(400).send({ error: 'Ce post n’a pas de script vidéo — écris-le dans l’éditeur' });
    }
    const lancement = await lancerVideo(id);
    if (!lancement.lance) return reply.status(400).send({ error: `Vidéo non lancée : ${lancement.raison}` });
    return { ok: true, providerId: lancement.providerId };
  });

  /** État de la vidéo d'un post, et rapatriement dès qu'elle est prête. */
  app.get<{ Params: { id: string } }>('/api/posts/:id/video', async (request, reply) => {
    const id = Number(request.params.id);
    const avant = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
    if (!avant) return reply.status(404).send({ error: 'Post introuvable' });
    if (avant.videoStatus === 'pending') await finaliserVideo(id);
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get()!;
    return {
      statut: post.videoStatus,
      script: post.videoScript,
      erreur: post.videoError,
      dureeMs: post.videoDurationMs,
      url: post.videoAssetId ? urlVideo(post.videoAssetId) : null,
      // Adresse relative : le dashboard la sert derrière la même origine.
      urlLocale: post.videoAssetId ? `/public-assets/${post.videoAssetId}.mp4` : null,
      testMode: getVideo().testMode,
      publicUrl: config.PUBLIC_URL,
    };
  });
}
