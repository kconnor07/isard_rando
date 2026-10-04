import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-faits-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('signaux d’IA, pitch et réécriture', async () => {
  const { signauxIA, porteUnPitch, tauxDeReecriture, faitACompleter } = await import('../src/writer/reglesLinkedIn.js');

  it('les signes d’un texte écrit par une IA sont nommés, un texte sobre passe', () => {
    const ia = 'Dans un monde où tout va vite — vraiment — il faut booster vos workflows.\n→ 100 % automatisé\n→ Zéro erreur';
    const signaux = signauxIA(ia).join(' | ');
    expect(signaux).toMatch(/flèches/);
    expect(signaux).toMatch(/tirets longs/);
    expect(signaux).toMatch(/dans un monde où/);
    expect(signaux).toMatch(/workflows/);
    expect(signaux).toMatch(/invérifiable/);
    expect(signauxIA('Vos devis partent en trois jours. Ceux de vos concurrents en trois heures.\n\nEt chez vous ?')).toEqual([]);
  });

  it('le pitch : la marque ou l’offre, en mot entier', () => {
    expect(porteUnPitch('Chez Odile, on regarde ça.', ['Odile'], 'un audit offert de 30 minutes')).toBe(true);
    expect(porteUnPitch('Réservez un audit offert de 30 minutes.', ['Odile'], 'un audit offert de 30 minutes')).toBe(true);
    expect(porteUnPitch('Odilette est un prénom rare.', ['Odile'], 'un audit offert de 30 minutes')).toBe(false);
  });

  it('le taux de réécriture va de 0 (texte de l’IA tel quel) à 1 (tout réécrit)', () => {
    const genere = 'Vos devis partent en trois jours. Vos concurrents répondent en trois heures. Et chez vous ?';
    expect(tauxDeReecriture(genere, genere)).toBe(0);
    expect(tauxDeReecriture(genere, 'Rien à voir avec le texte de départ.')).toBeGreaterThan(0.8);
    const retouche = tauxDeReecriture(genere, 'Vos devis partent en trois jours. Chez le plombier que j’ai vu mardi, cinq. Et chez vous ?');
    expect(retouche).toBeGreaterThan(0.2);
    expect(retouche).toBeLessThan(0.7);
    expect(faitACompleter('Texte.\n[FAIT VÉCU : un appel de la semaine]\nSuite.')).toBe(true);
    expect(faitACompleter('Texte sans emplacement.')).toBe(false);
  });
});

describe('banque de faits, promotion plafonnée, sujets entre fondateurs', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { ajouterFait, faitsPourLeCompte, noterUsage } = await import('../src/writer/faits.js');
  const { draftPost, estLeTourDeLaPromo } = await import('../src/writer/generate.js');
  const { verifierPost } = await import('../src/writer/conformite.js');
  const { buildServer } = await import('../src/api/server.js');

  beforeAll(() => {
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled Aboubakar' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Alexis Duquenoy' } });
    storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
    setSetting('image_gen', { enabled: false });
  });

  const actu = () =>
    db
      .insert(schema.newsItems)
      .values({ url: `https://www.lesechos.fr/${Math.random()}`, canonicalUrl: `https://www.lesechos.fr/${Math.random()}`, title: 'Les PME et les devis', contentHash: String(Math.random()), status: 'shortlisted', lang: 'fr' })
      .returning()
      .get();

  it('la banque sert d’abord les faits du compte et les moins racontés', () => {
    const commun = ajouterFait({ texte: 'Un audit chez un garagiste de Blagnac : 6 heures de saisie par semaine.', source: 'audit', accordClient: false, actif: true });
    const alexis = ajouterFait({ texte: 'Alexis a eu trois appels de boulangers la même semaine.', source: 'appel', compte: 'alexis', accordClient: false, actif: true });
    ajouterFait({ texte: 'Un fait désactivé qui ne doit jamais sortir.', source: 'autre', accordClient: false, actif: false });
    expect(faitsPourLeCompte('khaled').map((f) => f.id)).toEqual([commun.id]);
    expect(faitsPourLeCompte('alexis').map((f) => f.id).sort()).toEqual([commun.id, alexis.id].sort());
    noterUsage(commun.id);
    expect(faitsPourLeCompte('alexis')[0]!.id).toBe(alexis.id);
  });

  it('un post de profil raconte un fait de la banque, et le fait est compté', async () => {
    const avant = db.select().from(schema.faits).all().find((f) => f.compte === 'alexis')!;
    const { postId } = await draftPost({ newsItemId: actu().id, channel: 'li_personal', format: 'li_image' });
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    expect(post.faitId).toBeTruthy();
    expect(post.caption).not.toMatch(/FAIT VÉCU/);
    expect(verifierPost(post).map((p) => p.code)).not.toContain('fait-a-completer');
    const fait = db.select().from(schema.faits).where(eq(schema.faits.id, post.faitId!)).get()!;
    expect(fait.utilisations).toBeGreaterThanOrEqual(1);
    expect(avant).toBeTruthy();
  });

  it('un fait saisi remplace l’emplacement, et rejoint la banque', async () => {
    db.update(schema.faits).set({ actif: false }).run();
    const { postId } = await draftPost({ newsItemId: actu().id, channel: 'li_personal', format: 'li_image' });
    const avant = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    expect(verifierPost(avant).map((p) => p.code)).toContain('fait-a-completer');
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const brut = login.headers['set-cookie'];
    const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/fait`,
      headers: { cookie },
      payload: { texte: 'Mardi, un menuisier de Muret m’a montré ses devis : partis cinq jours après la visite.', source: 'appel', accordClient: false, enregistrer: true },
    });
    expect(res.statusCode).toBe(200);
    const apres = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()!;
    expect(apres.caption).toContain('un menuisier de Muret');
    expect(apres.caption).not.toMatch(/FAIT VÉCU/);
    expect(apres.faitId).toBeTruthy();
    expect(db.select().from(schema.faits).where(eq(schema.faits.id, apres.faitId!)).get()!.compte).toBe(apres.liAccountKey);
    // Plus rien à compléter : la route le dit
    expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/fait`, headers: { cookie }, payload: { faitId: apres.faitId } })).statusCode).toBe(409);
    // La banque se lit et s'écrit depuis les réglages
    const liste = await app.inject({ method: 'GET', url: '/api/faits', headers: { cookie } });
    expect((liste.json() as unknown[]).length).toBeGreaterThanOrEqual(4);
    const refus = await app.inject({ method: 'POST', url: '/api/faits', headers: { cookie }, payload: { texte: 'court' } });
    expect(refus.statusCode).toBe(400);
    // Le détail du post dit la part réécrite par la personne
    const detail = (await app.inject({ method: 'GET', url: `/api/posts/${postId}`, headers: { cookie } })).json() as { reecriture: number; faitACompleter: boolean };
    expect(detail.faitACompleter).toBe(false);
    expect(detail.reecriture).toBeGreaterThan(0);
    await app.close();
  });

  it('un post de profil sur dix est promotionnel ; les autres ne nomment ni la marque ni l’offre', () => {
    const creer = (promo: boolean) =>
      db.insert(schema.posts).values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'alexis', format: 'li_image', theme: 't', status: 'published', hook: 'h', caption: 'x', cta: '', hashtags: '[]', promo }).returning().get();
    db.delete(schema.posts).where(eq(schema.posts.liAccountKey, 'alexis')).run();
    for (let i = 0; i < 8; i++) creer(false);
    expect(estLeTourDeLaPromo('alexis', 10)).toBe(false);
    creer(false);
    expect(estLeTourDeLaPromo('alexis', 10)).toBe(true);
    creer(true);
    expect(estLeTourDeLaPromo('alexis', 10)).toBe(false);
    const pitch = db.insert(schema.posts).values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_image', theme: 't', status: 'awaiting_approval', hook: 'h', caption: 'Chez Odile, nous proposons un audit offert de 30 minutes.\n\nEt chez vous ?', cta: '', hashtags: '[]' }).returning().get();
    expect(verifierPost(pitch).map((p) => p.code)).toContain('promo-hors-quota');
    expect(verifierPost({ ...pitch, promo: true }).map((p) => p.code)).not.toContain('promo-hors-quota');
    // La Page est la vitrine : elle peut nommer la marque
    expect(verifierPost({ ...pitch, channel: 'li_org', liAccountKey: '77' }).map((p) => p.code)).not.toContain('promo-hors-quota');
  });

  it('un même article ne part pas sur les deux profils la même semaine : le second est arrêté', () => {
    const news = actu();
    const valeurs = { platform: 'linkedin' as const, channel: 'li_personal' as const, format: 'li_image' as const, theme: 't', status: 'awaiting_approval' as const, hook: 'h', caption: 'Texte.\n\nEt chez vous ?', cta: '', hashtags: '[]', newsItemId: news.id };
    const premier = db.insert(schema.posts).values({ ...valeurs, liAccountKey: 'khaled' }).returning().get();
    const second = db.insert(schema.posts).values({ ...valeurs, liAccountKey: 'alexis' }).returning().get();
    expect(verifierPost(premier).map((p) => p.code)).not.toContain('sujet-deja-pris');
    const probleme = verifierPost(second).find((p) => p.code === 'sujet-deja-pris');
    expect(probleme?.niveau).toBe('bloquant');
    expect(probleme?.message).toMatch(/Khaled Aboubakar/);
  });
});

describe('reposts commentés, réécriture moyenne, offre unifiée', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { preparerLesReposts, repostsDuPost } = await import('../src/publishers/repost.js');
  const { reecritureMoyenne } = await import('../src/api/routes/apiMisc.js');
  const { setSetting, getSettingRaw, getDmTriggers, unifierLOffre, ANCIENNE_OFFRE } = await import('../src/db/settingsRepo.js');

  const publier = (channel: 'li_personal' | 'li_org', liAccountKey: string, caption = 'Vos devis partent trop tard.\n\nEt chez vous ?') =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel, liAccountKey, format: 'li_image', theme: 't', status: 'published', hook: 'Les devis', caption, cta: '', hashtags: '[]', publishedAt: new Date().toISOString(), externalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:9/' })
      .returning()
      .get();

  it('un post de la Page paraît : chaque profil reçoit son repost commenté, une seule fois', async () => {
    db.update(schema.posts).set({ amplifiedBy: JSON.stringify(['repost']) }).run();
    const page = publier('li_org', '77');
    const khaled = publier('li_personal', 'khaled');
    const resume = await preparerLesReposts();
    expect(resume.posts).toBe(2);
    const pourLaPage = repostsDuPost(db.select().from(schema.posts).where(eq(schema.posts.id, page.id)).get()!);
    expect(pourLaPage.map((r) => r.compte).sort()).toEqual(['alexis', 'khaled']);
    const pourKhaled = repostsDuPost(db.select().from(schema.posts).where(eq(schema.posts.id, khaled.id)).get()!);
    expect(pourKhaled.map((r) => r.compte)).toEqual(['alexis']);
    for (const r of pourLaPage) {
      expect(r.texte).toMatch(/\?/);
      expect(r.texte).not.toMatch(/https?:|Commente|Odile/);
    }
    const dir = path.join(config.outboxDir, 'emails');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('repost.json')).length).toBe(2);
    expect((await preparerLesReposts()).posts).toBe(0);
  });

  it('la réécriture moyenne compare le texte de l’IA au texte publié', () => {
    db.update(schema.posts).set({ texteGenere: null }).run();
    expect(reecritureMoyenne()).toBeNull();
    const p = publier('li_personal', 'khaled', 'Vos devis partent trop tard. Un menuisier de Muret attendait cinq jours.\n\nEt chez vous ?');
    db.update(schema.posts).set({ texteGenere: 'Vos devis partent trop tard.\n\nEt chez vous ?' }).where(eq(schema.posts.id, p.id)).run();
    const moyenne = reecritureMoyenne()!;
    expect(moyenne).toBeGreaterThan(0.3);
    expect(moyenne).toBeLessThan(1);
  });

  it('les anciens textes « 20 minutes » prennent l’offre unique ; un texte personnalisé reste', () => {
    setSetting('dm_triggers', { ...getDmTriggers(), rdvLabel: ANCIENNE_OFFRE.rdvLabel, diagnosticPromise: 'Mon offre à moi, écrite à la main', diagnosticReplyVariants: [ANCIENNE_OFFRE.variante, 'Une réponse à moi {{rdv}}'] });
    expect(unifierLOffre()).toBe(true);
    const dm = getDmTriggers();
    expect(dm.rdvLabel).toBe('Réserver l’audit offert de 30 minutes');
    expect(dm.diagnosticPromise).toBe('Mon offre à moi, écrite à la main');
    expect(dm.diagnosticReplyVariants[0]).toMatch(/audit offert de 30 minutes/);
    expect(dm.diagnosticReplyVariants[1]).toBe('Une réponse à moi {{rdv}}');
    expect(getSettingRaw('offre_unifiee')).toBe(1);
    expect(unifierLOffre()).toBe(false);
  });
});
