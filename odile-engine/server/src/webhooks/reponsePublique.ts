/**
 * Répondre sous un commentaire, à la demande d'un humain.
 *
 * Le moteur répond déjà tout seul quand le mot-clé est là. Cette voie-ci sert à
 * l'autre cas, celui qui coûtait des prospects : quelqu'un demande la ressource
 * avec ses mots à lui (« je veux bien la méthode »), la réponse l'attend toute
 * prête dans la boîte « à traiter », et un clic l'envoie.
 *
 * Les deux réseaux n'ont pas la même mécanique : LinkedIn veut un commentaire
 * enfant, avec l'acteur qui a publié le post ; Instagram a un point d'entrée
 * « replies » sur le commentaire lui-même.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { GRAPH } from '../publishers/instagram.js';
import { compteDuPost, droitCommentaire, jetonDuCompte } from '../publishers/linkedinAccounts.js';
import { getStoredToken } from '../publishers/tokens.js';
import { repondreSousCommentaireLinkedIn } from './linkedinPoller.js';

type Comment = typeof schema.comments.$inferSelect;

export async function repondreSousCommentaire(comment: Comment, texte: string): Promise<void> {
  if (!comment.externalId) throw new Error('Ce commentaire n’a pas d’identifiant côté plateforme — impossible d’y répondre.');

  if (config.PUBLISH_MODE === 'dry') {
    const fichier = path.join(config.outboxDir, `reponse-${comment.id}-${Date.now()}.json`);
    fs.mkdirSync(config.outboxDir, { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify({ platform: comment.platform, commentaire: comment.externalId, texte }, null, 2));
    logger.info({ commentId: comment.id, fichier }, 'réponse simulée (mode dry)');
    return;
  }

  if (comment.platform === 'linkedin') {
    const post = comment.postId ? db.select().from(schema.posts).where(eq(schema.posts.id, comment.postId)).get() : null;
    if (!post?.externalPostId) throw new Error('Post LinkedIn d’origine introuvable — impossible de répondre sous le commentaire.');
    const compte = compteDuPost(post);
    const jeton = compte ? jetonDuCompte(compte) : null;
    if (!compte || !jeton) throw new Error('Compte LinkedIn déconnecté — reconnecte-le dans Connexions & santé.');
    const droit = droitCommentaire(compte);
    if (!droit.peutRepondre) throw new Error(`Droit ${droit.manque} absent sur ${compte.name} — reconnecte ce profil pour pouvoir répondre.`);
    await repondreSousCommentaireLinkedIn({
      compte,
      token: jeton.accessToken,
      postUrn: post.externalPostId,
      commentUrn: comment.externalId,
      texte,
    });
    logger.info({ commentId: comment.id, compte: compte.name }, 'réponse LinkedIn postée à la demande');
    return;
  }

  const ig = getStoredToken('meta', 'ig_user');
  if (!ig) throw new Error('Instagram non connecté — impossible de répondre.');
  await fetchJson(`${GRAPH}/${encodeURIComponent(comment.externalId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: texte, access_token: ig.accessToken }),
  });
  logger.info({ commentId: comment.id }, 'réponse Instagram postée à la demande');
}
