import { and, desc, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getDmTriggers } from '../db/settingsRepo.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from '../publishers/instagram.js';
import { getStoredToken } from '../publishers/tokens.js';

/** Limite Meta : 200 DM/h par compte. Marge de sécurité. */
const HOURLY_DM_LIMIT = 190;

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

export function matchKeyword(text: string, keywords: string[]): string | null {
  const norm = normalize(text);
  for (const kw of keywords) {
    const normKw = normalize(kw);
    if (normKw && new RegExp(`(^|\\W)${normKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(norm)) {
      return kw.toUpperCase();
    }
  }
  return null;
}

/**
 * Est-ce que cette personne suit le compte ?
 *
 * Meta ne prévient d'aucun nouvel abonné et n'expose pas la liste des abonnés :
 * `is_user_follow_business` n'est lisible que pour une personne déjà en
 * conversation avec le compte. `null` = indéterminé, jamais « non ».
 */
export async function estAbonne(igsid: string): Promise<boolean | null> {
  const igToken = getStoredToken('meta', 'ig_user');
  if (!igToken || !igsid) return null;
  try {
    const res = await fetchJson<{ is_user_follow_business?: boolean }>(
      `${GRAPH}/${encodeURIComponent(igsid)}?fields=is_user_follow_business&access_token=${encodeURIComponent(igToken.accessToken)}`,
    );
    return typeof res.is_user_follow_business === 'boolean' ? res.is_user_follow_business : null;
  } catch {
    return null;
  }
}

/**
 * Où poster un message Instagram, et avec quel jeton.
 *
 * Avec Facebook Login, la messagerie Instagram passe par la Messenger Platform :
 * l'objet visé est la **Page**, pas le compte Instagram — `POST /{page-id}/messages`.
 * Le point d'entrée `/{ig-user-id}/messages` appartient à l'autre parcours (Instagram
 * Login, sur graph.instagram.com) ; l'appeler ici vaut à Meta de répondre
 * « (#3) Application does not have the capability to make this API call ».
 */
export function cibleMessagerie(): { pageId: string; token: string } | null {
  const igToken = getStoredToken('meta', 'ig_user');
  const pageToken = getStoredToken('meta', 'fb_page');
  const pageId = pageToken?.externalId ?? (igToken?.meta.pageId as string | undefined);
  const token = pageToken?.accessToken ?? igToken?.accessToken;
  return pageId && token ? { pageId, token } : null;
}

/** Envoi d'un message privé à une personne, hors réponse à un commentaire. */
async function envoyerMessage(igsid: string, texte: string): Promise<void> {
  const cible = cibleMessagerie();
  if (!cible) throw new Error('Aucune Page Facebook connectée — la messagerie Instagram passe par elle');
  await fetchJson(`${GRAPH}/${cible.pageId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: texte }, access_token: cible.token }),
  });
}

/**
 * Une phrase différente d'un commentaire au suivant. La rotation suit l'identifiant
 * du commentaire : deux commentaires consécutifs ne reçoivent jamais la même phrase,
 * sans avoir à retenir ce qui a déjà servi.
 */
export function choisirVariante(variantes: string[], graine: number): string | null {
  const utiles = variantes.map((v) => v.trim()).filter(Boolean);
  if (utiles.length === 0) return null;
  return utiles[((graine % utiles.length) + utiles.length) % utiles.length]!;
}

/**
 * Réponse publique sous le commentaire.
 *
 * Elle ne dépend que de `instagram_manage_comments` : elle part même quand la
 * messagerie de l'app Meta n'est pas ouverte. Elle ne porte jamais le lien — tout
 * se passe en privé — et son texte dépend du sort du message privé : renvoi vers
 * les DM s'il est parti, invitation à écrire sinon.
 */
export async function repondreEnPublic(commentId: number, dmParti: boolean, lien: string): Promise<void> {
  const comment = db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!comment || comment.publicReplyStatus === 'sent' || !comment.externalId) return;
  const settings = getDmTriggers();
  if (!settings.publicReply) return;
  const modele = choisirVariante(dmParti ? settings.publicReplyVariants : settings.publicReplyFallbackVariants, commentId);
  if (!modele) return;
  const texte = buildReply(modele, contexteDuCommentaire(comment.postId, comment.matchedKeyword));

  const igToken = getStoredToken('meta', 'ig_user');
  if (config.PUBLISH_MODE === 'dry' || !igToken) {
    db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, texte }, 'réponse publique simulée (mode dry)');
    return;
  }
  try {
    await fetchJson(`${GRAPH}/${encodeURIComponent(comment.externalId)}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: texte, access_token: igToken.accessToken }),
    });
    db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, dmParti }, 'réponse publique postée');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.update(schema.comments)
      .set({ publicReplyStatus: 'failed', publicReplyError: detail.slice(0, 500) })
      .where(eq(schema.comments.id, commentId))
      .run();
    logger.error({ commentId, err: detail }, 'échec de la réponse publique');
  }
}

/**
 * Lien de valeur à envoyer : le lien court tracké du post, sinon le site.
 * Sa cible est la ressource promise (guide PDF, outil, article) — voir le pipeline.
 */
export function linkForPost(postId: number | null): string {
  if (postId) {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
    if (post?.linkId) {
      const link = db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get();
      if (link) return `${config.PUBLIC_URL}/r/${link.code}`;
    }
  }
  return 'https://odileai.com';
}

/** Ce que les gabarits de message savent remplacer. */
export interface ContexteReponse {
  /** lien court tracké vers la ressource promise */
  link: string;
  /** « le guide « Automatiser vos devis » », « l'accès à n8n »… */
  ressource?: string | null;
  /** le mot commenté, tel qu'il a été reconnu */
  motcle?: string | null;
  /** prénom de la personne, quand la plateforme le donne */
  prenom?: string | null;
  /** lien de prise de rendez-vous (réglages), sinon le site de la marque */
  rdv?: string | null;
}

/**
 * Comment nommer ce que la personne va recevoir.
 *
 * Un lien court tout nu se lit comme du spam ; « voici le guide « Automatiser vos
 * devis » » se lit comme une réponse. Le post a déclaré sa ressource au moment de
 * la rédaction : on la reprend mot pour mot.
 */
export function nommerRessource(post: { resourceKind?: string | null; resourceTitle?: string | null } | null): string {
  const titre = post?.resourceTitle?.trim();
  if (post?.resourceKind === 'guide') return titre ? `le guide « ${titre} »` : 'le guide promis';
  if (post?.resourceKind === 'outil') return titre ? `l’accès à ${titre}` : 'l’accès à l’outil';
  if (post?.resourceKind === 'article') return 'l’analyse complète';
  return 'ce qui était promis';
}

/**
 * Remplit un gabarit de message.
 *
 * Un placeholder sans valeur disparaît proprement — pas de « {{prenom}} » affiché,
 * pas d'espace double ni de virgule orpheline laissés derrière lui.
 */
export function buildReply(template: string, contexte: ContexteReponse | string): string {
  const ctx: ContexteReponse = typeof contexte === 'string' ? { link: contexte } : contexte;
  let texte = template.replaceAll('{{link}}', ctx.link);
  const remplir = (cle: string, valeur: string | null | undefined) => {
    const motif = new RegExp(`[ ,]*\\{\\{${cle}\\}\\}`, 'g');
    texte = valeur?.trim()
      ? texte.replaceAll(`{{${cle}}}`, valeur.trim())
      : texte.replace(motif, '');
  };
  remplir('prenom', ctx.prenom);
  remplir('ressource', ctx.ressource);
  remplir('motcle', ctx.motcle);
  remplir('rdv', ctx.rdv);
  return texte.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,])/g, '$1').trim();
}

/** Le lien de rendez-vous des réglages, sinon le site de la marque. */
export function lienRdv(): string {
  const regle = getDmTriggers().rdvUrl.trim();
  if (regle) return regle;
  return getBrand().siteUrl || 'https://odileai.com';
}

/**
 * Le modèle de réponse à un commentaire, selon la plateforme.
 *
 * Sur Instagram, le mot-clé envoie la ressource en privé : le modèle porte le lien.
 * Sur LinkedIn, quand le mot-clé ouvre le diagnostic, la ressource est déjà dans la
 * description du post — renvoyer le même lien n'apprendrait rien à personne : la
 * réponse dit où il se trouve et propose le rendez-vous.
 */
export function modeleDeReponse(platform: string, post?: { caption?: string | null } | null): string {
  const s = getDmTriggers();
  if (platform !== 'linkedin' || s.linkedinOffer !== 'diagnostic') return s.replyTemplate;
  // Un post d'avant la stratégie n'a pas le lien dans sa description : la réponse doit
  // alors le donner, sinon elle renvoie la personne vers un lien qui n'existe pas.
  if (post && typeof post.caption === 'string' && !post.caption.includes('/r/')) return s.replyTemplate;
  return `Merci {{prenom}} 🙂 {{ressource}} est en lien dans le post. Si vous voulez ${s.diagnosticPromise}, c’est ici : {{rdv}}`;
}

/** Le contexte de réponse d'un commentaire : lien, ressource nommée, mot-clé. */
export function contexteDuCommentaire(postId: number | null, motcle: string | null, prenom?: string | null): ContexteReponse {
  const post = postId ? (db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get() ?? null) : null;
  return { link: linkForPost(postId), ressource: nommerRessource(post), motcle, prenom, rdv: lienRdv() };
}

/**
 * Traite un commentaire Instagram fraîchement reçu : si un mot-clé déclencheur
 * correspond, envoie UNE private reply avec le lien tracké (règles Meta :
 * 1 réponse privée par commentaire, sous 7 jours, ≤ 200 DM/h).
 */
/**
 * Ce commentaire mérite-t-il une réponse, alors qu'il n'a pas le mot-clé ?
 *
 * « Très intéressant, je veux bien la méthode » est un prospect ; « 👏 » est une
 * politesse. Le premier doit remonter dans la boîte à traiter, le second non —
 * une boîte pleine d'applaudissements ne se regarde plus, et la vraie demande s'y
 * noie. On repère une marque d'intérêt, une question, ou simplement une phrase
 * construite : le doute profite au prospect.
 */
const MARQUES_D_INTERET = [
  'je veux', 'je suis preneur', 'je suis preneuse', 'preneur', 'preneuse', 'jaimerais', "j'aimerais", 'interess', 'intéress',
  'comment', 'combien', 'prix', 'tarif', 'dispo', 'lien', 'guide', 'methode', 'méthode', 'envoie', 'envoyer', 'envoi',
  'partage', 'recevoir', 'recois', 'reçois', 'possible', 'besoin', 'contact', 'rendez-vous', 'rendezvous', 'rdv',
  'demo', 'démo', 'essai', 'tester', 'ca marche', 'ça marche', 'ca coute', 'ça coûte',
];

export function interetProbable(texte: string): boolean {
  // Les apostrophes typographiques et la casse ne doivent pas décider du sort d'un
  // prospect : on compare sur un texte mis à plat.
  const propre = texte.replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();
  const bas = propre.toLowerCase();
  if (propre.length < 3) return false;
  if (MARQUES_D_INTERET.some((m) => bas.includes(m))) return true;
  if (propre.includes('?')) return true;
  // Une phrase construite (au moins six mots) est une prise de parole, pas un applaudissement.
  return propre.split(/\s+/).filter((m) => /[a-zà-ÿ]{2,}/i.test(m)).length >= 6;
}

/**
 * Prépare la réponse d'un commentaire qui n'a pas le mot-clé.
 *
 * Rien n'est envoyé : le texte attend dans la boîte « à traiter », et c'est un
 * humain qui décide. Sans cela, un prospect qui écrit « je veux bien la méthode »
 * au lieu de « GUIDE » ne reçoit jamais rien — le tunnel le perd.
 */
export function preparerSansMotCle(commentId: number): boolean {
  const comment = db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!comment || comment.matchedKeyword || comment.suggestedReply || comment.dmStatus !== 'none') return false;
  const post = comment.postId ? db.select().from(schema.posts).where(eq(schema.posts.id, comment.postId)).get() : null;
  // Seuls les posts qui promettent quelque chose ouvrent une boîte à traiter.
  if (!post?.commentTriggerKeyword) return false;
  if (!interetProbable(comment.text)) return false;
  const contexte = contexteDuCommentaire(comment.postId, post.commentTriggerKeyword, prenomDuCommentaire(comment.authorName));
  const postDuCommentaire = comment.postId ? (db.select({ caption: schema.posts.caption }).from(schema.posts).where(eq(schema.posts.id, comment.postId)).get() ?? null) : null;
  const texte = buildReply(modeleDeReponse(comment.platform, postDuCommentaire), contexte);
  db.update(schema.comments).set({ suggestedReply: texte }).where(eq(schema.comments.id, commentId)).run();
  logger.info({ commentId }, 'commentaire sans mot-clé : réponse préparée, en attente d’un humain');
  return true;
}

/** Prénom utilisable dans une réponse (« marie.dupont » → « Marie »). */
function prenomDuCommentaire(nom: string): string | null {
  const premier = nom.split(/[\s._-]+/).filter(Boolean)[0];
  if (!premier || premier.length < 2 || /^\d+$/.test(premier)) return null;
  return premier.charAt(0).toUpperCase() + premier.slice(1).toLowerCase();
}

export async function handleInstagramComment(commentId: number): Promise<void> {
  const comment = db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).get();
  if (!comment || comment.dmStatus !== 'none') return;

  const settings = getDmTriggers();
  if (!settings.enabled) return;

  const post = comment.postId
    ? db.select().from(schema.posts).where(eq(schema.posts.id, comment.postId)).get()
    : null;
  const keywords = [
    ...(post?.commentTriggerKeyword ? [post.commentTriggerKeyword] : []),
    ...settings.keywords,
  ];
  const matched = matchKeyword(comment.text, keywords);
  if (!matched) {
    // Pas le mot-clé, mais peut-être un prospect : on prépare une réponse, sans l'envoyer.
    preparerSansMotCle(commentId);
    return;
  }

  // Ne jamais répondre à soi-même
  const igToken = getStoredToken('meta', 'ig_user');
  if (igToken && comment.authorExternalId === igToken.externalId) return;

  db.update(schema.comments)
    .set({ matchedKeyword: matched, dmStatus: 'pending' })
    .where(eq(schema.comments.id, commentId))
    .run();

  // Garde-fou 200 DM/h
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const sentLastHour = db
    .select({ id: schema.dmEvents.id })
    .from(schema.dmEvents)
    .where(gte(schema.dmEvents.sentAt, oneHourAgo))
    .all().length;
  if (sentLastHour >= HOURLY_DM_LIMIT) {
    logger.warn({ commentId }, 'limite horaire de DM atteinte — commentaire laissé en pending');
    return;
  }

  const lien = linkForPost(comment.postId);
  const contexte = contexteDuCommentaire(comment.postId, matched);
  // Porte d'abonnement : on demande d'abord de s'abonner, et la réponse de la
  // personne permettra de vérifier puis d'envoyer le lien (voir handleInstagramMessage).
  const abonne = settings.requireFollow ? await estAbonne(comment.authorExternalId ?? '') : true;
  // Porte d'abonnement, en deux temps. Au premier commentaire, Meta ne sait pas dire si
  // la personne suit le compte : `is_user_follow_business` n'est lisible qu'une fois la
  // conversation ouverte. Le premier message ne réclame donc rien — il demande seulement
  // de répondre. C'est cette réponse qui rend l'abonnement lisible, et c'est alors
  // seulement que le lien part (ou que l'abonnement est demandé, à bon escient).
  const porteFermee = settings.requireFollow && abonne !== true;
  const message = porteFermee
    ? buildReply(settings.askFollowTemplate, contexte)
    : buildReply(settings.replyTemplate, contexte);

  if (config.PUBLISH_MODE === 'dry' || !igToken) {
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'dry',
      })
      .run();
    db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, commentId)).run();
    logger.info({ commentId, matched }, 'DM simulé (mode dry)');
    await repondreEnPublic(commentId, true, lien);
    return;
  }

  const cible = cibleMessagerie();
  try {
    if (!cible) throw new Error('Aucune Page Facebook connectée — la messagerie Instagram passe par elle');
    // Private reply : la fenêtre d'envoi est déclenchée par le commentaire lui-même,
    // et l'objet visé est la Page (voir cibleMessagerie).
    await fetchJson(`${GRAPH}/${cible.pageId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: comment.externalId },
        message: { text: message },
        access_token: cible.token,
      }),
    });
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'sent',
      })
      .run();
    db.update(schema.comments)
      .set({ dmStatus: porteFermee ? 'awaiting_follow' : 'sent' })
      .where(eq(schema.comments.id, commentId))
      .run();
    logger.info({ commentId, matched, porteFermee }, porteFermee ? 'invitation à répondre envoyée (porte d’abonnement)' : 'private reply envoyée');
    await repondreEnPublic(commentId, true, lien);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.insert(schema.dmEvents)
      .values({
        commentId,
        platform: 'instagram',
        recipientExternalId: comment.authorExternalId,
        message,
        status: 'failed',
        error: detail.slice(0, 500),
      })
      .run();
    db.update(schema.comments).set({ dmStatus: 'failed' }).where(eq(schema.comments.id, commentId)).run();
    logger.error({ commentId, err: detail }, 'échec de la private reply');
    // Le commentaire reçoit quand même une réponse : la messagerie Meta peut être
    // fermée (produit Messenger absent) sans que la personne reste sans réponse.
    await repondreEnPublic(commentId, false, lien);
  }
}

/**
 * Message entrant d'une personne. Deux usages :
 *
 * — elle attend un lien derrière la porte d'abonnement : on revérifie son
 *   abonnement, et le lien part dès qu'il est constaté ;
 * — elle vient d'arriver en conversation : si elle suit le compte, un mot de
 *   remerciement part une seule fois.
 *
 * Meta n'émettant aucun événement d'abonnement, c'est ce message entrant qui
 * sert de déclencheur : c'est le seul moment où l'état d'abonnement devient
 * lisible.
 */
export async function handleInstagramMessage(igsid: string, texte = ''): Promise<void> {
  if (!igsid) return;
  const settings = getDmTriggers();
  if (!settings.enabled) return;
  const igToken = getStoredToken('meta', 'ig_user');
  if (igToken && igsid === igToken.externalId) return; // nos propres envois

  const enAttente = db
    .select()
    .from(schema.comments)
    .where(and(eq(schema.comments.authorExternalId, igsid), eq(schema.comments.dmStatus, 'awaiting_follow')))
    .orderBy(desc(schema.comments.id))
    .limit(1)
    .get();

  const abonne = await estAbonne(igsid);
  if (!enAttente) {
    // Personne sans demande en cours : un remerciement, seulement si elle suit
    // et qu'aucun message ne lui a déjà été envoyé.
    if (abonne !== true) return;
    const dejaEcrit = db
      .select({ id: schema.dmEvents.id })
      .from(schema.dmEvents)
      .where(eq(schema.dmEvents.recipientExternalId, igsid))
      .limit(1)
      .get();
    if (dejaEcrit) return;
    const message = buildReply(settings.thanksTemplate, { link: getBrand().siteUrl || 'https://odileai.com', rdv: lienRdv() });
    await envoyerMessage(igsid, message);
    db.insert(schema.dmEvents)
      .values({ commentId: null, platform: 'instagram', recipientExternalId: igsid, message, status: 'sent' })
      .run();
    logger.info({ igsid }, 'remerciement d’abonnement envoyé');
    return;
  }

  if (config.PUBLISH_MODE === 'dry') {
    db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, enAttente.id)).run();
    logger.info({ commentId: enAttente.id }, 'lien simulé (mode dry)');
    return;
  }

  const contexte = contexteDuCommentaire(enAttente.postId, enAttente.matchedKeyword);
  const message =
    abonne === false ? buildReply(settings.remindTemplate, contexte) : buildReply(settings.thanksTemplate, contexte);
  try {
    await envoyerMessage(igsid, message);
    db.insert(schema.dmEvents)
      .values({ commentId: enAttente.id, platform: 'instagram', recipientExternalId: igsid, message, status: 'sent' })
      .run();
    // Abonnement indéterminé : Meta ne sait pas répondre, on ne bloque pas la
    // personne pour autant — le lien est parti, la demande est close.
    if (abonne !== false) {
      db.update(schema.comments).set({ dmStatus: 'sent' }).where(eq(schema.comments.id, enAttente.id)).run();
    }
    logger.info({ commentId: enAttente.id, abonne, texte: texte.slice(0, 40) }, abonne === false ? 'relance abonnement' : 'lien envoyé après abonnement');
  } catch (err) {
    logger.warn({ igsid, err: String(err).slice(0, 200) }, 'message privé impossible');
  }
}
