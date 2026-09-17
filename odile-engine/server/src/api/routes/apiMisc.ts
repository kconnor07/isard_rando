import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '@odile/shared';
import { config } from '../../config.js';
import { getDefaultTheme, getLlmBudget } from '../../db/settingsRepo.js';
import { consommationDuJour } from '../../lib/llmBudget.js';
import { db, schema } from '../../db/client.js';
import { latestMetricsByPost } from '../../publishers/metrics.js';
import { clicksByLink } from './apiAnalytics.js';
import { connectionWarnings } from '../../publishers/refresh.js';
import { expliquerErreurMeta } from '../../publishers/metaErrors.js';
import { nextPublishSlot, shouldDraftToday } from '../../scheduler/cadence.js';
import { checkPassword, hasValidSession, issueSession, SESSION_COOKIE } from '../auth.js';
import { loginLimiter } from '../rateLimit.js';
import { dailyIpHash } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { repondreSousCommentaire } from '../../webhooks/reponsePublique.js';

export function registerMiscRoutes(app: FastifyInstance): void {
  // ----- Auth ---------------------------------------------------------------
  app.post('/api/auth/login', async (request, reply) => {
    // 5 échecs par quart d'heure et par IP : le mot de passe d'administration est la
    // seule barrière devant les jetons LinkedIn/Meta.
    const key = request.ip ?? 'inconnu';
    const gate = loginLimiter.check(key);
    if (!gate.allowed) {
      logger.warn({ ip: dailyIpHash(key), retryAfter: gate.retryAfter }, 'connexion bloquée (trop de tentatives)');
      return reply
        .status(429)
        .header('retry-after', String(gate.retryAfter))
        .send({ error: `Trop de tentatives — réessayez dans ${Math.ceil(gate.retryAfter / 60)} minute(s).` });
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success || !checkPassword(parsed.data.password)) {
      const after = loginLimiter.fail(key);
      logger.warn({ ip: dailyIpHash(key), restantes: after.remaining }, 'mot de passe incorrect');
      return reply.status(401).send({
        error: after.remaining > 0 ? `Mot de passe incorrect — ${after.remaining} tentative(s) avant blocage.` : 'Mot de passe incorrect.',
      });
    }
    loginLimiter.reset(key);
    issueSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({ authenticated: hasValidSession(request) }));

  // ----- Résumé du dashboard ------------------------------------------------
  app.get('/api/dashboard/summary', async () => {
    const count = (statuses: string[]) =>
      db
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(inArray(schema.posts.status, statuses as never))
        .all().length;
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const clicks7d = db
      .select({ id: schema.clicks.id })
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since7d), eq(schema.clicks.bot, false)))
      .all().length;
    // Portée et interactions des posts publiés sur 7 jours (dernier relevé de chaque post)
    const published7d = db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since7d)))
      .all();
    let reach7d = 0;
    let engagement7d = 0;
    for (const m of latestMetricsByPost(published7d.map((p) => p.id)).values()) {
      reach7d += m.reach ?? 0;
      engagement7d += m.engagement ?? 0;
    }
    const pendingComments = db
      .select({ id: schema.comments.id })
      .from(schema.comments)
      .where(inArray(schema.comments.dmStatus, ['manual_suggested', 'pending']))
      .all().length;
    const cadence = shouldDraftToday();
    return {
      awaitingApproval: count(['awaiting_approval', 'reviewing', 'draft']),
      scheduled: count(['scheduled', 'publishing']),
      published: count(['published']),
      clicks7d,
      reach7d,
      engagement7d,
      pendingComments,
      cadence,
      warnings: connectionWarnings(),
      nextSlots: {
        instagram: nextPublishSlot('instagram').toISOString(),
        linkedin: nextPublishSlot('linkedin').toISOString(),
      },
    };
  });

  /**
   * Bilan de santé du moteur, en une page : version, mode, clés présentes,
   * budget du jour, derniers passages de chaque tâche avec leur motif d'échec,
   * et l'état des posts. Conçu pour remplacer une conversation de diagnostic :
   * aucun secret n'y figure, seulement la présence ou l'absence des clés.
   */
  app.get('/api/diagnostic/moteur', async () => {
    const derniers = db
      .select()
      .from(schema.jobRuns)
      .orderBy(desc(schema.jobRuns.startedAt))
      .limit(20)
      .all()
      .map((r) => {
        let motif: string | null = null;
        try {
          const resume = r.summary ? (JSON.parse(r.summary) as Record<string, unknown>) : null;
          const brut = resume && typeof resume.error === 'string' ? resume.error : null;
          const budget = resume && typeof resume.arreteParLeBudget === 'string' ? resume.arreteParLeBudget : null;
          motif = budget ? `budget : ${budget}` : brut ? brut.split('\n')[0]!.slice(0, 300) : null;
        } catch {
          motif = (r.summary ?? '').slice(0, 200);
        }
        return { tache: r.jobName, a: r.startedAt, fini: r.finishedAt, ok: r.ok, motif };
      });
    const parStatut = new Map<string, number>();
    for (const p of db.select({ status: schema.posts.status }).from(schema.posts).all()) {
      parStatut.set(p.status, (parStatut.get(p.status) ?? 0) + 1);
    }
    const recents = db
      .select()
      .from(schema.posts)
      .orderBy(desc(schema.posts.id))
      .limit(5)
      .all()
      .map((p) => ({ id: p.id, statut: p.status, theme: p.theme, motif: p.error?.slice(0, 300) ?? null, cree: p.createdAt }));
    const budget = getLlmBudget();
    const conso = consommationDuJour();
    return {
      version: process.env.GIT_SHA ?? 'dev',
      modePublication: config.PUBLISH_MODE,
      modeIA: config.LLM_MODE,
      clesPresentes: {
        anthropic: Boolean(config.ANTHROPIC_API_KEY),
        gemini: Boolean(config.GEMINI_API_KEY),
        images: Boolean(config.FREEPIK_API_KEY),
      },
      budgetIA: {
        actif: budget.enabled,
        plafondEuros: budget.dailyEuros,
        depenseAujourdhui: Number(conso.cout.toFixed(3)),
        appelsAujourdhui: conso.appels,
        bloque: budget.enabled && budget.dailyEuros > 0 && conso.cout >= budget.dailyEuros,
      },
      themeParDefaut: getDefaultTheme(),
      postsParStatut: Object.fromEntries(parStatut),
      postsRecents: recents,
      dernieresTaches: derniers,
    };
  });

  /** Relance l'envoi du DM d'un commentaire (après correction d'un réglage Meta). */
  app.post<{ Params: { id: string } }>('/api/comments/:id/retry-dm', async (request, reply) => {
    const id = Number(request.params.id);
    const comment = db.select().from(schema.comments).where(eq(schema.comments.id, id)).get();
    if (!comment) return reply.status(404).send({ error: 'Commentaire introuvable' });
    db.update(schema.comments).set({ dmStatus: 'none' }).where(eq(schema.comments.id, id)).run();
    const { handleInstagramComment } = await import('../../webhooks/commentDm.js');
    await handleInstagramComment(id);
    const apres = db.select().from(schema.comments).where(eq(schema.comments.id, id)).get();
    const dernier = db
      .select()
      .from(schema.dmEvents)
      .where(eq(schema.dmEvents.commentId, id))
      .orderBy(desc(schema.dmEvents.id))
      .limit(1)
      .get();
    const cause = expliquerErreurMeta(dernier?.error);
    return {
      ok: apres?.dmStatus !== 'failed',
      dmStatus: apres?.dmStatus ?? 'none',
      error: dernier?.error ?? null,
      cause: cause?.cause ?? null,
      remede: cause?.remede ?? null,
    };
  });

  /**
   * État réel de la chaîne de publication : ce qui attend son tour, ce qui est parti
   * (avec le lien vivant et ses chiffres), ce qui a échoué et pourquoi. Tout vient des
   * tables publish_jobs / posts / post_metrics — aucune valeur d'exemple.
   */
  app.get('/api/dashboard/publications', async () => {
    const jobs = db
      .select()
      .from(schema.publishJobs)
      .where(inArray(schema.publishJobs.state, ['pending', 'failed'] as never))
      .orderBy(schema.publishJobs.scheduledAt)
      .limit(40)
      .all();
    const publies = db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, 'published'))
      .orderBy(desc(schema.posts.publishedAt))
      .limit(12)
      .all();
    const metriques = latestMetricsByPost(publies.map((p) => p.id));
    const liens = new Map(db.select().from(schema.links).all().map((l) => [l.id, l]));
    const clics = clicksByLink([...liens.keys()]);
    const postDe = (postId: number) => db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
    const ligneJob = (j: typeof jobs[number]) => {
      const post = postDe(j.postId);
      return {
        postId: j.postId,
        hook: post?.hook ?? '',
        channel: post?.channel ?? '',
        scheduledAt: j.scheduledAt,
        state: j.state,
        tentative: j.attempt,
        tentativesMax: j.maxAttempts,
        erreur: j.lastError,
      };
    };
    const dernierPassage = db
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.jobName, 'publish-due'))
      .orderBy(desc(schema.jobRuns.startedAt))
      .limit(1)
      .get();
    return {
      mode: config.PUBLISH_MODE,
      dernierPassage: dernierPassage ? { a: dernierPassage.startedAt, ok: dernierPassage.ok } : null,
      aVenir: jobs.filter((j) => j.state === 'pending').map(ligneJob),
      echecs: jobs.filter((j) => j.state === 'failed').map(ligneJob),
      publiees: publies.map((p) => {
        const m = metriques.get(p.id);
        return {
          postId: p.id,
          hook: p.hook,
          channel: p.channel,
          publishedAt: p.publishedAt,
          url: p.externalUrl,
          simule: Boolean(p.externalPostId?.startsWith('dry-')),
          miroirFacebook: p.fbMirrorUrl,
          miroirErreur: p.fbMirrorError,
          portee: m?.reach ?? null,
          likes: m?.likes ?? null,
          commentaires: m?.comments ?? null,
          clics: p.linkId ? (clics.get(p.linkId) ?? 0) : 0,
          releveLe: m?.fetchedAt ?? null,
        };
      }),
    };
  });

  // ----- Commentaires / DM --------------------------------------------------
  app.get<{ Querystring: { platform?: string; dmStatus?: string } }>('/api/comments', async (request) => {
    const conditions = [];
    if (request.query.platform) conditions.push(eq(schema.comments.platform, request.query.platform as never));
    if (request.query.dmStatus)
      conditions.push(inArray(schema.comments.dmStatus, request.query.dmStatus.split(',') as never));
    const rows = (
      conditions.length
        ? db.select().from(schema.comments).where(and(...conditions))
        : db.select().from(schema.comments)
    )
      .orderBy(desc(schema.comments.id))
      .limit(100)
      .all();
    // Motif du dernier envoi raté : « Échec DM » sans raison n'aide personne.
    const erreurs = new Map<number, string>();
    for (const e of db
      .select()
      .from(schema.dmEvents)
      .where(eq(schema.dmEvents.status, 'failed'))
      .orderBy(desc(schema.dmEvents.id))
      .limit(200)
      .all()) {
      if (e.commentId !== null && e.error && !erreurs.has(e.commentId)) erreurs.set(e.commentId, e.error);
    }
    return rows.map((c) => {
      const brut = erreurs.get(c.id) ?? null;
      // Le numéro d'erreur de Meta ne dit pas quoi corriger : la traduction, si.
      const cause = expliquerErreurMeta(brut);
      return {
        id: c.id,
        platform: c.platform,
        authorName: c.authorName,
        text: c.text,
        matchedKeyword: c.matchedKeyword,
        dmStatus: c.dmStatus,
        dmError: brut,
        dmCause: cause?.cause ?? null,
        dmRemede: cause?.remede ?? null,
        publicReplyStatus: c.publicReplyStatus,
        publicReplyError: c.publicReplyError,
        suggestedReply: c.suggestedReply,
        externalPostUrl: c.externalPostUrl,
        createdTime: c.createdTime ?? c.fetchedAt,
      };
    });
  });

  /**
   * Envoie la réponse publique sous un commentaire, à la demande d'un humain.
   *
   * C'est la sortie de la boîte « à traiter » : un prospect qui n'a pas écrit le
   * mot-clé reçoit quand même ce qu'il demande, en un clic, sous son commentaire.
   */
  app.post<{ Params: { id: string }; Body: { texte?: string } }>('/api/comments/:id/repondre', async (request, reply) => {
    const id = Number(request.params.id);
    const comment = db.select().from(schema.comments).where(eq(schema.comments.id, id)).get();
    if (!comment) return reply.status(404).send({ error: 'Commentaire introuvable' });
    const texte = (request.body?.texte ?? comment.suggestedReply ?? '').trim();
    if (!texte) return reply.status(400).send({ error: 'Aucune réponse à envoyer — rédige-la d’abord.' });
    try {
      await repondreSousCommentaire(comment, texte);
      db.update(schema.comments)
        .set({ publicReplyStatus: 'sent', publicReplyError: null, dmStatus: 'handled', suggestedReply: texte })
        .where(eq(schema.comments.id, id))
        .run();
      return { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      db.update(schema.comments)
        .set({ publicReplyStatus: 'failed', publicReplyError: detail.slice(0, 500) })
        .where(eq(schema.comments.id, id))
        .run();
      return reply.status(400).send({ error: detail });
    }
  });

  app.post<{ Params: { id: string } }>('/api/comments/:id/mark-handled', async (request) => {
    db.update(schema.comments)
      .set({ dmStatus: 'handled' })
      .where(eq(schema.comments.id, Number(request.params.id)))
      .run();
    return { ok: true };
  });
}
