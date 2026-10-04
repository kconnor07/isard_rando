/**
 * Profils personnels : le moteur prépare, la personne publie.
 *
 * L'audit LinkedIn 2026 le dit sans détour : la voix d'un dirigeant ne se délègue
 * pas à un automate. Sur un profil personnel, le post arrive donc à l'heure prévue
 * dans la boîte email de la personne, prêt à coller — texte final, visuels ou
 * document en pièces jointes. Elle le relit, le publie elle-même, puis clique
 * « Marquer publié » : le post compte dans le calendrier et les statistiques.
 *
 * La Page entreprise, elle, reste publiée par l'API officielle après validation.
 * Le réglage « Stratégie LinkedIn → profils publiés par l'outil » rétablit
 * l'ancien fonctionnement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getStrategieLinkedIn } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { renderPost } from '../render/renderer.js';
import { compteDuPost } from './linkedinAccounts.js';
import { documentDuPost } from './linkedinDocument.js';
import { buildCaption, collectPublishImages } from './types.js';

type Post = typeof schema.posts.$inferSelect;

/** Ce post part-il par la personne plutôt que par l'API ? */
export function publieParLaPersonne(post: Pick<Post, 'platform' | 'channel'>): boolean {
  return post.platform === 'linkedin' && post.channel === 'li_personal' && !getStrategieLinkedIn().profilsPubliesParLoutil;
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Les fichiers à joindre : le document PDF, sinon les visuels rendus. */
async function piecesJointes(post: Post): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const aRendre = db
    .select({ renderAssetId: schema.slides.renderAssetId })
    .from(schema.slides)
    .where(eq(schema.slides.postId, post.id))
    .all()
    .some((s) => !s.renderAssetId);
  if (aRendre) await renderPost(post.id);
  if (post.format === 'li_doc') {
    const doc = await documentDuPost(post.id);
    return [{ filename: `document-${post.id}.pdf`, content: fs.readFileSync(doc.path), contentType: 'application/pdf' }];
  }
  if (post.format === 'reel' && post.videoAssetId) {
    // Une vidéo dépasse vite la taille d'un email : elle se télécharge depuis le tableau de bord.
    return [];
  }
  return collectPublishImages(post.id).map((img) => ({
    filename: `visuel-${post.id}-${img.idx + 1}${path.extname(img.path) || '.png'}`,
    content: fs.readFileSync(img.path),
    contentType: img.path.endsWith('.jpg') || img.path.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
  }));
}

/**
 * L'heure est venue : le post passe « à publier vous-même », et la personne reçoit
 * tout ce qu'il faut pour le faire. Le job de publication est clos, rien ne part
 * chez LinkedIn.
 */
export async function remettreAPublier(post: Post, jobId: number): Promise<void> {
  const texte = buildCaption(post);
  const compte = compteDuPost(post);
  let pieces: Awaited<ReturnType<typeof piecesJointes>> = [];
  try {
    pieces = await piecesJointes(post);
  } catch (err) {
    logger.warn({ postId: post.id, err: String(err).slice(0, 200) }, 'visuels non joints — à télécharger depuis le tableau de bord');
  }
  const quand = new Date().toISOString();
  db.update(schema.publishJobs)
    .set({ state: 'done', finishedAt: quand, result: JSON.stringify({ aPublier: true }) })
    .where(eq(schema.publishJobs.id, jobId))
    .run();
  db.update(schema.posts).set({ status: 'to_publish', error: null, updatedAt: quand }).where(eq(schema.posts.id, post.id)).run();

  const lienEditeur = `${config.PUBLIC_URL.replace(/\/+$/, '')}/posts/${post.id}`;
  await sendMail({
    kind: 'a_publier',
    to: getApprovalEmail().to,
    postId: post.id,
    subject: `[Odile] ✍️ À publier${compte ? ` par ${compte.name}` : ''} : « ${post.hook.slice(0, 50)} »`,
    html: `<p>C'est l'heure prévue pour ce post${compte ? ` sur le profil de <b>${echapper(compte.name)}</b>` : ''}. Il n'est pas parti tout seul : sur un profil personnel, c'est vous qui publiez.</p>
<ol>
<li>Relisez le texte ci-dessous, ajoutez un détail vécu si vous en avez un.</li>
<li>Copiez-le dans LinkedIn, avec ${post.format === 'li_doc' ? 'le document PDF joint (bouton « Document »)' : pieces.length ? 'le visuel joint' : 'le visuel (à télécharger depuis le tableau de bord)'}.</li>
<li>Publiez, puis cliquez « Marquer publié » dans le tableau de bord.</li>
<li>Pendant la première heure, répondez à chaque commentaire par une question ou un complément.</li>
</ol>
<pre style="white-space:pre-wrap;font-family:inherit;background:#f4f6fb;border:1px solid #dfe5f0;border-radius:10px;padding:12px">${echapper(texte)}</pre>
<p><a href="${lienEditeur}">Ouvrir le post dans le tableau de bord →</a></p>`,
    text: `C'est l'heure prévue pour ce post. Copiez-le dans LinkedIn, publiez, puis cliquez « Marquer publié » : ${lienEditeur}\n\n${texte}`,
    attachments: pieces,
  });
  logger.info({ postId: post.id }, 'post de profil remis à la personne pour publication');
}

/**
 * La personne a publié : le post compte comme publié, avec son adresse si elle
 * l'a donnée. Les jobs encore en attente sont annulés.
 */
export function marquerPublie(postId: number, url: string | null, now = new Date()): Post | null {
  const quand = now.toISOString();
  db.update(schema.publishJobs)
    .set({ state: 'canceled', finishedAt: quand, lastError: 'publié à la main' })
    .where(and(eq(schema.publishJobs.postId, postId), eq(schema.publishJobs.state, 'pending')))
    .run();
  db.update(schema.posts)
    .set({ status: 'published', publishedAt: quand, externalUrl: url, externalPostId: null, error: null, updatedAt: quand })
    .where(eq(schema.posts.id, postId))
    .run();
  return db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get() ?? null;
}
