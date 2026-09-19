/**
 * Ce que recevra la personne — calculé AVANT la validation.
 *
 * Tout ce que le tunnel dira ou donnera après la publication (le lien du post et sa
 * cible, la ressource, la réponse sous le commentaire, le message privé Instagram
 * en deux temps, la réponse publique, le commentaire d'amorce, la légende Facebook,
 * les noms qui seront identifiés) est composé ici à partir des mêmes fonctions que
 * l'exécution. Le fondateur le lit dans « À valider », l'éditeur, le calendrier et
 * l'email ; il valide en connaissance de cause, pas sur une promesse.
 */
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getAmplification, getCadence, getDmTriggers, getFbMirror } from '../db/settingsRepo.js';
import { texteAmorce } from '../publishers/amplify.js';
import { legendePourFacebook } from '../publishers/facebook.js';
import { commentary } from '../publishers/linkedin.js';
import { compteDuPost, droitCommentaire, mentionsConnues } from '../publishers/linkedinAccounts.js';
import { targetWithUtm } from '../shortener/index.js';
import { buildReply, choisirVariante, contexteDuCommentaire, lienRdv, nommerRessource, REPONSE_PUBLIQUE_PORTE } from '../webhooks/commentDm.js';

type Post = typeof schema.posts.$inferSelect;

export interface MentionPrevue {
  nom: string;
  /** identifiée (cliquable), en clair (pas d'identifiant connu), absente (déclarée mais plus dans le texte) */
  statut: 'identifiee' | 'en-clair' | 'absente';
}

export interface ApercuTunnel {
  postId: number;
  platform: 'linkedin' | 'instagram';
  motcle: string | null;
  lien: { shortUrl: string; cible: string; clics: number } | null;
  /** le lien figure dans le texte publié (LinkedIn) ; sinon il ne part qu'en privé (Instagram) */
  lienDansLePost: boolean;
  ressource: { kind: string; titre: string | null; url: string | null; erreur: string | null; viaLien: boolean; libelle: string };
  document: { pages: number; url: string } | null;
  amorce: string | null;
  reponseLinkedIn: string | null;
  /** nombre de formulations parmi lesquelles la réponse est tirée à chaque commentaire (1 = toujours celle-ci) */
  reponseVariantes: number;
  /** LinkedIn ne laisse pas lire les commentaires de ce compte : la réponse sera manuelle */
  reponseManuelle: boolean;
  dmInstagram: { etape1: string; etape2: string | null } | null;
  reponsePublique: string | null;
  captionFacebook: string | null;
  mentions: MentionPrevue[];
  rdv: string | null;
  avertissements: string[];
}

function lienDuPost(post: Post): ApercuTunnel['lien'] {
  if (!post.linkId) return null;
  const link = db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get();
  if (!link) return null;
  const clics = db.select({ id: schema.clicks.id }).from(schema.clicks).where(and(eq(schema.clicks.linkId, link.id), eq(schema.clicks.bot, false))).all().length;
  return { shortUrl: `${config.PUBLIC_URL.replace(/\/+$/, '')}/r/${link.code}`, cible: targetWithUtm(link), clics };
}

/** Les noms qui seront identifiés à la publication, ceux qui resteront en clair, ceux qui ont disparu du texte. */
export function previsualiserMentions(post: Pick<Post, 'caption' | 'mentions' | 'platform'>): MentionPrevue[] {
  if (post.platform !== 'linkedin') return [];
  const out: MentionPrevue[] = [];
  for (const m of mentionsConnues()) {
    if (commentary(post.caption, [m]).includes(`](${m.urn})`)) out.push({ nom: m.nom, statut: 'identifiee' });
  }
  let declarees: { nom?: string }[] = [];
  try {
    declarees = post.mentions ? (JSON.parse(post.mentions) as { nom?: string }[]) : [];
  } catch {
    declarees = [];
  }
  for (const d of declarees) {
    const nom = d.nom?.trim();
    if (!nom || out.some((o) => o.nom.toLowerCase() === nom.toLowerCase())) continue;
    out.push({ nom, statut: post.caption.toLowerCase().includes(nom.toLowerCase()) ? 'en-clair' : 'absente' });
  }
  return out;
}

export function apercuTunnel(postId: number): ApercuTunnel | null {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) return null;
  const dm = getDmTriggers();
  const platform = post.platform as 'linkedin' | 'instagram';
  const motcle = post.commentTriggerKeyword;
  const lien = lienDuPost(post);
  const viaLien = platform === 'linkedin' && dm.linkedinOffer === 'diagnostic';
  const base = config.PUBLIC_URL.replace(/\/+$/, '');
  const urlRessource =
    post.resourceKind === 'guide' && post.resourceAssetId
      ? `${base}/guide/${post.resourceAssetId}`
      : (post.resourceUrl ?? lien?.cible ?? null);
  const avertissements: string[] = [];
  const contexte = contexteDuCommentaire(post.id, motcle, null);

  let document: ApercuTunnel['document'] = null;
  if (post.format === 'li_doc') {
    const pages = db.select({ id: schema.slides.id, renderAssetId: schema.slides.renderAssetId }).from(schema.slides).where(eq(schema.slides.postId, post.id)).all();
    if (pages.length > 0 && pages.every((p) => p.renderAssetId)) document = { pages: pages.length, url: `/api/posts/${post.id}/document.pdf` };
  }

  let amorce: string | null = null;
  let reponseLinkedIn: string | null = null;
  let reponseVariantes = 1;
  let reponseManuelle = false;
  if (platform === 'linkedin') {
    if (getAmplification().enabled && getAmplification().firstComment) amorce = texteAmorce(post);
    if (motcle) {
      const lienDansLePost = post.caption.includes('/r/');
      const variantes = dm.linkedinOffer === 'diagnostic' && lienDansLePost ? dm.diagnosticReplyVariants : dm.linkedinReplyVariants;
      const modele = choisirVariante(variantes, post.id) ?? dm.replyTemplate;
      reponseLinkedIn = dm.publicReply ? buildReply(modele, contexte) : null;
      reponseVariantes = Math.max(1, variantes.filter((v) => v.trim()).length);
      const compte = compteDuPost(post);
      reponseManuelle = !compte || !droitCommentaire(compte).peutLire;
      if (reponseManuelle) avertissements.push('LinkedIn ne laisse pas lire les commentaires de ce compte : la réponse ci-dessus est à coller soi-même sous chaque commentaire.');
      if (!dm.publicReply) avertissements.push('La réponse publique est désactivée dans les réglages : sur LinkedIn, personne ne répondra au mot-clé.');
      if (dm.linkedinOffer === 'diagnostic' && !dm.rdvUrl.trim()) avertissements.push('Aucun lien de rendez-vous réglé : la réponse renverra vers la page d’accueil du site.');
    }
  }

  let dmInstagram: ApercuTunnel['dmInstagram'] = null;
  let reponsePublique: string | null = null;
  let captionFacebook: string | null = null;
  if (platform === 'instagram') {
    if (motcle) {
      dmInstagram = dm.requireFollow
        ? { etape1: buildReply(dm.askFollowTemplate, contexte), etape2: buildReply(dm.thanksTemplate, contexte) }
        : { etape1: buildReply(dm.replyTemplate, contexte), etape2: null };
      // Porte fermée : la réponse publique ne dit pas « tout y est » (le lien n'est pas
      // encore parti) — elle renvoie vers le message privé, comme l'exécution.
      const modelePublic = dm.requireFollow ? REPONSE_PUBLIQUE_PORTE : choisirVariante(dm.publicReplyVariants, post.id);
      reponsePublique = dm.publicReply && modelePublic ? buildReply(modelePublic, contexte) : null;
      reponseVariantes = dm.requireFollow ? 1 : Math.max(1, dm.publicReplyVariants.filter((v) => v.trim()).length);
      if (dm.requireFollow) avertissements.push('Porte d’abonnement active : le premier message demande de s’abonner et de répondre ; le lien part au second message.');
    }
    if (getFbMirror().enabled || (post.broadcastGroup && getCadence().broadcast)) {
      captionFacebook = legendePourFacebook(post, post.externalUrl);
    }
  }

  const mentions = previsualiserMentions(post);
  if (platform === 'linkedin' && mentions.some((m) => m.statut === 'absente')) {
    avertissements.push(`Nom(s) déclaré(s) mais absent(s) du texte, donc non identifié(s) : ${mentions.filter((m) => m.statut === 'absente').map((m) => m.nom).join(', ')}.`);
  }

  return {
    postId: post.id,
    platform,
    motcle,
    lien,
    lienDansLePost: platform === 'linkedin' && /\/r\/[a-z2-9]{6,}/i.test(post.caption),
    ressource: {
      kind: post.resourceKind ?? 'article',
      titre: post.resourceTitle,
      url: urlRessource,
      erreur: post.resourceError,
      viaLien,
      libelle: nommerRessource(post),
    },
    document,
    amorce,
    reponseLinkedIn,
    reponseVariantes,
    reponseManuelle,
    dmInstagram,
    reponsePublique,
    captionFacebook,
    mentions,
    rdv: platform === 'linkedin' && motcle ? lienRdv() : null,
    avertissements,
  };
}
