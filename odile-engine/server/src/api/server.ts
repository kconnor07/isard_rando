import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { requireSession } from './auth.js';
import { registerMiscRoutes } from './routes/apiMisc.js';
import { registerNewsRoutes } from './routes/apiNews.js';
import { registerPostRoutes } from './routes/apiPosts.js';
import { registerSettingsRoutes } from './routes/apiSettings.js';
import { registerPublicRoutes } from './routes/public.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../../web/dist');

export async function buildServer(): Promise<FastifyInstance> {
  // Journalisation via notre pino (le logger Fastify natif spécialise les
  // génériques de FastifyInstance et complique tout le typage des routes).
  // maxParamLength : les jetons signés /a/:token dépassent les 100 caractères par défaut
  const app = Fastify({ trustProxy: true, bodyLimit: 8 * 1024 * 1024, logger: false, maxParamLength: 512 });
  app.addHook('onResponse', (request, reply, done) => {
    if (!request.url.startsWith('/public-assets') && !request.url.startsWith('/assets')) {
      logger.debug({ method: request.method, url: request.url, status: reply.statusCode }, 'http');
    }
    done();
  });

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody); // formulaires HTML des pages d'approbation
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  registerPublicRoutes(app);

  // Webhooks Meta (vérification HMAC sur corps brut) — plugin encapsulé
  const { metaWebhookPlugin } = await import('../webhooks/meta.js');
  await app.register(metaWebhookPlugin);

  // Routes OAuth (LinkedIn / Meta)
  const { registerOauthRoutes } = await import('../publishers/oauth.js');
  registerOauthRoutes(app);

  // API dashboard (session requise)
  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/')) await requireSession(request, reply);
  });
  registerMiscRoutes(app);
  registerPostRoutes(app);
  registerNewsRoutes(app);
  registerSettingsRoutes(app);

  // Dashboard statique (production : web/dist construit par Vite)
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      const url = request.url;
      const isApiLike =
        url.startsWith('/api') || url.startsWith('/a/') || url.startsWith('/r/') ||
        url.startsWith('/webhooks') || url.startsWith('/public-assets') || url.startsWith('/oauth');
      if (request.method === 'GET' && !isApiLike) {
        return reply.type('text/html').send(fs.readFileSync(path.join(WEB_DIST, 'index.html')));
      }
      return reply.status(404).send({ error: 'Introuvable' });
    });
  }

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT, publicUrl: config.PUBLIC_URL }, 'serveur démarré');
  return app;
}
