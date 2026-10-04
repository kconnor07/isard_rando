import { desc, eq, isNotNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  ARCHETYPES,
  DEFAULTS,
  generatedPostSchema,
  type Channel,
  type GeneratedPost,
  type PostFormat,
} from '@odile/shared';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { db, schema } from '../db/client.js';
import {
  getBrand,
  getCadence,
  getDefaultFormat,
  getDefaultTheme,
  getDmTriggers,
  getImageGen,
  getStrategieLinkedIn,
  getTone,
  getVideo,
} from '../db/settingsRepo.js';
import { compteDuCanal, type CompteLinkedIn } from '../publishers/linkedinAccounts.js';
import { videoDue } from '../video/index.js';
import { completeJson } from '../llm/router.js';
import { ICON_IDS } from '../render/icons.js';
import { nextShortlistedItem } from '../scorer/shortlist.js';
import { createLink } from '../shortener/index.js';
import { toneToPrompt } from './tone.js';
import { adresseDuSite, avecSite, bornerHashtags, hashtagDeMarque, lienPermis, porteLeSite, reseauDuCanal } from './marque.js';
import { ACCROCHE_MAX, accroche, faitACompleter, porteUnAppat, tutoie } from './reglesLinkedIn.js';
import { faitPourLePrompt, faitsPourLeCompte, noterUsage, registreDuCompte } from './faits.js';
import { mentionnerSurInstagram, type MentionDeclaree } from './mentions.js';
import { corrigerLigneSource, sourceReelle } from './source.js';

export interface DraftOptions {
  newsItemId?: number;
  channel?: Channel;
  format?: PostFormat;
  theme?: string;
  /** le sujet choisi par le fondateur, quand le post part d'un sujet et non d'un article */
  sujet?: { label: string; angle?: string; reason?: string | null };
  /** sujets de veille supplémentaires à considérer (les autres articles du même sujet) */
  contexteItemIds?: number[];
}

export interface DraftResult {
  postId: number;
  newsItemId: number;
  channel: Channel;
  format: PostFormat;
  screenshotUrl: string | null;
}

/**
 * Le vocabulaire de hashtags d'Odile : toujours les mêmes thèmes, pour que LinkedIn
 * et Instagram rangent la marque sous les bons sujets (l'autorité thématique se
 * construit par la répétition, pas par la variété).
 */
const VOCABULAIRE_HASHTAGS =
  'Vocabulaire maison — thèmes : #AutomatisationIA, #AgentsIA, #IntelligenceArtificielle, #Productivite, #TransformationDigitale ; ' +
  'publics : #PME, #TPE, #Dirigeants, #Entrepreneurs ; local : #Toulouse. Sans accents, en CamelCase.';

const WRITER_SYSTEM = `Tu es le copywriter senior d'Odile AI (odileai.com), agence française d'automatisation IA
pour PME et TPE. Tu écris des posts LinkedIn/Instagram à très haute valeur ajoutée qui génèrent
des clics et des commentaires.

LIGNE ÉDITORIALE (Odile est une AGENCE, pas un média tech) :
- JAMAIS de post « actu produit » qui présente un outil pour lui-même (« X sort », « voici Y »).
  L'outil n'est jamais le sujet : c'est la preuve. Le sujet, c'est le résultat pour le dirigeant.
- Chaque post part d'un BÉNÉFICE métier (temps gagné, clients signés, coûts évités) ou d'un
  CAS D'ENTREPRISE : ce que d'autres boîtes ont mis en place et ce que ça leur rapporte —
  cite l'entreprise et les chiffres réels de la source quand ils existent, n'en invente aucun.
- Explique les CAPACITÉS par ce qu'elles permettent concrètement, pas par la technique.
- Positionnement implicite : ce genre de solution, Odile le met en place pour ses clients.
  Reste utile et généreux — le lecteur doit apprendre quelque chose même sans cliquer.
- Source anglophone (US) : ne traduis pas, TRANSPOSE. Adapte l'histoire, les ordres de
  grandeur et les exemples au quotidien d'une PME/TPE française.
- Source = post social performant (LinkedIn/X) : RECYCLE ce qui a fait son succès — l'angle,
  la structure, le rythme du hook — mais réécris un contenu 100 % original en français.
  Jamais de traduction, jamais de reprise des tournures ; les chiffres cités restent ceux
  de la source.

Tu appliques le framework AIDA :
- Attention : la slide hook (slide 1) arrête le scroll — 10 mots max, un chiffre ou une tension.
- Intérêt : la slide 2 promet un bénéfice concret si on continue de swiper.
- Désir : les slides suivantes prouvent (cas réel, étapes, résultats chiffrés).
- Action : la dernière slide porte UN seul appel à l'action.
Patterns de hooks qui performent : chiffre + promesse (« Devis envoyés en 90 secondes »),
tension (« Vos concurrents l'utilisent déjà »), perte évitée (« 4 h perdues par semaine »),
récit (« Cette PME de 12 personnes a économisé 30 000 € »), actualité chaude (« ChatGPT affiche
désormais de la pub »), curiosité spécifique. Ne commence pas toutes tes accroches pareil.
Jamais de titre générique (« l'IA révolutionne… »).
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

/**
 * Les accroches des derniers posts (une par post d'origine : les copies d'une
 * diffusion reprennent celle du parent). Le rédacteur les voit pour ne pas les
 * refaire — c'est la première chose qu'un abonné remarque.
 */
export function accrochesRecentes(limite = 12): string[] {
  const vues = new Set<string>();
  const liste: string[] = [];
  for (const r of db.select({ hook: schema.posts.hook }).from(schema.posts).orderBy(desc(schema.posts.id)).limit(limite * 5).all()) {
    const h = r.hook?.trim();
    if (!h || vues.has(h.toLowerCase())) continue;
    vues.add(h.toLowerCase());
    liste.push(h);
    if (liste.length >= limite) break;
  }
  return liste;
}

/**
 * Les mots d'ouverture trop utilisés parmi les accroches récentes (« Vos », « Votre »…) :
 * au moins deux fois dans les huit dernières. Fonction pure, testée.
 */
export function ouverturesUsees(accroches: string[]): string[] {
  const compte = new Map<string, number>();
  for (const a of accroches.slice(0, 8)) {
    const premier = a.trim().split(/\s+/)[0]?.replace(/[«»"'’.,:;!?]/g, '');
    if (!premier) continue;
    const cle = /^\d/.test(premier) ? 'un chiffre' : premier.toLowerCase();
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return [...compte].filter(([, n]) => n >= 2).map(([mot]) => mot);
}

function consigneVarieteAccroches(): string {
  const recentes = accrochesRecentes();
  if (recentes.length === 0) return '';
  const usees = ouverturesUsees(recentes);
  return `VARIÉTÉ DES ACCROCHES — voici les accroches des derniers posts, déjà vues par nos abonnés :
${recentes.map((h) => `- ${h}`).join('\n')}
Ton accroche ne doit ressembler à aucune : ni le même sujet, ni la même structure, ni le même rythme.${
    usees.length
      ? `\nOuvertures déjà trop utilisées, INTERDITES en premier mot : ${usees.map((m) => `« ${m} »`).join(', ')}.`
      : ''
  }
Alterne les formes : un fait daté (« Mardi, OpenAI a… »), une question qui dérange, une citation,
un contre-pied, un personnage (« Cette boulangère de Muret… »), un avant/après, un chiffre choc.`;
}

const BANNED_CLICHES = [
  'un robot qui serre la main d’un humain',
  'un cerveau lumineux ou en circuits imprimés',
  'des lignes de code qui défilent en pluie',
  'un hologramme flottant au-dessus d’une main ouverte',
  'un cadenas numérique générique',
];

const ARCHETYPE_IDS = ARCHETYPES.map((a) => a.id) as [string, ...string[]];
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** « Objet 3D suspendu + halo », « OBJET_HALO », « objet halo » → « objet_halo » ; sinon la valeur brute. */
export function normalizeArchetype(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const raw = fold(value);
  const compact = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const hit = ARCHETYPES.find((a) => a.id === compact || fold(a.label) === raw || a.id.replace(/_/g, ' ') === raw);
  return hit ? hit.id : value;
}

/**
 * Schéma de réponse du rédacteur, plus strict que le schéma partagé : archétype
 * obligatoire (id exact) et, quand les illustrations sont activées, une idée
 * d'image sur l'accroche. Une réponse non conforme est renvoyée au modèle avec
 * l'erreur exacte (boucle de correction de completeJson).
 */
/**
 * La caption porte-t-elle l'appel à l'action ?
 *
 * Même normalisation que le détecteur de commentaires (accents et casse ignorés) :
 * ce qui est vérifié ici est exactement ce qui sera reconnu chez les gens.
 */
export function captionPorteLeMotCle(caption: string, motcle: string): boolean {
  const norme = (t: string) =>
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const texte = norme(caption);
  return texte.includes('COMMENTE') && new RegExp(`(^|\\W)${norme(motcle)}(\\W|$)`).test(texte);
}

/** Ce que le texte d'un post LinkedIn doit respecter, selon la stratégie réglée. */
export interface ReglesDuTexte {
  /** pas de « Commente MOT » (appât déclassé par LinkedIn) */
  appatInterdit?: boolean;
  /** aucune adresse dans le texte (profil personnel) */
  lienInterdit?: boolean;
  /** vouvoiement imposé : aucun « tu » */
  vouvoiement?: boolean;
  /** la première ligne tient en ACCROCHE_MAX caractères (une marge est tolérée) */
  accrocheCourte?: boolean;
  /** un fait de la banque (faitId parmi faitsPermis) ou l'emplacement « [FAIT VÉCU : …] » */
  faitObligatoire?: boolean;
  faitsPermis?: number[];
}

export function writerResponseSchema(imagesAllowed: number, regles: ReglesDuTexte = {}) {
  // L'archétype est vérifié dans le superRefine (et non par un enum) pour que ses
  // erreurs et celle de l'idée d'image remontent ensemble au modèle, en une passe.
  const base = generatedPostSchema.extend({
    archetype: z.preprocess(normalizeArchetype, z.string()),
  });
  return base.superRefine((post, ctx) => {
    if (!post.archetype || !(ARCHETYPE_IDS as readonly string[]).includes(post.archetype)) {
      ctx.addIssue({
        code: 'custom',
        path: ['archetype'],
        message: `obligatoire : l'un de ${ARCHETYPE_IDS.join(', ')}`,
      });
    }
    // Le mot-clé est le seul déclencheur de tout le tunnel : s'il ne figure pas
    // dans la caption publiée, les gens ne savent pas quoi commenter, et un
    // commentaire au hasard ne déclenche rien. On ne laisse pas passer.
    if (regles.appatInterdit && (porteUnAppat(post.caption) || porteUnAppat(post.cta))) {
      ctx.addIssue({
        code: 'custom',
        path: ['caption'],
        message: 'aucun « Commente MOT » ni « commentez OUI » : LinkedIn déclasse cet appât depuis mars 2026. Termine par une vraie question ouverte sur le cas du lecteur.',
      });
    }
    if (regles.lienInterdit && /https?:\/\/|www\.|\{\{link\}\}/i.test(`${post.caption}\n${post.cta}`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['caption'],
        message: 'aucun lien, aucune adresse, aucun {{link}} : sur un profil personnel, un lien dans le texte coûte un quart de la portée',
      });
    }
    if (regles.vouvoiement && tutoie(post.caption)) {
      ctx.addIssue({
        code: 'custom',
        path: ['caption'],
        message: 'vouvoiement du début à la fin : aucun « tu », « toi », « tes », « t’ » — on ne mélange jamais tu et vous',
      });
    }
    if (regles.accrocheCourte && accroche(post.caption).length > ACCROCHE_MAX + 40) {
      ctx.addIssue({
        code: 'custom',
        path: ['caption'],
        message: `la première ligne (avant le premier saut de ligne) fait ${accroche(post.caption).length} caractères : elle doit tenir en ${ACCROCHE_MAX}, c'est tout ce qu'on voit avant « …voir plus »`,
      });
    }
    if (regles.faitObligatoire) {
      const permis = regles.faitsPermis ?? [];
      const emplacement = faitACompleter(post.caption);
      if (post.faitId && !permis.includes(post.faitId)) {
        ctx.addIssue({ code: 'custom', path: ['faitId'], message: `faitId doit être l'un de ${permis.join(', ') || '(aucun : la banque est vide)'}, ou null` });
      } else if (!post.faitId && !emplacement) {
        ctx.addIssue({
          code: 'custom',
          path: ['caption'],
          message: 'le post doit raconter un fait de la banque (déclare son numéro dans faitId) ou porter, seule sur sa ligne, l’emplacement « [FAIT VÉCU : …] »',
        });
      }
    }
    if (post.commentTrigger?.enabled && !regles.appatInterdit) {
      const motcle = post.commentTrigger.keyword ?? '';
      if (!/^[A-Za-zÀ-ÿ]{3,14}$/.test(motcle)) {
        ctx.addIssue({
          code: 'custom',
          path: ['commentTrigger', 'keyword'],
          message: 'un seul mot, 3 à 14 lettres, sans chiffre ni ponctuation (ex. GUIDE, METHODE, OUTIL)',
        });
      } else if (!captionPorteLeMotCle(post.caption, motcle)) {
        ctx.addIssue({
          code: 'custom',
          path: ['caption'],
          message: `la caption doit contenir l'appel à l'action « Commente ${motcle.toUpperCase()} » en toutes lettres — c'est lui qui déclenche l'envoi`,
        });
      }
    }
    if (imagesAllowed <= 0) return;
    const hook = post.slides[0];
    if (!hook?.imageIdea || hook.imageIdea.trim().length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['slides', 0, 'imageIdea'],
        message: "obligatoire : décris en français la scène de l'illustration de l'accroche (sujet, matière, ambiance)",
      });
    }
  });
}

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
      ? `"imageIdea" est OBLIGATOIRE sur la slide hook (slide 1)${
          imagesAllowed > 1 ? ` et possible sur au maximum ${imagesAllowed - 1} autre(s) slide(s)` : ''
        } : décris UNE scène précise et originale en français (sujet, matière, ambiance) — l'image sera générée
sans aucun texte dedans, le titre restant en surimpression. Idées bannies (déjà trop vues) : ${BANNED_CLICHES.join(' ; ')}.`
      : `La génération d'images est désactivée : ne renseigne aucun "imageIdea" et choisis un archétype sans image.`;

  return `DIRECTION ARTISTIQUE — choisis UN archétype de composition dans ce catalogue et renseigne son id EXACT
(l'un de : ${ARCHETYPE_IDS.join(', ')}) dans "archetype" (OBLIGATOIRE).
Sois créatif : varie les archétypes d'un post à l'autre (ceux marqués ⛔ sont interdits aujourd'hui).
${catalog}

${imageSpec}

Émojis : uniquement dans la légende (caption), jamais dans le texte des slides — les
visuels sont typographiques, et les émojis de la légende s'affichent avec le style de
l'appareil du lecteur.

Kind de slide disponible en plus : "notifications" (pile de 3 cartes de notification — renseigne notifications[{title,body}], parfait pour montrer des résultats concrets type « Devis signé », « Paiement reçu »).${
    isCarousel ? " Tu peux remplacer une slide 'content' par ce kind si l'archétype s'y prête." : ''
  }`;
}

/**
 * Ce post LinkedIn part-il en document PDF ?
 *
 * Un sur N, comme la vidéo : le document est le format qui retient le plus longtemps
 * sur LinkedIn, mais un fil qui n'en publierait que serait illisible. 0 = jamais.
 */
export function documentDue(nbPostsExistants: number): boolean {
  const tous = getCadence().docEveryNPosts;
  return tous > 0 && nbPostsExistants % tous === 0;
}

/** Génère un brouillon de post (copy + slides) depuis une actu shortlistée. */
/**
 * Le post promotionnel revient tous les N posts d'un même profil : on compte ceux
 * écrits depuis le dernier post promotionnel (les rejetés ne comptent pas).
 */
export function estLeTourDeLaPromo(compteKey: string | null, n: number): boolean {
  if (n <= 1) return true;
  const posts = db
    .select({ id: schema.posts.id, promo: schema.posts.promo, status: schema.posts.status, liAccountKey: schema.posts.liAccountKey })
    .from(schema.posts)
    .where(eq(schema.posts.channel, 'li_personal'))
    .orderBy(desc(schema.posts.id))
    .all()
    .filter((p) => p.status !== 'rejected' && (compteKey === null || p.liAccountKey === compteKey));
  const depuis = posts.findIndex((p) => p.promo);
  const sansPromo = depuis === -1 ? posts.length : depuis;
  return sansPromo >= n - 1;
}

export async function draftPost(opts: DraftOptions = {}): Promise<DraftResult> {
  const news = opts.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, opts.newsItemId)).get()
    : nextShortlistedItem();
  if (!news) throw new Error('Aucune actualité shortlistée disponible pour générer un post');

  const channel = opts.channel ?? channelFromRotation();
  const platform = channel === 'ig' ? 'instagram' : 'linkedin';
  // Un post sur N part en vidéo quand HeyGen est prêt : c'est le seul format qui
  // touche les gens qui ne suivent pas encore le compte.
  const nbPosts = db.select({ id: schema.posts.id }).from(schema.posts).all().length;
  const format: PostFormat =
    opts.format ??
    (videoDue(nbPosts)
      ? 'reel'
      : channel === 'ig'
        ? (getDefaultFormat() as PostFormat)
        : // Un post LinkedIn sur N part en document PDF : c'est le format qui retient le
          // plus longtemps sur le réseau, donc celui que l'algorithme pousse le plus.
          documentDue(nbPosts)
          ? 'li_doc'
          : 'li_image');
  const theme = opts.theme ?? getDefaultTheme();
  const tone = getTone();
  const brand = getBrand();
  const dm = getDmTriggers();
  const imageGen = getImageGen();
  // Qui publiera ce post, décidé AVANT d'écrire : tour de rôle entre les profils
  // personnels connectés, ou la page entreprise. Le texte est rédigé à sa voix.
  const compte = compteDuCanal(channel);

  const isCarousel = format === 'carousel';
  const isDocument = format === 'li_doc';
  const isReel = format === 'reel';
  const imagesAllowed = imageGen.enabled ? imageGen.imagesPerPost : 0;
  const slideSpec = isDocument
    ? `un DOCUMENT LinkedIn de ${DEFAULTS.carouselSlides.min} à ${DEFAULTS.carouselSlides.max} pages — le PDF que
  le lecteur feuillette dans le fil. Chaque page doit donner envie de passer à la suivante :
  1. kind "hook" — la couverture : le titre le plus fort du post, accentWord, body très court (c'est elle
     qui décide si le document est ouvert)
  2. kind "content" — le problème, tel que le dirigeant le vit
  3-N. kinds "content" / "screenshot" / "value_prop" — UNE idée par page, jamais deux : l'étape, la preuve,
     le chiffre (bigNumber), l'outil (kind "screenshot" avec toolName et toolUrl si une capture s'impose)
  N+1. kind "cta" — la dernière page : ce qu'il faut faire maintenant`
    : isCarousel
    ? `un carrousel de ${DEFAULTS.carouselSlides.min} à ${DEFAULTS.carouselSlides.max} slides :
  1. kind "hook" — l'accroche (annotation manuscrite optionnelle, titre court, accentWord = LE mot fort du titre)
  2. kind "content" — la promesse / le problème (badge de section, bigNumber si un chiffre frappe)
  3-N. kinds "content" / "screenshot" / "value_prop" — la preuve : étapes, outil concret
     (une slide kind "screenshot" si un outil/site mérite une capture d'écran réelle : renseigne toolName et toolUrl),
     une slide "value_prop" avec le résultat chiffré (bigNumber)
  N+1. kind "cta" — l'appel à l'action final`
    : isReel
      ? `exactement 1 slide kind "hook" : elle sert de COUVERTURE à la vidéo verticale (titre percutant de 6 mots
  maximum, accentWord, body très court) — c'est la vignette figée que l'on voit avant de lancer la lecture`
      : `exactement 1 slide kind "hook" : le visuel unique du post (titre percutant, accentWord, body court)`;

  // Ce que la personne recevra vraiment : le rédacteur doit promettre cela et rien d'autre.
  const lienFixe = dm.linkTarget === 'fixe' && dm.fixedUrl.trim() ? dm.fixedUrl.trim() : '';
  const cibleDuLien = lienFixe || news.url;
  const promesseDuLien = lienFixe
    ? dm.fixedLabel.trim() || 'la page vers laquelle nous envoyons les gens'
    : 'l’article source qui a inspiré ce post (son analyse complète)';
  // Sur LinkedIn, le lien de la description donne déjà la ressource. Le mot-clé ne
  // peut donc pas promettre la même chose : il ouvre le diagnostic, un cran plus haut.
  const diagnostic = dm.linkedinOffer === 'diagnostic';
  // Stratégie LinkedIn 2026 : sans mot-clé à commenter (appât déclassé), sans lien
  // dans le texte d'un profil (−17 à −27 % de portée). La Page garde son lien.
  const strategie = getStrategieLinkedIn();
  const reseau = reseauDuCanal(channel);
  const linkedin2026 = platform === 'linkedin' && !strategie.motcleSurLinkedIn;
  const lienDansLeTexte = platform === 'linkedin' && lienPermis(reseau);
  const motsLinkedIn = (diagnostic ? dm.diagnosticKeywords : dm.keywords).join(', ');
  const promesseDiagnostic = dm.diagnosticPromise.trim() || 'un regard sur votre organisation';

  const ctaSpec =
    platform === 'instagram' && dm.enabled
      ? `CTA Instagram : le déclencheur commentaire→DM. Choisis un mot-clé simple en majuscules
(par ex. ${dm.keywords.join(', ')}) et construis le CTA autour de « Commente [MOT-CLÉ] » pour recevoir
le lien en message privé. Renseigne commentTrigger {enabled: true, keyword}. AUCUN lien dans la caption.
CE QUE LA PERSONNE RECEVRA EN PRIVÉ, et que tu dois déclarer dans "resource" :
— "guide" si la promesse mérite un document à part (méthode, pas-à-pas, modèle) : le moteur
  le RÉDIGERA et l'enverra en PDF, donne-lui son titre exact dans resource.title ;
— "outil" si le post parle d'un outil précis et que la personne veut y accéder : mets son
  adresse officielle dans resource.toolUrl (celle du site de l'outil, pas celle de l'article) ;
— "article" sinon : elle recevra ${promesseDuLien}.
La promesse du CTA doit désigner EXACTEMENT ce que tu déclares — jamais autre chose.`
      : linkedin2026
        ? `FIN DU POST LinkedIn (stratégie 2026) : AUCUN appel à commenter un mot-clé — « Commente CAS »,
« commentez OUI » sont de l'appât à engagement, déclassé par LinkedIn depuis mars 2026. Aucune
injonction non plus (« dites-le en commentaire », « likez si », « partagez »).
Le post se termine par UNE VRAIE QUESTION, ouverte, sur le cas du lecteur : celle à laquelle un dirigeant
répond par une phrase sur sa propre entreprise (« Et chez vous, quelle tâche prend encore une heure par jour ? »).
Pour une méthode ou une liste, tu peux à la place inviter à l'enregistrer (« À garder pour votre prochaine réunion d'équipe. »).
${
  lienDansLeTexte
    ? `LE LIEN : une ligne « <ce que c'est, en trois mots> : {{link}} » juste avant la question (écris le marqueur tel quel, jamais une URL).`
    : `AUCUN lien, aucune adresse, aucun « lien en commentaire » : sur un profil, un lien coûte un quart de la portée.
Le post tient debout sans lien ; ceux qui veulent aller plus loin le demanderont en commentaire.`
}
Renseigne commentTrigger {"enabled": false}.
LA RESSOURCE, à déclarer dans "resource" — elle est donnée ${lienDansLeTexte ? 'par le lien' : 'en réponse à ceux qui la demandent'}, jamais promise en échange d'un commentaire :
— "guide" si le sujet mérite un document à part (méthode, pas-à-pas, modèle) : son titre exact dans resource.title ;
— "outil" si le post parle d'un outil précis : son adresse officielle dans resource.toolUrl ;
— "article" sinon : ${promesseDuLien}.`
        : `CTA LinkedIn : DEUX CHEMINS, et ils ne donnent surtout PAS la même chose.
1. LE LIEN, dans la description : il DONNE la ressource, tout de suite, sans rien demander.
   Écris le marqueur {{link}} et rien d'autre, jamais une URL inventée : le moteur le
   remplacera par une adresse courte traçable.
${
  diagnostic
    ? `2. LE MOT-CLÉ, pour aller plus loin : un mot simple en majuscules (par ex. ${motsLinkedIn}),
   et le CTA se construit autour de « Commente [MOT-CLÉ] ». Il n'ouvre PAS la ressource — elle est
   déjà dans le lien, la redemander n'aurait aucun sens — mais ${promesseDiagnostic}.
   N'écris donc JAMAIS « commente pour recevoir le guide » : ce qui se commente, c'est le regard
   sur SON cas à elle. Renseigne commentTrigger {enabled: true, keyword}.
Les deux se suivent en fin de post : d'abord la ressource et son lien, puis l'appel à commenter.`
    : `2. LE MOT-CLÉ, pour qui préfère demander : un mot simple en majuscules (par ex. ${motsLinkedIn}),
   et le CTA se construit autour de « Commente [MOT-CLÉ] ». La personne reçoit la même ressource en
   réponse sous son commentaire (LinkedIn n'ouvre sa messagerie à aucune application).
   Renseigne commentTrigger {enabled: true, keyword}.
Les deux se suivent en fin de post : l'appel à commenter, puis « Ou directement ici : {{link}} ».`
}
CE QUE DONNE LE LIEN, et que tu dois déclarer dans "resource" :
— "guide" si la promesse mérite un document à part (méthode, pas-à-pas, modèle) : le moteur
  le RÉDIGERA et l'enverra en PDF, donne-lui son titre exact dans resource.title ;
— "outil" si le post parle d'un outil précis et que la personne veut y accéder : mets son
  adresse officielle dans resource.toolUrl (celle du site de l'outil, pas celle de l'article) ;
— "article" sinon : elle recevra ${promesseDuLien}.
La promesse du CTA doit désigner EXACTEMENT ce que tu déclares — jamais autre chose.`;

  // Ce qui fait performer un post LinkedIn : court, sourcé, les acteurs nommés.
  // Le vrai média (le site de l'article), pas le nom du flux qui l'a trouvé.
  const media = sourceReelle(news.id)?.media ?? '';
  const profil = channel === 'li_personal';
  const voixDuTerrain = compte && compte.subject !== 'li_org' ? compte.name : `l'équipe de ${strategie.nomCourant}`;
  const registre = registreDuCompte(compte?.key);
  // Un post de profil sur N est le post promotionnel : le seul qui nomme la marque et l'offre.
  const promo = linkedin2026 && profil && estLeTourDeLaPromo(compte?.key ?? null, strategie.promoUnPostSur);
  // Le fait vécu : choisi dans la banque, jamais inventé ; à défaut, un emplacement à compléter.
  const faitObligatoire = linkedin2026 && profil && strategie.faitVecuObligatoire;
  const faitsCandidats = faitObligatoire ? faitsPourLeCompte(compte?.key ?? null) : [];
  const consigneMarque = !linkedin2026
    ? ''
    : profil
      ? promo
        ? `- C'EST LE POST PROMOTIONNEL DU CYCLE (un sur ${strategie.promoUnPostSur}) : dis simplement ce que fait ${strategie.nomCourant} sur ce sujet,
  et propose, juste avant la question, l'offre mot pour mot : « ${strategie.offre} ». Une seule fois, sans superlatif.`
        : `- CE POST NE VEND RIEN : ni le nom ${strategie.nomCourant}, ni l'offre, ni « contactez-nous », ni « chez nous on fait ça ».
  Il apporte de la valeur, point : c'est ce qui rend le post promotionnel crédible quand il vient.`
      : `- ${strategie.nomCourant} : au plus une fois, naturellement. L'offre, seulement si le sujet s'y prête, mot pour mot :
  « ${strategie.offre} ».`;
  const consigneFait = !faitObligatoire
    ? `- AUCUN CAS CLIENT INVENTÉ : pas de « chez nos clients », pas d'anecdote, pas de chiffre qui ne vient pas de la source.`
    : `- UN FAIT VÉCU, OBLIGATOIRE : le post raconte UN fait réel, vécu par ${voixDuTerrain} ou observé à Toulouse. Tu n'en inventes JAMAIS.
${
        faitsCandidats.length
          ? `  Faits disponibles (prends-en UN SEUL qui sert vraiment le sujet, raconte-le sans rien ajouter, et déclare son numéro dans "faitId") :
${faitsCandidats.map((f) => `  ${faitPourLePrompt(f)}`).join('\n')}
  Un client « anonyme » ne se nomme pas : « un cabinet comptable », « une boutique toulousaine ».
  Si AUCUN ne sert le sujet, fais comme si la banque était vide (ci-dessous).`
          : '  La banque de faits est vide.'
      }
  Sans fait qui serve le sujet : écris, seule sur sa ligne, l'emplacement « [FAIT VÉCU : <ce qu'il faudrait raconter ici, en une phrase>] »
  et renvoie "faitId": null. La personne le complétera avant publication. Jamais « chez nos clients » ni un cas imaginaire.`;
  const strategieLinkedIn =
    linkedin2026
      ? `
STRATÉGIE LINKEDIN 2026 (le texte du post, « caption ») — tirée de l'audit du compte et des données 2026 :
- L'ACCROCHE est la première ligne, seule avant le premier saut de ligne : ${ACCROCHE_MAX} caractères au plus,
  c'est tout ce qu'on voit sur mobile avant « …voir plus ». Elle nomme un problème vécu par un dirigeant de PME,
  affirme quelque chose de contre-intuitif, ou ouvre sur une expérience personnelle. Une accroche sur ce qui
  coûte ou ce qui rate bat une accroche enthousiaste.
- LONGUEUR : 800 à 1 200 caractères, en phrases courtes, une idée par ligne, lignes aérées.
  Lisible par un lycéen : aucun jargon, aucun sigle non expliqué, aucun anglicisme.
- STRUCTURE : l'accroche ; la promesse (le bénéfice en une phrase) ; une phrase de crédibilité (pourquoi
  cette voix sait de quoi elle parle) ; le message en phrases courtes ; une conclusion explicite ; la question finale.
${consigneFait}
- REGISTRE : ${
          registre === 'vous'
            ? 'VOUVOIEMENT du début à la fin. Jamais « tu », « toi », « tes », « t’ ».'
            : 'TUTOIEMENT du début à la fin, jamais « vous » pour s’adresser au lecteur.'
        } On ne mélange jamais les deux.
- PAS DE SURVENTE : ni « 100 % automatisé », ni « remplace un salarié », ni promesse invérifiable
  (« +300 % », « 10x », « 50 PME nous font confiance ») — elles heurtent la crainte du lecteur et ruinent la crédibilité.
- PAS DE JARGON : ni « workflow », « agent », « RAG », « LLM », « prompt », « no-code », « SaaS ». Parle d'heures par
  semaine, d'euros par an, de mois avant que ça rapporte.
- PAS DE SIGNES D'IA : aucune flèche (→), pas de tiret long (—), pas d'énumérations par trois à répétition, pas de
  liste à puces en émojis, pas de « révolutionner », « booster », « incontournable », « crucial ».
- SOURCER, toujours : nomme en clair d'où vient l'information — le NOM EXACT du média${media ? ` (ici « ${media} »)` : ''},
  et l'auteur ou l'auteure si l'article le donne. Une ligne « Source : … » en fin de post.
  JAMAIS « une étude », « des chercheurs », « un labo américain » : un post sourcé est crédible, un post vague ne l'est pas.
  Déclare ce média dans "mentions" avec source: true (et son vanityName LinkedIn s'il a une page).
- IDENTIFIER : ${strategie.mentionsMax} mentions au plus, chacune intégrée dans une phrase, jamais une liste de tags :
  le média source et, quand l'actualité s'y prête, l'entreprise ou la personne au cœur de l'info. Déclare-les dans
  "mentions" (nom exact ; entreprise : vanityName LinkedIn = la fin de l'URL de sa page, ex. « openai » ;
  instagram = son compte officiel sans @, seulement si tu en es sûr). Une identification décorative est pénalisée.
${consigneMarque}
- ${
          lienDansLeTexte
            ? `N'écris PAS l'adresse du site : le moteur termine lui-même le post par « ${brand.name} : ${adresseDuSite(brand.siteUrl)} ».`
            : 'AUCUNE adresse, aucun lien, aucun nom de domaine dans le texte : le post tient debout seul.'
        }
- hashtags : ${
          strategie.hashtagsMax === 0
            ? 'aucun (renvoie "hashtags": []).'
            : `0 à ${strategie.hashtagsMax}, précis, chaque mot en majuscule (#AutomatisationPME), jamais ${hashtagDeMarque(brand)} (il n'a aucun abonné) : ils servent à la recherche, pas à la portée. ${VOCABULAIRE_HASHTAGS}`
        }

CE QUE L'ALGORITHME LINKEDIN RÉCOMPENSE EN 2026 (écris pour ça) :
- le TEMPS DE LECTURE : des détails concrets, un chiffre sourcé, une mini-histoire — pas de généralités ;
- les COMMENTAIRES LONGS : la question finale appelle une phrase sur le cas du lecteur, pas un mot ;
- les ENREGISTREMENTS : une méthode, des étapes, une liste qu'on a envie de garder ;
- la COHÉRENCE : toujours les trois mêmes sujets (automatisation IA des PME, agents IA au quotidien,
  gains concrets en temps et en ventes) — c'est ce qui construit l'autorité ;
- un texte HUMAIN : un avis de praticien, des phrases qu'un dirigeant dirait. Bannis « révolutionner »,
  « dans un monde où », « game changer », « à l'ère de ».
CE QUI EST DÉCLASSÉ : l'appât à commentaire (« Commente X »), le lien externe dans un post de profil,
le même texte publié par deux comptes, le contenu générique « écrit par une IA ».
ORDRE DE FIN DE POST, sans rien d'autre entre les lignes :
  1. la conclusion ;
${lienDansLeTexte ? `  2. la ressource et son lien, sur une ligne : « <ce que c'est, en trois mots> : {{link}} » ;
` : ''}  ${lienDansLeTexte ? '3' : '2'}. la question finale, seule sur sa ligne ;
  ${lienDansLeTexte ? '4' : '3'}. une ligne vide, puis « Source : média, auteur ».
  (Le moteur ajoute ensuite ${lienDansLeTexte ? 'l’adresse du site et ' : ''}les hashtags : ne les écris pas dans le texte.)`
      : platform === 'linkedin'
      ? `
STRATÉGIE LINKEDIN (le texte du post, « caption ») :
- COURT : entre 500 et 1 000 caractères, jamais plus de 1 200. Une idée par ligne, lignes
  aérées, phrases brèves. Un post long n'est pas lu ; un post court est partagé.
- Les 200 PREMIERS caractères sont les seuls visibles avant « …voir plus » : l'accroche y
  tient tout entière, avec son chiffre ou sa tension. Pas d'introduction, pas de préambule.
- SOURCER, toujours : nomme en clair d'où vient l'information — le NOM EXACT du média${media ? ` (ici « ${media} »)` : ''},
  et l'auteur ou l'auteure si l'article le donne. Une ligne « Source : … » en fin de post.
  JAMAIS « une étude », « des chercheurs », « un labo américain », « les équipes de recherche » :
  un post sourcé est crédible, un post vague ne l'est pas — et il ne rend rien au média.
  Déclare ce média dans "mentions" avec source: true (et son vanityName LinkedIn s'il a une page).
- IDENTIFIER (jusqu'à 3 mentions, jamais gratuites) : le média source, et quand l'actualité
  s'y prête, l'entreprise ou la personne de notoriété au cœur de l'info (le fondateur qui
  l'annonce, la grande marque qui l'a mis en place). Nomme-les en clair dans le texte et
  déclare-les dans "mentions" (nom exact ; entreprise : vanityName LinkedIn = la fin de l'URL
  de sa page, ex. « openai », « usine-digitale » ; instagram = son compte officiel sans @,
  seulement si tu en es sûr). Le moteur identifie ce qu'il peut vérifier ; le reste reste
  écrit en clair. Une identification injustifiée est pénalisée par LinkedIn : pas de tag décoratif.
- Nomme ${brand.name} une fois, naturellement, dans la dernière ligne (le moteur l'identifiera).
- N'écris PAS l'adresse du site : le moteur termine lui-même le post par « ${brand.name} : ${adresseDuSite(brand.siteUrl)} ».
- hashtags : 2, hors texte (le moteur place ${hashtagDeMarque(brand)} en tête : 3 au total, LinkedIn ignore le reste) —
  un thème du vocabulaire maison + un plus précis sur le sujet. ${VOCABULAIRE_HASHTAGS}

CE QUE L'ALGORITHME LINKEDIN RÉCOMPENSE EN 2026 (écris pour ça) :
- le TEMPS DE LECTURE : des détails concrets, un chiffre sourcé, une mini-histoire — pas de généralités ;
- les COMMENTAIRES LONGS (plus de 15 mots) : l'appel à commenter demande une vraie réponse
  (« Commente CAS et dis-moi quelle tâche te prend le plus de temps »), jamais un simple mot ;
- les ENREGISTREMENTS : une méthode, des étapes, une liste qu'on a envie de garder ;
- la COHÉRENCE : Odile parle toujours des mêmes trois sujets (automatisation IA des PME,
  agents IA au quotidien, gains concrets en temps et en ventes) — c'est ce qui construit l'autorité ;
- un texte HUMAIN : un avis de praticien, des phrases qu'un dirigeant dirait. Le contenu
  générique « écrit par une IA » est déclassé : bannis « révolutionner », « dans un monde où »,
  « game changer », « à l'ère de ». Aucun mot anglais laissé tel quel.
- ORDRE DE FIN DE POST, sans rien d'autre entre les lignes :
  1. une ligne vide ;
${
  diagnostic
    ? `  2. la ressource et son lien, sur une ligne : « <ce que c'est, en trois mots> : {{link}} » (le marqueur tel quel, jamais une URL) ;
  3. l'appel à l'action seul sur sa ligne : « Commente [MOT-CLÉ] » (en toutes lettres, c'est lui qui déclenche) suivi de ce qu'il ouvre — ${promesseDiagnostic} ;`
    : `  2. l'appel à l'action seul sur sa ligne : « Commente [MOT-CLÉ] » (écrit en toutes lettres, c'est lui qui déclenche l'envoi) ;
  3. « Ou directement ici : {{link}} » (le marqueur tel quel, jamais une URL) ;`
}
  4. « Source : média, auteur » ;
  5. la mention de ${brand.name}, intégrée à l'une de ces deux lignes.
  (Le moteur ajoute ensuite l'adresse du site et les hashtags : ne les écris pas dans le texte.)`
      : '';

  // Vidéo : le script est prononcé par l'avatar de la marque, pas lu à l'écran.
  const reglagesVideo = getVideo();
  const specVideo = isReel
    ? `
SCRIPT DE LA VIDÉO (champ "videoScript") — c'est le cœur de ce post :
- L'avatar de ${brand.name} va PRONONCER ce texte face caméra. Écris pour l'oreille, pas pour l'œil.
- Durée visée : ${reglagesVideo.targetSeconds} secondes, soit environ ${Math.round(reglagesVideo.targetSeconds * 15)} caractères. Ne dépasse jamais 1 300.
- La PREMIÈRE PHRASE tient en 2 secondes et arrête le scroll : un chiffre, une tension, une question directe.
  Pas de « bonjour », pas de « aujourd'hui je vais vous parler de ».
- Ensuite : le problème vécu par le dirigeant, ce qui change concrètement, un exemple ou un ordre de grandeur.
- Termine par ${linkedin2026 ? "la même question que la légende, dite à l'oral" : "le même appel à l'action que la légende (« Commente [MOT-CLÉ] »), dit à l'oral"}.
- Phrases courtes, une idée par phrase, vocabulaire parlé. AUCUN émoji, AUCUN hashtag, AUCUNE URL, aucun sigle
  imprononçable : tout est lu à voix haute tel quel.
- Ponctue pour la respiration : un point là où l'avatar doit marquer une pause.`
    : '';

  // Qui parle. Sans cette consigne, chaque compte publie le même communiqué à la
  // troisième personne : trois fois la même voix, que les lecteurs — et l'algorithme —
  // repèrent immédiatement comme de la duplication.
  const specEnonciateur =
    platform === 'linkedin' && compte
      ? compte.subject === 'li_org'
        ? `
QUI PARLE : la page entreprise ${brand.name}.
- Écris au « nous » : la voix de l'agence, collective mais incarnée.
- Ce que NOUS observons sur le terrain, ce que nous en faisons pour les PME que nous accompagnons.
- Aucun « je », aucune anecdote personnelle. Aucun « nous sommes ravis de » non plus : on informe, on ne communique pas.`
        : `
QUI PARLE : ${compte.name}${compte.role ? `, ${compte.role}` : ''}, depuis son profil personnel — pas depuis la page de la marque.
- Écris à la PREMIÈRE PERSONNE DU SINGULIER : « je », « ce que j'en retiens », « ce que je vois chez nos clients ».
- Un point de vue assumé de praticien : ce que cette actualité change concrètement pour les dirigeants
  que cette personne accompagne. Une opinion, pas un résumé neutre.
${
          linkedin2026 && !promo
            ? '- Ce post ne parle pas de l’agence : un point de vue de praticien, sans « chez nous » ni « l’agence ».'
            : `- ${linkedin2026 ? strategie.nomCourant : brand.name} se dit « chez nous », « l'agence » — jamais comme une entreprise tierce dont on parlerait.`
        }
- Bannis le ton communiqué : « nous sommes ravis de », « notre équipe a le plaisir de », « c'est avec fierté que ».`
      : '';

  // Un post qui part d'un SUJET : l'angle commande, l'article n'est que la matière.
  const contexte = (opts.contexteItemIds ?? []).filter((id) => id !== news.id);
  const autresArticles = contexte.length
    ? db
        .select({ title: schema.newsItems.title, summary: schema.newsItems.summary, url: schema.newsItems.url })
        .from(schema.newsItems)
        .where(inArray(schema.newsItems.id, contexte.slice(0, 5)))
        .all()
    : [];
  const blocSujet = opts.sujet
    ? `SUJET DU POST (c'est lui qui commande, l'article ci-dessous n'est que la matière) :
${opts.sujet.label}
${opts.sujet.reason ? `Pourquoi maintenant : ${opts.sujet.reason}\n` : ''}${opts.sujet.angle ? `ANGLE IMPOSÉ : ${opts.sujet.angle}\nTraite le sujet sous CET angle et aucun autre. Si l'article source ne suffit pas, appuie-toi sur ce que tu sais du quotidien des PME françaises, sans inventer de chiffre.\n` : ''}
${autresArticles.length ? `AUTRES ARTICLES SUR LE MÊME SUJET (pour recouper, pas pour résumer) :\n${autresArticles.map((a) => `- ${a.title}${a.summary ? ` — ${a.summary.slice(0, 180)}` : ''}`).join('\n')}\n` : ''}
`
    : '';

  const prompt = `${blocSujet}ACTUALITÉ SOURCE (à transformer en post ${platform === 'instagram' ? 'Instagram' : 'LinkedIn'}) :
Titre : ${news.title}
Résumé : ${news.summary ?? '(pas de résumé)'}
URL : ${news.url}
Langue source : ${news.lang}
Pourquoi elle a été retenue : ${news.scoreReason ?? ''}
${
  news.contentText
    ? `\nEXTRAIT DE L'ARTICLE (matière première pour comprendre le sujet — rédige un contenu
100 % ORIGINAL en français, avec tes propres mots ; ne recopie aucune phrase de la source, cite-la
seulement comme référence via le lien) :\n"""\n${news.contentText.slice(0, 2800)}\n"""`
    : ''
}

TON DE LA MARQUE :
${toneToPrompt(tone)}

${buildArchetypeSpec(isCarousel || isDocument, imagesAllowed)}

${consigneVarieteAccroches()}

FORMAT DEMANDÉ : ${slideSpec}

${ctaSpec}
${specEnonciateur}${strategieLinkedIn}${specVideo}
CONTRAINTES :
- Tout en français. Source anglophone : TRANSPOSE, ne traduis pas — adapte l'histoire et les ordres de
  grandeur au quotidien d'une PME française. Marque : ${brand.name} (${brand.handle}).
- caption : le texte du post (${platform === 'instagram' ? '2 200 caractères max pour Instagram' : '1 200 caractères max pour LinkedIn'}, aéré, sauts de ligne).
  Structure AIDA aussi dans la caption.
- hashtags : ${
    platform === 'instagram'
      ? `4, sans doublon avec le texte (le moteur place ${hashtagDeMarque(brand)} en tête : Instagram n'en accepte que 5) — des hashtags de niche (10 000 à 500 000 publications), jamais des géants génériques. ${VOCABULAIRE_HASHTAGS}`
      : linkedin2026
        ? `0 à ${strategie.hashtagsMax}, précis, en CamelCase, sans doublon avec le texte — jamais ${hashtagDeMarque(brand)}.`
        : `2 (le moteur place ${hashtagDeMarque(brand)} en tête : 3 au total), sans doublon avec le texte.`
  }${
    platform === 'instagram'
      ? `
- Instagram : nomme ${brand.name} une fois dans la légende. AUCUNE adresse, pas même celle du site. Les mots-clés du sujet
  figurent en clair dans les deux premières lignes (la recherche Instagram lit la légende). Termine par une raison
  d'enregistrer ou d'envoyer le post à quelqu'un : ce sont les signaux qu'Instagram récompense le plus.`
      : ''
  }
- hook : reprend le titre de la slide 1 (pour l'objet de l'email de validation).
- screenshotUrl : URL réelle de l'outil/du site à capturer (celle de l'actu ou de l'outil cité), sinon null.
- Chaque slide : title ≤ 9 mots, body ≤ 2 phrases, bullets ≤ 4 items courts.
- Mise en page (facultatif, quand ça sert le message) : "icon" = une icône affichée dans un badge rond
  au-dessus du titre, parmi : ${ICON_IDS.join(', ')} ; "subtitle" = un sous-titre sur deux tons,
  la partie voilée puis le mot plein séparés par « | » (ex. « le tueur silencieux des | conversions »),
  idéal quand le titre est UN mot fort ; "ctaLabel" sur une slide de contenu ou de chiffre = un bouton
  court (≤ 6 mots). Dans "body", **gras** met en valeur la fin d'une phrase (ex. « des TPE perdent des devis
  **faute de réponse.** »).`;

  const { value: generated } = await completeJson<GeneratedPost>(
    { task: 'writing', label: 'post:redaction', tier: 'best', system: WRITER_SYSTEM, prompt, maxTokens: 16000 },
    writerResponseSchema(
      imagesAllowed,
      linkedin2026
        ? {
            appatInterdit: true,
            lienInterdit: !lienDansLeTexte,
            vouvoiement: registre === 'vous',
            accrocheCourte: true,
            ...(faitObligatoire ? { faitObligatoire: true, faitsPermis: faitsCandidats.map((f) => f.id) } : {}),
          }
        : {},
    ),
    { attempts: 3 },
  );

  const brouillon = persistDraft({ news, channel, platform, format, theme, tone, generated, cibleDuLien, compte, motcleAutorise: !linkedin2026 });
  await finaliserLeTexte(brouillon.postId, platform, news.id, generated.mentions ?? []);
  // Le fait raconté, le post promotionnel, et le texte de l'IA tel quel : comparé au texte
  // publié, il dira quelle part la personne a réécrite.
  const faitId = faitObligatoire && generated.faitId && faitsCandidats.some((f) => f.id === generated.faitId) && !faitACompleter(generated.caption) ? generated.faitId : null;
  if (faitId) noterUsage(faitId);
  const ecrit = db.select({ caption: schema.posts.caption }).from(schema.posts).where(eq(schema.posts.id, brouillon.postId)).get();
  db.update(schema.posts).set({ faitId, promo, texteGenere: ecrit?.caption ?? null }).where(eq(schema.posts.id, brouillon.postId)).run();
  return brouillon;
}

/**
 * Dernière main au texte, une fois le post enregistré :
 * - la ligne « Source » nomme le vrai média (le modèle écrit parfois « une étude américaine ») ;
 * - sur Instagram, les noms cités deviennent des @ quand le compte est vérifié.
 * Les identifications LinkedIn, elles, se posent à la publication (elles exigent l'API).
 */
export async function finaliserLeTexte(postId: number, platform: 'linkedin' | 'instagram', newsItemId: number | null, mentions: MentionDeclaree[]): Promise<void> {
  const post = db.select({ caption: schema.posts.caption }).from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) return;
  let caption = corrigerLigneSource(post.caption, sourceReelle(newsItemId)?.media ?? null);
  if (platform === 'instagram') {
    try {
      caption = (await mentionnerSurInstagram(caption, mentions)).caption;
    } catch (err) {
      logger.warn({ postId, err: String(err).slice(0, 160) }, 'mentions Instagram non posées — noms laissés en clair');
    }
  }
  if (caption !== post.caption) db.update(schema.posts).set({ caption }).where(eq(schema.posts.id, postId)).run();
}

const porteUnLien = (ligne: string) => ligne.includes('{{link}}') || /https?:\/\//i.test(ligne);

/**
 * Nettoie un texte ligne à ligne après avoir touché aux liens.
 *
 * Une étiquette privée de son adresse — « Ou directement ici : », « Source : » —
 * ne veut plus rien dire : la ligne part avec le lien, au lieu de rester ouverte
 * sur le vide. Le reste est seulement resserré (espaces avant ponctuation, lignes
 * vides en trop).
 */
function nettoyer(texte: string, transformer: (ligne: string) => string): string {
  const lignes = texte.split('\n').flatMap((ligne) => {
    // Une adresse retirée en milieu de phrase laisse « voir ici : . » : on resserre
    // avant le point et la virgule — pas avant « ? » ni « ! », que le français espace.
    const nette = transformer(ligne)
      .replace(/[ \t]+([.,])/g, '$1')
      // « Le guide : . » — le deux-points n'introduit plus rien : il part avec l'adresse.
      .replace(/\s*[:：]([.,])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trimEnd();
    if (porteUnLien(ligne) && !porteUnLien(nette) && (!nette.trim() || /[:：>→»]$/.test(nette.trim()))) return [];
    return [nette];
  });
  return lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface OptionsDuLien {
  /** le mot à commenter, pour placer la ligne au bon endroit */
  motcle?: string | null;
  /** ce qui introduit l'adresse : « C'est ici », « Ou directement ici »… */
  libelle?: string;
  /** poser le lien AVANT l'appel à commenter (le lien donne, le mot-clé propose) */
  avantLeCta?: boolean;
}

/**
 * Comment poser le lien, selon ce que le mot-clé donne sur LinkedIn.
 *
 * Quand le mot-clé ouvre le diagnostic, le lien est ce qu'on DONNE : il vient en
 * premier, et l'appel à commenter propose la suite. Quand le mot-clé renvoie la
 * même ressource que le lien, celui-ci n'est qu'un raccourci : il suit le mot-clé.
 */
export function optionsDuLien(motcle?: string | null): OptionsDuLien {
  const diagnostic = getDmTriggers().linkedinOffer === 'diagnostic';
  return diagnostic
    ? { motcle, libelle: 'C’est ici', avantLeCta: true }
    : { motcle, libelle: 'Ou directement ici', avantLeCta: false };
}

/**
 * Pose le lien court dans un texte destiné à LinkedIn.
 *
 * Deux chemins cohabitent : le lien de la description, qui donne la ressource sans
 * rien demander, et « Commente [MOT-CLÉ] », qui ouvre autre chose. Toute autre URL
 * inventée par le modèle est retirée : une seule adresse, la nôtre, traçable.
 */
export function avecLien(texte: string, url: string, opts: OptionsDuLien = {}): string {
  // L'adresse du site de la marque n'est pas une URL inventée : elle reste.
  const propre = nettoyer(texte, (ligne) =>
    ligne.replaceAll('{{link}}', url).replace(/https?:\/\/\S+/gi, (trouve) => (trouve.startsWith(url) || porteLeSite(trouve) ? trouve : '')),
  );
  if (propre.includes(url)) return propre;
  // Le modèle a oublié le lien : on le pose nous-mêmes, contre l'appel à l'action
  // quand il y en a un, en fin de texte sinon.
  const ligne = `${opts.libelle ?? 'C’est ici'} : ${url}`;
  if (!opts.motcle) return `${propre}\n\n${ligne}`;
  const lignes = propre.split('\n');
  const cle = opts.motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const iCta = lignes.findIndex((l) => new RegExp(`commente\\s+${cle}`, 'i').test(l));
  if (iCta === -1) return `${propre}\n\n${ligne}`;
  lignes.splice(opts.avantLeCta ? iCta : iCta + 1, 0, ...(opts.avantLeCta ? [ligne, ''] : ['', ligne]));
  return lignes.join('\n');
}

/**
 * Filet de sécurité après une réécriture (studio de design, régénération) : le
 * modèle a pu effacer le lien court. On le remet — sur LinkedIn seulement, puisque
 * sur Instagram aucun lien n'est affiché, tout part en message privé.
 */
export function relierLeLien(
  post: { platform: string; channel: string; linkId: number | null; commentTriggerKeyword: string | null },
  texte: string,
): string {
  if (post.platform !== 'linkedin' || !post.linkId) return texte;
  // Profil personnel en stratégie 2026 : aucun lien dans le texte, même après une réécriture.
  if (!lienPermis(reseauDuCanal(post.channel))) return sansLien(texte);
  const lien = db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get();
  if (!lien) return texte;
  return avecLien(texte, `${config.PUBLIC_URL}/r/${lien.code}`, optionsDuLien(post.commentTriggerKeyword));
}

/**
 * Retire placeholder et URL d'un texte qui n'en veut aucun (Instagram), sans laisser
 * de trou. Les adresses sans « https:// » (« www.site.fr », « odile.ai/demo ») partent
 * aussi : un modèle en invente parfois, et une adresse inventée est pire qu'aucune.
 */
export function sansLien(texte: string): string {
  return nettoyer(texte, (ligne) =>
    ligne
      .replaceAll('{{link}}', '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/(?:^|\s)(?:www\.[a-z0-9.-]+\.[a-z]{2,}\S*|[a-z0-9-]+\.[a-z]{2,}\/\S+)/gi, ' '),
  );
}

export { bornerHashtags };

function persistDraft(args: {
  news: typeof schema.newsItems.$inferSelect;
  channel: Channel;
  platform: 'linkedin' | 'instagram';
  format: PostFormat;
  theme: string;
  tone: ReturnType<typeof getTone>;
  generated: GeneratedPost;
  /** cible du lien court : l'article source, ou l'adresse fixe des réglages */
  cibleDuLien: string;
  /** compte qui publie — choisi AVANT la rédaction, puisque le texte porte sa voix */
  compte: CompteLinkedIn | null;
  /** un mot à commenter a-t-il sa place ? (non sur LinkedIn en stratégie 2026) */
  motcleAutorise: boolean;
}): DraftResult {
  const { news, channel, platform, format, theme, tone, generated, cibleDuLien, compte, motcleAutorise } = args;
  const motcle = motcleAutorise && generated.commentTrigger?.enabled ? generated.commentTrigger.keyword.toUpperCase() : null;

  const archetype = ARCHETYPES.some((a) => a.id === generated.archetype)
    ? generated.archetype!
    : null;
  const post = db
    .insert(schema.posts)
    .values({
      newsItemId: news.id,
      platform,
      channel,
      liAccountKey: compte?.key ?? null,
      format,
      theme,
      status: 'draft',
      archetype,
      hook: generated.hook,
      caption: generated.caption,
      cta: generated.cta,
      hashtags: JSON.stringify(bornerHashtags(generated.hashtags, platform)),
      commentTriggerKeyword: motcle,
      // Ce que le post promet : le pipeline le fabriquera (guide) ou le pointera (outil).
      resourceKind: generated.resource?.kind ?? 'article',
      resourceTitle: generated.resource?.title ?? null,
      resourceUrl: generated.resource?.kind === 'outil' ? (generated.resource.toolUrl ?? null) : null,
      mentions: generated.mentions?.length ? JSON.stringify(generated.mentions) : null,
      videoScript: generated.videoScript?.trim() || null,
      toneSnapshot: JSON.stringify(tone),
    })
    .returning({ id: schema.posts.id })
    .get();

  // Lien court tracké, remplace {{link}} (LinkedIn) — créé dans tous les cas : il sert
  // aussi de lien envoyé en DM Instagram. Sa cible suit le réglage « lien envoyé en
  // privé » : l'article source, ou une adresse à soi (contact, prise de rendez-vous).
  const link = createLink(cibleDuLien, {
    postId: post.id,
    label: `post-${post.id}`,
    utm: { utm_source: platform, utm_medium: 'social', utm_campaign: `post-${post.id}` },
  });
  // Le lien court traçable est posé dans le texte des deux plateformes. Sur LinkedIn
  // il accompagne le mot-clé au lieu de le remplacer : commenter nourrit le post,
  // le lien sert ceux qui veulent aller droit au but.
  // Sur Instagram aucune adresse : le lien part en message privé, jamais dans la
  // légende (une URL y est illisible et non cliquable, et elle trahit le tunnel).
  // Sur un profil LinkedIn non plus (stratégie 2026) : le lien se donne en réponse,
  // après la première heure. Sur la Page, le lien et l'adresse du site ferment le post.
  const reseau = reseauDuCanal(channel);
  const lienDansLeTexte = platform === 'linkedin' && lienPermis(reseau);
  const caption = lienDansLeTexte
    ? avecSite(avecLien(generated.caption, link.shortUrl, optionsDuLien(motcle)), reseau)
    : sansLien(generated.caption);
  const cta = lienDansLeTexte ? generated.cta.replaceAll('{{link}}', link.shortUrl) : sansLien(generated.cta);
  db.update(schema.posts)
    .set({ caption, cta, linkId: link.id })
    .where(eq(schema.posts.id, post.id))
    .run();

  generated.slides.forEach((slide, idx) => {
    // Le marqueur de lien n'a rien à faire sur un visuel : une image ne se clique pas,
    // et « {{link}} » imprimé sur une slide se voit jusqu'à la fin du post.
    const content = JSON.stringify(slide).replaceAll('{{link}}', '').replace(/ {2,}/g, ' ');
    db.insert(schema.slides).values({ postId: post.id, idx, kind: slide.kind, content }).run();
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
