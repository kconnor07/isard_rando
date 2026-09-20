import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import sharp from 'sharp';
import { config } from '../config.js';
import { apercuTunnel, type ApercuTunnel } from '../approvals/tunnel.js';

/** Le même libellé que le dashboard : un lien Instagram ne figure jamais dans la légende, il part en privé. */
function libelleDuLien(t: Pick<ApercuTunnel, 'platform' | 'lienDansLePost'>): string {
  return t.lienDansLePost ? 'Lien dans le post' : t.platform === 'instagram' ? 'Lien (en privé seulement)' : 'Lien (absent du texte)';
}
import { db, schema } from '../db/client.js';
import { getApprovalEmail, getBrand, getDmTriggers } from '../db/settingsRepo.js';
import { createToken } from '../lib/signedToken.js';
import { TEMPLATES_DIR } from '../render/themes.js';
import { freresDuGroupe, surfaceDuPost } from '../scheduler/broadcast.js';
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
  const slot = nextPublishSlot(post.platform as 'linkedin' | 'instagram', new Date(), { platform: post.platform as 'linkedin' | 'instagram', channel: post.channel, liAccountKey: post.liAccountKey });
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

  // Ce que recevra la personne qui commente : on ne fait pas valider une promesse
  // sans la montrer. Un guide mal fabriqué, et c'est le premier échange privé avec
  // un prospect qui déçoit — le pire moment du parcours pour rater quelque chose.
  const base = config.PUBLIC_URL.replace(/\/$/, '');
  // Sur LinkedIn, la ressource s'atteint par le lien du post ; le commentaire, lui,
  // ouvre le diagnostic. Dire « elle recevra le guide » serait faux deux fois.
  const dm = getDmTriggers();
  const viaLien = post.platform === 'linkedin' && dm.linkedinOffer === 'diagnostic';
  // Ce que recevra la personne, tel que le moteur le composera : lien et cible, réponse,
  // message privé, amorce — pour valider en connaissance de cause, depuis l'email aussi.
  const tunnel = apercuTunnel(post.id);
  const ligne = (label: string, texte: string | null | undefined) =>
    texte ? `<p style="margin:4px 0;color:#556;font-size:13px"><b>${label}</b> ${escapeHtml(texte)}</p>` : '';
  const blocTunnel = tunnel
    ? `<div style="margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#f4f6fb;border:1px solid #dfe5f0">
      <p style="margin:0 0 6px;color:#0a0a12;font-size:13px;font-weight:700">Ce que recevra la personne</p>
      ${tunnel.lien ? `<p style="margin:4px 0;color:#556;font-size:13px"><b>${libelleDuLien(tunnel)} :</b> <a href="${escapeHtml(tunnel.lien.shortUrl)}" style="color:#0077cc">${escapeHtml(tunnel.lien.shortUrl)}</a> → <a href="${escapeHtml(tunnel.lien.cible)}" style="color:#0077cc">${escapeHtml(tunnel.lien.cible.slice(0, 90))}</a></p>` : ''}
      <p style="margin:4px 0;color:#556;font-size:13px"><b>Ressource :</b> ${escapeHtml(tunnel.ressource.libelle)}${tunnel.ressource.url ? ` — <a href="${escapeHtml(tunnel.ressource.url)}" style="color:#0077cc">${tunnel.ressource.kind === 'guide' ? 'ouvrir le PDF' : 'voir la page'}</a>` : ''}${tunnel.ressource.erreur ? ` <span style="color:#b45309">(fabrication en échec : ${escapeHtml(tunnel.ressource.erreur.slice(0, 120))})</span>` : ''}</p>
      ${ligne('Réponse sous le commentaire :', tunnel.reponseLinkedIn)}
      ${tunnel.dmInstagram ? ligne('Message privé (1) :', tunnel.dmInstagram.etape1) + ligne('Message privé (2, après réponse) :', tunnel.dmInstagram.etape2) : ''}
      ${ligne('Réponse publique :', tunnel.reponsePublique)}
      ${ligne('Commentaire d’amorce :', tunnel.amorce)}
      ${tunnel.mentions.length ? ligne('Identifiés :', tunnel.mentions.map((m) => `${m.nom} (${m.statut === 'identifiee' ? '@' : m.statut === 'en-clair' ? 'en clair' : 'absent'})`).join(', ')) : ''}
      ${tunnel.avertissements.map((a) => `<p style="margin:4px 0;color:#b45309;font-size:12px">⚠ ${escapeHtml(a)}</p>`).join('')}
    </div>`
    : '';
  const blocRessource = post.commentTriggerKeyword
    ? post.resourceError
      ? `<div style="margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#fff4ed;border:1px solid #f4c9a8;color:#8a4b12;font-size:13px">
      ⚠ <b>La ressource promise n'a pas pu être fabriquée</b> — la personne recevra l'article source à la place, alors que le post promet
      ${post.resourceKind === 'guide' ? 'un guide' : 'autre chose'}.<br/><span style="color:#a9714a">${escapeHtml(post.resourceError.slice(0, 200))}</span>
    </div>`
      : `<p style="margin:8px 0 0;color:#556;font-size:13px">${
          viaLien ? '🔗 Le lien du post donne' : '🎁 Elle recevra'
        } : <b>${
          post.resourceKind === 'guide' ? 'le guide' : post.resourceKind === 'outil' ? 'l’accès à l’outil' : 'l’analyse complète'
        }${post.resourceTitle ? ` « ${escapeHtml(post.resourceTitle)} »` : ''}</b>${
          post.resourceKind === 'guide' && post.resourceAssetId
            ? ` — <a href="${base}/guide/${post.resourceAssetId}" style="color:#0077cc"><b>ouvrir le PDF</b></a>`
            : post.resourceUrl
              ? ` — <a href="${escapeHtml(post.resourceUrl)}" style="color:#0077cc">voir la page</a>`
              : ''
        }</p>`
    : '';

  // Vidéo : on ne valide pas à l'aveugle un post dont le visuel principal est un MP4.
  const ligneVideo =
    post.format === 'reel'
      ? post.videoStatus === 'ready' && post.videoAssetId
        ? `<p style="margin:6px 0 2px;color:#556;font-size:13px">🎬 Vidéo de l'avatar${
            post.videoDurationMs ? ` (${Math.round(post.videoDurationMs / 1000)} s)` : ''
          } — <a href="${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${post.videoAssetId}.mp4" style="color:#0077cc"><b>la regarder avant d'approuver</b></a></p>`
        : `<p style="margin:6px 0 2px;color:#b45309;font-size:13px">⚠ Vidéo indisponible : ${escapeHtml(
            post.videoError ?? 'fabrication en cours',
          )}. Le post partirait avec la seule image de couverture.</p>`
      : '';

  // Diffusion simultanée : l'email le dit, pour que la validation soit donnée en connaissance de cause.
  const autresSurfaces = freresDuGroupe(post).map((f) => surfaceDuPost(f).label);
  const subject = `${settings.subjectPrefix}${opts.reminder ? ' [RELANCE]' : ''} Post à valider · ${CHANNEL_LABELS[post.channel] ?? post.channel}${autresSurfaces.length ? ` +${autresSurfaces.length}` : ''} · ${post.hook.slice(0, 60)}`;

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
    <p style="margin:4px 0;color:#556;font-size:14px">Format : <b>${
      post.format === 'carousel'
        ? `carrousel ${slides.length} slides`
        : post.format === 'li_doc'
          ? `document PDF ${slides.length} pages`
          : post.format === 'reel'
            ? 'vidéo verticale'
            : 'visuel unique'
    }</b> · Thème : <b>${post.theme}</b></p>
    ${news ? `<p style="margin:4px 0;color:#556;font-size:13px">📰 Source : <a href="${news.url}" style="color:#0077cc">${escapeHtml(news.title)}</a><br/><span style="color:#8899aa">${escapeHtml(news.scoreReason ?? '')}</span></p>` : ''}
    ${reviewLine}
    <p style="margin:10px 0 2px;color:#556;font-size:13px">🕒 Si tu approuves, publication programmée : <b>${fmtParis(slot)}</b> (heure de Paris)</p>
    ${autresSurfaces.length ? `<p style="margin:6px 0 2px;color:#556;font-size:13px">📣 Partira aussi, avec la même validation, sur : <b>${escapeHtml(autresSurfaces.join(', '))}</b></p>` : ''}
    ${ligneVideo}
    ${blocTunnel}
  </td></tr>
  <tr><td align="center" style="padding:10px 20px">
    <table role="presentation" cellpadding="0" cellspacing="0">${slideRows.join('')}</table>
  </td></tr>
  <tr><td style="padding:8px 28px">
    <div style="background:#f6f8fb;border-radius:12px;padding:16px 18px;color:#223;font-size:14px;line-height:1.55;white-space:pre-wrap">${escapeHtml(post.caption)}</div>
    <p style="margin:8px 0 0;color:#0077cc;font-size:13px">${escapeHtml(hashtags)}</p>
    ${
      post.commentTriggerKeyword
        ? `<p style="margin:8px 0 0;color:#556;font-size:13px">💬 Déclencheur : commenter « <b>${post.commentTriggerKeyword}</b> »${
            viaLien ? ` → réponse sous le commentaire proposant ${escapeHtml(dm.diagnosticPromise)}` : ''
          }</p>`
        : ''
    }
    ${blocRessource}
  </td></tr>
  <tr><td align="center" style="padding:22px 28px 6px">
    ${btn('✅ Approuver', urlFor('approve'), '#16a34a')}
    ${btn('✏️ Modifier', urlFor('edit'), '#2563eb')}
    ${btn('❌ Rejeter', urlFor('reject'), '#dc2626')}
  </td></tr>
  <tr><td align="center" style="padding:4px 28px 26px">
    <p style="margin:0;color:#99a;font-size:12px">Les liens expirent dans 7 jours. « Approuver » et « Rejeter » ne fonctionnent qu'une fois ; « Modifier » ouvre une session de 2 heures dans ton navigateur.<br/>Rien ne sera publié sans ton accord.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  const text = `Un post ${CHANNEL_LABELS[post.channel] ?? post.channel} attend ta validation.${
    post.format === 'reel' && post.videoStatus === 'ready' && post.videoAssetId
      ? `\nVidéo : ${config.PUBLIC_URL.replace(/\/$/, '')}/public-assets/${post.videoAssetId}.mp4`
      : ''
  }

Hook : ${post.hook}

Caption :
${post.caption}

${hashtags}
${
  tunnel
    ? `
Ce que recevra la personne :
${tunnel.lien ? `- ${libelleDuLien(tunnel)} : ${tunnel.lien.shortUrl} → ${tunnel.lien.cible}\n` : ''}- Ressource : ${tunnel.ressource.libelle}${tunnel.ressource.url ? ` (${tunnel.ressource.url})` : ''}
${tunnel.reponseLinkedIn ? `- Réponse sous le commentaire : ${tunnel.reponseLinkedIn}\n` : ''}${tunnel.dmInstagram ? `- Message privé : ${tunnel.dmInstagram.etape1}${tunnel.dmInstagram.etape2 ? ` | puis : ${tunnel.dmInstagram.etape2}` : ''}\n` : ''}${tunnel.avertissements.map((a) => `- ⚠ ${a}\n`).join('')}`
    : ''
}
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
