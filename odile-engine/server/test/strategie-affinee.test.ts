import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-affinee-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('règles de conformité affinées', async () => {
  const { and, eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getDmTriggers } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { PROMESSE_DM, verifierPost } = await import('../src/writer/conformite.js');
  const { realignerSansModele } = await import('../src/scheduler/realigner.js');
  const { schedulePost } = await import('../src/approvals/service.js');
  const { captionFacebook } = await import('../src/publishers/facebook.js');
  const { apercuTunnel } = await import('../src/approvals/tunnel.js');
  const { REPONSE_PUBLIQUE_PORTE } = await import('../src/webhooks/commentDm.js');
  const { buildServer } = await import('../src/api/server.js');

  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS', 'DIAGNOSTIC', 'AUDIT'], keywords: ['GUIDE'], rdvUrl: 'https://odile.test/rdv', requireFollow: true, publicReply: true });
  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'x', cta: 'x', hashtags: '[]', ...values })
      .returning()
      .get();

  it('« messagerie » et « rendez-vous » ne sont pas des promesses ni des vouvoiements', () => {
    expect(PROMESSE_DM.test('Tu perds 2 h par jour dans ta messagerie.')).toBe(false);
    expect(PROMESSE_DM.test('Je te l’envoie en messagerie privée.')).toBe(true);
    expect(PROMESSE_DM.test('Commente CAS, je vous envoie le détail.')).toBe(true);
    const post = creer({ caption: 'Tu tries ta messagerie à la main ? Prends rendez-vous, on regarde ton cas.\n\nCommente CAS si tu veux un diagnostic.', commentTriggerKeyword: 'CAS' });
    const codes = verifierPost(post).map((p) => p.code);
    expect(codes).not.toContain('dm-promis');
    expect(codes).not.toContain('tu-vous');
  });

  it('un mot-clé hors liste est remplacé sans réécriture, et la slide CTA sera refaite', () => {
    const post = creer({ id: 30, caption: 'Vous perdez du temps.\n\nCommente OUTIL si vous voulez un diagnostic.', cta: 'Commente OUTIL 👇', commentTriggerKeyword: 'OUTIL' });
    db.insert(schema.slides).values({ postId: post.id, idx: 1, kind: 'cta', content: '{}', renderAssetId: 'rendu-cta' }).run();
    expect(verifierPost(post).find((p) => p.code === 'motcle-hors-liste')?.corrigeable).toBe(true);
    const r = realignerSansModele(post);
    expect(r.corrections.join(' | ')).toMatch(/mot-clé OUTIL remplacé par CAS/);
    expect(r.post.commentTriggerKeyword).toBe('CAS');
    expect(r.post.caption).toContain('Commente CAS si vous voulez');
    expect(r.post.cta).toBe('Commente CAS 👇');
    expect(db.select().from(schema.slides).where(and(eq(schema.slides.postId, post.id), eq(schema.slides.kind, 'cta'))).get()!.renderAssetId).toBeNull();
    expect(verifierPost(r.post).map((p) => p.code)).not.toContain('motcle-hors-liste');
  });

  it('la validation dit quelle copie reste à valider, et pourquoi', () => {
    const original = creer({ broadcastGroup: 'g2', caption: 'Vous perdez du temps.\n\nCommente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS' });
    creer({ broadcastGroup: 'g2', platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Commente GUIDE, je t’envoie le guide en message privé.', commentTriggerKeyword: 'GUIDE', error: 'texte non adapté à ce compte (x) — texte d’origine conservé, à réécrire' });
    const outcome = schedulePost(original.id, new Date(Date.now() + 3 * 3600_000).toISOString());
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Une copie reste à valider : Instagram/);
    expect(outcome.message).toMatch(/n’a pas été adapté/);
  });

  it('un guide raté remplacé par l’article reste bloquant tant que le texte promet un guide', () => {
    const post = creer({ caption: 'Je vous ai préparé un guide complet.\n\nCommente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS', resourceKind: 'article', resourceUrl: 'https://source.test/article', resourceError: 'Réponse LLM invalide après 3 tentatives (modèle m, tâche guide)' });
    const p = verifierPost(post).find((q) => q.code === 'guide-manquant');
    expect(p?.niveau).toBe('bloquant');
    expect(p?.message).toMatch(/recevrait l’article source/);
    // Sans promesse de guide dans le texte, l'article de secours convient
    const autre = creer({ caption: 'Voici ce que j’en pense.\n\nCommente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS', resourceKind: 'article', resourceUrl: 'https://source.test/article', resourceError: 'x' });
    expect(verifierPost(autre).map((q) => q.code)).not.toContain('guide-manquant');
  });

  it('porte d’abonnement : la légende Instagram est prévenue, la réponse publique ne ment pas', () => {
    const post = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Commente GUIDE et je t’envoie le guide en message privé.', commentTriggerKeyword: 'GUIDE' });
    const p = verifierPost(post).find((q) => q.code === 'porte-abonnement');
    expect(p?.niveau).toBe('attention');
    const apercu = apercuTunnel(post.id)!;
    expect(apercu.lienDansLePost).toBe(false);
    expect(apercu.reponsePublique).toBe(REPONSE_PUBLIQUE_PORTE);
    expect(apercu.dmInstagram?.etape2).toBeTruthy();
    // Avec l'abonnement annoncé, plus d'avertissement
    const ok = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Abonne-toi et commente GUIDE : je t’envoie le guide en message privé.', commentTriggerKeyword: 'GUIDE' });
    expect(verifierPost(ok).map((q) => q.code)).not.toContain('porte-abonnement');
  });

  it('la légende Facebook garde une ligne qui parle de messagerie', () => {
    const legende = captionFacebook({ caption: 'Ta messagerie déborde ?\nVoici 3 réflexes.\nCommente GUIDE, je t’envoie le guide en message privé.', motcle: 'GUIDE', ressource: 'le guide', urlInstagram: 'https://www.instagram.com/p/x' } as never);
    expect(legende).toContain('Ta messagerie déborde ?');
    expect(legende).not.toContain('en message privé');
  });

  it('l’état du réalignement compte aussi les posts programmés', async () => {
    creer({ status: 'scheduled', scheduledAt: new Date(Date.now() + 86400_000).toISOString(), caption: 'Commente GUIDE, je t’envoie la checklist en message privé.', commentTriggerKeyword: 'GUIDE' });
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const cookie = login.headers['set-cookie'];
    const res = await app.inject({ method: 'GET', url: '/api/posts/realigner/etat', headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : String(cookie) } });
    expect(res.statusCode).toBe(200);
    const etat = res.json() as { total: number; programmes: number; reecritures: number };
    expect(etat.programmes).toBeGreaterThanOrEqual(1);
    expect(etat.reecritures).toBeGreaterThanOrEqual(1);
    expect(etat.total).toBeGreaterThanOrEqual(etat.programmes);
    await app.close();
  });
});

describe('mot-clé manquant, format natif, ligne du lien, guides et articles en ligne', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { setSetting, getDmTriggers, getBlog } = await import('../src/db/settingsRepo.js');
  const { verifierPost, formatPourPlateforme } = await import('../src/writer/conformite.js');
  const { realignerSansModele, reparerAuDemarrage } = await import('../src/scheduler/realigner.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { reciblerLiensDesGuides } = await import('../src/resources/guide.js');
  const { fieldDataEtIgnores, publierDansFramer } = await import('../src/blog/framer.js');
  const { republierArticle } = await import('../src/blog/pipeline.js');

  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS', 'DIAGNOSTIC', 'AUDIT'], keywords: ['GUIDE'], rdvUrl: '' });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'x', cta: 'x', hashtags: '[]', ...values })
      .returning()
      .get();

  it('un post LinkedIn sans mot-clé reçoit le mot de diagnostic — sauf au démarrage s’il est programmé', () => {
    const post = creer({ id: 60, caption: 'Vous perdez du temps sur vos devis.\n\nVoilà ce que je ferais.', cta: '', commentTriggerKeyword: null });
    expect(verifierPost(post).find((p) => p.code === 'motcle-manquant')?.corrigeable).toBe(true);
    const r = realignerSansModele(post);
    expect(r.corrections.join(' | ')).toMatch(/mot-clé CAS attribué/);
    expect(r.corrections.join(' | ')).toMatch(/appel à commenter « CAS » ajouté/);
    expect(r.post.commentTriggerKeyword).toBe('CAS');
    expect(r.post.caption).toMatch(/Commente CAS si vous voulez/);
    expect(verifierPost(r.post).map((p) => p.code)).not.toContain('motcle-manquant');
    // Programmé : le démarrage n'allonge pas un texte validé
    const programme = creer({ status: 'scheduled', scheduledAt: new Date(Date.now() + 86400_000).toISOString(), caption: 'Texte validé, sans appel.', cta: '', commentTriggerKeyword: null });
    reparerAuDemarrage();
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, programme.id)).get()!;
    expect(apres.commentTriggerKeyword).toBeNull();
    expect(apres.caption).toBe('Texte validé, sans appel.');
  });

  it('le format suit la plateforme', () => {
    expect(formatPourPlateforme('carousel', 'linkedin')).toBe('li_doc');
    expect(formatPourPlateforme('li_doc', 'instagram')).toBe('carousel');
    expect(formatPourPlateforme('reel', 'linkedin')).toBe('reel');
    const post = creer({ format: 'carousel', caption: 'Commente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS' });
    expect(verifierPost(post).find((p) => p.code === 'format-plateforme')?.corrigeable).toBe(true);
    const r = realignerSansModele(post);
    expect(r.corrections).toContain('format carousel converti en li_doc');
    expect(r.post.format).toBe('li_doc');
  });

  it('une ligne de lien qui parle d’audit redevient une invitation à ouvrir', () => {
    const post = creer({ caption: 'Vous perdez du temps.\n\nCommente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS', resourceKind: 'article' });
    const lien = createLink('https://source.test/article', { postId: post.id, label: `post-${post.id}` });
    const url = `https://odile.test/r/${lien.code}`;
    db.update(schema.posts).set({ linkId: lien.id, caption: `Vous perdez du temps.\n\nPour un audit gratuit : ${url}\n\nCommente CAS si vous voulez un diagnostic.` }).where(eq(schema.posts.id, post.id)).run();
    const courant = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(verifierPost(courant).find((p) => p.code === 'lien-mal-etiquete')?.message).toMatch(/mène à un article/);
    const r = realignerSansModele(courant);
    expect(r.corrections).toContain('ligne du lien réécrite (elle parlait d’audit ou de diagnostic)');
    expect(r.post.caption).toContain(`C’est ici : ${url}`);
    expect(r.post.caption).not.toContain('audit gratuit');
    expect(verifierPost(r.post).map((p) => p.code)).not.toContain('lien-mal-etiquete');
  });

  it('renseigner le lien de rendez-vous recible les boutons des guides déjà fabriqués', () => {
    const post = creer({ caption: 'Commente CAS si vous voulez un diagnostic.', commentTriggerKeyword: 'CAS' });
    const guide = createLink('https://odileai.com', { postId: post.id, label: `guide-${post.id}` });
    const autre = createLink('https://source.test/article', { postId: post.id, label: `post-${post.id}` });
    expect(reciblerLiensDesGuides('https://odile.test/rdv')).toBeGreaterThanOrEqual(1);
    expect(db.select().from(schema.links).where(eq(schema.links.id, guide.id)).get()!.targetUrl).toBe('https://odile.test/rdv');
    expect(db.select().from(schema.links).where(eq(schema.links.id, autre.id)).get()!.targetUrl).toBe('https://source.test/article');
    expect(reciblerLiensDesGuides('https://odile.test/rdv')).toBe(0);
    expect(reciblerLiensDesGuides('   ')).toBe(0);
  });

  it('les champs sans colonne Framer sont nommés, et un article en ligne se met à jour par son identifiant', async () => {
    const contenu = { slug: 'test-article', title: 'Titre', bodyHtml: '<p>x</p>', excerpt: 'e', coverUrl: null, coverAlt: 'a', date: '2026-09-19', metaTitle: 'MT', metaDescription: 'MD', keywords: ['k'], jsonLd: '{}', author: 'A' };
    const fields = [{ id: 'f1', name: 'Title', type: 'string' }, { id: 'f2', name: 'Content', type: 'formattedText' }];
    const { data, ignores } = fieldDataEtIgnores(contenu, { title: 'f1', body: 'f2', excerpt: '', cover: '', date: '', metaTitle: '', metaDescription: '', keywords: '', jsonLd: '', author: '' }, fields);
    expect(Object.keys(data)).toEqual(['f1', 'f2']);
    expect(ignores).toEqual(['extrait', 'date', 'balise title', 'méta-description', 'mots-clés', 'JSON-LD', 'auteur']);

    setSetting('blog', { ...getBlog(), collectionId: 'col-1' });
    const dry = await publierDansFramer(contenu, getBlog(), { itemId: 'item-42' });
    expect(dry.itemId).toBe('item-42');
    const fichier = dry.url!.replace('file://', '');
    expect(JSON.parse(fs.readFileSync(fichier, 'utf8')).itemId).toBe('item-42');
    expect(fichier.startsWith(config.outboxDir)).toBe(true);

    const article = {
      slug: 'automatiser-devis-toulouse',
      title: 'Automatiser ses devis à Toulouse : le guide des PME',
      metaTitle: 'Automatiser ses devis à Toulouse : guide PME',
      metaDescription: 'Comment une PME toulousaine automatise ses devis avec l’IA, sans changer d’outil ni recruter : méthode, coûts, délais.',
      excerpt: 'Un guide concret pour les PME de Toulouse qui veulent envoyer leurs devis plus vite, sans erreur.',
      coverTitle: 'Devis automatisés',
      directAnswer: 'Une PME toulousaine peut automatiser ses devis en une semaine, avec ses outils actuels.',
      primaryKeyword: 'automatiser devis Toulouse',
      keyTakeaways: ['Un devis part en dix minutes au lieu d’une journée.', 'Aucun changement d’outil n’est nécessaire.', 'Le retour sur investissement se mesure dès le premier mois.'],
      sections: [
        { h2: 'Pourquoi automatiser ses devis', paragraphs: ['Parce que chaque heure passée à recopier des lignes est une heure sans client.'] },
        { h2: 'La méthode en trois étapes', paragraphs: ['On part de vos devis existants, on repère les blocs répétés, on branche l’IA dessus.'] },
        { h2: 'Ce que ça change à Toulouse', paragraphs: ['Les artisans et cabinets toulousains répondent le jour même : c’est ce qui fait la différence.'] },
      ],
      faq: [
        { question: 'Combien de temps faut-il pour automatiser ses devis ?', answer: 'Une semaine suffit dans la plupart des PME, sans changer d’outil ni former une équipe.' },
        { question: 'Est-ce que ça marche avec mon logiciel actuel ?', answer: 'Oui : l’automatisation se branche sur ce que vous utilisez déjà, tableur ou logiciel métier.' },
        { question: 'Combien ça coûte pour une PME ?', answer: 'Beaucoup moins qu’une embauche : le coût se compare à quelques heures de travail par mois.' },
      ],
      sources: [{ title: 'Source', url: 'https://source.test' }],
      keywords: ['devis', 'Toulouse', 'automatisation'],
      localAngle: 'À Toulouse, les PME…',
    };
    const row = db
      .insert(schema.articles)
      .values({ slug: article.slug, title: article.title, excerpt: article.excerpt, metaTitle: article.metaTitle, metaDescription: article.metaDescription, content: JSON.stringify(article), status: 'published', framerItemId: 'item-42', publishedUrl: 'https://odileai.com/blog/automatiser-devis-toulouse', publishedAt: '2026-09-01T08:00:00.000Z', createdAt: '2026-09-01T07:00:00.000Z', updatedAt: '2026-09-01T07:00:00.000Z' } as never)
      .returning()
      .get();
    const res = await republierArticle(row.id);
    expect(res.url).toBe('https://odileai.com/blog/automatiser-devis-toulouse');
    const apres = db.select().from(schema.articles).where(eq(schema.articles.id, row.id)).get()!;
    expect(apres.status).toBe('published');
    expect(apres.jsonLd).toContain('"dateModified"');
    expect(JSON.parse(apres.jsonLd)['@graph'].find((n: { '@type': string }) => n['@type'] === 'BlogPosting').dateModified >= '2026-09-19').toBe(true);
    // Un article sans identifiant Framer connu ne se met pas à jour à l'aveugle
    const orphelin = db.insert(schema.articles).values({ ...row, id: undefined, slug: 'autre', framerItemId: null } as never).returning().get();
    await expect(republierArticle(orphelin.id)).rejects.toThrow(/item Framer connu/);
    void path;
  });
});

describe('créneaux par compte, rappels et alertes', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getDmTriggers, getBrand } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { nextPublishSlot, cleDeSurface } = await import('../src/scheduler/cadence.js');
  const { schedulePost } = await import('../src/approvals/service.js');
  const { verifierPost } = await import('../src/writer/conformite.js');
  const { postsARappeler, rappelerCommentairesLinkedIn } = await import('../src/webhooks/linkedinPoller.js');
  const { alerterComptesRefuses } = await import('../src/publishers/refresh.js');

  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  deleteToken('meta', 'ig_user');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes: 'w_member_social r_member_social', meta: { name: 'Alexis' } });
  storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
  storeToken({ provider: 'meta', subject: 'ig_user', externalId: 'ig1', accessToken: 't', meta: { igUsername: 'odile.ai' } });
  setSetting('publish_slots', { li: [{ dow: 2, time: '08:30' }, { dow: 4, time: '08:30' }], ig: [{ dow: 3, time: '12:00' }] });
  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS', 'DIAGNOSTIC', 'AUDIT'], keywords: ['GUIDE'], rdvUrl: 'https://odile.test/rdv' });
  setSetting('brand', { ...getBrand(), name: 'Odile AI' });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'Odile AI vous aide.\n\nCommente CAS si vous voulez un diagnostic.', cta: 'Commente CAS', hashtags: '[]', commentTriggerKeyword: 'CAS', ...values })
      .returning()
      .get();

  it('un créneau pris par Khaled reste libre pour Alexis et pour la page', () => {
    const premier = nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', liAccountKey: 'khaled' });
    const post = creer({ status: 'scheduled', scheduledAt: premier.toISOString(), approvedAt: new Date().toISOString() });
    db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: premier.toISOString() }).run();
    expect(nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', liAccountKey: 'alexis' }).getTime()).toBe(premier.getTime());
    expect(nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', channel: 'li_org', liAccountKey: '77' }).getTime()).toBe(premier.getTime());
    expect(nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', liAccountKey: 'khaled' }).getTime()).toBeGreaterThan(premier.getTime());
    // Sans surface (anciens appels) : tout job compte comme pris
    expect(nextPublishSlot('linkedin').getTime()).toBeGreaterThan(premier.getTime());
    expect(cleDeSurface({ platform: 'instagram' })).toBe('ig');
    expect(cleDeSurface({ platform: 'linkedin', liAccountKey: 'alexis' })).toBe('li_personal:alexis');
    expect(cleDeSurface({ platform: 'linkedin', channel: 'li_org', liAccountKey: '77' })).toBe('li_org:77');
  });

  it('une diffusion s’enchaîne compte par compte, juste après l’original, sans attendre deux semaines', () => {
    const quand = nextPublishSlot('linkedin', new Date(Date.now() + 14 * 86400_000), { platform: 'linkedin', liAccountKey: 'khaled' });
    const original = creer({ broadcastGroup: 'g3' });
    const alexis = creer({ broadcastGroup: 'g3', liAccountKey: 'alexis' });
    const page = creer({ broadcastGroup: 'g3', channel: 'li_org', liAccountKey: '77' });
    const insta = creer({ broadcastGroup: 'g3', platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Commente GUIDE et je t’envoie le guide en message privé.', cta: 'Commente GUIDE', commentTriggerKeyword: 'GUIDE' });
    const outcome = schedulePost(original.id, quand.toISOString());
    expect(outcome.ok).toBe(true);
    const lire = (id: number) => db.select().from(schema.posts).where(eq(schema.posts.id, id)).get()!;
    const tAlexis = new Date(lire(alexis.id).scheduledAt!).getTime();
    const tPage = new Date(lire(page.id).scheduledAt!).getTime();
    const tInsta = new Date(lire(insta.id).scheduledAt!).getTime();
    // Chaque compte prend SON prochain créneau après l'original : le suivant du calendrier (deux jours), pas la semaine d'après
    expect(tAlexis).toBeGreaterThan(quand.getTime());
    expect(tAlexis - quand.getTime()).toBeLessThanOrEqual(2 * 86400_000);
    // La page a droit au même créneau qu'Alexis, décalée de 45 minutes : jamais la même minute
    expect(tPage).toBeGreaterThan(tAlexis);
    expect(tPage - tAlexis).toBe(45 * 60_000);
    expect(tInsta).toBeGreaterThan(quand.getTime());
    expect(tInsta - quand.getTime()).toBeLessThanOrEqual(7 * 86400_000);
  });

  it('un post LinkedIn qui ne nomme pas la marque est signalé', () => {
    const sans = creer({ caption: 'Vous perdez du temps.\n\nCommente CAS si vous voulez un diagnostic.' });
    expect(verifierPost(sans).find((p) => p.code === 'marque-absente')?.niveau).toBe('attention');
    const avec = creer({});
    expect(verifierPost(avec).map((p) => p.code)).not.toContain('marque-absente');
  });

  it('le lendemain d’un post dont les commentaires sont illisibles, un rappel part — une fois', async () => {
    const hier = new Date(Date.now() - 20 * 3600_000).toISOString();
    const khaled = creer({ status: 'published', publishedAt: hier, externalPostId: 'urn:li:share:1', externalUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1' });
    creer({ status: 'published', publishedAt: hier, externalPostId: 'urn:li:share:2', liAccountKey: 'alexis' }); // Alexis lit ses commentaires : pas de rappel
    creer({ status: 'published', publishedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), externalPostId: 'urn:li:share:3' }); // trop vieux
    const liste = postsARappeler();
    expect(liste.map((r) => r.post.id)).toEqual([khaled.id]);
    expect(liste[0]!.reponse).toBeTruthy();
    expect((await rappelerCommentairesLinkedIn()).rappels).toBe(1);
    expect((await rappelerCommentairesLinkedIn()).rappels).toBe(0);
    expect(postsARappeler()).toEqual([]);
  });

  it('un compte refusé par la plateforme est signalé par email, pas un hoquet réseau, et pas deux fois', async () => {
    const base = { provider: 'linkedin' as const, subject: 'li_person' as const, label: 'LinkedIn — Khaled', checkedAt: new Date().toISOString() };
    expect(await alerterComptesRefuses([{ ...base, ok: false, detail: 'HTTP 503', cause: 'reseau' }])).toBe(false);
    expect(await alerterComptesRefuses([{ ...base, ok: false, detail: 'jeton expiré ou révoqué — reconnecter', cause: 'auth' }])).toBe(true);
    expect(await alerterComptesRefuses([{ ...base, ok: false, detail: 'jeton expiré ou révoqué — reconnecter', cause: 'auth' }])).toBe(false);
  });
});
