/**
 * CLI d'exploitation : npm run job -- <commande> [options]
 * Chaque commande correspond à un job du scheduler, exécutable à la main.
 */
import { runJob } from './lib/jobRunner.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const val = process.argv[idx + 1];
  return val && !val.startsWith('--') ? val : 'true';
}

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'scrape': {
      const { runScrape } = await import('./scraper/index.js');
      return runJob('scrape', runScrape);
    }
    case 'score': {
      const { runScore } = await import('./scorer/score.js');
      return runJob('score', () => runScore());
    }
    case 'shortlist': {
      const { buildDailyShortlist } = await import('./scorer/shortlist.js');
      return runJob('shortlist', async () => buildDailyShortlist());
    }
    case 'draft': {
      const { draftPost } = await import('./writer/generate.js');
      const newsId = arg('news');
      return runJob('draft', () => draftPost({ newsItemId: newsId ? Number(newsId) : undefined }));
    }
    case 'render': {
      const { renderPost } = await import('./render/renderer.js');
      const postId = Number(arg('post'));
      if (!postId) throw new Error('--post <id> requis');
      return runJob('render', () => renderPost(postId));
    }
    case 'gallery': {
      const { renderGallery } = await import('./render/gallery.js');
      return runJob('gallery', renderGallery);
    }
    case 'review': {
      const { runDesignReview } = await import('./design-studio/index.js');
      const postId = Number(arg('post'));
      if (!postId) throw new Error('--post <id> requis');
      return runJob('review', () => runDesignReview(postId));
    }
    case 'send-approval': {
      const { sendApprovalEmail } = await import('./mailer/approvalEmail.js');
      const postId = Number(arg('post'));
      if (!postId) throw new Error('--post <id> requis');
      return runJob('send-approval', () => sendApprovalEmail(postId));
    }
    case 'pipeline': {
      // Chaîne complète : draft → screenshots → render → review → email
      const { runDraftPipeline } = await import('./scheduler/pipeline.js');
      const newsId = arg('news');
      return runJob('pipeline', () =>
        runDraftPipeline({ newsItemId: newsId ? Number(newsId) : undefined }),
      );
    }
    case 'publish-due': {
      const { processDuePublishJobs } = await import('./publishers/worker.js');
      return runJob('publish-due', processDuePublishJobs);
    }
    case 'poll-li-comments': {
      const { pollLinkedInComments } = await import('./webhooks/linkedinPoller.js');
      return runJob('poll-li-comments', pollLinkedInComments);
    }
    case 'seed': {
      const { seedSourcesIfEmpty } = await import('./scraper/sources.js');
      return runJob('seed', async () => ({ seeded: seedSourcesIfEmpty() }));
    }
    case 'fixture': {
      // Injecte une actu de test pour dérouler le pipeline sans réseau.
      const { db, schema } = await import('./db/client.js');
      const { canonicalizeUrl, contentHash } = await import('./scraper/dedupe.js');
      const url = arg('url') ?? `https://exemple.fr/actu-ia-${Date.now()}`;
      const canonical = canonicalizeUrl(url);
      const row = db
        .insert(schema.newsItems)
        .values({
          url,
          canonicalUrl: canonical,
          contentHash: contentHash(canonical),
          title: arg('title') ?? 'Un nouvel outil IA génère les devis des PME en 90 secondes',
          summary:
            'Un outil IA permet aux TPE/PME de générer des devis chiffrés en moins de deux minutes, avec intégration aux CRM du marché.',
          lang: 'fr',
          status: 'shortlisted',
          scoreRelevance: 45,
          scoreClick: 42,
          scoreTotal: 87,
          scoreReason: 'Outil concret, gain de temps chiffrable, très pertinent PME/TPE.',
          shortlistDate: new Date().toISOString().slice(0, 10),
          shortlistRank: 1,
          scoredAt: new Date().toISOString(),
        })
        .returning({ id: schema.newsItems.id })
        .get();
      console.log(`Actu fixture insérée : id=${row.id}`);
      return { ok: true };
    }
    default:
      console.log(`Commandes : scrape | score | shortlist | draft [--news <id>] | render --post <id> | gallery | review --post <id> | send-approval --post <id> | pipeline [--news <id>] | publish-due | poll-li-comments | seed | fixture [--title ..] [--url ..]`);
      return { ok: false };
  }
}

main()
  .then((r) => {
    if (r && 'ok' in r && !r.ok) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Le navigateur partagé maintient la boucle d'événements : fermeture explicite.
    const { closeBrowser } = await import('./render/browser.js');
    await closeBrowser();
  });
