import { desc, eq, isNotNull } from 'drizzle-orm';
import {
  ARCHETYPES,
  DEFAULTS,
  generatedPostSchema,
  type Channel,
  type GeneratedPost,
  type PostFormat,
} from '@odile/shared';
import { db, schema } from '../db/client.js';
import {
  getBrand,
  getCadence,
  getDefaultFormat,
  getDefaultTheme,
  getDmTriggers,
  getImageGen,
  getTone,
} from '../db/settingsRepo.js';
import { completeJson } from '../llm/router.js';
import { nextShortlistedItem } from '../scorer/shortlist.js';
import { createLink } from '../shortener/index.js';
import { toneToPrompt } from './tone.js';

export interface DraftOptions {
  newsItemId?: number;
  channel?: Channel;
  format?: PostFormat;
  theme?: string;
}

export interface DraftResult {
  postId: number;
  newsItemId: number;
  channel: Channel;
  format: PostFormat;
  screenshotUrl: string | null;
}

const WRITER_SYSTEM = `Tu es le copywriter senior d'Odile AI (odileai.com), agence française d'automatisation IA
pour PME et TPE. Tu écris des posts LinkedIn/Instagram à très haute valeur ajoutée qui génèrent
des clics et des commentaires. Tu appliques le framework AIDA :
- Attention : la slide hook (slide 1) arrête le scroll — 10 mots max, un chiffre ou une tension.
- Intérêt : la slide 2 promet un bénéfice concret si on continue de swiper.
- Désir : les slides suivantes prouvent (outil réel, étapes, résultats chiffrés).
- Action : la dernière slide porte UN seul appel à l'action.
Patterns de hooks qui performent : chiffre + promesse (« Vos devis en 90 secondes »),
tension (« vos concurrents l'utilisent déjà »), perte évitée (« 4 h perdues par semaine »),
curiosité spécifique. Jamais de titre générique (« l'IA révolutionne… »).
Une idée par slide. Titres courts. Le lecteur est un dirigeant de PME/TPE pressé.`;

function channelFromRotation(): Channel {
  const cadence = getCadence();
  const count = db.select({ id: schema.posts.id }).from(schema.posts).all().length;
  return cadence.rotation[count % cadence.rotation.length] ?? 'ig';
}

/** Les 5 derniers archétypes utilisés — interdits pour forcer la variété visuelle. */
function recentArchetypes(): string[] {
  return db
    .select({ archetype: schema.posts.archetype })
    .from(schema.posts)
    .where(isNotNull(schema.posts.archetype))
    .orderBy(desc(schema.posts.id))
    .limit(5)
    .all()
    .map((r) => r.archetype!)
    .filter(Boolean);
}

const BANNED_CLICHES = [
  'un robot qui serre la main d’un humain',
  'un cerveau lumineux ou en circuits imprimés',
  'des lignes de code qui défilent en pluie',
  'un hologramme flottant au-dessus d’une main ouverte',
  'un cadenas numérique générique',
];

function buildArchetypeSpec(isCarousel: boolean, imagesAllowed: number): string {
  const recent = recentArchetypes();
  const catalog = ARCHETYPES.map(
    (a) =>
      `- "${a.id}" (${a.label}) : ${a.description}${a.needsImage ? ' [nécessite imageIdea]' : ''}${
        recent.includes(a.id) ? ' ⛔ UTILISÉ RÉCEMMENT — INTERDIT' : ''
      }`,
  ).join('\n');
  const imageSpec =
    imagesAllowed > 0
      ? `Si l'archétype nécessite une illustration, renseigne "imageIdea" sur ${
          imagesAllowed === 1 ? 'la slide hook UNIQUEMENT' : `au maximum ${imagesAllowed} slides (hook en priorité)`
        } : décris UNE scène précise et originale en français (sujet, matière, ambiance) — l'image sera générée
sans aucun texte dedans, le titre restant en surimpression. Idées bannies (déjà trop vues) : ${BANNED_CLICHES.join(' ; ')}.`
      : `La génération d'images est désactivée : ne renseigne aucun "imageIdea" et choisis un archétype sans image.`;

  return `DIRECTION ARTISTIQUE — choisis UN archétype de composition dans ce catalogue et renseigne son id dans "archetype".
Sois créatif : varie les archétypes d'un post à l'autre (ceux marqués ⛔ sont interdits aujourd'hui).
${catalog}

${imageSpec}

Kinds de slides disponibles en plus : "notifications" (pile de 3 cartes de notification — renseigne notifications[{title,body}], parfait pour montrer des résultats concrets type « Devis signé », « Paiement reçu ») et "echo" (mot répété en fond — renseigne echoWord + un title court qui sert de bandeau).${
    isCarousel ? " Tu peux remplacer une slide 'content' par l'un de ces kinds si l'archétype s'y prête." : ''
  }`;
}

/** Génère un brouillon de post (copy + slides) depuis une actu shortlistée. */
export async function draftPost(opts: DraftOptions = {}): Promise<DraftResult> {
  const news = opts.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, opts.newsItemId)).get()
    : nextShortlistedItem();
  if (!news) throw new Error('Aucune actualité shortlistée disponible pour générer un post');

  const channel = opts.channel ?? channelFromRotation();
  const platform = channel === 'ig' ? 'instagram' : 'linkedin';
  const format: PostFormat =
    opts.format ?? (channel === 'ig' ? (getDefaultFormat() as PostFormat) : 'li_image');
  const theme = opts.theme ?? getDefaultTheme();
  const tone = getTone();
  const brand = getBrand();
  const dm = getDmTriggers();
  const imageGen = getImageGen();

  const isCarousel = format === 'carousel';
  const imagesAllowed = imageGen.enabled ? imageGen.imagesPerPost : 0;
  const slideSpec = isCarousel
    ? `un carrousel de ${DEFAULTS.carouselSlides.min} à ${DEFAULTS.carouselSlides.max} slides :
  1. kind "hook" — l'accroche (annotation manuscrite optionnelle, titre court, accentWord = LE mot fort du titre)
  2. kind "content" — la promesse / le problème (badge de section, bigNumber si un chiffre frappe)
  3-N. kinds "content" / "screenshot" / "value_prop" — la preuve : étapes, outil concret
     (une slide kind "screenshot" si un outil/site mérite une capture d'écran réelle : renseigne toolName et toolUrl),
     une slide "value_prop" avec le résultat chiffré (bigNumber)
  N+1. kind "cta" — l'appel à l'action final`
    : `exactement 1 slide kind "hook" : le visuel unique du post (titre percutant, accentWord, body court)`;

  const ctaSpec =
    platform === 'instagram' && dm.enabled
      ? `CTA Instagram : le déclencheur commentaire→DM. Choisis un mot-clé simple en majuscules
(par ex. ${dm.keywords.join(', ')}) et construis le CTA autour de « Commente [MOT-CLÉ] » pour recevoir
le lien en message privé. Renseigne commentTrigger {enabled: true, keyword}. AUCUN lien dans la caption.`
      : `CTA LinkedIn : pousse vers la ressource. Utilise le placeholder {{link}} dans la caption
(il sera remplacé par un lien court tracké). commentTrigger.enabled = false.`;

  const prompt = `ACTUALITÉ SOURCE (à transformer en post ${platform === 'instagram' ? 'Instagram' : 'LinkedIn'}) :
Titre : ${news.title}
Résumé : ${news.summary ?? '(pas de résumé)'}
URL : ${news.url}
Langue source : ${news.lang}
Pourquoi elle a été retenue : ${news.scoreReason ?? ''}

TON DE LA MARQUE :
${toneToPrompt(tone)}

${buildArchetypeSpec(isCarousel, imagesAllowed)}

FORMAT DEMANDÉ : ${slideSpec}

${ctaSpec}

CONTRAINTES :
- Tout en français (traduis et adapte si la source est en anglais). Marque : ${brand.name} (${brand.handle}).
- caption : le texte du post (2 200 caractères max pour Instagram, aéré, sauts de ligne).
  Structure AIDA aussi dans la caption. Termine par le CTA.
- hashtags : 5 à 8, ciblés PME/automatisation/IA, sans doublon avec le texte.
- hook : reprend le titre de la slide 1 (pour l'objet de l'email de validation).
- screenshotUrl : URL réelle de l'outil/du site à capturer (celle de l'actu ou de l'outil cité), sinon null.
- Chaque slide : title ≤ 9 mots, body ≤ 2 phrases, bullets ≤ 4 items courts.`;

  const { value: generated } = await completeJson<GeneratedPost>(
    { task: 'writing', tier: 'best', system: WRITER_SYSTEM, prompt, maxTokens: 16000 },
    generatedPostSchema,
  );

  return persistDraft({ news, channel, platform, format, theme, tone, generated });
}

function persistDraft(args: {
  news: typeof schema.newsItems.$inferSelect;
  channel: Channel;
  platform: 'linkedin' | 'instagram';
  format: PostFormat;
  theme: string;
  tone: ReturnType<typeof getTone>;
  generated: GeneratedPost;
}): DraftResult {
  const { news, channel, platform, format, theme, tone, generated } = args;

  const archetype = ARCHETYPES.some((a) => a.id === generated.archetype)
    ? generated.archetype!
    : null;
  const post = db
    .insert(schema.posts)
    .values({
      newsItemId: news.id,
      platform,
      channel,
      format,
      theme,
      status: 'draft',
      archetype,
      hook: generated.hook,
      caption: generated.caption,
      cta: generated.cta,
      hashtags: JSON.stringify(generated.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))),
      commentTriggerKeyword: generated.commentTrigger?.enabled
        ? generated.commentTrigger.keyword.toUpperCase()
        : null,
      toneSnapshot: JSON.stringify(tone),
    })
    .returning({ id: schema.posts.id })
    .get();

  // Lien court tracké vers la source, remplace {{link}} (LinkedIn) — créé dans tous
  // les cas : il sert aussi de lien envoyé en DM Instagram.
  const link = createLink(news.url, {
    postId: post.id,
    label: `post-${post.id}`,
    utm: { utm_source: platform, utm_medium: 'social', utm_campaign: `post-${post.id}` },
  });
  const caption = generated.caption.replaceAll('{{link}}', link.shortUrl);
  const cta = generated.cta.replaceAll('{{link}}', link.shortUrl);
  db.update(schema.posts)
    .set({ caption, cta, linkId: link.id })
    .where(eq(schema.posts.id, post.id))
    .run();

  generated.slides.forEach((slide, idx) => {
    db.insert(schema.slides)
      .values({ postId: post.id, idx, kind: slide.kind, content: JSON.stringify(slide) })
      .run();
  });

  db.update(schema.newsItems).set({ status: 'used' }).where(eq(schema.newsItems.id, news.id)).run();

  return {
    postId: post.id,
    newsItemId: news.id,
    channel,
    format,
    screenshotUrl: generated.screenshotUrl,
  };
}
