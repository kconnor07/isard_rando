import cron from 'node-cron';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getApprovalEmail } from '../db/settingsRepo.js';
import { runJob } from '../lib/jobRunner.js';
import { logger } from '../lib/logger.js';
import { sendApprovalEmail } from '../mailer/approvalEmail.js';
import { sendMail } from '../mailer/smtp.js';
import { runScrape } from '../scraper/index.js';
import { runScore } from '../scorer/score.js';
import { buildDailyShortlist } from '../scorer/shortlist.js';
import { shouldDraftToday } from './cadence.js';
import { runDraftPipeline } from './pipeline.js';

const TZ = 'Europe/Paris';

/** Enregistre tous les crons du moteur (idempotent au démarrage du process). */
export function registerJobs(): void {
  // Collecte de la veille : toutes les heures. Elle ne coûte rien (lecture de flux
  // RSS), et garder le fil frais permet de noter des articles encore chauds.
  cron.schedule('15 * * * *', () => {
    void runJob('scrape', runScrape);
  }, { timezone: TZ });

  /**
   * Notation de la veille : trois fois par jour, pas à chaque heure.
   *
   * C'était le seul poste qui consommait des modèles en continu, sans que personne
   * ne l'ait demandé — jusqu'à 144 appels par jour pour trier des articles qu'une
   * seule shortlist quotidienne utilise. La shortlist retient les articles des
   * 24 dernières heures : les noter trois fois par jour ne lui en fait perdre
   * aucun. Le passage de 6 h 05 précède celui de 6 h 30 qui construit la shortlist.
   */
  cron.schedule('5 6,12,18 * * *', () => {
    // Plafond relevé puisque les passages sont plus espacés : le retard se rattrape.
    void runJob('score', () => runScore(150));
  }, { timezone: TZ });

  // Collecte par recherche web IA (hors flux RSS), puis scoring des nouveaux items
  cron.schedule('20 6 * * *', () => {
    void (async () => {
      const { runWebsearch } = await import('../scraper/websearch.js');
      await runJob('websearch', runWebsearch);
      await runJob('score', () => runScore());
    })().catch((err) => logger.error({ err: String(err) }, 'websearch en échec'));
  }, { timezone: TZ });

  // Shortlist quotidienne v2 (extraction plein texte + engagement + rescoring + mélange)
  cron.schedule('30 6 * * *', () => {
    void runJob('shortlist', () => buildDailyShortlist());
  }, { timezone: TZ });

  // Sujets du jour : les items de la semaine regroupés par thème, avec leurs angles,
  // plus les rendez-vous du calendrier des PME. Après la shortlist, qui les a notés.
  cron.schedule('50 6 * * *', () => {
    void (async () => {
      const { construireSujets } = await import('../scorer/sujets.js');
      await runJob('sujets', () => construireSujets());
    })().catch((err) => logger.error({ err: String(err) }, 'sujets en échec'));
  }, { timezone: TZ });

  // Apprentissage hebdomadaire (clics → poids des sources + affinités de sujets)
  cron.schedule('50 7 * * 1', () => {
    void (async () => {
      const { runLearn } = await import('../scorer/learn.js');
      await runJob('learn', () => runLearn());
    })().catch((err) => logger.error({ err: String(err) }, 'learn en échec'));
  }, { timezone: TZ });

  // Brouillon du jour si la cadence l'exige (pipeline complet → email d'approbation)
  cron.schedule('0 7 * * *', () => {
    void runJob('draft-if-due', async () => {
      const check = shouldDraftToday();
      if (!check.due) return { skipped: true, reason: check.reason };
      return runDraftPipeline();
    });
  }, { timezone: TZ });

  // Vidéos avatar en fabrication : HeyGen met quelques minutes, parfois plus. Ce
  // passage rapatrie le MP4 dès qu'il est prêt et débloque l'email de validation.
  cron.schedule('*/3 * * * *', () => {
    void (async () => {
      const { suivreVideosEnCours } = await import('../video/index.js');
      const { finirPostsVideo } = await import('../video/relance.js');
      await runJob('video-suivi', async () => {
        const resume = await suivreVideosEnCours();
        const finis = await finirPostsVideo();
        return { ...resume, ...finis };
      });
    })().catch((err) => logger.error({ err: String(err) }, 'video-suivi en échec'));
  }, { timezone: TZ });

  // Blog du site : un article quand la cadence l'exige (rédaction → validation dans le dashboard)
  cron.schedule('30 6 * * *', () => {
    void (async () => {
      const { blogDue, runBlogPipeline } = await import('../blog/pipeline.js');
      await runJob('blog-if-due', async () => {
        const check = blogDue();
        if (!check.due) return { skipped: true, reason: check.reason };
        return runBlogPipeline();
      });
    })().catch((err) => logger.error({ err: String(err) }, 'blog-if-due en échec'));
  }, { timezone: TZ });

  // Articles programmés : publication dans Framer à l'heure dite
  cron.schedule('*/10 * * * *', () => {
    void (async () => {
      const { publierArticlesDus } = await import('../blog/pipeline.js');
      await runJob('blog-publish-due', () => publierArticlesDus());
    })().catch((err) => logger.error({ err: String(err) }, 'blog-publish-due en échec'));
  }, { timezone: TZ });

  // Publications dues (+ suivi des containers Instagram en cours)
  cron.schedule('*/5 * * * *', () => {
    void (async () => {
      const { processDuePublishJobs } = await import('../publishers/worker.js');
      await runJob('publish-due', processDuePublishJobs);
    })().catch((err) => logger.error({ err: String(err) }, 'publish-due en échec'));
  }, { timezone: TZ });

  // Amplification : commentaire d'amorce de l'auteur, puis commentaires des collègues sous le post
  cron.schedule('*/10 * * * *', () => {
    void (async () => {
      const { amplifierPostsPublies } = await import('../publishers/amplify.js');
      await runJob('amplify', () => amplifierPostsPublies());
    })().catch((err) => logger.error({ err: String(err) }, 'amplify en échec'));
  }, { timezone: TZ });

  // LinkedIn : lecture des commentaires de chaque profil et de la page, réponse sous le commentaire (pas d'API DM, pas de webhook)
  cron.schedule('*/30 * * * *', () => {
    void (async () => {
      const { pollLinkedInComments } = await import('../webhooks/linkedinPoller.js');
      await runJob('poll-li-comments', pollLinkedInComments);
    })().catch((err) => logger.error({ err: String(err) }, 'poll-li-comments en échec'));
  }, { timezone: TZ });

  // Le lendemain d'un post LinkedIn dont les commentaires ne sont pas lisibles par
  // l'application : un rappel, avec la réponse à coller — sinon personne ne répond.
  cron.schedule('0 9 * * *', () => {
    void (async () => {
      const { rappelerCommentairesLinkedIn } = await import('../webhooks/linkedinPoller.js');
      await runJob('rappel-li-commentaires', rappelerCommentairesLinkedIn);
    })().catch((err) => logger.error({ err: String(err) }, 'rappel-li-commentaires en échec'));
  }, { timezone: TZ });

  // Renouvellement des jetons (LinkedIn refresh_token, jeton utilisateur Meta) avant expiration
  cron.schedule('30 4 * * *', () => {
    void (async () => {
      const { checkConnections, refreshTokens } = await import('../publishers/refresh.js');
      await runJob('refresh-tokens', refreshTokens);
      // Puis la vérité du terrain : une page qui a perdu son droit ou un jeton révoqué
      // ne doit pas rester « vert » jusqu'au prochain clic sur « Tester les connexions ».
      await runJob('check-connections', async () => {
        const { alerterComptesRefuses } = await import('../publishers/refresh.js');
        const checks = await checkConnections();
        const alerte = await alerterComptesRefuses(checks);
        return { comptes: checks.length, refuses: checks.filter((c) => !c.ok && c.cause === 'auth').length, alerte };
      });
    })().catch((err) => logger.error({ err: String(err) }, 'refresh-tokens en échec'));
  }, { timezone: TZ });

  // Relevé quotidien des statistiques des posts publiés (portée, réactions, enregistrements…)
  cron.schedule('10 9 * * *', () => {
    void (async () => {
      const { runMetricsJob } = await import('../publishers/metrics.js');
      await runJob('metrics', () => runMetricsJob());
    })().catch((err) => logger.error({ err: String(err) }, 'metrics en échec'));
  }, { timezone: TZ });

  // Relevé rapproché des posts tout juste publiés : la courbe des premières heures
  // ne s'attrape pas avec un seul passage quotidien (voir delaiEntreReleves).
  cron.schedule('25 */2 * * *', () => {
    void (async () => {
      const { runMetricsJob } = await import('../publishers/metrics.js');
      await runJob('metrics-recents', () => runMetricsJob({ maxAgeDays: 3 }));
    })().catch((err) => logger.error({ err: String(err) }, 'metrics-recents en échec'));
  }, { timezone: TZ });

  // Relances d'approbation (24 h sans réponse, max configurable)
  cron.schedule('0 8 * * *', () => {
    void runJob('approval-reminders', sendApprovalReminders);
  }, { timezone: TZ });

  // Maintenance quotidienne
  cron.schedule('0 3 * * *', () => {
    void runJob('maintenance', runMaintenance);
  }, { timezone: TZ });

  // Récap hebdomadaire (lundi 8 h)
  cron.schedule('0 8 * * 1', () => {
    void runJob('weekly-analytics', sendWeeklyRecap);
  }, { timezone: TZ });

  logger.info('crons enregistrés (Europe/Paris)');
}

async function sendApprovalReminders(): Promise<{ reminded: number }> {
  const settings = getApprovalEmail();
  const pending = db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.status, 'awaiting_approval'))
    .all();
  let reminded = 0;
  for (const post of pending) {
    const lastApproval = db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.postId, post.id))
      .orderBy(desc(schema.approvals.id))
      .limit(1)
      .get();
    if (!lastApproval || lastApproval.actedAt) continue;
    const ageH = (Date.now() - new Date(lastApproval.sentAt).getTime()) / 3600000;
    if (ageH < 24) continue;
    const remindersTotal = db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(eq(schema.approvals.postId, post.id))
      .all().length;
    if (remindersTotal - 1 >= settings.maxReminders) continue;
    await sendApprovalEmail(post.id, { reminder: true });
    reminded++;
  }
  return { reminded };
}

async function runMaintenance(): Promise<Record<string, number>> {
  const now = Date.now();
  // 0. Items shortlistés jamais utilisés depuis 72 h → retour au pool
  const { recycleStaleShortlist } = await import('../scorer/shortlist.js');
  const recycled = recycleStaleShortlist();
  // 1. Alerte tokens OAuth qui expirent sous 7 jours (les jetons de Page Meta n'expirent pas ;
  //    ceux renouvelés automatiquement n'arrivent ici que si le renouvellement a échoué)
  let expiryWarnings = 0;
  const tokens = db.select().from(schema.oauthTokens).all();
  for (const token of tokens) {
    if (!token.expiresAt) continue;
    const days = (new Date(token.expiresAt).getTime() - now) / 86400000;
    if (days > 0 && days <= 7) {
      const already = db
        .select()
        .from(schema.emailLog)
        .where(
          and(
            eq(schema.emailLog.kind, 'token_expiry'),
            gte(schema.emailLog.sentAt, new Date(now - 3 * 86400000).toISOString()),
          ),
        )
        .all();
      if (already.length === 0) {
        await sendMail({
          kind: 'token_expiry',
          to: getApprovalEmail().to,
          subject: `[Odile] ⚠️ Reconnexion ${token.provider} requise sous ${Math.ceil(days)} j`,
          html: `<p>Le jeton <b>${token.provider} / ${token.subject}</b> expire le ${token.expiresAt}.<br/>
Ouvre le dashboard → Réglages → Connexions pour le renouveler en un clic.</p>`,
          text: `Le jeton ${token.provider}/${token.subject} expire le ${token.expiresAt}. Reconnecte-le depuis le dashboard.`,
        });
        expiryWarnings++;
      }
    }
  }
  // 2. Purge des vieux runs de jobs (> 90 j)
  const purged = db
    .delete(schema.jobRuns)
    .where(lt(schema.jobRuns.startedAt, new Date(now - 90 * 86400000).toISOString()))
    .run().changes;
  // 3. Purge des payloads bruts de commentaires (> 30 j)
  const rawPurged = db
    .update(schema.comments)
    .set({ raw: null })
    .where(lt(schema.comments.fetchedAt, new Date(now - 30 * 86400000).toISOString()))
    .run().changes;
  return { expiryWarnings, purged, rawPurged, recycled };
}

async function sendWeeklyRecap(): Promise<{ sent: boolean }> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const published = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since)))
    .all();
  const clicks = db
    .select({ id: schema.clicks.id })
    .from(schema.clicks)
    .where(and(gte(schema.clicks.ts, since), eq(schema.clicks.bot, false)))
    .all().length;
  const { latestMetricsByPost } = await import('../publishers/metrics.js');
  const metrics = latestMetricsByPost(published.map((p) => p.id));
  let reach = 0;
  let likes = 0;
  let comments = 0;
  for (const m of metrics.values()) {
    reach += m.reach ?? 0;
    likes += m.likes ?? 0;
    comments += m.comments ?? 0;
  }
  const dms = db
    .select({ id: schema.dmEvents.id })
    .from(schema.dmEvents)
    .where(gte(schema.dmEvents.sentAt, since))
    .all().length;
  const rows = published
    .map((p) => {
      const m = metrics.get(p.id);
      const stats = m ? ` — ${m.reach ?? '?'} vus · ${m.likes ?? 0} j'aime · ${m.comments ?? 0} comm.` : '';
      return `<li>${p.hook} — <a href="${p.externalUrl ?? '#'}">${p.channel}</a>${stats}</li>`;
    })
    .join('');
  const reachLine = metrics.size > 0 ? ` · <b>${reach}</b> personnes atteintes · <b>${likes}</b> j'aime · <b>${comments}</b> commentaires` : '';
  const result = await sendMail({
    kind: 'analytics',
    to: getApprovalEmail().to,
    subject: `[Odile] Récap hebdo : ${published.length} post(s), ${metrics.size > 0 ? `${reach} vus, ` : ''}${clicks} clic(s), ${dms} DM(s)`,
    html: `<h2>Semaine écoulée</h2>
<p><b>${published.length}</b> post(s) publié(s) · <b>${clicks}</b> clic(s) trackés · <b>${dms}</b> DM(s) envoyés${reachLine}</p>
<ul>${rows}</ul>
<p>Détail complet dans le dashboard → Analytics.</p>`,
    text: `${published.length} posts publiés, ${reach} vus, ${clicks} clics, ${dms} DMs cette semaine.`,
  });
  return { sent: result.ok };
}
