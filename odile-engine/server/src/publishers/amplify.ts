/**
 * Amplification : ce qui se passe SOUS un post LinkedIn une fois qu'il est en ligne.
 *
 * Deux gestes que font à la main toutes les équipes qui percent sur LinkedIn, et
 * que le moteur fait désormais seul :
 *
 * 1. Le COMMENTAIRE D'AMORCE, posté par le compte auteur juste après la publication.
 *    Il rappelle le mot-clé à commenter, et rien d'autre : AUCUN lien. Le lien, un
 *    seul, vit désormais dans la description du post. Il ne donne jamais la ressource
 *    promise : celle-ci reste au bout du commentaire, sinon le tunnel n'a plus de
 *    raison d'exister.
 * 2. Les COMMENTAIRES DE L'ÉQUIPE, une demi-heure plus tard : les autres comptes
 *    connectés commentent le post de leur collègue. Un commentaire précoce pèse
 *    beaucoup plus qu'un like dans le classement LinkedIn, et ouvre le post aux
 *    réseaux des collègues — c'est la différence entre trois comptes qui publient
 *    chacun dans leur coin et une équipe qui pousse le même sujet.
 *
 * Chaque compte ne commente qu'une fois par post (`posts.amplifiedBy`), et rien ne
 * se passe au-delà de 48 h : un post d'avant-hier ne se réanime pas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, gte } from 'drizzle-orm';
import type { AmplificationSettings } from '@odile/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getAmplification, getBrand, getDmTriggers } from '../db/settingsRepo.js';
import { verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { nommerRessource } from '../webhooks/commentDm.js';
import { commenterPostLinkedIn } from '../webhooks/linkedinPoller.js';
import {
  compteDuPost,
  droitCommentaire,
  jetonDuCompte,
  toutesLesSurfaces,
  type CompteLinkedIn,
} from './linkedinAccounts.js';

type Post = typeof schema.posts.$inferSelect;

/** Marque réservée au commentaire d'amorce dans `posts.amplifiedBy`. */
const AMORCE = 'source';

export interface Amplificateur {
  compte: CompteLinkedIn;
  /** « amorce » = le compte auteur qui pose la source ; « equipe » = un collègue. */
  role: 'amorce' | 'equipe';
}

export interface ResumeAmplification {
  candidats: number;
  commentaires: number;
  echecs: number;
}

/** Les comptes déjà passés sous un post (« source » pour l'amorce). */
export function dejaPasses(post: Pick<Post, 'amplifiedBy'>): string[] {
  if (!post.amplifiedBy) return [];
  try {
    const brut = JSON.parse(post.amplifiedBy) as unknown;
    return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Qui doit commenter ce post, maintenant.
 *
 * Fonction pure : elle ne regarde ni la base ni l'heure système, tout lui est donné.
 * Les collègues sont espacés (`spacingMinutes`) pour ne pas arriver tous à la même
 * seconde — trois commentaires simultanés se lisent comme un automatisme.
 */
export function amplificateursDus(args: {
  publishedAt: string;
  dejaFaits: string[];
  auteur: CompteLinkedIn | null;
  equipe: CompteLinkedIn[];
  reglages: AmplificationSettings;
  now: Date;
}): Amplificateur[] {
  const { publishedAt, dejaFaits, auteur, equipe, reglages, now } = args;
  const publie = new Date(publishedAt).getTime();
  if (Number.isNaN(publie)) return [];
  const ecouleMin = (now.getTime() - publie) / 60000;
  const dus: Amplificateur[] = [];

  if (reglages.firstComment && auteur && !dejaFaits.includes(AMORCE) && ecouleMin >= reglages.firstCommentDelayMinutes) {
    dus.push({ compte: auteur, role: 'amorce' });
  }
  if (reglages.crossComment) {
    // La liste est coupée AVANT de retirer ceux qui sont passés : les mêmes comptes
    // restent désignés d'un passage à l'autre, même si l'un d'eux échoue.
    const collegues = equipe.filter((c) => c.key !== auteur?.key).slice(0, reglages.maxAccounts);
    collegues.forEach((compte, rang) => {
      if (dejaFaits.includes(compte.key)) return;
      if (ecouleMin < reglages.delayMinutes + rang * reglages.spacingMinutes) return;
      dus.push({ compte, role: 'equipe' });
    });
  }
  return dus;
}

/**
 * Le commentaire d'amorce : le rappel du mot-clé, sans aucun lien.
 *
 * Le lien vit dans la description du post — le répéter ici ne servirait qu'à
 * disperser les clics sur deux adresses. Sans mot-clé à rappeler, l'amorce n'a rien
 * à dire : on ne poste rien plutôt qu'un commentaire creux sous son propre post.
 */
export function texteAmorce(
  post: Pick<Post, 'commentTriggerKeyword' | 'resourceKind' | 'resourceTitle'> & { caption?: string | null },
): string | null {
  if (!post.commentTriggerKeyword) return null;
  const dm = getDmTriggers();
  if (dm.linkedinOffer !== 'diagnostic') {
    return `Pour recevoir ${nommerRessource(post)} : commente ${post.commentTriggerKeyword} ici, je te l'envoie en réponse.`;
  }
  // Le lien est dans la description : l'amorce ne le répète pas, elle ouvre la suite.
  // Sauf si la description ne le porte pas (post d'avant la stratégie) : on ne dit
  // pas « servez-vous » d'un lien qui n'existe pas.
  const ressource = nommerRessource(post);
  const lienDansLePost = typeof post.caption !== 'string' || post.caption.includes('/r/');
  if (!lienDansLePost) return `Si vous voulez ${dm.diagnosticPromise} : commente ${post.commentTriggerKeyword} ici.`;
  return `${ressource.charAt(0).toUpperCase()}${ressource.slice(1)} est en lien dans la description — servez-vous.\n\nEt si vous voulez ${dm.diagnosticPromise} : commente ${post.commentTriggerKeyword} ici.`;
}

const commentaireSchema = z.object({ texte: z.string().min(20).max(600) });

/**
 * Le commentaire d'un collègue, écrit à sa voix.
 *
 * Un « super post 👏 » ne trompe personne et abîme la marque : le commentaire doit
 * apporter quelque chose. Sans modèle disponible (mode mock hors test, budget
 * atteint), on ne commente pas — mieux vaut rien qu'un automatisme visible.
 */
async function texteDeCollegue(post: Post, compte: CompteLinkedIn): Promise<string | null> {
  if (!verifierBudget('writing').autorise) return null;
  const voix =
    compte.subject === 'li_org'
      ? `la page entreprise ${compte.name} (« nous », voix de l'agence)`
      : `${compte.name}${compte.role ? `, ${compte.role}` : ''} (« je », voix personnelle)`;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        label: 'post:amplification',
        prompt: `Tu écris un commentaire LinkedIn sous le post d'un collègue de la même équipe (${getBrand().name}).

QUI COMMENTE : ${voix}

LE POST :
"""
${post.caption.slice(0, 1200)}
"""

RÈGLES :
- 1 à 2 phrases, entre 150 et 320 caractères. Français, ton parlé, phrases courtes.
- APPORTE quelque chose : un angle complémentaire, un chiffre ou un cas vu sur le terrain,
  une nuance, ou une question ouverte qui appelle une réponse.
- INTERDIT : « super post », « très intéressant », « merci du partage », « bien vu », toute
  formule qui pourrait être collée sous n'importe quel post.
- Aucun lien, aucun hashtag, aucune émoji. Ne répète ni l'appel à l'action ni le mot-clé :
  c'est le rôle de l'auteur, pas le tien.

Réponds en JSON : {"texte": "..."}`,
        maxTokens: 400,
      },
      commentaireSchema,
    );
    return value.texte.trim();
  } catch (err) {
    logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'commentaire d’amplification non rédigé');
    return null;
  }
}

/** Consigne le passage d'un compte sous un post. */
function marquerPasse(post: Post, cle: string, now: Date): void {
  const faits = [...new Set([...dejaPasses(post), cle])];
  db.update(schema.posts)
    .set({ amplifiedBy: JSON.stringify(faits), amplifiedAt: now.toISOString() })
    .where(eq(schema.posts.id, post.id))
    .run();
  post.amplifiedBy = JSON.stringify(faits);
}

/** En mode « dry », le commentaire est écrit dans outbox/ au lieu de partir chez LinkedIn. */
function commentaireDry(post: Post, compte: CompteLinkedIn, role: string, texte: string): void {
  const fichier = path.join(config.outboxDir, `amplify-${post.id}-${compte.key}-${Date.now()}.json`);
  fs.mkdirSync(config.outboxDir, { recursive: true });
  fs.writeFileSync(
    fichier,
    JSON.stringify({ publisher: 'linkedin-comment', post: post.id, role, actor: compte.actor, texte }, null, 2),
  );
}

/**
 * Passe d'amplification : à lancer souvent (toutes les dix minutes), elle ne fait
 * quelque chose que lorsqu'un délai est échu.
 */
export async function amplifierPostsPublies(now = new Date()): Promise<ResumeAmplification> {
  const resume: ResumeAmplification = { candidats: 0, commentaires: 0, echecs: 0 };
  const reglages = getAmplification();
  if (!reglages.enabled) return resume;

  const depuis = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const posts = db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.platform, 'linkedin'),
        eq(schema.posts.status, 'published'),
        gte(schema.posts.publishedAt, depuis),
      ),
    )
    .all()
    .filter((p) => p.externalPostId);

  // Seuls les comptes actifs, en état de marche, qui ont le droit d'écrire un commentaire
  // participent : un jeton expiré ferait rédiger un commentaire (appel IA) pour un 401.
  const equipe = toutesLesSurfaces().filter((c) => c.actif && !c.enPanne && droitCommentaire(c).peutRepondre);

  for (const post of posts) {
    const auteur = compteDuPost(post);
    const dus = amplificateursDus({
      publishedAt: post.publishedAt!,
      dejaFaits: dejaPasses(post),
      auteur,
      equipe,
      reglages,
      now,
    });
    if (dus.length === 0) continue;
    resume.candidats++;

    for (const { compte, role } of dus) {
      const jeton = jetonDuCompte(compte);
      if (!jeton) continue;
      const texte =
        role === 'amorce' ? texteAmorce(post) : await texteDeCollegue(post, compte);
      if (!texte) {
        // Rien à dire : on note le passage de l'amorce (elle ne dira jamais rien de
        // plus), mais pas celui d'un collègue — le modèle pourra réessayer plus tard.
        if (role === 'amorce') marquerPasse(post, AMORCE, now);
        continue;
      }
      try {
        if (config.PUBLISH_MODE === 'dry') {
          commentaireDry(post, compte, role, texte);
        } else {
          await commenterPostLinkedIn({
            compte,
            token: jeton.accessToken,
            postUrn: post.externalPostId!,
            texte,
          });
        }
        marquerPasse(post, role === 'amorce' ? AMORCE : compte.key, now);
        resume.commentaires++;
        logger.info({ postId: post.id, compte: compte.name, role }, 'post amplifié');
      } catch (err) {
        resume.echecs++;
        logger.warn(
          { postId: post.id, compte: compte.name, role, err: String(err).slice(0, 200) },
          'commentaire d’amplification refusé par LinkedIn',
        );
      }
    }
  }
  return resume;
}
