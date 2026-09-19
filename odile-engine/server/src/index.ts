import { config } from './config.js';
import './db/client.js'; // init + migrations
import { logger } from './lib/logger.js';
import { closeBrowser } from './render/browser.js';
import { startServer } from './api/server.js';
import { registerJobs } from './scheduler/jobs.js';
import { seedSourcesIfEmpty } from './scraper/sources.js';
import { reparerAuDemarrage } from './scheduler/realigner.js';

async function main(): Promise<void> {
  seedSourcesIfEmpty();
  // Les posts en attente disent vrai dès le démarrage : compte attribué, lien reposé,
  // adresses retirées d'Instagram, hashtags bornés, dates orphelines effacées.
  try {
    reparerAuDemarrage();
  } catch (err) {
    logger.warn({ err: String(err).slice(0, 200) }, 'réparation au démarrage en échec');
  }
  const app = await startServer();
  if (!config.DISABLE_SCHEDULER) registerJobs();
  else logger.warn('scheduler désactivé (DISABLE_SCHEDULER=1)');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'arrêt en cours…');
    await app.close().catch(() => undefined);
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: String(err) }, 'échec du démarrage');
  process.exit(1);
});
