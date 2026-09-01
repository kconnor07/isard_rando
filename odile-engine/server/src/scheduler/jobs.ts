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
  // Veille : toutes les heures à h+15 (scrape incrémental + scoring des nouveaux items)
  cron.schedule('15 * * * *', () => {
    void runJob('scrape', runScrape).then(() => runJob('score', () => runScore()));
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

  // Publications dues (+ suivi des containers Instagram en cours)
  cron.schedule('*/5 * * * *', () => {
    void (async () => {
      const { processDuePublishJobs } = await import('../publishers/worker.js');
      await runJob('publish-due', processDuePublishJobs);
    })().catch((err) => logger.error({ err: String(err) }, 'publish-due en échec'));
  }, { timezone: TZ });

  // Fallback LinkedIn : détection des commentaires (pas d'API DM)
  cron.schedule('*/30 * * * *', () => {
    void (async () => {
      const { pollLinkedInComments } = await import('../webhooks/linkedinPoller.js');
      await runJob('poll-li-comments', pollLinkedInComments);
    })().catch((err) => logger.error({ err: String(err) }, 'poll-li-comments en échec'));
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
  // 1. Alerte tokens OAuth qui expirent sous 7 jours
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
    .where(gte(schema.clicks.ts, since))
    .all().length;
  const dms = db
    .select({ id: schema.dmEvents.id })
    .from(schema.dmEvents)
    .where(gte(schema.dmEvents.sentAt, since))
    .all().length;
  const rows = published
    .map((p) => `<li>${p.hook} — <a href="${p.externalUrl ?? '#'}">${p.channel}</a></li>`)
    .join('');
  const result = await sendMail({
    kind: 'analytics',
    to: getApprovalEmail().to,
    subject: `[Odile] Récap hebdo : ${published.length} post(s), ${clicks} clic(s), ${dms} DM(s)`,
    html: `<h2>Semaine écoulée</h2>
<p><b>${published.length}</b> post(s) publié(s) · <b>${clicks}</b> clic(s) trackés · <b>${dms}</b> DM(s) envoyés</p>
<ul>${rows}</ul>
<p>Détail complet dans le dashboard → Analytics.</p>`,
    text: `${published.length} posts publiés, ${clicks} clics, ${dms} DMs cette semaine.`,
  });
  return { sent: result.ok };
}
