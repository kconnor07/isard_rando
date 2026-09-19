import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-gardefous-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('un compte n’est « en panne » que si la plateforme le refuse', async () => {
  const { HttpError } = await import('../src/lib/http.js');
  const { causeDeLEchec } = await import('../src/publishers/refresh.js');
  const { controleEnPanne } = await import('../src/publishers/linkedinAccounts.js');

  it('401/403 et droit absent = refus ; 5xx, délai et coupure = réseau', () => {
    expect(causeDeLEchec(new HttpError(401, 'https://api.linkedin.com/v2/userinfo', '{}'))).toBe('auth');
    expect(causeDeLEchec(new HttpError(403, 'https://api.linkedin.com/v2/userinfo', '{}'))).toBe('auth');
    expect(causeDeLEchec(new Error('droit w_organization_social absent — reconnecte LinkedIn'))).toBe('auth');
    expect(causeDeLEchec(new HttpError(502, 'https://api.linkedin.com/v2/userinfo', 'Bad Gateway'))).toBe('reseau');
    expect(causeDeLEchec(new HttpError(429, 'https://api.linkedin.com/v2/userinfo', '{}'))).toBe('reseau');
    expect(causeDeLEchec(new Error('The operation was aborted due to timeout'))).toBe('reseau');
    expect(causeDeLEchec(new TypeError('fetch failed'))).toBe('reseau');
  });

  it('un contrôle raté pour le réseau ne met pas le compte en panne, un refus si', () => {
    expect(controleEnPanne({ ok: false, cause: 'reseau', detail: 'HTTP 503 : Service Unavailable' })).toBe(false);
    expect(controleEnPanne({ ok: false, cause: 'auth', detail: 'jeton expiré ou révoqué — reconnecter' })).toBe(true);
    expect(controleEnPanne({ ok: true })).toBe(false);
    // Contrôles enregistrés avant que la cause soit notée : lus à leur texte / statut
    expect(controleEnPanne({ ok: false, detail: 'jeton expiré ou révoqué — reconnecter' })).toBe(true);
    expect(controleEnPanne({ ok: false, status: 500, detail: 'HTTP 500 : erreur' })).toBe(false);
    expect(controleEnPanne({ ok: false, detail: 'fetch failed' })).toBe(false);
  });
});

describe('les comptes en panne sortent de la rotation et de la diffusion', async () => {
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { comptesLinkedIn, prochainComptePersonnel, compteDuCanal, compteDuPost } = await import('../src/publishers/linkedinAccounts.js');
  const { surfacesConnectees } = await import('../src/scheduler/broadcast.js');

  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  deleteToken('meta', 'ig_user');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });
  storeToken({
    provider: 'linkedin',
    subject: 'li_person',
    accountKey: 'alexis',
    externalId: 'alexis',
    accessToken: 't',
    scopes: 'w_member_social',
    meta: { name: 'Alexis', lastCheck: { at: '2026-09-19T00:00:00.000Z', ok: false, cause: 'auth', detail: 'jeton expiré ou révoqué — reconnecter' } },
  });
  storeToken({
    provider: 'linkedin',
    subject: 'li_person',
    accountKey: 'lea',
    externalId: 'lea',
    accessToken: 't',
    scopes: 'w_member_social',
    meta: { name: 'Léa', lastCheck: { at: '2026-09-19T00:00:00.000Z', ok: false, cause: 'reseau', detail: 'HTTP 503 : Service Unavailable' } },
  });
  storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Odile AI' } });

  it('le jeton refusé est en panne, le hoquet réseau non', () => {
    const etats = Object.fromEntries(comptesLinkedIn('li_person').map((c) => [c.key, c.enPanne]));
    expect(etats).toEqual({ khaled: false, alexis: true, lea: false });
    expect(comptesLinkedIn('li_person').find((c) => c.key === 'alexis')?.panne).toMatch(/LinkedIn refuse ce compte/);
    // La page sans droit de publication reste en panne
    expect(comptesLinkedIn('li_org')[0]?.enPanne).toBe(true);
  });

  it('ni copie, ni tour de rôle, ni relais pour un compte en panne', () => {
    expect(surfacesConnectees().map((s) => s.label)).toEqual(['Khaled', 'Léa']);
    for (let i = 0; i < 6; i++) expect(prochainComptePersonnel()?.key).not.toBe('alexis');
    expect(compteDuCanal('li_org')).toBeNull();
    // Un post qui vise explicitement Alexis le garde (le contrôle de conformité le dira) ;
    // une clé périmée ne retombe jamais sur lui.
    expect(compteDuPost({ channel: 'li_personal', liAccountKey: 'alexis' })?.key).toBe('alexis');
    expect(compteDuPost({ channel: 'li_personal', liAccountKey: 'parti' })?.key).toBe('khaled');
  });
});

describe('copie non adaptée, garde-fou de publication et réparations', async () => {
  const { eq } = await import('drizzle-orm');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { setSetting, getDmTriggers } = await import('../src/db/settingsRepo.js');
  const { verifierPost, motifDeRefus, echecDAdaptation } = await import('../src/writer/conformite.js');
  const { realignerSansModele, realignerPost } = await import('../src/scheduler/realigner.js');
  const { processDuePublishJobs } = await import('../src/publishers/worker.js');
  const { schedulePost } = await import('../src/approvals/service.js');
  const { sansLien } = await import('../src/writer/generate.js');
  const { buildServer } = await import('../src/api/server.js');

  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS', 'DIAGNOSTIC', 'AUDIT'], keywords: ['GUIDE'], rdvUrl: 'https://odile.test/rdv' });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'instagram', channel: 'ig', format: 'carousel', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'Commente GUIDE et je t’envoie le guide en message privé.', cta: 'Commente GUIDE', hashtags: '[]', ...values })
      .returning()
      .get();

  it('une adaptation ratée bloque la copie, et une réécriture la débloque', async () => {
    const original = creer({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', broadcastGroup: 'g1', caption: 'Vous perdez du temps. Commente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS' });
    const copie = creer({ broadcastGroup: 'g1', commentTriggerKeyword: 'GUIDE', error: 'texte non adapté à ce compte (Réponse LLM invalide) — texte d’origine conservé, à réécrire' });
    expect(echecDAdaptation(copie.error)).toBe(true);
    const problemes = verifierPost(copie);
    const p = problemes.find((q) => q.code === 'copie-non-adaptee');
    expect(p?.niveau).toBe('bloquant');
    expect(p?.reecriture).toBe(true);
    expect(motifDeRefus(problemes)).toMatch(/n’a pas été adapté/);
    // Valider l'original ne programme pas la copie : elle reste à valider, avec SA raison
    schedulePost(original.id, new Date(Date.now() + 3 * 3600_000).toISOString());
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, original.id)).get()!.status).toBe('scheduled');
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, copie.id)).get()!;
    expect(apres.status).toBe('awaiting_approval');
    expect(apres.error).toMatch(/^texte non adapté/);
    // « Réaligner » fait réécrire la copie (en simulation, le texte est reposé tel quel) et efface la raison
    const r = await realignerPost(copie.id, { modele: true });
    expect(r.reecrit).toBe(true);
    expect(r.corrections.join(' ')).toMatch(/texte réécrit pour Instagram/);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, copie.id)).get()!.error).toBeNull();
    expect(verifierPost(db.select().from(schema.posts).where(eq(schema.posts.id, copie.id)).get()!).map((q) => q.code)).not.toContain('copie-non-adaptee');
  });

  it('corriger le texte à la main efface aussi la raison', async () => {
    const copie = creer({ error: 'plafond IA du jour atteint — texte d’origine conservé' });
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    const res = await app.inject({ method: 'PATCH', url: `/api/posts/${copie.id}`, headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : String(cookie) }, payload: { caption: 'Texte corrigé. Commente GUIDE et je t’envoie le guide en message privé.' } });
    expect(res.statusCode).toBe(200);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, copie.id)).get()!.error).toBeNull();
    await app.close();
  });

  it('un post programmé qui ne tiendrait pas ses promesses ne part pas : il revient à valider', async () => {
    const post = creer({ status: 'scheduled', scheduledAt: new Date(Date.now() - 60000).toISOString(), approvedAt: new Date().toISOString(), caption: 'Le guide est ici : {{link}}. Commente GUIDE.' });
    const job = db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: new Date(Date.now() - 60000).toISOString() }).returning().get();
    const resume = await processDuePublishJobs();
    expect(resume.refuses).toBe(1);
    expect(resume.published).toBe(0);
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(apres.status).toBe('awaiting_approval');
    expect(apres.scheduledAt).toBeNull();
    expect(apres.error).toMatch(/\{\{link\}\}/);
    expect(db.select().from(schema.publishJobs).where(eq(schema.publishJobs.id, job.id)).get()!.state).toBe('canceled');
    // Le fondateur est prévenu par email (outbox en simulation)
    const dir = path.join(config.outboxDir, 'emails');
    const mails = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : [];
    expect(mails.some((m) => m.includes('non publié') && m.includes('{{link}}'))).toBe(true);
  });

  it('un post conforme part toujours', async () => {
    const post = creer({ status: 'scheduled', scheduledAt: new Date(Date.now() - 60000).toISOString(), approvedAt: new Date().toISOString(), commentTriggerKeyword: 'GUIDE' });
    db.insert(schema.slides).values({ postId: post.id, idx: 0, kind: 'hook', content: JSON.stringify({ title: 'x' }) }).run();
    db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: new Date(Date.now() - 60000).toISOString() }).run();
    const resume = await processDuePublishJobs();
    expect(resume.refuses).toBe(0);
    expect(resume.processed).toBe(1);
    // Parti, ou en échec technique (simulation sans rendu) — mais jamais renvoyé à valider
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!.status).not.toBe('awaiting_approval');
  });

  it('la réparation ne touche pas une légende Instagram sans adresse, ni les hashtags d’un post programmé', () => {
    const caption = 'Vous perdez du temps sur vos devis ? Voilà comment faire !\n\nCommente GUIDE et je t’envoie le guide en message privé.';
    const post = creer({ status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), caption, commentTriggerKeyword: 'GUIDE', hashtags: JSON.stringify(['#IA', '#PME', '#Toulouse', '#auto', '#devis', '#agence', '#nocode']) });
    const r = realignerSansModele(post, { hashtags: false });
    expect(r.corrections).toEqual([]);
    expect(r.post.caption).toBe(caption);
    expect(JSON.parse(r.post.hashtags)).toHaveLength(7);
    // Sans l'option, les hashtags sont bornés — mais la légende reste intacte
    const r2 = realignerSansModele(post);
    expect(r2.corrections).toEqual(['hashtags ramenés à 5']);
    expect(r2.post.caption).toBe(caption);
    // Avec une vraie adresse, elle part
    const avecLien = creer({ caption: 'Le guide : https://odile.test/guide . Commente GUIDE et je t’envoie le guide en message privé.', commentTriggerKeyword: 'GUIDE' });
    const r3 = realignerSansModele(avecLien);
    expect(r3.corrections).toContain('adresse retirée de la légende Instagram');
    expect(r3.post.caption).not.toContain('https://');
    expect(r3.post.caption).toContain('Le guide.');
  });

  it('au démarrage, un post programmé garde son texte ; « Réaligner » le corrige à la demande', async () => {
    const { reparerAuDemarrage } = await import('../src/scheduler/realigner.js');
    const { createLink } = await import('../src/shortener/index.js');
    const caption = 'Vous perdez du temps.\n\nCommente GUIDE si vous voulez un diagnostic.';
    const post = creer({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'carousel', status: 'scheduled', scheduledAt: new Date(Date.now() + 86400_000).toISOString(), caption, cta: 'Commente GUIDE', commentTriggerKeyword: 'GUIDE' });
    const lien = createLink('https://source.test/article', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id }).where(eq(schema.posts.id, post.id)).run();
    reparerAuDemarrage();
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(apres.caption).toBe(caption);
    expect(apres.cta).toBe('Commente GUIDE');
    expect(apres.commentTriggerKeyword).toBe('GUIDE');
    expect(apres.status).toBe('scheduled');
    // Le format, lui, suit la plateforme (pas un changement de texte)
    expect(apres.format).toBe('li_doc');
    expect(verifierPost(apres).map((p) => p.code)).toEqual(expect.arrayContaining(['lien-absent', 'motcle-hors-liste']));
    // Sur demande, tout se corrige et le post garde son créneau
    const r = await realignerPost(post.id, { modele: false });
    expect(r.corrections.join(' | ')).toMatch(/lien de la ressource reposé/);
    expect(r.corrections.join(' | ')).toMatch(/mot-clé GUIDE remplacé par/);
    const fin = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(fin.status).toBe('scheduled');
    expect(fin.caption).toContain(`https://odile.test/r/${lien.code}`);
    expect(verifierPost(fin).map((p) => p.code)).not.toContain('lien-absent');
  });

  it('sansLien garde l’espace française avant « ? » et « ! »', () => {
    expect(sansLien('Vous perdez du temps ? Oui ! Voir : https://x.test/a .')).toBe('Vous perdez du temps ? Oui ! Voir.');
    expect(sansLien('Tout est là {{link}} , promis.')).toBe('Tout est là, promis.');
  });
});
