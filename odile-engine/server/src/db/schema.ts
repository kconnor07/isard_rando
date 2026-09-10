import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
  updatedAt: text('updated_at').notNull().$defaultFn(now),
});

export const newsSources = sqliteTable('news_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['rss', 'hn', 'websearch', 'youtube', 'reddit'] }).notNull(),
  url: text('url').notNull(),
  lang: text('lang', { enum: ['fr', 'en'] }).notNull().default('en'),
  weight: real('weight').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  etag: text('etag'),
  lastModified: text('last_modified'),
  lastFetchedAt: text('last_fetched_at'),
  lastError: text('last_error'),
  consecutiveErrors: integer('consecutive_errors').notNull().default(0),
});

export const newsItems = sqliteTable(
  'news_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').references(() => newsSources.id),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    imageUrl: text('image_url'),
    publishedAt: text('published_at'),
    fetchedAt: text('fetched_at').notNull().$defaultFn(now),
    lang: text('lang').notNull().default('en'),
    contentHash: text('content_hash').notNull(),
    scoreRelevance: integer('score_relevance'),
    scoreClick: integer('score_click'),
    scoreTotal: integer('score_total'),
    scoreReason: text('score_reason'),
    scoredAt: text('scored_at'),
    /* Veille v2 : enrichissement des candidats shortlist */
    contentText: text('content_text'),
    extractedAt: text('extracted_at'),
    engagement: integer('engagement'), // 0-100 normalisé
    engagementRaw: text('engagement_raw'), // JSON {hnPoints,hnComments,redditScore,redditComments}
    topics: text('topics'), // JSON string[] (tags FR)
    scoreFinal: real('score_final'),
    shortlistDate: text('shortlist_date'), // YYYY-MM-DD
    shortlistRank: integer('shortlist_rank'),
    status: text('status', { enum: ['new', 'scored', 'shortlisted', 'used', 'discarded'] })
      .notNull()
      .default('new'),
  },
  (t) => [
    uniqueIndex('news_items_hash_idx').on(t.contentHash),
    index('news_items_status_idx').on(t.status),
    index('news_items_shortlist_idx').on(t.shortlistDate, t.shortlistRank),
  ],
);

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    newsItemId: integer('news_item_id').references(() => newsItems.id),
    platform: text('platform', { enum: ['linkedin', 'instagram'] }).notNull(),
    channel: text('channel', { enum: ['li_personal', 'li_org', 'ig'] }).notNull(),
    format: text('format', { enum: ['carousel', 'static', 'li_image'] }).notNull(),
    theme: text('theme').notNull(),
    language: text('language').notNull().default('fr'),
    status: text('status', {
      enum: [
        'draft',
        'reviewing',
        'awaiting_approval',
        'approved',
        'scheduled',
        'publishing',
        'published',
        'rejected',
        'failed',
      ],
    })
      .notNull()
      .default('draft'),
    hook: text('hook').notNull().default(''),
    archetype: text('archetype'),
    caption: text('caption').notNull().default(''),
    cta: text('cta').notNull().default(''),
    hashtags: text('hashtags').notNull().default('[]'), // JSON string[]
    linkId: integer('link_id'),
    commentTriggerKeyword: text('comment_trigger_keyword'),
    toneSnapshot: text('tone_snapshot'), // JSON
    reviewSummary: text('review_summary'), // JSON: {iterations, finalScores}
    scheduledAt: text('scheduled_at'),
    approvedAt: text('approved_at'),
    publishedAt: text('published_at'),
    externalPostId: text('external_post_id'),
    externalUrl: text('external_url'),
    rejectReason: text('reject_reason'),
    error: text('error'),
    createdAt: text('created_at').notNull().$defaultFn(now),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [index('posts_status_idx').on(t.status), index('posts_created_idx').on(t.createdAt)],
);

export const slides = sqliteTable(
  'slides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: text('kind', {
      enum: ['hook', 'content', 'value_prop', 'screenshot', 'cta', 'notifications', 'echo'],
    }).notNull(),
    content: text('content').notNull(), // JSON SlideContent
    renderAssetId: text('render_asset_id'),
    screenshotAssetId: text('screenshot_asset_id'),
    heroAssetId: text('hero_asset_id'),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('slides_post_idx').on(t.postId, t.idx)],
);

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(), // nanoid(21) — sert de segment d'URL publique
  kind: text('kind', {
    enum: ['render', 'screenshot', 'logo', 'upload', 'genimage', 'library', 'candidate'],
  }).notNull(),
  postId: integer('post_id'),
  slideId: integer('slide_id'),
  path: text('path').notNull(),
  width: integer('width'),
  height: integer('height'),
  mime: text('mime').notNull().default('image/png'),
  bytes: integer('bytes'),
  sha256: text('sha256'),
  meta: text('meta'), // JSON: {sourceUrl, variance, visionOk, visionReason, capturedAt}
  createdAt: text('created_at').notNull().$defaultFn(now),
});

export const designReviews = sqliteTable(
  'design_reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    slideId: integer('slide_id'),
    iteration: integer('iteration').notNull(),
    reviewer: text('reviewer', {
      enum: ['art_director', 'colorimetry', 'copy', 'engagement'],
    }).notNull(),
    score: integer('score').notNull(),
    verdict: text('verdict').notNull().default(''),
    issues: text('issues').notNull().default('[]'), // JSON ReviewIssue[]
    passed: integer('passed', { mode: 'boolean' }).notNull(),
    modelUsed: text('model_used').notNull().default(''),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('design_reviews_post_idx').on(t.postId, t.iteration)],
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull(),
    kind: text('kind', { enum: ['approval', 'login'] }).notNull().default('approval'),
    sentTo: text('sent_to').notNull(),
    emailMessageId: text('email_message_id'),
    sentAt: text('sent_at').notNull().$defaultFn(now),
    expiresAt: text('expires_at').notNull(),
    remindersSent: integer('reminders_sent').notNull().default(0),
    action: text('action', { enum: ['approve', 'reject', 'edit'] }),
    actedAt: text('acted_at'),
    actedIp: text('acted_ip'),
  },
  (t) => [uniqueIndex('approvals_jti_idx').on(t.jti), index('approvals_post_idx').on(t.postId)],
);

export const publishJobs = sqliteTable(
  'publish_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    scheduledAt: text('scheduled_at').notNull(),
    state: text('state', { enum: ['pending', 'running', 'done', 'failed', 'canceled'] })
      .notNull()
      .default('pending'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    result: text('result'), // JSON
  },
  (t) => [index('publish_jobs_state_idx').on(t.state, t.scheduledAt)],
);

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platform: text('platform', { enum: ['linkedin', 'instagram'] }).notNull(),
    externalId: text('external_id').notNull(),
    postId: integer('post_id'),
    externalPostId: text('external_post_id'),
    externalPostUrl: text('external_post_url'),
    authorExternalId: text('author_external_id'),
    authorName: text('author_name').notNull().default(''),
    text: text('text').notNull().default(''),
    createdTime: text('created_time'),
    matchedKeyword: text('matched_keyword'),
    dmStatus: text('dm_status', {
      enum: ['none', 'pending', 'sent', 'failed', 'manual_suggested', 'handled'],
    })
      .notNull()
      .default('none'),
    suggestedReply: text('suggested_reply'),
    raw: text('raw'), // JSON payload webhook/API
    fetchedAt: text('fetched_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('comments_external_idx').on(t.platform, t.externalId),
    index('comments_dm_idx').on(t.dmStatus),
  ],
);

export const dmEvents = sqliteTable('dm_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  commentId: integer('comment_id').references(() => comments.id),
  platform: text('platform').notNull(),
  recipientExternalId: text('recipient_external_id'),
  message: text('message').notNull(),
  status: text('status', { enum: ['sent', 'failed', 'suggested', 'dry'] }).notNull(),
  sentAt: text('sent_at').notNull().$defaultFn(now),
  error: text('error'),
});

export const links = sqliteTable(
  'links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    targetUrl: text('target_url').notNull(),
    postId: integer('post_id'),
    label: text('label').notNull().default(''),
    utm: text('utm'), // JSON {source, medium, campaign}
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('links_code_idx').on(t.code)],
);

export const clicks = sqliteTable(
  'clicks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    linkId: integer('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    ts: text('ts').notNull().$defaultFn(now),
    ipHash: text('ip_hash').notNull(),
    ua: text('ua'),
    referer: text('referer'),
  },
  (t) => [index('clicks_link_idx').on(t.linkId, t.ts)],
);

export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', { enum: ['linkedin', 'meta'] }).notNull(),
    subject: text('subject', { enum: ['li_person', 'li_org', 'fb_page', 'ig_user'] }).notNull(),
    externalId: text('external_id').notNull().default(''),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    scopes: text('scopes').notNull().default(''),
    expiresAt: text('expires_at'),
    meta: text('meta'), // JSON: {pageName, igUsername, orgUrn, personUrn…}
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('oauth_subject_idx').on(t.provider, t.subject)],
);

export const emailLog = sqliteTable('email_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', {
    enum: ['approval', 'reminder', 'li_comment_digest', 'analytics', 'error', 'token_expiry', 'test'],
  }).notNull(),
  postId: integer('post_id'),
  to: text('to').notNull(),
  messageId: text('message_id'),
  status: text('status', { enum: ['sent', 'failed'] }).notNull(),
  error: text('error'),
  sentAt: text('sent_at').notNull().$defaultFn(now),
});

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobName: text('job_name').notNull(),
    startedAt: text('started_at').notNull().$defaultFn(now),
    finishedAt: text('finished_at'),
    ok: integer('ok', { mode: 'boolean' }),
    summary: text('summary'), // JSON: compteurs, coûts LLM…
  },
  (t) => [index('job_runs_name_idx').on(t.jobName, t.startedAt)],
);

/**
 * Templates maison : thèmes visuels créés depuis le dashboard. Le CSS est
 * généré à partir de ces paramètres — pas de CSS libre saisi par l'utilisateur.
 */
export const customThemes = sqliteTable('custom_themes', {
  id: text('id').primaryKey(), // slug : « ma-signature »
  name: text('name').notNull(),
  /** couleur d'accent (titres accentués, badges, CTA) */
  accent: text('accent').notNull().default('#0099ff'),
  /** fond : dégradé entre deux teintes */
  bg1: text('bg1').notNull().default('#050508'),
  bg2: text('bg2').notNull().default('#0a1024'),
  /** couleur du texte principal */
  textColor: text('text_color').notNull().default('#fdfdfd'),
  /** décor : orbes de verre, halo doux, dégradé plein ou rien */
  decor: text('decor', { enum: ['orbes', 'halo', 'degrade', 'aucun'] })
    .notNull()
    .default('orbes'),
  /** image de fond de la bibliothèque (asset id), appliquée à toutes les slides */
  backgroundAssetId: text('background_asset_id'),
  /** opacité de cette image de fond, 0-100 */
  backgroundOpacity: integer('background_opacity').notNull().default(35),
  /** grain de film */
  grain: integer('grain', { mode: 'boolean' }).notNull().default(true),
  /** intensité du grain, 0-100 */
  grainLevel: integer('grain_level').notNull().default(30),
  /** couleur secondaire (fin du dégradé des gros chiffres) — null : l'accent */
  secondary: text('secondary'),
  // --- Typographie ---
  titleFont: text('title_font', { enum: ['inter', 'playfair', 'fragment'] }).notNull().default('inter'),
  titleWeight: integer('title_weight').notNull().default(800),
  titleCase: text('title_case', { enum: ['normal', 'upper'] }).notNull().default('normal'),
  /** échelle des titres en %, 60-140 */
  titleScale: integer('title_scale').notNull().default(100),
  /** traitement du mot accentué */
  accentStyle: text('accent_style', { enum: ['serif', 'plain', 'underline', 'highlight'] })
    .notNull()
    .default('serif'),
  /** alignement : auto = centré sur hook/CTA, à gauche ailleurs */
  align: text('align', { enum: ['auto', 'left', 'center'] }).notNull().default('auto'),
  // --- Décor ---
  decorIntensity: integer('decor_intensity').notNull().default(100),
  decorPosition: text('decor_position', {
    enum: ['haut-droite', 'haut-gauche', 'bas-droite', 'bas-gauche', 'centre'],
  })
    .notNull()
    .default('haut-droite'),
  gradientAngle: integer('gradient_angle').notNull().default(168),
  /** assombrissement des bords, 0-100 */
  vignette: integer('vignette').notNull().default(0),
  // --- Image de fond ---
  bgFit: text('bg_fit', { enum: ['cover', 'contain'] }).notNull().default('cover'),
  bgPosition: text('bg_position', { enum: ['centre', 'haut', 'bas'] }).notNull().default('centre'),
  bgBlur: integer('bg_blur').notNull().default(0),
  bgBlend: text('bg_blend', { enum: ['normal', 'multiply', 'screen', 'soft-light', 'luminosity'] })
    .notNull()
    .default('normal'),
  // --- Matière ---
  radius: text('radius', { enum: ['pill', 'rounded', 'sharp'] }).notNull().default('pill'),
  /** intensité du verre (badges, pilules), 0-100 — 50 = réglage d'origine */
  glass: integer('glass').notNull().default(50),
  frame: text('frame', { enum: ['aucun', 'texte', 'accent'] }).notNull().default('aucun'),
  padding: text('padding', { enum: ['serre', 'normal', 'aere'] }).notNull().default('normal'),
  // --- Pied de page ---
  showLogo: integer('show_logo', { mode: 'boolean' }).notNull().default(true),
  showCounter: integer('show_counter', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
});
