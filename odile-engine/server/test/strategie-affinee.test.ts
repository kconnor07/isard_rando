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
