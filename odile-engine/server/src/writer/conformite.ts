/**
 * Un post est-il conforme à sa plateforme et à son compte ?
 *
 * Ce contrôle dit, en phrases simples, ce qui empêcherait un post de tenir ses
 * promesses : sur LinkedIn le lien de la ressource doit être dans la description et
 * rien ne part en message privé ; sur Instagram aucune adresse, le mot-clé envoie la
 * ressource en privé ; le compte qui publie doit exister et fonctionner. Il sert
 * trois fois : à l'écran de validation (le fondateur voit avant d'approuver), au
 * moment d'approuver ou de programmer (un défaut bloquant est refusé), et au
 * réalignement des anciens posts (ce qui est corrigeable est corrigé).
 */
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getDmTriggers } from '../db/settingsRepo.js';
import { compteDuPost } from '../publishers/linkedinAccounts.js';
import { captionPorteLeMotCle } from './generate.js';
import { HASHTAGS_MAX } from '@odile/shared';

type Post = typeof schema.posts.$inferSelect;

export interface Probleme {
  code:
    | 'compte-en-panne'
    | 'compte-non-attribue'
    | 'lien-absent'
    | 'lien-placeholder'
    | 'dm-promis'
    | 'motcle-absent'
    | 'motcle-hors-liste'
    | 'url-instagram'
    | 'parle-de-linkedin'
    | 'trop-long'
    | 'hashtags'
    | 'tu-vous'
    | 'guide-manquant'
    | 'date-orpheline'
    | 'rdv-manquant'
    | 'copie-non-adaptee'
    | 'porte-abonnement'
    | 'motcle-manquant'
    | 'format-plateforme'
    | 'lien-mal-etiquete'
    | 'marque-absente';
  niveau: 'bloquant' | 'attention';
  message: string;
  /** le réalignement sait le corriger seul (sans réécriture par le modèle) */
  corrigeable: boolean;
  /** une réécriture par le modèle (« Réaligner ») sait le corriger */
  reecriture?: boolean;
}

/**
 * Une copie dont l'adaptation a échoué porte la raison dans `error` (voir
 * `adapterLegende`) : son texte est celui du parent, pas celui de sa plateforme.
 */
export function echecDAdaptation(error: string | null | undefined): boolean {
  return /^(texte non adapté|plafond IA du jour)/i.test(error ?? '');
}

/**
 * Ce qui promet un envoi en privé. « messagerie » seul n'en fait pas partie : c'est
 * le sujet le plus fréquent des posts (trier ses emails), pas une promesse.
 */
export const PROMESSE_DM = /message priv|en DM\b|en MP\b|(?:en|par) messagerie|je t[’']envoie|je vous envoie|re[çc]ois(?:-le)? en (?:DM|MP)\b/i;
const ADRESSE = /https?:\/\/|www\.|\{\{link\}\}/i;
/** La ligne qui porte le lien court du post. */
export const LIGNE_DU_LIEN = /\/r\/[a-z2-9]{6,}/i;
/** Une ligne de lien qui parle d'audit ou de diagnostic alors que le lien mène à la ressource. */
const ETIQUETTE_RDV = /\b(audit|diagnostic|rendez-vous|rdv|20 minutes)\b/i;

/** Le format natif d'une plateforme : LinkedIn feuillette un document, Instagram un carrousel. */
export function formatPourPlateforme(format: string, platform: 'instagram' | 'linkedin'): string {
  const table: Record<string, string> =
    platform === 'instagram' ? { li_doc: 'carousel', li_image: 'static' } : { carousel: 'li_doc', static: 'li_image' };
  return table[format] ?? format;
}
const RENVOI_LINKEDIN = /lien (dans|en) (la )?description|sur linkedin|sous ce post linkedin/i;

/** Les dernières lignes d'une légende : là où vit l'appel à l'action. */
function blocFinal(caption: string): string {
  return caption.trim().split('\n').slice(-4).join('\n');
}

export function verifierPost(post: Post): Probleme[] {
  const problemes: Probleme[] = [];
  const dm = getDmTriggers();
  const diagnostic = dm.linkedinOffer === 'diagnostic';
  const caption = post.caption ?? '';
  const motcle = post.commentTriggerKeyword;
  let hashtags: string[] = [];
  try {
    hashtags = JSON.parse(post.hashtags) as string[];
  } catch {
    hashtags = [];
  }

  if (caption.includes('{{link}}') || (post.cta ?? '').includes('{{link}}')) {
    problemes.push({ code: 'lien-placeholder', niveau: 'bloquant', corrigeable: true, message: 'Le marqueur {{link}} est resté dans le texte au lieu de l’adresse.' });
  }
  if (echecDAdaptation(post.error)) {
    problemes.push({
      code: 'copie-non-adaptee',
      niveau: 'bloquant',
      corrigeable: false,
      reecriture: true,
      message: `Le texte n’a pas été adapté à ce compte (${(post.error ?? '').replace(/ — texte d’origine conservé.*$/, '').slice(0, 140)}) : « Réaligner » le fait réécrire, ou corrige-le dans l’éditeur.`,
    });
  }

  if (post.platform === 'linkedin') {
    const compte = compteDuPost(post);
    if (!compte) {
      // En simulation (PUBLISH_MODE=dry) rien ne part vraiment : l'absence de compte n'y bloque pas.
      if (config.PUBLISH_MODE !== 'dry') {
        problemes.push({ code: 'compte-en-panne', niveau: 'bloquant', corrigeable: false, message: 'Aucun compte LinkedIn connecté pour ce canal.' });
      }
    } else {
      if (compte.enPanne) {
        problemes.push({ code: 'compte-en-panne', niveau: 'bloquant', corrigeable: false, message: `${compte.name} ne peut pas publier : ${compte.panne}.` });
      }
      if (!post.liAccountKey) {
        problemes.push({ code: 'compte-non-attribue', niveau: 'attention', corrigeable: true, message: `Aucun compte choisi : le post partirait sur ${compte.name}.` });
      }
    }
    const lienDansLeTexte = caption.includes(`${config.PUBLIC_URL.replace(/\/+$/, '')}/r/`) || /\/r\/[a-z2-9]{6,}/i.test(caption);
    if (post.linkId && diagnostic && !lienDansLeTexte) {
      problemes.push({ code: 'lien-absent', niveau: 'bloquant', corrigeable: true, message: 'Le lien de la ressource n’est pas dans la description : la personne n’a rien à ouvrir, et les réponses automatiques diraient qu’il y est.' });
    }
    // Sans mot à commenter, le post n'ouvre aucune conversation : c'est le tunnel
    // qui manque, pas une faute — « Réaligner » ajoute l'appel à commenter.
    if (!motcle && diagnostic && dm.diagnosticKeywords.length > 0 && ['awaiting_approval', 'draft', 'reviewing', 'scheduled'].includes(post.status)) {
      problemes.push({ code: 'motcle-manquant', niveau: 'attention', corrigeable: true, message: 'Aucun mot à commenter : ce post n’ouvre pas de conversation. « Réaligner » ajoute l’appel à commenter (diagnostic).' });
    }
    // La ligne du lien dit « audit » ou « diagnostic » alors que le lien mène à la ressource.
    const ligneLien = caption.split('\n').find((l) => LIGNE_DU_LIEN.test(l));
    if (ligneLien && diagnostic && ETIQUETTE_RDV.test(ligneLien)) {
      problemes.push({ code: 'lien-mal-etiquete', niveau: 'attention', corrigeable: true, message: `La ligne du lien parle de rendez-vous ou de diagnostic alors qu’elle mène à ${post.resourceKind === 'guide' ? 'un guide' : post.resourceKind === 'outil' ? 'un outil' : 'un article'} : c’est le mot-clé qui ouvre le diagnostic. « Réaligner » réécrit cette ligne.` });
    }
    // La page entreprise est la seule identification (@) que le moteur sait faire à
    // coup sûr : un post de profil qui ne la nomme pas n'y renvoie personne.
    const marque = getBrand().name.trim();
    if (marque && !caption.toLowerCase().includes(marque.toLowerCase())) {
      problemes.push({ code: 'marque-absente', niveau: 'attention', corrigeable: false, message: `« ${marque} » n’est pas nommée dans le texte : la page ne sera pas identifiée (@) et personne n’y est renvoyé.` });
    }
    if (PROMESSE_DM.test(blocFinal(caption)) || PROMESSE_DM.test(post.cta ?? '')) {
      problemes.push({ code: 'dm-promis', niveau: 'bloquant', corrigeable: false, reecriture: true, message: 'Le texte promet un envoi en message privé : impossible sur LinkedIn (le lien est dans le post, le mot-clé ouvre le diagnostic).' });
    }
    if (motcle && diagnostic && !dm.diagnosticKeywords.map((k) => k.toUpperCase()).includes(motcle.toUpperCase())) {
      problemes.push({ code: 'motcle-hors-liste', niveau: 'attention', corrigeable: true, message: `Le mot « ${motcle} » n’est pas un mot de diagnostic (${dm.diagnosticKeywords.join(', ')}) : « Réaligner » le remplace dans le texte et sur la slide.` });
    }
    if (caption.length > 3000) problemes.push({ code: 'trop-long', niveau: 'bloquant', corrigeable: false, message: `Texte de ${caption.length} caractères : LinkedIn en accepte 3 000.` });
    else if (caption.length > 1500) problemes.push({ code: 'trop-long', niveau: 'attention', corrigeable: false, message: `Texte long (${caption.length} caractères) : sur LinkedIn, au-delà de 1 200 le post est moins lu.` });
    if (hashtags.length > HASHTAGS_MAX.linkedin) problemes.push({ code: 'hashtags', niveau: 'attention', corrigeable: true, message: `${hashtags.length} hashtags : LinkedIn n’en tient compte que de ${HASHTAGS_MAX.linkedin}.` });
    if (diagnostic && motcle && !dm.rdvUrl.trim()) {
      problemes.push({ code: 'rdv-manquant', niveau: 'attention', corrigeable: false, message: 'Aucun lien de rendez-vous réglé : la réponse au mot-clé renverra vers la page d’accueil du site (Réglages → Commentaire → DM).' });
    }
  }

  if (post.platform === 'instagram') {
    if (ADRESSE.test(caption) || ADRESSE.test(post.cta ?? '')) {
      problemes.push({ code: 'url-instagram', niveau: 'bloquant', corrigeable: true, message: 'Une adresse figure dans la légende : sur Instagram elle n’est pas cliquable, et la ressource part en message privé.' });
    }
    if (RENVOI_LINKEDIN.test(blocFinal(caption))) {
      problemes.push({ code: 'parle-de-linkedin', niveau: 'attention', corrigeable: false, message: 'L’appel à l’action parle d’un lien en description ou de LinkedIn : sur Instagram, c’est le mot-clé qui envoie la ressource.' });
    }
    if (caption.length > 2200) problemes.push({ code: 'trop-long', niveau: 'bloquant', corrigeable: false, message: `Légende de ${caption.length} caractères : Instagram en accepte 2 200.` });
    if (dm.requireFollow && motcle && PROMESSE_DM.test(blocFinal(caption)) && !/abonn/i.test(caption)) {
      problemes.push({ code: 'porte-abonnement', niveau: 'attention', corrigeable: false, message: 'La porte d’abonnement est active (Réglages → Commentaire → DM) : le premier message demandera de s’abonner avant d’envoyer, alors que le texte promet un envoi direct. Dis-le dans la légende (« abonne-toi et commente… ») ou désactive la porte.' });
    }
    if (hashtags.length > HASHTAGS_MAX.instagram) problemes.push({ code: 'hashtags', niveau: 'attention', corrigeable: true, message: `${hashtags.length} hashtags : au-delà de ${HASHTAGS_MAX.instagram}, Instagram n’en tient plus compte.` });
  }

  if ((post.platform === 'linkedin' || post.platform === 'instagram') && formatPourPlateforme(post.format, post.platform) !== post.format) {
    problemes.push({ code: 'format-plateforme', niveau: 'attention', corrigeable: true, message: post.platform === 'linkedin' ? 'Format d’Instagram sur LinkedIn : plusieurs slides y sont un document PDF à feuilleter, une seule une image. « Réaligner » convertit le format.' : 'Format LinkedIn sur Instagram : « Réaligner » le convertit en carrousel ou image.' });
  }
  if (motcle && !captionPorteLeMotCle(caption, motcle)) {
    problemes.push({ code: 'motcle-absent', niveau: 'bloquant', corrigeable: true, message: `Le texte ne demande pas « Commente ${motcle} » : personne ne saura quoi commenter.` });
  }
  if (/(?<!rendez-)\bvous\b/i.test(caption) && /\b(tu|t[’']|tes|ton|ta)\b/i.test(caption)) {
    problemes.push({ code: 'tu-vous', niveau: 'attention', corrigeable: false, message: 'Tutoiement et vouvoiement se mélangent dans le texte.' });
  }
  if (post.resourceKind === 'guide' && !post.resourceAssetId && !post.resourceUrl) {
    problemes.push({ code: 'guide-manquant', niveau: 'bloquant', corrigeable: false, message: `Le guide promis n’existe pas${post.resourceError ? ` (${post.resourceError.slice(0, 120)})` : ''} : relance la fabrication ou change la promesse.` });
  } else if (post.resourceError && post.resourceKind !== 'guide' && /\bguide\b|checklist|\bkit\b|\bmod[èe]le\b/i.test(`${caption}\n${post.cta ?? ''}`)) {
    // La fabrication du guide a échoué et le secours (l'article source) a pris sa
    // place : le texte, lui, promet toujours un guide.
    problemes.push({ code: 'guide-manquant', niveau: 'bloquant', corrigeable: false, message: `Le guide promis n’a pas pu être fabriqué (${post.resourceError.slice(0, 120)}) : la personne recevrait l’article source à la place. Relance la fabrication ou change la promesse.` });
  }
  if (post.scheduledAt && !['scheduled', 'publishing', 'published'].includes(post.status)) {
    problemes.push({ code: 'date-orpheline', niveau: 'attention', corrigeable: true, message: 'Une date de publication traîne sur un post qui n’est pas programmé.' });
  }
  return problemes;
}

export function bloquants(problemes: Probleme[]): Probleme[] {
  return problemes.filter((p) => p.niveau === 'bloquant');
}

/** Une phrase pour refuser une action, à partir des défauts bloquants. */
export function motifDeRefus(problemes: Probleme[]): string | null {
  const b = bloquants(problemes);
  if (b.length === 0) return null;
  return `Ce post ne peut pas partir en l’état : ${b.map((p) => p.message).join(' ')} Clique « Réaligner » ou corrige-le dans l’éditeur.`;
}

/** Tous les posts encore modifiables, avec leurs défauts (pour l'écran de validation et le réalignement). */
export function postsAVerifier(): Post[] {
  return db
    .select()
    .from(schema.posts)
    .all()
    .filter((p) => ['draft', 'reviewing', 'awaiting_approval', 'scheduled', 'rejected', 'failed'].includes(p.status));
}
