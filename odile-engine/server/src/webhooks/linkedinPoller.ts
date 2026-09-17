/**
 * Commentaires LinkedIn, sur les trois surfaces : chaque profil personnel connecté
 * et la page entreprise.
 *
 * LinkedIn n'ouvre sa messagerie à aucune application — pas de message privé
 * possible, ni pour nous ni pour personne (l'API « Messages » est réservée à une
 * poignée de partenaires historiques et interdit de toute façon l'envoi automatisé).
 * Le lien de la ressource promise part donc là où l'API le permet : SOUS le
 * commentaire, en réponse à la personne, au nom du compte qui a publié. Et pour
 * qui veut ajouter la touche personnelle, un message privé prêt à coller est
 * proposé par email.
 *
 * Pas de webhook côté LinkedIn : on relit les commentaires des posts récents à
 * intervalle régulier (voir jobs.ts).
 */
import { and, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getDmTriggers } from '../db/settingsRepo.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { API, linkedInHeaders } from '../publishers/linkedin.js';
import {
  compteDuPost,
  droitCommentaire,
  jetonDuCompte,
  toutesLesSurfaces,
  type CompteLinkedIn,
} from '../publishers/linkedinAccounts.js';
import {
  buildReply,
  choisirVariante,
  lienRdv,
  linkForPost,
  matchKeyword,
  nommerRessource,
  type ContexteReponse,
} from './commentDm.js';

interface LiComment {
  commentUrn?: string;
  id?: string;
  actor?: string;
  'actor~'?: { localizedFirstName?: string; localizedLastName?: string };
  message?: { text?: string };
  created?: { time?: number };
  object?: string;
  parentComment?: string;
}

/** LinkedIn limite la création de commentaires par minute : on reste bien en deçà. */
const REPONSES_MAX_PAR_PASSAGE = 20;

/**
 * Réponse à poster sous un commentaire.
 *
 * Mêmes gabarits que les messages privés Instagram : `{{link}}`, `{{ressource}}`,
 * `{{motcle}}`, `{{rdv}}` et `{{prenom}}` quand LinkedIn le donne. Un placeholder
 * sans valeur disparaît proprement. Nommer la ressource compte double ici : la
 * réponse est publique, et les lecteurs qui n'ont pas commenté la lisent aussi.
 */
export function composerReponseLinkedIn(modele: string, contexte: ContexteReponse): string {
  return buildReply(modele, contexte);
}

/** Prénom du commentateur, quand la décoration `actor~` a été servie. */
function prenomDe(element: LiComment): string | null {
  return element['actor~']?.localizedFirstName?.trim() || null;
}

/**
 * Lit les commentaires d'un post. On demande d'abord les auteurs décorés (prénom),
 * puis sans décoration si LinkedIn refuse la projection — l'essentiel est le texte.
 */
async function lireCommentaires(token: string, postUrn: string): Promise<LiComment[]> {
  const urn = encodeURIComponent(postUrn);
  const base = `${API}/rest/socialActions/${urn}/comments`;
  try {
    const res = await fetchJson<{ elements?: LiComment[] }>(
      `${base}?count=50&projection=(elements*(actor,actor~(localizedFirstName,localizedLastName),commentUrn,id,message,created,object,parentComment))`,
      { headers: linkedInHeaders(token) },
    );
    return res.elements ?? [];
  } catch {
    const res = await fetchJson<{ elements?: LiComment[] }>(`${base}?count=50`, { headers: linkedInHeaders(token) });
    return res.elements ?? [];
  }
}

/**
 * Répond sous un commentaire, au nom du compte qui a publié le post.
 * `POST /rest/socialActions/{commentUrn}/comments` avec `parentComment` — la forme
 * « réponse dans le fil » de LinkedIn.
 */
export async function repondreSousCommentaireLinkedIn(args: {
  compte: CompteLinkedIn;
  token: string;
  postUrn: string;
  commentUrn: string;
  texte: string;
}): Promise<string | null> {
  const res = await fetchJson<{ commentUrn?: string; id?: string }>(
    `${API}/rest/socialActions/${encodeURIComponent(args.commentUrn)}/comments`,
    {
      method: 'POST',
      headers: linkedInHeaders(args.token),
      body: JSON.stringify({
        actor: args.compte.actor,
        object: args.postUrn,
        message: { text: args.texte },
        parentComment: args.commentUrn,
      }),
    },
  );
  return res.commentUrn ?? res.id ?? null;
}

/**
 * Commentaire de PREMIER NIVEAU sous un post — pas une réponse dans un fil.
 *
 * Même route que la réponse, sans `parentComment` : c'est ce seul champ qui fait la
 * différence chez LinkedIn. Sert à l'amplification (voir publishers/amplify.ts).
 */
export async function commenterPostLinkedIn(args: {
  compte: CompteLinkedIn;
  token: string;
  postUrn: string;
  texte: string;
}): Promise<string | null> {
  const res = await fetchJson<{ commentUrn?: string; id?: string }>(
    `${API}/rest/socialActions/${encodeURIComponent(args.postUrn)}/comments`,
    {
      method: 'POST',
      headers: linkedInHeaders(args.token),
      body: JSON.stringify({
        actor: args.compte.actor,
        object: args.postUrn,
        message: { text: args.texte },
      }),
    },
  );
  return res.commentUrn ?? res.id ?? null;
}

export interface LinkedInPollSummary {
  scanned: number;
  newComments: number;
  matched: number;
  replied: number;
  failed: number;
}

/** Les posts LinkedIn publiés récemment, par compte : on ne lit que ce qui nous appartient. */
function postsRecents(): (typeof schema.posts.$inferSelect)[] {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  return db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.platform, 'linkedin'),
        eq(schema.posts.status, 'published'),
        gte(schema.posts.publishedAt, since),
      ),
    )
    .all()
    .filter((p) => p.externalPostId?.startsWith('urn:'));
}

export async function pollLinkedInComments(): Promise<LinkedInPollSummary> {
  const surfaces = toutesLesSurfaces();
  const resume: LinkedInPollSummary = { scanned: 0, newComments: 0, matched: 0, replied: 0, failed: 0 };
  if (surfaces.length === 0) return resume;
  const settings = getDmTriggers();
  const nosActeurs = new Set(surfaces.map((s) => s.actor));
  const aRepondre: { commentId: number; compte: CompteLinkedIn; token: string; postUrn: string; commentUrn: string; contexte: ContexteReponse }[] = [];
  const pourEmail: { compte: string; auteur: string; texte: string; dm: string; postUrl: string | null }[] = [];

  for (const post of postsRecents()) {
    const compte = compteDuPost(post);
    const token = compte ? jetonDuCompte(compte) : null;
    if (!compte || !token) continue;
    resume.scanned++;
    let elements: LiComment[];
    try {
      elements = await lireCommentaires(token.accessToken, post.externalPostId!);
    } catch (err) {
      // La lecture des commentaires d'un profil dépend d'un droit que LinkedIn
      // n'accorde pas à toutes les apps (r_member_social) : on le dit, sans casser.
      logger.warn({ post: post.id, compte: compte.name, err: String(err).slice(0, 200) }, 'lecture des commentaires LinkedIn impossible');
      continue;
    }
    const lien = linkForPost(post.id);
    const motsCles = [...(post.commentTriggerKeyword ? [post.commentTriggerKeyword] : []), ...settings.keywords];

    for (const element of elements) {
      const externalId = element.commentUrn ?? element.id;
      if (!externalId) continue;
      // Nos propres réponses reviennent dans la liste : on ne se répond pas à soi-même.
      if (element.actor && nosActeurs.has(element.actor)) continue;
      // Une réponse à un autre commentaire n'est pas une demande.
      if (element.parentComment) continue;
      const text = element.message?.text ?? '';
      const matched = matchKeyword(text, motsCles);
      const prenom = prenomDe(element);
      const nom = [element['actor~']?.localizedFirstName, element['actor~']?.localizedLastName].filter(Boolean).join(' ');
      const contexte: ContexteReponse = {
        link: lien,
        ressource: nommerRessource(post),
        motcle: matched,
        prenom,
        rdv: lienRdv(),
      };
      const dm = matched ? composerReponseLinkedIn(settings.replyTemplate, contexte) : null;
      const inserted = db
        .insert(schema.comments)
        .values({
          platform: 'linkedin',
          externalId: String(externalId),
          postId: post.id,
          externalPostId: post.externalPostId,
          externalPostUrl: post.externalUrl,
          authorExternalId: element.actor ?? null,
          authorName: nom || element.actor?.replace('urn:li:person:', 'Membre ') || '',
          text,
          createdTime: element.created?.time ? new Date(element.created.time).toISOString() : null,
          matchedKeyword: matched,
          dmStatus: matched ? 'manual_suggested' : 'none',
          suggestedReply: dm,
          raw: JSON.stringify(element),
        })
        .onConflictDoNothing({ target: [schema.comments.platform, schema.comments.externalId] })
        .returning({ id: schema.comments.id })
        .all();
      if (inserted.length === 0) continue;
      resume.newComments++;
      if (!matched || !dm) continue;
      resume.matched++;
      aRepondre.push({
        commentId: inserted[0]!.id,
        compte,
        token: token.accessToken,
        postUrn: post.externalPostId!,
        commentUrn: String(externalId),
        contexte,
      });
      pourEmail.push({ compte: compte.name, auteur: nom || element.actor || 'inconnu', texte: text, dm, postUrl: post.externalUrl });
    }
  }

  // Réponse sous chaque commentaire, au nom du compte qui a publié.
  for (const item of aRepondre.slice(0, REPONSES_MAX_PAR_PASSAGE)) {
    if (!settings.publicReply) break;
    const modele = choisirVariante(settings.linkedinReplyVariants, item.commentId);
    if (!modele) break;
    const texte = composerReponseLinkedIn(modele, item.contexte);
    const droit = droitCommentaire(item.compte);
    if (config.PUBLISH_MODE === 'dry') {
      db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, item.commentId)).run();
      logger.info({ commentId: item.commentId, compte: item.compte.name, texte }, 'réponse LinkedIn simulée (mode dry)');
      resume.replied++;
      continue;
    }
    if (!droit.peutRepondre) {
      db.update(schema.comments)
        .set({ publicReplyStatus: 'failed', publicReplyError: `droit ${droit.manque} absent sur ${item.compte.name} — reconnecte ce compte` })
        .where(eq(schema.comments.id, item.commentId))
        .run();
      resume.failed++;
      continue;
    }
    try {
      await repondreSousCommentaireLinkedIn({ compte: item.compte, token: item.token, postUrn: item.postUrn, commentUrn: item.commentUrn, texte });
      db.update(schema.comments).set({ publicReplyStatus: 'sent', publicReplyError: null }).where(eq(schema.comments.id, item.commentId)).run();
      logger.info({ commentId: item.commentId, compte: item.compte.name }, 'réponse postée sous le commentaire LinkedIn');
      resume.replied++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      db.update(schema.comments)
        .set({ publicReplyStatus: 'failed', publicReplyError: detail.slice(0, 500) })
        .where(eq(schema.comments.id, item.commentId))
        .run();
      logger.error({ commentId: item.commentId, compte: item.compte.name, err: detail }, 'échec de la réponse LinkedIn');
      resume.failed++;
    }
  }

  if (pourEmail.length > 0) {
    const rows = pourEmail
      .map(
        (m) => `<tr>
<td style="padding:8px;border-bottom:1px solid #eee"><b>${escapeHtml(m.compte)}</b><br/>${escapeHtml(m.auteur)}<br/><i>${escapeHtml(m.texte.slice(0, 200))}</i></td>
<td style="padding:8px;border-bottom:1px solid #eee">
  <div style="background:#f2f6ff;border-radius:8px;padding:10px;font-size:13px">${escapeHtml(m.dm)}</div>
  ${m.postUrl ? `<a href="${m.postUrl}">Ouvrir le post →</a>` : ''}
</td></tr>`,
      )
      .join('');
    await sendMail({
      kind: 'li_comment_digest',
      to: getApprovalEmail().to,
      subject: `[Odile] 💬 ${pourEmail.length} commentaire(s) LinkedIn — lien envoyé, DM à coller si tu veux`,
      html: `<p>Le lien est parti en réponse sous chaque commentaire (LinkedIn n'ouvre pas sa messagerie aux applications). Pour ajouter la touche personnelle, voici un message privé prêt à coller :</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<p style="color:#889">Copie le message, ouvre le profil de la personne, colle en message privé. 30 secondes par lead.</p>`,
      text: pourEmail.map((m) => `[${m.compte}] ${m.auteur} : ${m.texte}\n→ DM : ${m.dm}\n`).join('\n'),
    });
  }

  return resume;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
