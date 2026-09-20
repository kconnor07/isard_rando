import fs from 'node:fs';
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
import { getCadence, getDmTriggers, getFbMirror, getPublishSlots } from '../../db/settingsRepo.js';
import { slotOccurrencesBetween } from '../../lib/time.js';
import { db, schema } from '../../db/client.js';
import { compteDuCanal, compteDuPost, comptesLinkedIn } from '../../publishers/linkedinAccounts.js';
import { getStoredToken } from '../../publishers/tokens.js';
import { documentDuPost } from '../../publishers/linkedinDocument.js';
import { realignerPost, realignerTout } from '../../scheduler/realigner.js';
import { apercuTunnel } from '../../approvals/tunnel.js';
import { echecDAdaptation, formatPourPlateforme, postsAVerifier, verifierPost } from '../../writer/conformite.js';
import { freresDuGroupe, surfaceDuPost } from '../../scheduler/broadcast.js';

/**
 * Le format équivalent sur l'autre plateforme. Un document PDF n'existe pas sur
 * Instagram, un carrousel d'images n'existe pas sur LinkedIn ; le reel est commun.
 */
export { formatPourPlateforme };
import { runJob } from '../../lib/jobRunner.js';
import { mirrorToFacebookPage, legendePourFacebook } from '../../publishers/facebook.js';
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
    /** clé de la surface pour filtrer sans ambiguïté : « ig », la clé du compte, ou null = compte non attribué */
    surfaceKey: post.channel === 'ig' ? 'ig' : (post.liAccountKey ?? null),
    /** miroir Facebook d'un post Instagram : prévu, publié (adresse) ou en échec */
    facebook:
      post.platform === 'instagram'
        ? {
            prevu: getFbMirror().enabled || Boolean(post.broadcastGroup && getCadence().broadcast),
            url: post.fbMirrorUrl,
            error: post.fbMirrorError,
          }
        : null,
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
        // Les copies elles-mêmes : le fondateur peut ouvrir chacune (texte, lien, mot-clé)
        // au lieu de valider l'original sans les avoir vues.
        members: freres.map((f) => ({ id: f.id, surface: surfaceDuPost(f).label, status: f.status, scheduledAt: f.scheduledAt, platform: f.platform })),
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
    // Ce qui empêcherait le post de tenir ses promesses, en phrases : vu avant d'approuver.
    problemes: ['draft', 'reviewing', 'awaiting_approval', 'scheduled', 'rejected', 'failed'].includes(post.status) ? verifierPost(post) : [],
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

  /** Ce que recevra la personne : lien et cible, ressource, réponses, DM, amorce, légende Facebook, identifications — avant validation. */
  app.get<{ Params: { id: string } }>('/api/posts/:id/tunnel', async (request, reply) => {
    const apercu = apercuTunnel(Number(request.params.id));
    if (!apercu) return reply.status(404).send({ error: 'Post introuvable' });
    return apercu;
  });

  /**
   * Ce que « Réaligner » toucherait : tous les posts modifiables, programmés compris.
   * L'écran « À valider » ne liste pas les programmés : sans ce compte, le bouton
   * manquait quand seuls des posts déjà programmés étaient à corriger.
   */
  app.get('/api/posts/realigner/etat', async () => {
    const concernes = postsAVerifier()
      .map((p) => ({ id: p.id, status: p.status, problemes: verifierPost(p) }))
      .filter((p) => p.problemes.some((q) => q.corrigeable || q.reecriture));
    return {
      total: concernes.length,
      programmes: concernes.filter((p) => p.status === 'scheduled').length,
      // Ceux que le modèle réécrira (et déprogrammera s'ils sont programmés)
      reecritures: concernes.filter((p) => p.problemes.some((q) => q.reecriture && q.niveau === 'bloquant')).length,
      ids: concernes.map((p) => p.id),
    };
  });

  /** Réaligne tous les posts modifiables avec la stratégie en vigueur (le modèle réécrit ce qui l'exige si `modele` est vrai). */
  app.post<{ Body: { modele?: boolean } }>('/api/posts/realigner', async (request) => {
    const resume = await realignerTout({ modele: request.body?.modele !== false });
    return {
      ok: true,
      ...resume,
      message: `${resume.posts} posts vérifiés · ${resume.corriges} corrigés · ${resume.reecrits} réécrits (à revalider) · ${resume.bloquants} encore bloqués`,
    };
  });

  app.post<{ Params: { id: string }; Body: { modele?: boolean } }>('/api/posts/:id/realigner', async (request, reply) => {
    const id = Number(request.params.id);
    if (!db.select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.id, id)).get()) return reply.status(404).send({ error: 'Post introuvable' });
    const r = await realignerPost(id, { modele: request.body?.modele !== false });
    const bloques = r.restants.filter((p) => p.niveau === 'bloquant');
    return {
      ok: true,
      ...r,
      message:
        r.corrections.length === 0 && bloques.length === 0
          ? 'Rien à corriger : le post est conforme.'
          : `${r.corrections.length ? r.corrections.join(' · ') : 'aucune correction automatique'}${bloques.length ? ` — reste à corriger à la main : ${bloques.map((p) => p.message).join(' ')}` : ''}`,
    };
  });

  /**
   * Le document PDF d'un post LinkedIn, tel que LinkedIn le recevra : à feuilleter
   * avant de valider. Refait si une slide a changé depuis la dernière fabrication.
   */
  app.get<{ Params: { id: string } }>('/api/posts/:id/document.pdf', async (request, reply) => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, Number(request.params.id))).get();
    if (!post) return reply.status(404).send({ error: 'Post introuvable' });
    if (post.format !== 'li_doc') return reply.status(400).send({ error: 'Ce post n’est pas un document PDF' });
    let doc: Awaited<ReturnType<typeof documentDuPost>>;
    try {
      doc = await documentDuPost(post.id);
    } catch (err) {
      return reply.status(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const nom =
      post.hook
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'document';
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${nom}.pdf"`)
      .header('cache-control', 'no-store')
      .send(fs.createReadStream(doc.path));
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
    // Un texte corrigé à la main n'est plus « non adapté » : la raison s'efface.
    if (data.caption !== undefined || data.cta !== undefined) {
      const courant = db.select({ error: schema.posts.error }).from(schema.posts).where(eq(schema.posts.id, id)).get();
      if (echecDAdaptation(courant?.error)) update.error = null;
    }
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
      // Même légende que le miroir automatique : sans « Commente X » que personne ne servirait sur la Page.
      const mirror = await mirrorToFacebookPage({ post, images, caption: legendePourFacebook(post, post.externalUrl) });
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
      .select({ id: schema.posts.id, hook: schema.posts.hook, platform: schema.posts.platform, channel: schema.posts.channel, liAccountKey: schema.posts.liAccountKey, scheduledAt: schema.posts.scheduledAt, status: schema.posts.status })
      .from(schema.posts)
      .where(
        and(
          inArray(schema.posts.status, ['scheduled', 'publishing', 'published']),
          gte(schema.posts.scheduledAt, new Date(from.getTime() - 30 * 60000).toISOString()),
          lte(schema.posts.scheduledAt, new Date(to.getTime() + 30 * 60000).toISOString()),
        ),
      )
      .all();
    // Un créneau est pris PAR COMPTE : le calendrier filtré sur Alexis voit libre le
    // mardi 8 h 30 que Khaled occupe. `posts` porte chaque occupant avec sa surface.
    const out: {
      at: string;
      platform: 'instagram' | 'linkedin';
      past: boolean;
      postId: number | null;
      postHook: string | null;
      posts: { id: number; hook: string; surfaceKey: string }[];
    }[] = [];
    for (const platform of ['instagram', 'linkedin'] as const) {
      for (const slot of platform === 'instagram' ? slots.ig : slots.li) {
        for (const at of slotOccurrencesBetween(slot, from, to)) {
          const occupants = occupied.filter(
            (p) => p.platform === platform && p.scheduledAt && Math.abs(new Date(p.scheduledAt).getTime() - at.getTime()) < 30 * 60000,
          );
          const taken = occupants[0];
          out.push({
            at: at.toISOString(),
            platform,
            // délai minimal de 2 h avant publication (rendu, vérification)
            past: at.getTime() < now + 2 * 3600000,
            postId: taken?.id ?? null,
            postHook: taken?.hook ?? null,
                      posts: occupants.map((p) => ({ id: p.id, hook: p.hook, surfaceKey: p.channel === 'ig' ? 'ig' : (compteDuPost(p)?.key ?? p.liAccountKey ?? '') })),
          });
        }
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  });

  /**
   * Les surfaces où le moteur peut publier : chaque profil LinkedIn (actif ou en pause),
   * la page, Instagram, et la Page Facebook quand le miroir est actif. Vient des
   * connexions, pas des posts : un compte fraîchement connecté apparaît tout de suite.
   */
  app.get('/api/surfaces', async () => {
    const initiales = (label: string) =>
      label
        .replace(/^page\s+/i, '')
        .split(/[\s\p{Extended_Pictographic}\p{S}-]+/u)
        .filter(Boolean)
        .slice(0, 2)
        .map((m) => m.charAt(0).toUpperCase())
        .join('') || label.slice(0, 2).toUpperCase();
    const out: { key: string; platform: 'linkedin' | 'instagram' | 'facebook'; channel: string; label: string; initiales: string; actif: boolean; enPanne: boolean; panne: string }[] = [];
    for (const c of comptesLinkedIn('li_person')) out.push({ key: c.key, platform: 'linkedin', channel: 'li_personal', label: c.name, initiales: initiales(c.name), actif: c.actif, enPanne: c.enPanne, panne: c.panne });
    for (const c of comptesLinkedIn('li_org')) out.push({ key: c.key, platform: 'linkedin', channel: 'li_org', label: `page ${c.name}`, initiales: initiales(c.name), actif: c.actif, enPanne: c.enPanne, panne: c.panne });
    if (getStoredToken('meta', 'ig_user')) out.push({ key: 'ig', platform: 'instagram', channel: 'ig', label: 'Instagram', initiales: 'IG', actif: true, enPanne: false, panne: '' });
    if (getStoredToken('meta', 'fb_page') && (getFbMirror().enabled || getCadence().broadcast)) {
      out.push({ key: 'fb', platform: 'facebook', channel: 'ig', label: 'Facebook (miroir)', initiales: 'FB', actif: true, enPanne: false, panne: '' });
    }
    return out;
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
