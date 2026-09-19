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
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getDmTriggers } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { compteDuPost } from '../publishers/linkedinAccounts.js';
import { renderPost } from '../render/renderer.js';
import { nommerRessource } from '../webhooks/commentDm.js';
import { bloquants, postsAVerifier, verifierPost, type Probleme } from '../writer/conformite.js';
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

/** Corrections sans modèle : sûres, idempotentes, applicables au démarrage. */
export function realignerSansModele(post: Post): { corrections: string[]; post: Post } {
  const corrections: string[] = [];
  const update: Partial<Post> = {};
  let caption = post.caption;
  let cta = post.cta;

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
  if (JSON.stringify(bornes) !== post.hashtags) {
    update.hashtags = JSON.stringify(bornes);
    if (bornes.length !== hashtags.length) corrections.push(`hashtags ramenés à ${bornes.length}`);
  }
  if (post.platform === 'instagram') {
    const propre = sansLien(caption);
    const ctaPropre = sansLien(cta);
    if (propre !== caption || ctaPropre !== cta) {
      caption = propre;
      cta = ctaPropre;
      corrections.push('adresse retirée de la légende Instagram');
    }
  }
  if (post.platform === 'linkedin' && post.linkId) {
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
    }
  }
  // Le mot-clé promis doit être demandé quelque part : sinon la ligne vient du CTA validé.
  const motcle = post.commentTriggerKeyword;
  if (motcle && !new RegExp(`commente\\s+${motcle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(caption)) {
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
  if (post.platform !== 'linkedin') return { reecrit: false, corrections: [] };
  const compte = compteDuPost(post);
  const motcle = motcleDeSurface({ id: post.id, platform: 'instagram', commentTriggerKeyword: post.commentTriggerKeyword ?? 'CAS' }, 'linkedin');
  const texte = await adapterLegende(post, 'linkedin', 'linkedin', compte, motcle);
  if (texte.echec) return { reecrit: false, corrections: [] };
  const lien = post.linkId ? db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get() : null;
  const url = lien ? `${config.PUBLIC_URL.replace(/\/+$/, '')}/r/${lien.code}` : '';
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
    corrections: [`fin du post réécrite pour ${compte?.name ?? 'LinkedIn'} (mot-clé ${texte.motcle ?? 'aucun'})${etaitProgramme ? ' — déprogrammé, à revalider' : ''}`],
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
  if (opts.modele && encore.some((p) => p.code === 'dm-promis' || p.code === 'motcle-hors-liste')) {
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

/** Au démarrage : les corrections sûres seulement, en silence, pour que le calendrier dise vrai. */
export function reparerAuDemarrage(): void {
  let n = 0;
  for (const post of postsAVerifier()) {
    try {
      if (realignerSansModele(post).corrections.length > 0) n++;
    } catch (err) {
      logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'réparation au démarrage en échec');
    }
  }
  if (n > 0) logger.info({ posts: n }, 'posts réalignés au démarrage (compte, lien, adresses, hashtags, dates)');
}
