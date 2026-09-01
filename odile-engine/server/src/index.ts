import { config } from './config.js';
import './db/client.js'; // init + migrations
import { logger } from './lib/logger.js';
import { closeBrowser } from './render/browser.js';
import { startServer } from './api/server.js';
import { registerJobs } from './scheduler/jobs.js';
import { seedSourcesIfEmpty } from './scraper/sources.js';

async function main(): Promise<void> {
  seedSourcesIfEmpty();
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
