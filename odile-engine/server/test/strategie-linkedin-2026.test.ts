import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-linkedin-2026-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('les règles d’écriture LinkedIn 2026', async () => {
  const { porteUnAppat, sansAppat, tutoie, vouvoie, accroche, finitSurUneQuestion, contientUnLien } = await import('../src/writer/reglesLinkedIn.js');
  const { writerResponseSchema } = await import('../src/writer/generate.js');
  const { commentary } = await import('../src/publishers/linkedin.js');

  it('l’appât à commentaire est reconnu, un verbe ordinaire non', () => {
    expect(porteUnAppat('Commente CAS si vous voulez un diagnostic.')).toBe(true);
    expect(porteUnAppat('Commentez « AUDIT » et je vous réponds.')).toBe(true);
    expect(porteUnAppat('commentez oui si vous êtes d’accord')).toBe(true);
    expect(porteUnAppat('Le dirigeant commente Les Echos chaque matin.')).toBe(false);
    expect(porteUnAppat('Elle commente ChatGPT avec prudence.')).toBe(false);
    expect(sansAppat('Le corps.\n\nEt chez vous ?\n\nCommente CAS pour un diagnostic.')).toBe('Le corps.\n\nEt chez vous ?');
  });

  it('le registre, l’accroche, la question finale et les liens', () => {
    expect(tutoie('Tu perds du temps sur tes devis.')).toBe(true);
    expect(tutoie('Je t’envoie la méthode.')).toBe(true);
    expect(tutoie('Le ton de vos emails compte. Un statut à jour.')).toBe(false);
    expect(tutoie('Un client têtu.')).toBe(false);
    expect(vouvoie('Prenez rendez-vous.')).toBe(false);
    expect(vouvoie('Et chez vous ?')).toBe(true);
    expect(accroche('Première ligne.\nSuite.')).toBe('Première ligne.');
    expect(finitSurUneQuestion('Texte.\n\nEt chez vous, qui relit ?\n\nSource : Les Echos')).toBe(true);
    expect(finitSurUneQuestion('Texte.\n\nÀ garder sous la main.')).toBe(false);
    expect(contientUnLien('Voir https://exemple.fr', 'odileai.com')).toBe(true);
    expect(contientUnLien('Tout est sur odileai.com', 'odileai.com')).toBe(true);
    expect(contientUnLien('Aucun lien ici.', 'odileai.com')).toBe(false);
  });

  it('le rédacteur est renvoyé à sa copie : appât, lien, tutoiement, accroche trop longue', () => {
    const base = {
      archetype: 'objet_halo',
      hook: 'Accroche',
      caption: 'Vos devis partent en trois jours.\n\nEt chez vous, combien de temps ?',
      hashtags: ['#AutomatisationPME'],
      cta: 'Et chez vous ?',
      slides: [{ kind: 'hook', title: 'Titre' }],
      screenshotUrl: null,
      commentTrigger: { enabled: false, keyword: '' },
    };
    const regles = { appatInterdit: true, lienInterdit: true, vouvoiement: true, accrocheCourte: true };
    const schema = writerResponseSchema(0, regles);
    expect(schema.safeParse(base).success).toBe(true);
    const erreurs = (v: object) => {
      const r = schema.safeParse({ ...base, ...v });
      return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
    };
    expect(erreurs({ caption: `${base.caption}\n\nCommente CAS` })).toMatch(/Commente MOT/);
    expect(erreurs({ caption: `${base.caption}\n\nLe guide : {{link}}` })).toMatch(/aucun lien/);
    expect(erreurs({ caption: 'Tu perds du temps.\n\nEt toi ?' })).toMatch(/vouvoiement/);
    expect(erreurs({ caption: `${'Une accroche beaucoup trop longue pour un mobile, '.repeat(4)}\n\nEt chez vous ?` })).toMatch(/première ligne/);
    // Un mot-clé déclaré n'est plus exigé dans le texte quand l'appât est interdit.
    expect(schema.safeParse({ ...base, commentTrigger: { enabled: true, keyword: 'CAS' } }).success).toBe(true);
  });

  it('trois identifications au plus, dans l’ordre de la liste', () => {
    const mentions = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((nom, i) => ({ nom, urn: `urn:li:organization:${i}` }));
    const texte = commentary('Alpha, Beta, Gamma et Delta en parlent.', mentions, 3);
    expect(texte.match(/@\[/g)).toHaveLength(3);
    expect(texte).toContain('Delta en parlent');
    expect(texte).not.toContain('@[Delta]');
  });
});

describe('rédaction et diffusion selon la stratégie 2026', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { draftPost } = await import('../src/writer/generate.js');
  const { verifierPost } = await import('../src/writer/conformite.js');
  const { motcleDeSurface, adapterLegende, diffuserPartout, freresDuGroupe } = await import('../src/scheduler/broadcast.js');
  const { getStrategieLinkedIn, setSetting } = await import('../src/db/settingsRepo.js');

  beforeAll(() => {
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
    deleteToken('meta', 'ig_user');
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });
    storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
    storeToken({ provider: 'meta', subject: 'ig_user', externalId: 'ig1', accessToken: 't', meta: { igUsername: 'odile.ai' } });
    setSetting('image_gen', { enabled: false });
  });

  const actu = () =>
    db
      .insert(schema.newsItems)
      .values({ url: `https://www.lesechos.fr/${Math.random()}`, canonicalUrl: `https://www.lesechos.fr/${Math.random()}`, title: 'Les PME et les devis', contentHash: String(Math.random()), status: 'shortlisted', lang: 'fr' })
      .returning()
      .get();

  it('par défaut : profils publiés par la personne, ni mot-clé ni lien sur les profils, vouvoiement', () => {
    const s = getStrategieLinkedIn();
    expect(s).toMatchObject({ profilsPubliesParLoutil: false, motcleSurLinkedIn: false, lienDansLeCorpsProfils: false, lienDansLeCorpsPage: true, registre: 'vous', hashtagsMax: 3, mentionsMax: 3 });
    expect(s.offre).toBe('un audit offert de 30 minutes');
  });

  it('un post de profil n’a ni lien, ni site, ni mot-clé, ni #OdileAI — mais garde son lien court pour la réponse', async () => {
    const { postId } = await draftPost({ newsItemId: actu().id, channel: 'li_personal', format: 'li_image' });
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    expect(post.commentTriggerKeyword).toBeNull();
    expect(post.caption).not.toMatch(/https?:|\/r\/|odileai\.com|Commente/);
    expect(post.caption.trim().endsWith('Source : Les Echos')).toBe(true);
    expect(JSON.parse(post.hashtags)).not.toContain('#OdileAI');
    expect(post.linkId).toBeTruthy();
    const bloquants = verifierPost(post).filter((p) => p.niveau === 'bloquant').map((p) => p.code);
    expect(bloquants).toEqual([]);
  });

  it('un post de la Page garde son lien et l’adresse du site', async () => {
    const { postId } = await draftPost({ newsItemId: actu().id, channel: 'li_org', format: 'li_image' });
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    expect(post.caption).toMatch(/https:\/\/odile\.test\/r\/[a-z2-9]+/);
    expect(post.commentTriggerKeyword).toBeNull();
    expect(verifierPost(post).filter((p) => p.niveau === 'bloquant')).toEqual([]);
  });

  it('le mot-clé n’existe plus que sur Instagram', () => {
    expect(motcleDeSurface({ id: 3, platform: 'instagram', commentTriggerKeyword: 'GUIDE' }, 'linkedin')).toBeNull();
    // Un post LinkedIn sans mot-clé en reçoit un en partant sur Instagram.
    expect(motcleDeSurface({ id: 3, platform: 'linkedin', commentTriggerKeyword: null }, 'instagram')).toBeTruthy();
  });

  it('adapter un texte pour un profil retire tout lien ; pour la Page, l’emplacement reste', async () => {
    const post = { caption: 'Trois idées.\n\nLe guide : https://odile.test/r/abcd2345\n\nEt chez vous ?', cta: '', commentTriggerKeyword: null, hook: 'h' };
    const profil = await adapterLegende(post, 'linkedin', 'linkedin', null);
    expect(profil.caption).not.toMatch(/https?:|\{\{link\}\}/);
    expect(profil.motcle).toBeNull();
    const page = await adapterLegende(post, 'instagram', 'linkedin', { subject: 'li_org' } as never);
    expect(page.caption).toContain('{{link}}');
  });

  it('diffuser un post de profil : la Page reçoit son lien, Instagram aucune adresse', async () => {
    const { postId } = await draftPost({ newsItemId: actu().id, channel: 'li_personal', format: 'li_image' });
    db.update(schema.slides).set({ renderAssetId: 'a1' }).where(eq(schema.slides.postId, postId)).run();
    const crees = await diffuserPartout(postId);
    expect(crees.length).toBeGreaterThanOrEqual(2);
    const parent = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    const freres = freresDuGroupe(parent);
    const page = freres.find((f) => f.channel === 'li_org')!;
    const insta = freres.find((f) => f.channel === 'ig')!;
    expect(page.caption).toMatch(/\/r\/[a-z2-9]+/);
    expect(page.commentTriggerKeyword).toBeNull();
    expect(JSON.parse(page.hashtags)).not.toContain('#OdileAI');
    // En simulation le texte n'est pas réécrit : le mot-clé Instagram (voir motcleDeSurface)
    // n'est posé que par une vraie réécriture. Aucune adresse, en tout cas.
    expect(insta.caption).not.toMatch(/https?:/);
  });
});

describe('profils en mode brouillon : la personne publie', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { processDuePublishJobs } = await import('../src/publishers/worker.js');
  const { rappelerLesLiens } = await import('../src/publishers/rappelLien.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { buildServer } = await import('../src/api/server.js');
  const { closeBrowser } = await import('../src/render/browser.js');
  const { DEFAULTS } = await import('@odile/shared');

  const programmer = (channel: 'li_personal' | 'li_org') => {
    const post = db
      .insert(schema.posts)
      .values({
        platform: 'linkedin', channel, liAccountKey: channel === 'li_org' ? '77' : 'khaled', format: 'li_image', theme: DEFAULTS.theme,
        status: 'scheduled', hook: 'Trois devis perdus par semaine', caption: 'Vos devis partent trop tard.\n\nEt chez vous, combien de jours ?',
        cta: '', hashtags: '["#Devis"]', resourceKind: 'guide', resourceTitle: 'Relancer un devis', resourceUrl: 'https://exemple.fr/guide', scheduledAt: new Date(Date.now() - 60000).toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.slides).values({ postId: post.id, idx: 0, kind: 'hook', content: JSON.stringify({ kind: 'hook', title: 'Trois devis perdus' }) }).run();
    db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: new Date(Date.now() - 60000).toISOString() }).run();
    const lien = createLink('https://exemple.fr/guide', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id }).where(eq(schema.posts.id, post.id)).run();
    return post;
  };

  it('à l’heure prévue, un post de profil arrive par email, prêt à publier — rien ne part chez LinkedIn', async () => {
    const post = programmer('li_personal');
    const resume = await processDuePublishJobs();
    expect(resume).toMatchObject({ processed: 1, aPublier: 1, published: 0, failed: 0 });
    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(relu.status).toBe('to_publish');
    expect(relu.externalPostId).toBeNull();
    const job = db.select().from(schema.publishJobs).where(eq(schema.publishJobs.postId, post.id)).get()!;
    expect(job.state).toBe('done');
    const sorties = fs.existsSync(config.outboxDir) ? fs.readdirSync(config.outboxDir) : [];
    expect(sorties.some((f) => f.startsWith(`publish-${post.id}-`))).toBe(false);
    const dir = path.join(config.outboxDir, 'emails');
    const mails = fs.readdirSync(dir).filter((f) => f.endsWith('a_publier.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    expect(mails.some((m) => m.includes('Marquer publié') && m.includes('Vos devis partent trop tard'))).toBe(true);
    await closeBrowser();
  }, 120_000);

  it('la Page, elle, part toujours par l’API', async () => {
    const post = programmer('li_org');
    const resume = await processDuePublishJobs();
    expect(resume).toMatchObject({ processed: 1, published: 1, aPublier: 0 });
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!.status).toBe('published');
    await closeBrowser();
  }, 120_000);

  it('« Marquer publié » compte le post, puis le rappel du lien arrive une heure plus tard', async () => {
    const post = db.select().from(schema.posts).where(eq(schema.posts.status, 'to_publish')).get()!;
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const brut = login.headers['set-cookie'];
    const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
    const mauvais = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/mark-published`, headers: { cookie }, payload: { url: 'https://exemple.fr/pas-linkedin' } });
    expect(mauvais.statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/mark-published`, headers: { cookie }, payload: { url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/' } });
    expect(res.statusCode).toBe(200);
    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(relu.status).toBe('published');
    expect(relu.externalUrl).toBe('https://www.linkedin.com/feed/update/urn:li:activity:123/');
    const encore = await app.inject({ method: 'POST', url: `/api/posts/${post.id}/mark-published`, headers: { cookie }, payload: {} });
    expect(encore.statusCode).toBe(409);
    // Le réglage se lit et s'écrit comme les autres
    const reglage = await app.inject({ method: 'GET', url: '/api/settings/linkedin_strategie', headers: { cookie } });
    expect((reglage.json() as { value: { registre: string } }).value.registre).toBe('vous');
    const ecrit = await app.inject({ method: 'PUT', url: '/api/settings/linkedin_strategie', headers: { cookie }, payload: { hashtagsMax: 9 } });
    expect(ecrit.statusCode).toBe(400);
    await app.close();

    expect((await rappelerLesLiens(new Date(Date.now() + 30 * 60000))).envoyes).toBe(0);
    const resume = await rappelerLesLiens(new Date(Date.now() + 61 * 60000));
    expect(resume.envoyes).toBeGreaterThanOrEqual(1);
    const dir = path.join(config.outboxDir, 'emails');
    const rappel = fs.readdirSync(dir).filter((f) => f.endsWith('rappel_lien.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    expect(rappel.some((m) => m.includes('Le guide « Relancer un devis »') && m.includes('https://odile.test/r/'))).toBe(true);
  });
});
