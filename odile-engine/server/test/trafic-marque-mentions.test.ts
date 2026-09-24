import { describe, expect, it } from 'vitest';

// Avant tout import : la configuration lit l'environnement au chargement.
process.env.DATA_DIR = `${process.cwd()}/var-test-trafic-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('trafic vers le site : marque, site, mentions, doublons, espacement', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getBrand } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { avecSite, porteLeSite, hashtagDeMarque, domaineDuSite } = await import('../src/writer/marque.js');
  const { buildCaption } = await import('../src/publishers/types.js');
  const { mentionnerSurInstagram, mentionsLinkedInDuRepertoire } = await import('../src/writer/mentions.js');
  const { verifierPost } = await import('../src/writer/conformite.js');
  const { surfacesManquantes, cleEffective } = await import('../src/scheduler/broadcast.js');
  const { nextPublishSlot, voisinTropProche } = await import('../src/scheduler/cadence.js');
  const { sourceReelle } = await import('../src/writer/source.js');

  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  deleteToken('meta', 'ig_user');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled' } });
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Alexis' } });
  storeToken({ provider: 'meta', subject: 'ig_user', externalId: 'ig1', accessToken: 't', meta: { igUsername: 'odile.ai' } });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'Texte. Odile AI.', cta: 'x', hashtags: '[]', ...values })
      .returning()
      .get();

  it('le hashtag de la marque et le domaine se déduisent du réglage', () => {
    expect(hashtagDeMarque({ name: 'Odile AI', siteUrl: 'https://odileai.com' })).toBe('#OdileAI');
    expect(hashtagDeMarque({ name: 'Odile AI', siteUrl: 'https://odileai.com', hashtagMarque: '#Odile_IA' })).toBe('#Odile_IA');
    expect(domaineDuSite('https://www.odileai.com/contact')).toBe('odileai.com');
    expect(porteLeSite('Tout est sur odileai.com.', 'odileai.com')).toBe(true);
    expect(porteLeSite('https://www.odileai.com/diagnostic', 'odileai.com')).toBe(true);
    expect(porteLeSite('Voir pasodileai.com', 'odileai.com')).toBe(false);
  });

  it('le site ferme les posts LinkedIn et Facebook — jamais Instagram, et jamais deux fois', () => {
    const marque = { name: 'Odile AI', siteUrl: 'https://odileai.com/', siteDansLesPosts: true };
    expect(avecSite('Texte.', 'linkedin', marque)).toBe('Texte.\n\nOdile AI : https://odileai.com');
    expect(avecSite('Texte.', 'facebook', marque)).toContain('https://odileai.com');
    expect(avecSite('Texte.', 'instagram', marque)).toBe('Texte.');
    expect(avecSite('Détails sur https://odileai.com', 'linkedin', marque)).toBe('Détails sur https://odileai.com');
    expect(avecSite('Texte.', 'linkedin', { ...marque, siteDansLesPosts: false })).toBe('Texte.');
  });

  it('à la publication : #OdileAI en tête partout, le site sur LinkedIn et sur le miroir Facebook, pas sur Instagram', () => {
    const li = creer({ caption: 'Un post LinkedIn.', hashtags: JSON.stringify(['#PME', '#AgentsIA', '#IA']) });
    expect(buildCaption(li)).toBe('Un post LinkedIn.\n\nOdile AI : https://odileai.com\n\n#OdileAI #PME #AgentsIA');
    const ig = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Un post Instagram. Odile AI.', hashtags: JSON.stringify(['#PME']) });
    expect(buildCaption(ig)).toBe('Un post Instagram. Odile AI.\n\n#OdileAI #PME');
    expect(buildCaption(ig, 'facebook')).toContain('Odile AI : https://odileai.com');
  });

  it('Instagram : le site cité dans la légende et la marque absente sont signalés', () => {
    const avecDomaine = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Rendez-vous sur odileai.com. Odile AI.' });
    expect(verifierPost(avecDomaine).find((p) => p.code === 'url-instagram')?.niveau).toBe('attention');
    const sansMarque = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Un contenu sans signature.' });
    expect(verifierPost(sansMarque).map((p) => p.code)).toContain('marque-absente');
    const signe = creer({ platform: 'instagram', channel: 'ig', liAccountKey: null, format: 'carousel', caption: 'Chez odile  ai, on automatise.' });
    expect(verifierPost(signe).map((p) => p.code)).not.toContain('marque-absente');
  });

  it('LinkedIn : le répertoire identifie les entreprises citées, sous leur nom ou un alias', () => {
    const repertoire = [
      { nom: 'L’Usine Digitale', alias: ['Usine Digitale'], linkedinUrn: 'urn:li:organization:123', instagram: 'usinedigitale' },
      { nom: 'OpenAI', alias: [], linkedinUrn: 'urn:li:organization:456', instagram: '' },
      { nom: 'Sans page', alias: [], linkedinUrn: '', instagram: 'sanspage' },
    ];
    const texte = 'OpenAI a été piraté en 72 h.\n\nSource : Usine Digitale';
    expect(mentionsLinkedInDuRepertoire(texte, repertoire)).toEqual([
      { nom: 'Usine Digitale', urn: 'urn:li:organization:123' },
      { nom: 'OpenAI', urn: 'urn:li:organization:456' },
    ]);
    // Un mot qui contient le nom n'est pas le nom
    expect(mentionsLinkedInDuRepertoire('OpenAIxyz et SuperOpenAI', repertoire)).toEqual([]);
  });

  it('Instagram : un @ n’est posé que pour un compte vérifié, une seule fois, à la première apparition', async () => {
    const repertoire = [{ nom: 'Usine Digitale', alias: [], linkedinUrn: '', instagram: 'usinedigitale' }];
    const verifies = new Set(['openai']);
    const verifier = async (h: string) => verifies.has(h);
    const { caption, poses } = await mentionnerSurInstagram(
      'OpenAI a été piraté. OpenAI réagit.\n\nSource : Usine Digitale',
      [
        { nom: 'OpenAI', instagram: 'openai' },
        { nom: 'Anthropic', instagram: 'anthropic_faux' },
        { nom: 'Absent du texte', instagram: 'absent' },
      ],
      { repertoire, verifier },
    );
    expect(caption).toBe('@openai a été piraté. OpenAI réagit.\n\nSource : @usinedigitale');
    expect(poses.sort()).toEqual(['openai', 'usinedigitale']);
    // Déjà identifié : rien ne change
    const deux = await mentionnerSurInstagram(caption, [{ nom: 'OpenAI', instagram: 'openai' }], { repertoire, verifier });
    expect(deux.caption).toBe(caption);
  });

  it('diffusion : un post sans compte occupe déjà celui qui le publiera — pas de copie pour ce même profil', () => {
    const post = creer({ liAccountKey: null });
    expect(cleEffective(post)).toBe('khaled');
    const manquantes = surfacesManquantes(post).map((s) => `${s.channel}:${s.liAccountKey ?? ''}`);
    expect(manquantes).toContain('li_personal:alexis');
    expect(manquantes).not.toContain('li_personal:khaled');
  });

  it('diffusion : un second exemplaire sur le même profil est bloqué, jamais le premier', () => {
    const premier = creer({ broadcastGroup: 'g-doublon', status: 'published', publishedAt: new Date().toISOString() });
    const second = creer({ broadcastGroup: 'g-doublon' });
    const autreProfil = creer({ broadcastGroup: 'g-doublon', liAccountKey: 'alexis' });
    expect(verifierPost(second).find((p) => p.code === 'doublon-surface')?.niveau).toBe('bloquant');
    expect(verifierPost(autreProfil).map((p) => p.code)).not.toContain('doublon-surface');
    expect(verifierPost(premier).map((p) => p.code)).not.toContain('doublon-surface');
  });

  it('espacement : un créneau à moins de 20 h d’un post du même profil est sauté ; signalé s’il est forcé', () => {
    setSetting('publish_slots', { li: [{ dow: 1, time: '09:00' }, { dow: 2, time: '09:00' }, { dow: 3, time: '09:00' }, { dow: 4, time: '09:00' }, { dow: 5, time: '09:00' }], ig: [{ dow: 3, time: '12:00' }] });
    const libre = nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', channel: 'li_personal', liAccountKey: 'alexis' });
    const khaledAvant = nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled' });
    // Un post déjà paru juste avant ce créneau sur le même profil…
    creer({ liAccountKey: 'alexis', status: 'published', publishedAt: new Date(libre.getTime() - 3 * 3600000).toISOString() });
    const suivant = nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', channel: 'li_personal', liAccountKey: 'alexis' });
    expect(suivant.getTime() - libre.getTime()).toBeGreaterThanOrEqual(20 * 3600000 - 3 * 3600000);
    // …mais les créneaux d'un autre profil n'en dépendent pas.
    expect(nextPublishSlot('linkedin', new Date(), { platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled' }).getTime()).toBe(khaledAvant.getTime());
    // Programmé de force à 3 h du post déjà paru : signalé à la validation.
    const force = creer({ liAccountKey: 'alexis', status: 'scheduled', scheduledAt: libre.toISOString() });
    expect(voisinTropProche(force)).not.toBeNull();
    expect(verifierPost(force).find((p) => p.code === 'trop-rapproche')?.niveau).toBe('attention');
  });

  it('la ligne « Source » cite le site de l’article quand le flux n’est qu’un agrégateur', () => {
    const src = db.insert(schema.newsSources).values({ name: 'Recherche web IA', kind: 'websearch', url: 'websearch://ia', enabled: true }).returning().get();
    const news = db
      .insert(schema.newsItems)
      .values({ sourceId: src.id, url: 'https://www.usine-digitale.fr/article/x', canonicalUrl: 'https://www.usine-digitale.fr/article/x', contentHash: `h-${Date.now()}`, title: 'Titre', lang: 'fr' })
      .returning()
      .get();
    expect(sourceReelle(news.id)?.media).toBe('L’Usine Digitale');
    const rss = db.insert(schema.newsSources).values({ name: 'ToulÉco (Toulouse)', kind: 'rss', url: 'https://www.touleco.fr/feed', enabled: true }).returning().get();
    const locale = db
      .insert(schema.newsItems)
      .values({ sourceId: rss.id, url: 'https://www.touleco.fr/article-y', canonicalUrl: 'https://www.touleco.fr/article-y', contentHash: `h2-${Date.now()}`, title: 'Titre', lang: 'fr' })
      .returning()
      .get();
    expect(sourceReelle(locale.id)?.media).toBe('ToulÉco');
    expect(getBrand().siteUrl).toBe('https://odileai.com');
    void eq;
  });
});
