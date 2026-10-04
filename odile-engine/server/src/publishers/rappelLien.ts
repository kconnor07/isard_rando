/**
 * Le lien de la ressource, posé par la personne elle-même, après la première heure.
 *
 * En 2026, un lien externe dans un post de profil coûte 17 à 27 % de portée, et
 * l'auteur qui commente son propre post avant tout le monde en perd encore 20 %.
 * Les commentaires automatisés, eux, sont déclassés et sanctionnés. Le moteur ne
 * commente donc plus rien sous les posts : il rappelle seulement, par email, le
 * lien à donner en réponse à quelqu'un qui le demande, une fois la première heure
 * passée. La personne garde la main sur ce qui s'écrit à son nom.
 *
 * Un seul rappel par post (`posts.amplifiedBy` porte « rappel-lien »), et rien
 * au-delà de 48 h : un post d'avant-hier ne se réanime pas.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getStrategieLinkedIn } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { linkForPost, nommerRessource } from '../webhooks/commentDm.js';

type Post = typeof schema.posts.$inferSelect;

/** Marque du rappel dans `posts.amplifiedBy`. */
export const RAPPEL_LIEN = 'rappel-lien';
const FENETRE_MS = 48 * 3600 * 1000;

export interface ResumeRappels {
  candidats: number;
  envoyes: number;
}

/** Ce qui a déjà été fait sous un post (« rappel-lien »). */
export function dejaPasses(post: Pick<Post, 'amplifiedBy'>): string[] {
  if (!post.amplifiedBy) return [];
  try {
    const brut = JSON.parse(post.amplifiedBy) as unknown;
    return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Le rappel est-il dû maintenant ? Fonction pure : tout lui est donné. */
export function rappelDu(args: { publishedAt: string; dejaFaits: string[]; minutes: number; now: Date }): boolean {
  const publie = new Date(args.publishedAt).getTime();
  if (Number.isNaN(publie) || args.dejaFaits.includes(RAPPEL_LIEN)) return false;
  const ecoule = args.now.getTime() - publie;
  return ecoule >= args.minutes * 60000 && ecoule < FENETRE_MS;
}

/**
 * Le texte à poster soi-même en réponse à un commentaire : la ressource, nommée,
 * et son lien. Rien quand le post n'a pas de lien court, ou quand le lien est
 * déjà dans le texte publié.
 */
export function texteDuLien(post: Pick<Post, 'id' | 'caption' | 'linkId' | 'resourceKind' | 'resourceTitle'>): string | null {
  if (!post.linkId) return null;
  const lien = linkForPost(post.id);
  if (!lien.includes('/r/') || post.caption.includes(lien)) return null;
  const ressource = nommerRessource(post);
  return `${ressource.charAt(0).toUpperCase()}${ressource.slice(1)}, pour aller plus loin : ${lien}`;
}

function marquerPasse(post: Post, now: Date): void {
  const faits = [...new Set([...dejaPasses(post), RAPPEL_LIEN])];
  db.update(schema.posts)
    .set({ amplifiedBy: JSON.stringify(faits), amplifiedAt: now.toISOString() })
    .where(eq(schema.posts.id, post.id))
    .run();
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Passe des rappels : à lancer souvent (toutes les dix minutes), elle n'envoie
 * quelque chose que lorsqu'un post a passé sa première heure.
 */
export async function rappelerLesLiens(now = new Date()): Promise<ResumeRappels> {
  const resume: ResumeRappels = { candidats: 0, envoyes: 0 };
  const { rappelLienApresMinutes } = getStrategieLinkedIn();
  const depuis = new Date(now.getTime() - FENETRE_MS).toISOString();
  const posts = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.platform, 'linkedin'), eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, depuis)))
    .all();

  for (const post of posts) {
    if (!rappelDu({ publishedAt: post.publishedAt!, dejaFaits: dejaPasses(post), minutes: rappelLienApresMinutes, now })) continue;
    const texte = texteDuLien(post);
    // Rien à rappeler (lien déjà dans le post, ou pas de ressource) : on le note pour ne plus y revenir.
    if (!texte) {
      marquerPasse(post, now);
      continue;
    }
    resume.candidats++;
    await sendMail({
      kind: 'rappel_lien',
      to: getApprovalEmail().to,
      postId: post.id,
      subject: `[Odile] 🔗 Le lien de votre post « ${post.hook.slice(0, 50)} »`,
      html: `<p>Votre post est en ligne depuis une heure, sans lien : c'est ce qui lui laisse toute sa portée.</p>
<p>Si quelqu'un a demandé la ressource, répondez-lui avec ce texte (sinon, ajoutez-le en réponse au premier commentaire) :</p>
<blockquote style="background:#f2f6ff;border-radius:8px;padding:10px;margin:0">${echapper(texte)}</blockquote>
${post.externalUrl?.startsWith('http') ? `<p><a href="${post.externalUrl}">Ouvrir le post →</a></p>` : ''}
<p style="color:#889">Ajoutez une question ou un complément à votre réponse : un fil qui continue pousse le post.</p>`,
      text: `Votre post est en ligne depuis une heure. Lien à donner en réponse à un commentaire :\n${texte}`,
    });
    marquerPasse(post, now);
    resume.envoyes++;
    logger.info({ postId: post.id }, 'rappel du lien envoyé');
  }
  return resume;
}
