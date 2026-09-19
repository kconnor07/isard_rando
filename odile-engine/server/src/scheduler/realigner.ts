/**
 * Réaligner les posts avec la stratégie du moment.
 *
 * Les posts écrits avant un changement de règle (lien dans la description LinkedIn,
 * mot-clé qui ouvre le diagnostic, aucune adresse sur Instagram, hashtags bornés,
 * comptes multiples) restaient en attente avec leurs anciennes promesses. Ce module
 * corrige seul ce qui se corrige sans réécrire (lien reposé, adresse retirée,
 * hashtags coupés, compte attribué, date orpheline effacée), et, sur demande, fait
 * réécrire par le modèle la fin des posts LinkedIn qui promettent encore un message
 * privé — puis les remet à valider, parce qu'un texte réécrit se relit.
 */
import { and, asc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getDmTriggers } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { compteDuPost } from '../publishers/linkedinAccounts.js';
import { renderPost } from '../render/renderer.js';
import { nommerRessource } from '../webhooks/commentDm.js';
import { bloquants, echecDAdaptation, formatPourPlateforme, LIGNE_DU_LIEN, postsAVerifier, verifierPost, type Probleme } from '../writer/conformite.js';
import { bornerHashtags, relierLeLien, sansLien } from '../writer/generate.js';
import { adapterLegende, motcleDeSurface } from './broadcast.js';

type Post = typeof schema.posts.$inferSelect;

export interface Realignement {
  postId: number;
  corrections: string[];
  restants: Probleme[];
  /** le post a été réécrit par le modèle et remis à valider */
  reecrit: boolean;
}

/** Une adresse qu'Instagram ne montrera pas : c'est elle, et elle seule, qui justifie de toucher la légende. */
const ADRESSE = /https?:\/\/|www\.|\{\{link\}\}|[a-z0-9-]+\.[a-z]{2,}\/\S/i;

export interface OptionsDeRealignement {
  /** couper les hashtags en trop (cosmétique : évité sur un post déjà validé) */
  hashtags?: boolean;
  /** ajouter un appel à commenter à un post LinkedIn qui n'en a pas (un texte validé ne s'allonge pas en silence) */
  motcle?: boolean;
  /**
   * toucher au texte (lien reposé, adresse retirée, mot-clé remplacé, appel ajouté).
   * À false, seuls le compte, le format et la date sont corrigés : un post déjà
   * validé ne change pas de texte sans que le fondateur l'ait demandé.
   */
  texte?: boolean;
}

/** Corrections sans modèle : sûres, idempotentes, applicables au démarrage. */
export function realignerSansModele(post: Post, opts: OptionsDeRealignement = {}): { corrections: string[]; post: Post } {
  const { hashtags: couperHashtags = true, motcle: ajouterMotcle = true, texte: toucherAuTexte = true } = opts;
  const corrections: string[] = [];
  const update: Partial<Post> = {};
  let caption = post.caption;
  let cta = post.cta;

  // Un document LinkedIn ne se publie pas comme carrousel Instagram, ni l'inverse :
  // le format suit la plateforme (les slides restent, seul l'emballage change).
  if (post.platform === 'linkedin' || post.platform === 'instagram') {
    const natif = formatPourPlateforme(post.format, post.platform);
    if (natif !== post.format) {
      update.format = natif as Post['format'];
      corrections.push(`format ${post.format} converti en ${natif}`);
    }
  }

  if (post.platform === 'linkedin' && !post.liAccountKey) {
    const compte = compteDuPost(post);
    if (compte) {
      update.liAccountKey = compte.key;
      corrections.push(`compte attribué : ${compte.name}`);
    }
  }
  if (post.scheduledAt && !['scheduled', 'publishing', 'published'].includes(post.status)) {
    update.scheduledAt = null;
    corrections.push('date orpheline effacée');
  }
  let hashtags: string[] = [];
  try {
    hashtags = JSON.parse(post.hashtags) as string[];
  } catch {
    hashtags = [];
  }
  const bornes = bornerHashtags(hashtags, post.platform as 'linkedin' | 'instagram');
  if (couperHashtags && JSON.stringify(bornes) !== post.hashtags) {
    update.hashtags = JSON.stringify(bornes);
    if (bornes.length !== hashtags.length) corrections.push(`hashtags ramenés à ${bornes.length}`);
  }
  // Seule une vraie adresse justifie de réécrire la légende : sans ce garde-fou, le
  // simple nettoyage des espaces comptait comme une « adresse retirée » sur des
  // posts qui n'en avaient jamais eu.
  if (toucherAuTexte && post.platform === 'instagram' && (ADRESSE.test(caption) || ADRESSE.test(cta))) {
    const propre = sansLien(caption);
    const ctaPropre = sansLien(cta);
    if (propre !== caption || ctaPropre !== cta) {
      caption = propre;
      cta = ctaPropre;
      corrections.push('adresse retirée de la légende Instagram');
    }
  }
  if (toucherAuTexte && post.platform === 'linkedin' && post.linkId) {
    const lien = db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get();
    if (lien) {
      const url = `${config.PUBLIC_URL.replace(/\/+$/, '')}/r/${lien.code}`;
      if (caption.includes('{{link}}') || cta.includes('{{link}}')) {
        caption = caption.replaceAll('{{link}}', url);
        cta = cta.replaceAll('{{link}}', url);
        corrections.push('marqueur {{link}} remplacé par l’adresse');
      }
      if (getDmTriggers().linkedinOffer === 'diagnostic' && !/\/r\/[a-z2-9]{6,}/i.test(caption)) {
        caption = relierLeLien(post, caption);
        corrections.push('lien de la ressource reposé dans la description');
      }
      // « Pour un audit : <lien> » alors que le lien mène à l'article : la ligne
      // redevient une simple invitation à ouvrir, le mot-clé garde le diagnostic.
      if (getDmTriggers().linkedinOffer === 'diagnostic') {
        const lignes = caption.split('\n');
        const i = lignes.findIndex((l) => LIGNE_DU_LIEN.test(l) && /\b(audit|diagnostic|rendez-vous|rdv|20 minutes)\b/i.test(l));
        if (i !== -1) {
          lignes[i] = `C’est ici : ${url}`;
          caption = lignes.join('\n');
          corrections.push('ligne du lien réécrite (elle parlait d’audit ou de diagnostic)');
        }
      }
    }
  }
  // Un post LinkedIn sans mot à commenter n'ouvre aucune conversation : on lui donne
  // le mot de diagnostic et l'appel qui va avec, quand on a le droit de l'allonger.
  if (toucherAuTexte && post.platform === 'linkedin' && !post.commentTriggerKeyword && ajouterMotcle) {
    const dm = getDmTriggers();
    const liste = dm.diagnosticKeywords.map((k) => k.toUpperCase());
    if (dm.linkedinOffer === 'diagnostic' && liste.length > 0) {
      update.commentTriggerKeyword = liste[post.id % liste.length]!;
      db.update(schema.slides).set({ renderAssetId: null }).where(and(eq(schema.slides.postId, post.id), eq(schema.slides.kind, 'cta'))).run();
      corrections.push(`mot-clé ${update.commentTriggerKeyword} attribué (aucun appel à commenter)`);
    }
  }
  // Sur LinkedIn, le mot commenté ouvre le diagnostic : un mot hors liste (GUIDE,
  // OUTIL…) est remplacé tel quel dans le texte, sans réécriture — et la slide qui
  // l'imprime sera refaite avant de partir.
  let motcle = update.commentTriggerKeyword ?? post.commentTriggerKeyword;
  if (toucherAuTexte && post.platform === 'linkedin' && motcle) {
    const dm = getDmTriggers();
    const liste = dm.diagnosticKeywords.map((k) => k.toUpperCase());
    if (dm.linkedinOffer === 'diagnostic' && liste.length > 0 && !liste.includes(motcle.toUpperCase())) {
      const nouveau = liste[post.id % liste.length]!;
      const ancien = new RegExp(`\\b${motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      caption = caption.replace(ancien, nouveau);
      cta = cta.replace(ancien, nouveau);
      update.commentTriggerKeyword = nouveau;
      db.update(schema.slides).set({ renderAssetId: null }).where(and(eq(schema.slides.postId, post.id), eq(schema.slides.kind, 'cta'))).run();
      corrections.push(`mot-clé ${motcle} remplacé par ${nouveau} (mot de diagnostic)`);
      motcle = nouveau;
    }
  }
  // Le mot-clé promis doit être demandé quelque part : sinon la ligne vient du CTA validé.
  if (toucherAuTexte && motcle && !new RegExp(`commente\\s+${motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(caption)) {
    const dm = getDmTriggers();
    const ligne = new RegExp(`commente\\s+${motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(cta)
      ? cta.trim()
      : post.platform === 'linkedin' && dm.linkedinOffer === 'diagnostic'
        ? `Commente ${motcle} si vous voulez ${dm.diagnosticPromise}.`
        : `Commente ${motcle} : je t’envoie ${nommerRessource(post)} en message privé.`;
    caption = `${caption.trim()}\n\n${post.platform === 'instagram' ? sansLien(ligne) : ligne}`;
    corrections.push(`appel à commenter « ${motcle} » ajouté`);
  }
  if (caption !== post.caption) update.caption = caption;
  if (cta !== post.cta) update.cta = cta;
  if (Object.keys(update).length > 0) {
    db.update(schema.posts).set({ ...update, updatedAt: new Date().toISOString() }).where(eq(schema.posts.id, post.id)).run();
  }
  return { corrections, post: { ...post, ...update } };
}

/**
 * Réécriture par le modèle de la fin d'un post LinkedIn qui promet encore un message
 * privé : même sujet, voix du compte, lien reposé, mot de diagnostic. Le post revient
 * à valider — un texte réécrit se relit avant de partir.
 */
export async function reecrireAvecLeModele(post: Post): Promise<{ reecrit: boolean; corrections: string[] }> {
  const vers = post.platform as 'linkedin' | 'instagram';
  if (vers !== 'linkedin' && vers !== 'instagram') return { reecrit: false, corrections: [] };
  // Une copie dont l'adaptation a échoué porte encore le texte de l'original : on
  // repart de sa plateforme à lui. Sans groupe, le post se réécrit pour lui-même.
  const original = post.broadcastGroup
    ? db.select().from(schema.posts).where(eq(schema.posts.broadcastGroup, post.broadcastGroup)).orderBy(asc(schema.posts.id)).get()
    : null;
  const de = (original && original.id !== post.id ? original.platform : vers) as 'linkedin' | 'instagram';
  const compte = vers === 'linkedin' ? compteDuPost(post) : null;
  // Le mot-clé se choisit dans la liste de la plateforme d'arrivée (diagnostic sur
  // LinkedIn, envoi privé sur Instagram) : on présente le post comme venant d'ailleurs.
  const motcle = motcleDeSurface(
    { id: post.id, platform: vers === 'linkedin' ? 'instagram' : 'linkedin', commentTriggerKeyword: post.commentTriggerKeyword ?? (vers === 'linkedin' ? 'CAS' : null) },
    vers,
  );
  const texte = await adapterLegende(post, de, vers, compte, motcle);
  if (texte.echec) return { reecrit: false, corrections: [`réécriture impossible : ${texte.echec}`] };
  const lien = post.linkId ? db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get() : null;
  const url = lien ? `${config.PUBLIC_URL.replace(/\/+$/, '')}/r/${lien.code}` : '';
  // Le modèle a rendu le même texte : rien à remplacer, et surtout rien à déprogrammer.
  // (Une copie « non adaptée » compte quand même comme adaptée : l'adaptation a eu lieu.)
  const identique = texte.caption.replaceAll('{{link}}', url) === post.caption && texte.cta.replaceAll('{{link}}', url) === post.cta && texte.motcle === post.commentTriggerKeyword;
  if (identique && !echecDAdaptation(post.error)) return { reecrit: false, corrections: ['le modèle n’a rien changé au texte'] };
  const now = new Date().toISOString();
  const etaitProgramme = post.status === 'scheduled';
  db.update(schema.posts)
    .set({
      caption: texte.caption.replaceAll('{{link}}', url),
      cta: texte.cta.replaceAll('{{link}}', url),
      commentTriggerKeyword: texte.motcle,
      status: etaitProgramme || post.status === 'rejected' || post.status === 'failed' ? 'awaiting_approval' : post.status,
      scheduledAt: etaitProgramme ? null : post.scheduledAt,
      approvedAt: etaitProgramme ? null : post.approvedAt,
      error: null,
      updatedAt: now,
    })
    .where(eq(schema.posts.id, post.id))
    .run();
  if (etaitProgramme) {
    db.update(schema.publishJobs)
      .set({ state: 'canceled', finishedAt: now })
      .where(and(eq(schema.publishJobs.postId, post.id), eq(schema.publishJobs.state, 'pending')))
      .run();
  }
  // La slide d'appel à l'action imprime le mot-clé : elle se refait si le mot a changé.
  if (texte.motcle !== post.commentTriggerKeyword) {
    db.update(schema.slides).set({ renderAssetId: null }).where(and(eq(schema.slides.postId, post.id), eq(schema.slides.kind, 'cta'))).run();
    renderPost(post.id).catch((err) => logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'rendu de la slide CTA après réalignement en échec'));
  }
  return {
    reecrit: true,
    corrections: [`texte réécrit pour ${compte?.name ?? (vers === 'instagram' ? 'Instagram' : 'LinkedIn')} (mot-clé ${texte.motcle ?? 'aucun'})${etaitProgramme ? ' — déprogrammé, à revalider' : ''}`],
  };
}

/** Réaligne un post : corrections sûres, puis réécriture si demandée et encore nécessaire. */
export async function realignerPost(postId: number, opts: { modele?: boolean } = {}): Promise<Realignement> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const sur = realignerSansModele(post);
  let corrections = sur.corrections;
  let reecrit = false;
  let courant = sur.post;
  const encore = verifierPost(courant);
  // Seul un défaut bloquant justifie de faire réécrire (et déprogrammer) un post.
  if (opts.modele && encore.some((p) => p.reecriture && p.niveau === 'bloquant')) {
    const r = await reecrireAvecLeModele(courant);
    reecrit = r.reecrit;
    corrections = [...corrections, ...r.corrections];
    courant = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get() ?? courant;
  }
  return { postId, corrections, restants: verifierPost(courant), reecrit };
}

/** Réaligne tous les posts encore modifiables. */
export async function realignerTout(opts: { modele?: boolean } = {}): Promise<{ posts: number; corriges: number; reecrits: number; bloquants: number; details: Realignement[] }> {
  const details: Realignement[] = [];
  for (const post of postsAVerifier()) {
    try {
      details.push(await realignerPost(post.id, opts));
    } catch (err) {
      logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'réalignement en échec');
    }
  }
  return {
    posts: details.length,
    corriges: details.filter((d) => d.corrections.length > 0).length,
    reecrits: details.filter((d) => d.reecrit).length,
    bloquants: details.filter((d) => bloquants(d.restants).length > 0).length,
    details,
  };
}

/**
 * Au démarrage : les corrections sûres seulement, pour que le calendrier dise vrai.
 * Un post déjà programmé ne change pas de texte : il ne reçoit que son compte, son
 * format et sa date. Ce qui lui manque encore reste visible (⛔ au calendrier,
 * compteur « Réaligner … dont N programmés ») et, s'il part sans avoir été corrigé,
 * le worker le refuse et le remet à valider. Le texte validé ne bouge que sur un
 * geste du fondateur.
 */
export function reparerAuDemarrage(): void {
  let n = 0;
  for (const post of postsAVerifier()) {
    try {
      const programme = post.status === 'scheduled';
      const { corrections } = realignerSansModele(post, { hashtags: !programme, motcle: !programme, texte: !programme });
      if (corrections.length > 0) {
        n++;
        logger.info({ postId: post.id, status: post.status, corrections }, programme ? 'post programmé réparé au démarrage' : 'post réparé au démarrage');
      }
    } catch (err) {
      logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'réparation au démarrage en échec');
    }
  }
  if (n > 0) logger.info({ posts: n }, 'posts réalignés au démarrage (compte, lien, adresses, hashtags, dates)');
}
