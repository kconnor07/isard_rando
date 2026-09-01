import { and, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getDmTriggers } from '../db/settingsRepo.js';
import { fetchJson } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { sendMail } from '../mailer/smtp.js';
import { getStoredToken } from '../publishers/tokens.js';
import { buildReply, matchKeyword } from './commentDm.js';

const API = 'https://api.linkedin.com';
const LINKEDIN_VERSION = '202506';

interface LiComment {
  commentUrn?: string;
  id?: string;
  actor?: string;
  message?: { text?: string };
  created?: { time?: number };
}

/**
 * Fallback LinkedIn (pas d'API DM) : détecte les commentaires sur nos posts
 * récents ; ceux qui contiennent un mot-clé reçoivent une réponse pré-rédigée
 * envoyée par email, à coller en un clic.
 */
export async function pollLinkedInComments(): Promise<{ scanned: number; newComments: number; matched: number }> {
  const token = getStoredToken('linkedin', 'li_person');
  if (!token) return { scanned: 0, newComments: 0, matched: 0 };
  const settings = getDmTriggers();

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const posts = db
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

  let scanned = 0;
  let newComments = 0;
  const matches: { author: string; text: string; reply: string; postUrl: string | null }[] = [];

  for (const post of posts) {
    scanned++;
    try {
      const urn = encodeURIComponent(post.externalPostId!);
      const res = await fetchJson<{ elements?: LiComment[] }>(
        `${API}/rest/socialActions/${urn}/comments?count=50`,
        {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            'linkedin-version': LINKEDIN_VERSION,
            'x-restli-protocol-version': '2.0.0',
          },
        },
      );
      for (const element of res.elements ?? []) {
        const externalId = element.commentUrn ?? element.id;
        if (!externalId) continue;
        const text = element.message?.text ?? '';
        const matched = matchKeyword(text, [
          ...(post.commentTriggerKeyword ? [post.commentTriggerKeyword] : []),
          ...settings.keywords,
        ]);
        const link = post.linkId
          ? db.select().from(schema.links).where(eq(schema.links.id, post.linkId)).get()
          : null;
        const reply = matched
          ? buildReply(settings.replyTemplate, link ? `${config.PUBLIC_URL}/r/${link.code}` : 'https://odileai.com')
          : null;
        const inserted = db
          .insert(schema.comments)
          .values({
            platform: 'linkedin',
            externalId: String(externalId),
            postId: post.id,
            externalPostId: post.externalPostId,
            externalPostUrl: post.externalUrl,
            authorExternalId: element.actor ?? null,
            authorName: element.actor?.replace('urn:li:person:', 'Membre ') ?? '',
            text,
            createdTime: element.created?.time ? new Date(element.created.time).toISOString() : null,
            matchedKeyword: matched,
            dmStatus: matched ? 'manual_suggested' : 'none',
            suggestedReply: reply,
            raw: JSON.stringify(element),
          })
          .onConflictDoNothing({ target: [schema.comments.platform, schema.comments.externalId] })
          .returning({ id: schema.comments.id })
          .all();
        if (inserted.length > 0) {
          newComments++;
          if (matched && reply) {
            matches.push({
              author: element.actor ?? 'inconnu',
              text,
              reply,
              postUrl: post.externalUrl,
            });
          }
        }
      }
    } catch (err) {
      // r_member_social exige un accès LinkedIn spécifique : dégradation propre
      logger.warn({ post: post.id, err: String(err).slice(0, 200) }, 'lecture des commentaires LinkedIn impossible');
    }
  }

  if (matches.length > 0) {
    const rows = matches
      .map(
        (m) => `<tr>
<td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(m.author)}<br/><i>${escapeHtml(m.text.slice(0, 200))}</i></td>
<td style="padding:8px;border-bottom:1px solid #eee">
  <div style="background:#f2f6ff;border-radius:8px;padding:10px;font-size:13px">${escapeHtml(m.reply)}</div>
  ${m.postUrl ? `<a href="${m.postUrl}">Ouvrir le post →</a>` : ''}
</td></tr>`,
      )
      .join('');
    await sendMail({
      kind: 'li_comment_digest',
      to: getApprovalEmail().to,
      subject: `[Odile] 💬 ${matches.length} commentaire(s) LinkedIn à répondre en DM`,
      html: `<p>LinkedIn n'autorise pas l'envoi automatique de messages privés — voici les réponses prêtes à coller :</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<p style="color:#889">Copie la réponse, ouvre le profil du commentateur, colle en message privé. 30 secondes par lead.</p>`,
      text: matches.map((m) => `${m.author} : ${m.text}\n→ Réponse : ${m.reply}\n`).join('\n'),
    });
  }

  return { scanned, newComments, matched: matches.length };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
