/**
 * Le repost commenté : ce que fait un fondateur quand un collègue ou la Page publie.
 *
 * L'audit LinkedIn 2026 le recommande à la place des posts jumeaux : un repost nu ne
 * compte pas, un repost avec un avis personnel compte comme un post à part entière, et
 * il ne fait pas doublon. Quand un post LinkedIn paraît, le moteur prépare pour chaque
 * autre profil un texte de 3 à 5 lignes, à sa voix. Il ne le publie jamais : la
 * personne ouvre le post, « Republier avec vos idées », colle, publie.
 */
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getStrategieLinkedIn } from '../db/settingsRepo.js';
import { verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { sendMail } from '../mailer/smtp.js';
import { registreDuCompte } from '../writer/faits.js';
import { contientUnLien, porteUnAppat, porteUnPitch, tutoie } from '../writer/reglesLinkedIn.js';
import { compteDuPost, comptesLinkedIn, type CompteLinkedIn } from './linkedinAccounts.js';
import { dejaPasses } from './rappelLien.js';

type Post = typeof schema.posts.$inferSelect;

export interface RepostPrepare {
  compte: string;
  nom: string;
  texte: string;
}

const REPOST = 'repost';
const FENETRE_MS = 24 * 3600 * 1000;

/** Les reposts déjà préparés pour un post (JSON), ou rien. */
export function repostsDuPost(post: Pick<Post, 'reposts'>): RepostPrepare[] {
  return memoireDesReposts(post).prepares;
}

/** Au-delà, le modèle ne sera plus sollicité pour ce post : il n'aura pas de repost. */
export const ESSAIS_MAX = 3;

/**
 * Ce que `posts.reposts` retient : les textes prêts (une liste), ou le nombre d'essais
 * infructueux (« {"essais":2} ») tant qu'aucun texte n'a abouti.
 */
export function memoireDesReposts(post: Pick<Post, 'reposts'>): { prepares: RepostPrepare[]; essais: number } {
  try {
    const v = post.reposts ? (JSON.parse(post.reposts) as unknown) : [];
    if (Array.isArray(v)) return { prepares: v as RepostPrepare[], essais: 0 };
    const essais = v && typeof v === 'object' && typeof (v as { essais?: unknown }).essais === 'number' ? (v as { essais: number }).essais : 0;
    return { prepares: [], essais };
  } catch {
    return { prepares: [], essais: 0 };
  }
}

/** Les profils qui reposteront : tous les profils actifs, sauf l'auteur. */
export function profilsPourLeRepost(post: Pick<Post, 'channel' | 'liAccountKey'>): CompteLinkedIn[] {
  const auteur = post.channel === 'li_personal' ? (post.liAccountKey ?? compteDuPost(post)?.key ?? null) : null;
  return comptesLinkedIn('li_person').filter((c) => c.actif && c.key !== auteur);
}

const repostSchema = (registre: 'vous' | 'tu', noms: string[], offre: string) =>
  z.object({ texte: z.string().min(80).max(600) }).superRefine((v, ctx) => {
    if (porteUnAppat(v.texte)) ctx.addIssue({ code: 'custom', path: ['texte'], message: 'aucun « Commente MOT »' });
    if (contientUnLien(v.texte)) ctx.addIssue({ code: 'custom', path: ['texte'], message: 'aucun lien ni adresse' });
    if (registre === 'vous' && tutoie(v.texte)) ctx.addIssue({ code: 'custom', path: ['texte'], message: 'vouvoiement' });
    if (porteUnPitch(v.texte, noms, offre)) ctx.addIssue({ code: 'custom', path: ['texte'], message: 'aucun pitch : ni le nom de la marque, ni l’offre' });
    const lignes = v.texte.split('\n').filter((l) => l.trim()).length;
    if (lignes > 6) ctx.addIssue({ code: 'custom', path: ['texte'], message: '3 à 5 lignes' });
  });

/** Le texte du repost, à la voix du compte. En simulation, un texte fixe et conforme. */
export async function texteDeRepost(post: Pick<Post, 'caption' | 'hook'>, compte: CompteLinkedIn): Promise<string | null> {
  const strategie = getStrategieLinkedIn();
  const registre = registreDuCompte(compte.key);
  if (config.LLM_MODE === 'mock') {
    return registre === 'vous'
      ? `Je repartage ce post, parce que je l’entends presque chaque semaine au téléphone.\nLe sujet n’est pas l’outil, c’est le temps que personne ne compte.\nEt chez vous, qui s’en occupe aujourd’hui ?`
      : `Je repartage ce post, parce que je l’entends presque chaque semaine au téléphone.\nLe sujet n’est pas l’outil, c’est le temps que personne ne compte.\nEt chez toi, qui s’en occupe aujourd’hui ?`;
  }
  if (!verifierBudget('writing').autorise) return null;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        label: 'post:repost',
        tier: 'best',
        prompt: `Tu écris le commentaire d'un REPOST LinkedIn (« Republier avec vos idées ») : ${compte.name}${compte.role ? `, ${compte.role}` : ''},
repartage le post ci-dessous depuis son profil personnel.

RÈGLES :
- 3 à 5 lignes courtes, à la première personne, ${registre === 'vous' ? 'au vouvoiement' : 'au tutoiement'}.
- Un avis personnel, pas un résumé : pourquoi ce post compte pour lui ou elle, ce qu'il ou elle entend sur le terrain
  (sans inventer de chiffre, de client ni d'anecdote précise), une nuance ou un complément.
- Termine par une vraie question ouverte au lecteur.
- AUCUN lien, aucun hashtag, aucun « Commente MOT », aucune flèche ni tiret long, aucun « super post de mon associé ».
- Ne nomme ni ${strategie.nomCourant} ni l'offre : le repost ne vend rien.

LE POST REPARTAGÉ :
"""
${post.caption.slice(0, 1500)}
"""

Réponds en JSON : {"texte": "..."}`,
        maxTokens: 500,
      },
      repostSchema(registre, [strategie.nomCourant], strategie.offre),
    );
    return value.texte.trim();
  } catch (err) {
    logger.warn({ compte: compte.name, err: String(err).slice(0, 200) }, 'repost commenté non rédigé');
    return null;
  }
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Prépare les reposts d'un post qui vient de paraître, et prévient par email. */
export async function preparerLesReposts(now = new Date()): Promise<{ posts: number; reposts: number }> {
  const resume = { posts: 0, reposts: 0 };
  if (!getStrategieLinkedIn().repostsCommentes) return resume;
  const depuis = new Date(now.getTime() - FENETRE_MS).toISOString();
  const posts = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.platform, 'linkedin'), eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, depuis)))
    .all()
    .filter((p) => !dejaPasses(p).includes(REPOST));

  for (const post of posts) {
    const profils = profilsPourLeRepost(post);
    const memoire = memoireDesReposts(post);
    // Des textes déjà écrits (email non parti au passage précédent) ne se réécrivent pas.
    let prepares: RepostPrepare[] = memoire.prepares;
    if (prepares.length === 0 && profils.length > 0) {
      // Budget d'écriture du jour épuisé : on attend qu'il revienne, sans appeler le modèle.
      if (config.LLM_MODE !== 'mock' && !verifierBudget('writing').autorise) continue;
      for (const compte of profils) {
        const texte = await texteDeRepost(post, compte);
        if (texte) prepares.push({ compte: compte.key, nom: compte.name, texte });
      }
      if (prepares.length === 0) {
        // Le modèle n'a rien produit de valable : on compte l'essai ; au troisième, on renonce
        // plutôt que de le solliciter toutes les dix minutes pendant vingt-quatre heures.
        const essais = memoire.essais + 1;
        if (essais < ESSAIS_MAX) {
          db.update(schema.posts).set({ reposts: JSON.stringify({ essais }) }).where(eq(schema.posts.id, post.id)).run();
          continue;
        }
        logger.warn({ postId: post.id, essais }, 'reposts commentés abandonnés : aucun texte valable en trois essais');
      } else {
        db.update(schema.posts).set({ reposts: JSON.stringify(prepares) }).where(eq(schema.posts.id, post.id)).run();
      }
    }
    const faits = [...new Set([...dejaPasses(post), REPOST])];
    if (prepares.length === 0) {
      // Personne pour reposter, ou plus rien à attendre du modèle : on clôt.
      db.update(schema.posts)
        .set({ reposts: JSON.stringify([]), amplifiedBy: JSON.stringify(faits), amplifiedAt: now.toISOString() })
        .where(eq(schema.posts.id, post.id))
        .run();
      continue;
    }
    resume.posts++;
    resume.reposts += prepares.length;
    const ouvrir = post.externalUrl?.startsWith('http') ? `<p><a href="${post.externalUrl}">Ouvrir le post →</a></p>` : '<p>Retrouvez le post sur le profil ou la Page qui l’a publié.</p>';
    const envoi = await sendMail({
      kind: 'repost',
      to: getApprovalEmail().to,
      postId: post.id,
      subject: `[Odile] 🔁 Repost commenté à faire : « ${post.hook.slice(0, 50)} »`,
      html: `<p>Ce post vient de paraître. Plutôt qu'un second post sur le même sujet, chaque autre profil le repartage avec son avis : sur LinkedIn, « Republier » puis « Republier avec vos idées », et collez le texte.</p>
${ouvrir}
${prepares.map((r) => `<p><b>${echapper(r.nom)}</b></p><blockquote style="background:#f2f6ff;border-radius:8px;padding:10px;margin:0 0 12px;white-space:pre-wrap">${echapper(r.texte)}</blockquote>`).join('\n')}
<p style="color:#889">Un repost nu ne compte pas ; un repost avec un avis compte comme un post. Adaptez le texte à votre semaine.</p>`,
      text: prepares.map((r) => `[${r.nom}]\n${r.texte}\n`).join('\n'),
    });
    // Email non parti : les textes sont gardés, la marque attend ; le passage suivant renvoie.
    if (!envoi.ok) {
      logger.warn({ postId: post.id }, 'email des reposts non envoyé : nouvelle tentative au prochain passage');
      continue;
    }
    db.update(schema.posts)
      .set({ reposts: JSON.stringify(prepares), amplifiedBy: JSON.stringify(faits), amplifiedAt: now.toISOString() })
      .where(eq(schema.posts.id, post.id))
      .run();
    logger.info({ postId: post.id, reposts: prepares.length }, 'reposts commentés préparés');
  }
  return resume;
}
