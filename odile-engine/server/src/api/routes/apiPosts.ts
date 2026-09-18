import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import {
  generateImageSchema,
  patchPostSchema,
  putSlideSchema,
  regenerateSchema,
  rejectSchema,
  schedulePostSchema,
} from '@odile/shared';
import { executeApprovalAction, schedulePost, unschedulePost } from '../../approvals/service.js';
import { getDmTriggers, getPublishSlots } from '../../db/settingsRepo.js';
import { slotOccurrencesBetween } from '../../lib/time.js';
import { db, schema } from '../../db/client.js';
import { compteDuCanal, comptesLinkedIn } from '../../publishers/linkedinAccounts.js';
import { freresDuGroupe, surfaceDuPost } from '../../scheduler/broadcast.js';

/**
 * Le format équivalent sur l'autre plateforme. Un document PDF n'existe pas sur
 * Instagram, un carrousel d'images n'existe pas sur LinkedIn ; le reel est commun.
 */
export function formatPourPlateforme(format: string, platform: 'instagram' | 'linkedin'): string {
  const table: Record<string, string> =
    platform === 'instagram' ? { li_doc: 'carousel', li_image: 'static' } : { carousel: 'li_doc', static: 'li_image' };
  return table[format] ?? format;
}
import { runJob } from '../../lib/jobRunner.js';
import { mirrorToFacebookPage } from '../../publishers/facebook.js';
import { buildCaption, collectPublishImages } from '../../publishers/types.js';
import { runDesignReview } from '../../design-studio/index.js';
import { sendApprovalEmail } from '../../mailer/approvalEmail.js';
import { themeExists } from '../../render/custom-theme.js';
import { assetIsCutout, parseVisualOverrides, renderPost } from '../../render/renderer.js';
import { regeneratePart } from '../../writer/regenerate.js';

const nanoJti = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

function postSummary(post: typeof schema.posts.$inferSelect) {
  const news = post.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, post.newsItemId)).get()
    : null;
  const slides = db
    .select({ id: schema.slides.id, renderAssetId: schema.slides.renderAssetId })
    .from(schema.slides)
    .where(eq(schema.slides.postId, post.id))
    .orderBy(schema.slides.idx)
    .all();
  const slideCount = slides.length;
  return {
    id: post.id,
    platform: post.platform,
    channel: post.channel,
    format: post.format,
    theme: post.theme,
    status: post.status,
    hook: post.hook,
    caption: post.caption,
    cta: post.cta,
    hashtags: JSON.parse(post.hashtags) as string[],
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    externalUrl: post.externalUrl,
    // Publication simulée (PUBLISH_MODE=dry) : le statut dit « publié » alors que
    // rien n'est parti. Le dashboard doit pouvoir le dire sans ambiguïté.
    simulated: Boolean(post.externalPostId?.startsWith('dry-')),
    /** motif du dernier échec (fabrication ou publication) */
    error: post.error,
    /** étape de fabrication en cours, quand le post est encore en chantier */
    pipelineStep: post.pipelineStep,
    /** vidéo avatar : état, script, adresse du MP4 servi par le moteur */
    video: {
      status: post.videoStatus,
      script: post.videoScript,
      error: post.videoError,
      durationMs: post.videoDurationMs,
      url: post.videoAssetId ? `/public-assets/${post.videoAssetId}.mp4` : null,
    },
    /** le compte qui publie, en clair : « Alexis Duquenoy », « page Odile AI », « Instagram » */
    surface: surfaceDuPost(post).label,
    liAccountKey: post.liAccountKey,
    /**
     * Les visuels rendus, dans l'ordre. Valider sans les voir, c'est signer sans
     * lire : la liste sert aux vignettes des écrans de validation et du calendrier.
     */
    vignettes: slides.map((s) => s.renderAssetId).filter((id): id is string => Boolean(id)),
    /** diffusion simultanée : la surface de ce post et celles de ses copies */
    broadcast: (() => {
      if (!post.broadcastGroup) return null;
      const freres = freresDuGroupe(post);
      return {
        group: post.broadcastGroup,
        surface: surfaceDuPost(post).label,
        others: freres.map((f) => surfaceDuPost(f).label),
        // L'original est le plus ancien du groupe : c'est lui que l'on valide, les
        // copies suivent. Sans ce repère, l'écran de validation montrait une copie
        // encore au studio, dont les actions restaient fermées.
        original: freres.every((f) => f.id > post.id),
      };
    })(),
    resource: {
      kind: post.resourceKind,
      title: post.resourceTitle,
      url: post.resourceUrl,
      assetId: post.resourceAssetId,
      error: post.resourceError,
      // Sur LinkedIn, quand le mot-clé ouvre le diagnostic, la ressource s'atteint
      // par le lien du post — pas en commentant. L'écran de validation doit le dire.
      viaLien: post.platform === 'linkedin' && getDmTriggers().linkedinOffer === 'diagnostic',
    },
    createdAt: post.createdAt,
    commentTriggerKeyword: post.commentTriggerKeyword,
    reviewSummary: post.reviewSummary ? JSON.parse(post.reviewSummary) : null,
    newsTitle: news?.title ?? null,
    newsUrl: news?.url ?? null,
    slideCount,
  };
}

/** Insère une ligne d'approbation « dashboard » puis exécute l'action. */
function dashboardAction(postId: number, act: 'approve' | 'reject', ctx: { publishNow?: boolean; reason?: string; ip?: string }) {
  const jti = `dash-${nanoJti()}`;
  db.insert(schema.approvals)
    .values({
      postId,
      jti,
      kind: 'approval',
      sentTo: 'dashboard',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    .run();
  return executeApprovalAction(
    { v: 1, jti, pid: postId, act, exp: Math.floor(Date.now() / 1000) + 60 },
    ctx,
  );
}

export function registerPostRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { status?: string } }>('/api/posts', async (request) => {
    const statuses = request.query.status?.split(',');
    const rows = statuses?.length
      ? db
          .select()
          .from(schema.posts)
          .where(inArray(schema.posts.status, statuses as never))
          .orderBy(desc(schema.posts.createdAt))
          .limit(100)
          .all()
      : db.select().from(schema.posts).orderBy(desc(schema.posts.createdAt)).limit(100).all();
    return rows.map(postSummary);
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, Number(request.params.id))).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    const slides = db
      .select()
      .from(schema.slides)
      .where(eq(schema.slides.postId, post.id))
      .orderBy(schema.slides.idx)
      .all()
      .map((s) => ({
        id: s.id,
        idx: s.idx,
        kind: s.kind,
        content: JSON.parse(s.content),
        renderAssetId: s.renderAssetId,
        screenshotAssetId: s.screenshotAssetId,
        heroAssetId: s.heroAssetId,
        heroCutout: assetIsCutout(s.heroAssetId),
      }));
    const reviews = db
      .select()
      .from(schema.designReviews)
      .where(eq(schema.designReviews.postId, post.id))
      .orderBy(schema.designReviews.iteration, schema.designReviews.reviewer)
      .all()
      .map((r) => ({
        id: r.id,
        iteration: r.iteration,
        reviewer: r.reviewer,
        score: r.score,
        verdict: r.verdict,
        issues: JSON.parse(r.issues),
        passed: r.passed,
        modelUsed: r.modelUsed,
        createdAt: r.createdAt,
      }));
    const clicks = post.linkId
      ? db.select({ id: schema.clicks.id }).from(schema.clicks).where(eq(schema.clicks.linkId, post.linkId)).all().length
      : 0;
    return { ...postSummary(post), slides, reviews, clicks, visualOverrides: parseVisualOverrides(post.visualOverrides) };
  });

  app.patch<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const parsed = patchPostSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const data = parsed.data;
    if (data.theme && !themeExists(data.theme)) {
      return reply.status(400).send({ error: 'Thème introuvable' });
    }
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (data.caption !== undefined) update.caption = data.caption;
    if (data.hook !== undefined) update.hook = data.hook;
    if (data.cta !== undefined) update.cta = data.cta;
    if (data.hashtags !== undefined) update.hashtags = JSON.stringify(data.hashtags);
    if (data.format !== undefined) update.format = data.format;
    if (data.channel !== undefined) {
      const platform = data.channel === 'ig' ? 'instagram' : 'linkedin';
      update.channel = data.channel;
      update.platform = platform;
      const actuel = db.select({ format: schema.posts.format, liAccountKey: schema.posts.liAccountKey }).from(schema.posts).where(eq(schema.posts.id, id)).get();
      // Changer de canal sans changer de format laissait un « document PDF » sur
      // Instagram : impubliable, et l'éditeur ne le montrait pas.
      const format = data.format ?? actuel?.format ?? 'carousel';
      const equivalent = formatPourPlateforme(format, platform);
      if (equivalent !== format) update.format = equivalent;
      // Le compte suit le canal : Instagram n'en a pas, un profil ne publie pas au
      // nom de la page. Sans compte compatible, le premier de la rotation.
      if (data.channel === 'ig') update.liAccountKey = null;
      else {
        const subject = data.channel === 'li_org' ? 'li_org' : 'li_person';
        const voulu = data.liAccountKey ?? actuel?.liAccountKey ?? null;
        const connu = voulu !== null && comptesLinkedIn(subject).some((c) => c.key === voulu);
        update.liAccountKey = connu ? voulu : (compteDuCanal(data.channel)?.key ?? null);
      }
    } else if (data.liAccountKey !== undefined) {
      const courant = db.select({ channel: schema.posts.channel }).from(schema.posts).where(eq(schema.posts.id, id)).get();
      if (courant?.channel === 'ig') return reply.status(400).send({ error: 'Un post Instagram n’a pas de compte LinkedIn' });
      const subject = courant?.channel === 'li_org' ? 'li_org' : 'li_person';
      if (data.liAccountKey !== null && !comptesLinkedIn(subject).some((c) => c.key === data.liAccountKey)) {
        return reply.status(400).send({ error: 'Ce compte n’est pas connecté sur ce canal' });
      }
      update.liAccountKey = data.liAccountKey;
    }
    if (data.theme !== undefined) update.theme = data.theme;
    if (data.scheduledAt !== undefined) update.scheduledAt = data.scheduledAt;
    // Le script corrigé n'invalide pas la vidéo déjà fabriquée : c'est « Relancer la vidéo » qui la refait.
    if (data.videoScript !== undefined) update.videoScript = data.videoScript;
    // Changer le mot-clé touche trois endroits : la caption publiée, la slide CTA
    // imprimée et le détecteur de commentaires. On les garde alignés.
    if (data.commentTriggerKeyword !== undefined) {
      const ancien = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get()?.commentTriggerKeyword;
      const nouveau = data.commentTriggerKeyword?.toUpperCase() ?? null;
      update.commentTriggerKeyword = nouveau;
      if (ancien && nouveau && data.caption === undefined) {
        const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
        if (post) update.caption = post.caption.replaceAll(ancien, nouveau);
      }
    }
    db.update(schema.posts).set(update).where(eq(schema.posts.id, id)).run();
    if (data.theme !== undefined || update.format !== undefined) {
      db.update(schema.slides).set({ renderAssetId: null }).where(eq(schema.slides.postId, id)).run();
    }
    return { ok: true };
  });

  app.put<{ Params: { id: string; idx: string } }>('/api/posts/:id/slides/:idx', async (request, reply) => {
    const parsed = putSlideSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const slide = db
      .select()
      .from(schema.slides)
      .where(
        and(
          eq(schema.slides.postId, Number(request.params.id)),
          eq(schema.slides.idx, Number(request.params.idx)),
        ),
      )
      .get();
    if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
    db.update(schema.slides)
      .set({
        content: JSON.stringify(parsed.data.content),
        kind: parsed.data.content.kind,
        renderAssetId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.slides.id, slide.id))
      .run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/regenerate', async (request, reply) => {
    const parsed = regenerateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const id = Number(request.params.id);
    if (parsed.data.scope === 'all') {
      return reply.status(400).send({ error: 'Régénération complète : rejette le post et relance depuis l’actu.' });
    }
    try {
      await regeneratePart({
        postId: id,
        scope: parsed.data.scope,
        slideIdx: parsed.data.slideIdx,
        instructions: parsed.data.instructions,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: `Régénération impossible : ${message.slice(0, 200)}` });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Querystring: { slide?: string } }>('/api/posts/:id/render', async (request) => {
    const slide = request.query.slide !== undefined ? Number(request.query.slide) : undefined;
    return renderPost(Number(request.params.id), Number.isInteger(slide) ? { onlyIdx: slide } : {});
  });

  // Génération / régénération de l'illustration IA d'une slide
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/generate-image',
    async (request, reply) => {
      const parsed = generateImageSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      // Nouvelle génération demandée explicitement : on repart de zéro
      db.update(schema.slides).set({ heroAssetId: null }).where(eq(schema.slides.id, slide.id)).run();
      const { generateHeroImage } = await import('../../imagegen/index.js');
      const result = await generateHeroImage(slide.id, parsed.data);
      if (!result.ok) return reply.status(422).send({ error: result.reason });
      return result;
    },
  );

  // Retirer l'illustration d'une slide : l'image générée, celle de la bibliothèque,
  // celle qu'on a importée, ou la capture d'écran posée par l'agent visuel.
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/remove-image',
    async (request, reply) => {
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      // Une slide « capture d'écran » sans capture n'a plus de sujet : elle redevient
      // une slide de contenu, avec son titre et son texte intacts. Sinon le rendu
      // afficherait un cadre de navigateur vide.
      const kind = slide.kind === 'screenshot' && slide.screenshotAssetId ? 'content' : slide.kind;
      const content = JSON.parse(slide.content) as Record<string, unknown>;
      content.kind = kind;
      db.update(schema.slides)
        .set({
          kind,
          content: JSON.stringify(content),
          heroAssetId: null,
          screenshotAssetId: null,
          renderAssetId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.slides.id, slide.id))
        .run();
      return { ok: true };
    },
  );

  // Illustration maison : l'utilisateur téléverse sa propre image pour une slide
  app.post<{ Params: { id: string; idx: string } }>(
    '/api/posts/:id/slides/:idx/upload-image',
    async (request, reply) => {
      const slide = db
        .select()
        .from(schema.slides)
        .where(
          and(
            eq(schema.slides.postId, Number(request.params.id)),
            eq(schema.slides.idx, Number(request.params.idx)),
          ),
        )
        .get();
      if (!slide) return reply.status(404).send({ error: 'Slide introuvable' });
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'Aucun fichier reçu' });
      if (!/^image\/(png|jpe?g|webp|avif)$/.test(file.mimetype)) {
        return reply.status(415).send({ error: `Format non pris en charge : ${file.mimetype}` });
      }
      const raw = await file.toBuffer();
      const sharp = (await import('sharp')).default;
      // Même normalisation que les illustrations générées : 1080×1350 JPEG
      const normalized = await sharp(raw)
        .resize(1080, 1350, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 90 })
        .toBuffer();
      const { saveAsset } = await import('../../render/renderer.js');
      const assetId = saveAsset(
        normalized,
        'genimage',
        {
          postId: slide.postId,
          slideId: slide.id,
          extraMeta: { source: 'upload', filename: file.filename },
        },
        { width: 1080, height: 1350 },
        { ext: 'jpg', mime: 'image/jpeg' },
      );
      db.update(schema.slides)
        .set({ heroAssetId: assetId, renderAssetId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.slides.id, slide.id))
        .run();
      return { ok: true, assetId };
    },
  );

  /**
   * Recopie manuelle sur la Page Facebook d'un post déjà publié sur Instagram.
   * Le miroir automatique ne vaut que pour les publications à venir : ce bouton
   * rattrape celles qui sont parties avant son activation.
   */
  app.post<{ Params: { id: string } }>('/api/posts/:id/mirror-facebook', async (request, reply) => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, Number(request.params.id))).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (post.status !== 'published') return reply.status(409).send({ error: 'Le post doit d’abord être publié sur Instagram' });
    if (post.platform !== 'instagram') return reply.status(409).send({ error: 'La recopie ne concerne que les posts Instagram' });
    try {
      const images = collectPublishImages(post.id);
      const mirror = await mirrorToFacebookPage({ post, images, caption: buildCaption(post) });
      db.update(schema.posts)
        .set({ fbMirrorPostId: mirror.postId, fbMirrorUrl: mirror.url, fbMirrorError: null })
        .where(eq(schema.posts.id, post.id))
        .run();
      return { ok: true, url: mirror.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(schema.posts).set({ fbMirrorError: message.slice(0, 500) }).where(eq(schema.posts.id, post.id)).run();
      return reply.status(502).send({ error: message.slice(0, 300) });
    }
  });

  /** Relance la fabrication (rendu, relecture, email) d'un post bloqué ou en échec. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/retry-fabrication', async (request, reply) => {
    const id = Number(request.params.id);
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (post.status === 'published') return reply.status(409).send({ error: 'Ce post est déjà publié' });
    const { refabriquerPost } = await import('../../scheduler/pipeline.js');
    void runJob('refabrication', () => refabriquerPost(id)).catch(() => undefined);
    return { started: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/review', async (request) => {
    return runDesignReview(Number(request.params.id));
  });

  app.post<{ Params: { id: string }; Body: { publishNow?: boolean } }>(
    '/api/posts/:id/approve',
    async (request, reply) => {
      const outcome = await dashboardAction(Number(request.params.id), 'approve', {
        publishNow: Boolean(request.body?.publishNow),
        ip: request.ip,
      });
      if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
      return outcome;
    },
  );

  /** Programme (ou déplace) un post à une date précise, choisie dans le calendrier ou l'éditeur. */
  app.post<{ Params: { id: string } }>('/api/posts/:id/schedule', async (request, reply) => {
    const parsed = schedulePostSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Date invalide : format ISO 8601 attendu (ex. 2026-09-18T16:30:00Z)' });
    const outcome = schedulePost(Number(request.params.id), parsed.data.at);
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  /** Post programmé : retour à « à valider » (job de publication annulé). */
  app.post<{ Params: { id: string } }>('/api/posts/:id/unschedule', async (request, reply) => {
    const outcome = unschedulePost(Number(request.params.id));
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/reject', async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const outcome = await dashboardAction(Number(request.params.id), 'reject', {
      reason: parsed.data.reason,
      ip: request.ip,
    });
    if (!outcome.ok) return reply.status(409).send({ error: outcome.message });
    return outcome;
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/send-approval-email', async (request, reply) => {
    const result = await sendApprovalEmail(Number(request.params.id));
    if (!result.ok) return reply.status(409).send({ error: "L'email n'a pas pu être envoyé (SMTP) — vérifiez Réglages → Email" });
    return result;
  });

  /**
   * Créneaux de publication configurés sur une période (heure de Paris), avec le post qui
   * occupe chacun d'eux : la grille du calendrier propose les créneaux libres à un clic.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/schedule/slots', async (request) => {
    const now = Date.now();
    const fromRaw = request.query.from ? new Date(request.query.from) : new Date(now);
    const from = Number.isNaN(fromRaw.getTime()) ? new Date(now) : fromRaw;
    const toRaw = request.query.to ? new Date(request.query.to) : new Date(from.getTime() + 28 * 86400000);
    const to = Number.isNaN(toRaw.getTime()) ? new Date(from.getTime() + 28 * 86400000) : toRaw;
    if (to.getTime() - from.getTime() > 70 * 86400000) to.setTime(from.getTime() + 70 * 86400000);
    const slots = getPublishSlots();
    const occupied = db
      .select({ id: schema.posts.id, hook: schema.posts.hook, platform: schema.posts.platform, scheduledAt: schema.posts.scheduledAt, status: schema.posts.status })
      .from(schema.posts)
      .where(
        and(
          inArray(schema.posts.status, ['scheduled', 'publishing', 'published']),
          gte(schema.posts.scheduledAt, new Date(from.getTime() - 30 * 60000).toISOString()),
          lte(schema.posts.scheduledAt, new Date(to.getTime() + 30 * 60000).toISOString()),
        ),
      )
      .all();
    const out: { at: string; platform: 'instagram' | 'linkedin'; past: boolean; postId: number | null; postHook: string | null }[] = [];
    for (const platform of ['instagram', 'linkedin'] as const) {
      for (const slot of platform === 'instagram' ? slots.ig : slots.li) {
        for (const at of slotOccurrencesBetween(slot, from, to)) {
          const taken = occupied.find(
            (p) => p.platform === platform && p.scheduledAt && Math.abs(new Date(p.scheduledAt).getTime() - at.getTime()) < 30 * 60000,
          );
          out.push({
            at: at.toISOString(),
            platform,
            // délai minimal de 2 h avant publication (rendu, vérification)
            past: at.getTime() < now + 2 * 3600000,
            postId: taken?.id ?? null,
            postHook: taken?.hook ?? null,
          });
        }
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/calendar', async (request) => {
    const from = request.query.from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const to = request.query.to ?? new Date(Date.now() + 30 * 86400000).toISOString();
    // La date qui compte est celle du créneau tant que le post n'est pas parti, puis
    // celle de la publication : un post publié à la main (« Publier maintenant » sur un
    // post jamais programmé, reprise après incident) n'avait aucune date de créneau et
    // disparaissait purement et simplement du calendrier.
    const quand = sql<string>`coalesce(${schema.posts.scheduledAt}, ${schema.posts.publishedAt})`;
    const rows = db
      .select()
      .from(schema.posts)
      .where(and(inArray(schema.posts.status, ['scheduled', 'publishing', 'published']), gte(quand, from), lte(quand, to)))
      .orderBy(quand)
      .all();
    return rows.map(postSummary);
  });
}
