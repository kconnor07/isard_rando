import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-approb-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('approbation par email (le chemin des boutons de l’email)', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getDmTriggers, getBrand } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { executeApprovalAction } = await import('../src/approvals/service.js');

  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS'], rdvUrl: 'https://odile.test/rdv' });
  setSetting('brand', { ...getBrand(), name: 'Odile AI' });
  deleteToken('linkedin', 'li_person');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });

  const creer = (values: Partial<typeof schema.posts.$inferInsert> = {}) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'Odile AI vous fait gagner du temps.\n\nCommente CAS si vous voulez un diagnostic.', cta: 'Commente CAS', hashtags: '[]', commentTriggerKeyword: 'CAS', ...values })
      .returning()
      .get();
  const jeton = (postId: number, act: 'approve' | 'reject') => {
    const jti = `jti${postId}${act}`;
    db.insert(schema.approvals).values({ postId, jti, kind: 'approval', sentTo: 'a@b.c', expiresAt: new Date(Date.now() + 86400_000).toISOString() }).run();
    return { v: 1 as const, jti, pid: postId, act, exp: Math.floor(Date.now() / 1000) + 3600 };
  };

  it('« Approuver » depuis l’email programme le post', () => {
    const post = creer();
    const r = executeApprovalAction(jeton(post.id, 'approve'), { ip: '1.2.3.4' });
    expect(r.ok).toBe(true);
    expect(r.scheduledAt).toBeTruthy();
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!.status).toBe('scheduled');
    // Le lien est à usage unique
    const encore = executeApprovalAction({ v: 1, jti: `jti${post.id}approve`, pid: post.id, act: 'approve', exp: Math.floor(Date.now() / 1000) + 3600 }, {});
    expect(encore.ok).toBe(false);
    expect(encore.message).toMatch(/déjà été utilisé/);
  });

  it('« Approuver » refuse un post qui ne tiendrait pas ses promesses', () => {
    const post = creer({ caption: 'Odile AI vous aide.\n\nCommente CAS, je t’envoie le guide en message privé.' });
    const r = executeApprovalAction(jeton(post.id, 'approve'), {});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/message privé/);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!.status).toBe('awaiting_approval');
  });

  it('« Rejeter » depuis l’email rejette le post et annule son job', () => {
    const post = creer();
    db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: new Date(Date.now() + 86400_000).toISOString() }).run();
    const r = executeApprovalAction(jeton(post.id, 'reject'), { reason: 'hors sujet' });
    expect(r.ok).toBe(true);
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(apres.status).toBe('rejected');
    expect(apres.rejectReason).toBe('hors sujet');
    expect(db.select().from(schema.publishJobs).where(eq(schema.publishJobs.postId, post.id)).get()!.state).toBe('canceled');
  });

  it('un lien inconnu ne fait rien', () => {
    expect(executeApprovalAction({ v: 1, jti: 'inconnu', pid: 1, act: 'approve', exp: Math.floor(Date.now() / 1000) + 60 }, {}).ok).toBe(false);
  });
});

describe('routes du dashboard : surfaces, aperçu du tunnel, réalignement', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { setSetting, getCadence } = await import('../src/db/settingsRepo.js');
  const { buildServer } = await import('../src/api/server.js');

  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  deleteToken('meta', 'ig_user');
  deleteToken('meta', 'fb_page');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled 💻 Aboubakar' } });
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Alexis Duquenoy', lastCheck: { at: '2026-09-19T00:00:00.000Z', ok: false, cause: 'auth', detail: 'jeton expiré ou révoqué' } } });
  storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
  storeToken({ provider: 'meta', subject: 'ig_user', externalId: 'ig1', accessToken: 't', meta: { igUsername: 'odile.ai' } });
  storeToken({ provider: 'meta', subject: 'fb_page', externalId: 'page1', accessToken: 't', meta: { name: 'Odile AI' } });
  setSetting('cadence', { ...getCadence(), broadcast: true });

  const app = await buildServer();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
  const brut = login.headers['set-cookie'];
  const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it('GET /api/surfaces liste chaque compte, ses initiales et son état', async () => {
    const res = await get('/api/surfaces');
    expect(res.statusCode).toBe(200);
    const surfaces = res.json() as { key: string; label: string; initiales: string; enPanne: boolean; platform: string }[];
    expect(surfaces.map((s) => s.key)).toEqual(['khaled', 'alexis', '77', 'ig', 'fb']);
    // Les émojis du nom LinkedIn ne comptent pas comme une initiale
    expect(surfaces.find((s) => s.key === 'khaled')!.initiales).toBe('KA');
    expect(surfaces.find((s) => s.key === '77')!.label).toBe('page Odile AI');
    expect(surfaces.find((s) => s.key === 'alexis')!.enPanne).toBe(true);
    // Un compte en panne reste listé (le calendrier doit le montrer), Facebook suit le miroir
    expect(surfaces.find((s) => s.key === 'fb')!.platform).toBe('facebook');
  });

  it('GET /api/posts/:id/tunnel donne ce que recevra la personne', async () => {
    const post = db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'h', caption: 'Odile AI.\n\nC’est ici : https://odile.test/r/abcdef\n\nCommente CAS si vous voulez un diagnostic.', cta: 'Commente CAS', hashtags: '[]', commentTriggerKeyword: 'CAS' })
      .returning()
      .get();
    const res = await get(`/api/posts/${post.id}/tunnel`);
    expect(res.statusCode).toBe(200);
    const t = res.json() as { motcle: string; lienDansLePost: boolean; reponseManuelle: boolean; avertissements: string[] };
    expect(t.motcle).toBe('CAS');
    expect(t.lienDansLePost).toBe(true);
    // Sans droit de lecture, la réponse est à coller à la main : l'aperçu le dit
    expect(t.reponseManuelle).toBe(true);
    expect(t.avertissements.join(' ')).toMatch(/coller soi-même/);
    expect((await get('/api/posts/999999/tunnel')).statusCode).toBe(404);
  });

  it('POST /api/posts/:id/realigner corrige sans modèle et rend compte', async () => {
    const post = db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', format: 'carousel', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'h', caption: 'Odile AI vous aide.\n\nCommente CAS si vous voulez un diagnostic.', cta: 'Commente CAS', hashtags: JSON.stringify(['#IA', '#PME', '#Toulouse', '#devis', '#automatisation']), commentTriggerKeyword: 'CAS' })
      .returning()
      .get();
    const res = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/realigner`, headers: { cookie }, payload: { modele: false } });
    expect(res.statusCode).toBe(200);
    const r = res.json() as { corrections: string[]; message: string };
    expect(r.corrections.join(' | ')).toMatch(/compte attribué/);
    expect(r.corrections.join(' | ')).toMatch(/hashtags ramenés à 3/);
    expect(r.corrections.join(' | ')).toMatch(/format carousel converti en li_doc/);
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    // Jamais sur un compte en panne
    expect(apres.liAccountKey).toBe('khaled');
    expect(apres.format).toBe('li_doc');
    expect((await app.inject({ method: 'POST', url: '/api/posts/999999/realigner', headers: { cookie }, payload: { modele: false } })).statusCode).toBe(404);
  });

  it('sans session, rien ne répond', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/surfaces' })).statusCode).toBe(401);
  });
});
