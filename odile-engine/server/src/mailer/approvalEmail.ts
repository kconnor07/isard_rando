import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import sharp from 'sharp';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getBrand } from '../db/settingsRepo.js';
import { createToken } from '../lib/signedToken.js';
import { TEMPLATES_DIR } from '../render/themes.js';
import { nextPublishSlot } from '../scheduler/cadence.js';
import { sendMail } from './smtp.js';

const nanoJti = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

const CHANNEL_LABELS: Record<string, string> = {
  ig: 'Instagram',
  li_personal: 'LinkedIn (profil)',
  li_org: 'LinkedIn (page entreprise)',
};

function fmtParis(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Envoie l'email de validation d'un post (aperçus inline + liens signés). */
export async function sendApprovalEmail(
  postId: number,
  opts: { reminder?: boolean } = {},
): Promise<{ ok: boolean }> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const slides = db
    .select()
    .from(schema.slides)
    .where(eq(schema.slides.postId, postId))
    .orderBy(schema.slides.idx)
    .all();
  const settings = getApprovalEmail();
  const brand = getBrand();

  // Jeton d'action à usage unique (partagé par les 3 liens ; 1ʳᵉ action gagne)
  const jti = nanoJti();
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  db.insert(schema.approvals)
    .values({
      postId,
      jti,
      kind: 'approval',
      sentTo: settings.to,
      expiresAt: new Date(exp * 1000).toISOString(),
    })
    .run();
  const urlFor = (act: 'approve' | 'reject' | 'edit') =>
    `${config.PUBLIC_URL}/a/${createToken({ jti, pid: postId, act, exp })}`;

  // Aperçus inline (CID), réduits pour rester < 3 Mo
  const attachments: { filename: string; content: Buffer; cid: string; contentType: string }[] = [];

  // Logo officiel dans l'en-tête (blanc sur fond sombre)
  const logoPath = path.join(TEMPLATES_DIR, 'brand', 'logo-odile.png');
  const hasLogo = fs.existsSync(logoPath);
  if (hasLogo) {
    attachments.push({
      filename: 'logo.png',
      content: fs.readFileSync(logoPath),
      cid: 'brandlogo@odile',
      contentType: 'image/png',
    });
  }
  const slideImgs: string[] = [];
  for (const slide of slides) {
    if (!slide.renderAssetId) continue;
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, slide.renderAssetId)).get();
    if (!asset || !fs.existsSync(asset.path)) continue;
    const jpeg = await sharp(asset.path).resize({ width: 480 }).jpeg({ quality: 74 }).toBuffer();
    const cid = `slide-${slide.idx}@odile`;
    attachments.push({ filename: `slide-${slide.idx + 1}.jpg`, content: jpeg, cid, contentType: 'image/jpeg' });
    slideImgs.push(
      `<td style="padding:6px"><img src="cid:${cid}" width="230" style="width:230px;border-radius:12px;display:block" alt="Slide ${slide.idx + 1}"/></td>`,
    );
  }
  const slideRows: string[] = [];
  for (let i = 0; i < slideImgs.length; i += 2) {
    slideRows.push(`<tr>${slideImgs.slice(i, i + 2).join('')}</tr>`);
  }

  const news = post.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, post.newsItemId)).get()
    : null;
  const review = post.reviewSummary ? (JSON.parse(post.reviewSummary) as { iterations: number; finalScores: Record<string, number>; passed: boolean }) : null;
  const slot = nextPublishSlot(post.platform as 'linkedin' | 'instagram');
  const hashtags = (JSON.parse(post.hashtags) as string[]).join(' ');

  const btn = (label: string, url: string, color: string) =>
    `<a href="${url}" style="display:inline-block;padding:14px 28px;margin:0 6px 10px 0;border-radius:999px;background:${color};color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">${label}</a>`;

  const reviewLine = review
    ? `<p style="margin:6px 0;color:#8899aa;font-size:13px">🎨 Studio de design : ${review.iterations} itération(s) — scores ${Object.entries(
        review.finalScores,
      )
        .map(([k, v]) => `${k.replace('_', ' ')} ${v}`)
        .join(' · ')} ${review.passed ? '✔ validé' : '⚠ seuil non atteint (à vérifier)'}</p>`
    : '';

  const subject = `${settings.subjectPrefix}${opts.reminder ? ' [RELANCE]' : ''} Post à valider · ${CHANNEL_LABELS[post.channel] ?? post.channel} · ${post.hook.slice(0, 60)}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f2f4f8;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0a0a12;padding:20px 28px">
    ${
      hasLogo
        ? `<img src="cid:brandlogo@odile" height="34" alt="${brand.name}" style="height:34px;vertical-align:middle"/>`
        : `<span style="color:#ffffff;font-weight:800;font-size:18px">${brand.name}</span>`
    }
    <span style="color:#0099ff;font-weight:700;font-size:13px;margin-left:12px">moteur de publication</span>
  </td></tr>
  <tr><td style="padding:26px 28px 8px">
    <h1 style="margin:0 0 4px;font-size:20px;color:#0a0a12">Un post ${CHANNEL_LABELS[post.channel] ?? post.channel} attend ta validation</h1>
    <p style="margin:4px 0;color:#556;font-size:14px">Format : <b>${post.format === 'carousel' ? `carrousel ${slides.length} slides` : 'visuel unique'}</b> · Thème : <b>${post.theme}</b></p>
    ${news ? `<p style="margin:4px 0;color:#556;font-size:13px">📰 Source : <a href="${news.url}" style="color:#0077cc">${escapeHtml(news.title)}</a><br/><span style="color:#8899aa">${escapeHtml(news.scoreReason ?? '')}</span></p>` : ''}
    ${reviewLine}
    <p style="margin:10px 0 2px;color:#556;font-size:13px">🕒 Si tu approuves, publication programmée : <b>${fmtParis(slot)}</b> (heure de Paris)</p>
  </td></tr>
  <tr><td align="center" style="padding:10px 20px">
    <table role="presentation" cellpadding="0" cellspacing="0">${slideRows.join('')}</table>
  </td></tr>
  <tr><td style="padding:8px 28px">
    <div style="background:#f6f8fb;border-radius:12px;padding:16px 18px;color:#223;font-size:14px;line-height:1.55;white-space:pre-wrap">${escapeHtml(post.caption)}</div>
    <p style="margin:8px 0 0;color:#0077cc;font-size:13px">${escapeHtml(hashtags)}</p>
    ${post.commentTriggerKeyword ? `<p style="margin:8px 0 0;color:#556;font-size:13px">💬 Déclencheur DM : commenter « <b>${post.commentTriggerKeyword}</b> »</p>` : ''}
  </td></tr>
  <tr><td align="center" style="padding:22px 28px 6px">
    ${btn('✅ Approuver', urlFor('approve'), '#16a34a')}
    ${btn('✏️ Modifier', urlFor('edit'), '#2563eb')}
    ${btn('❌ Rejeter', urlFor('reject'), '#dc2626')}
  </td></tr>
  <tr><td align="center" style="padding:4px 28px 26px">
    <p style="margin:0;color:#99a;font-size:12px">Les liens expirent dans 7 jours et ne fonctionnent qu'une fois.<br/>Rien ne sera publié sans ton accord.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  const text = `Un post ${CHANNEL_LABELS[post.channel] ?? post.channel} attend ta validation.

Hook : ${post.hook}

Caption :
${post.caption}

${hashtags}

Approuver : ${urlFor('approve')}
Modifier  : ${urlFor('edit')}
Rejeter   : ${urlFor('reject')}

Si approuvé, publication : ${fmtParis(slot)} (Paris).`;

  const result = await sendMail({
    kind: opts.reminder ? 'reminder' : 'approval',
    to: settings.to,
    subject,
    html,
    text,
    postId,
    attachments,
  });
  return { ok: result.ok };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
