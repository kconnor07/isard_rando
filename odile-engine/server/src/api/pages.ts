/** Pages HTML autonomes (hors dashboard) : atterrissage des liens d'email. */

const SHELL = (title: string, body: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{margin:0;background:#07070c;color:#f2f5fa;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;box-sizing:border-box}
  .card{max-width:560px;width:100%;background:#101018;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:36px}
  h1{font-size:22px;margin:0 0 12px}
  p{color:#aab3c2;line-height:1.55;font-size:15px}
  .accent{color:#39aaff}
  button,.btn{display:inline-block;border:0;border-radius:999px;padding:14px 30px;font-size:16px;font-weight:700;
       cursor:pointer;text-decoration:none;margin:8px 8px 0 0}
  .approve{background:#16a34a;color:#fff}.reject{background:#dc2626;color:#fff}.neutral{background:#2563eb;color:#fff}
  label{display:flex;gap:10px;align-items:center;color:#aab3c2;font-size:14px;margin-top:14px}
  textarea{width:100%;box-sizing:border-box;background:#0a0a12;color:#eee;border:1px solid rgba(255,255,255,.15);
       border-radius:12px;padding:12px;margin-top:10px;font-family:inherit}
  .ok{color:#4ade80}.err{color:#f87171}
</style></head><body><div class="card">${body}</div></body></html>`;

export function approvalLandingPage(args: {
  action: 'approve' | 'reject' | 'edit';
  token: string;
  hook: string;
  channel: string;
  scheduledPreview: string;
}): string {
  const { action, token, hook, channel, scheduledPreview } = args;
  if (action === 'approve') {
    return SHELL(
      'Approuver le post',
      `<h1>✅ Approuver ce post ?</h1>
<p>« <span class="accent">${escapeHtml(hook)}</span> » — ${escapeHtml(channel)}</p>
<p>Publication programmée : <b>${escapeHtml(scheduledPreview)}</b> (heure de Paris).</p>
<form method="post" action="/a/${token}/confirm">
  <label><input type="checkbox" name="publishNow" value="1"> Publier immédiatement plutôt qu'au créneau optimal</label>
  <button class="approve" type="submit">Confirmer l'approbation</button>
</form>
<p style="font-size:13px">Rien n'est encore fait : ce clic de confirmation est la seule action qui déclenche la programmation.</p>`,
    );
  }
  if (action === 'reject') {
    return SHELL(
      'Rejeter le post',
      `<h1>❌ Rejeter ce post ?</h1>
<p>« <span class="accent">${escapeHtml(hook)}</span> » — ${escapeHtml(channel)}</p>
<form method="post" action="/a/${token}/confirm">
  <textarea name="reason" rows="3" placeholder="Raison (facultatif — aide l'IA à mieux faire la prochaine fois)"></textarea>
  <button class="reject" type="submit">Confirmer le rejet</button>
</form>`,
    );
  }
  return SHELL(
    'Ouvrir l’éditeur',
    `<h1>✏️ Modifier ce post</h1>
<p>« <span class="accent">${escapeHtml(hook)}</span> »</p>
<form method="post" action="/a/${token}/confirm">
  <button class="neutral" type="submit">Ouvrir l'éditeur du dashboard</button>
</form>
<p style="font-size:13px">Une session sécurisée sera ouverte dans ton navigateur.</p>`,
  );
}

export function resultPage(ok: boolean, message: string, extra = ''): string {
  return SHELL(
    ok ? 'C’est fait' : 'Impossible',
    `<h1 class="${ok ? 'ok' : 'err'}">${ok ? '✔' : '✖'} ${escapeHtml(message)}</h1>${extra}
<p>Tu peux fermer cet onglet.</p>`,
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
