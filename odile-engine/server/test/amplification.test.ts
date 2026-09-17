import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-amplify-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('amplification', async () => {
  const fs = await import('node:fs');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { amplificateursDus, amplifierPostsPublies, dejaPasses, texteAmorce } = await import('../src/publishers/amplify.js');
  const { captionFacebook } = await import('../src/publishers/facebook.js');
  const { toutesLesSurfaces } = await import('../src/publishers/linkedinAccounts.js');
  const { eq } = await import('drizzle-orm');

  const reglages = {
    enabled: true,
    firstComment: true,
    firstCommentDelayMinutes: 4,
    crossComment: true,
    delayMinutes: 25,
    spacingMinutes: 20,
    maxAccounts: 2,
  };
  const publie = '2026-09-17T09:00:00.000Z';
  const apres = (minutes: number) => new Date(new Date(publie).getTime() + minutes * 60000);

  beforeAll(() => {
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
    const scopes = 'w_member_social,r_basicprofile';
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'moi', externalId: 'moi', accessToken: 't', scopes, meta: { name: 'Moi' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes, meta: { name: 'Alexis Duquenoy', role: 'cofondateur' } });
    storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
    setSetting('amplification', reglages);
  });

  it('personne ne commente avant l’heure, puis l’auteur, puis les collègues un par un', () => {
    const equipe = toutesLesSurfaces();
    const auteur = equipe.find((c) => c.key === 'moi')!;
    const dus = (minutes: number, dejaFaits: string[] = []) =>
      amplificateursDus({ publishedAt: publie, dejaFaits, auteur, equipe, reglages, now: apres(minutes) })
        .map((a) => `${a.role}:${a.compte.key}`);

    expect(dus(2)).toEqual([]);
    expect(dus(5)).toEqual(['amorce:moi']);
    expect(dus(30)).toEqual(['amorce:moi', 'equipe:alexis']);
    expect(dus(50)).toEqual(['amorce:moi', 'equipe:alexis', 'equipe:77']);
    // Ce qui est déjà passé ne repasse pas ; l'auteur ne se commente jamais en collègue.
    expect(dus(50, ['source', 'alexis'])).toEqual(['equipe:77']);
    expect(dus(50).some((d) => d === 'equipe:moi')).toBe(false);
  });

  it('le nombre de comptes qui commentent est plafonné', () => {
    const equipe = toutesLesSurfaces();
    const auteur = equipe.find((c) => c.key === 'moi')!;
    const dus = amplificateursDus({
      publishedAt: publie,
      dejaFaits: [],
      auteur,
      equipe,
      reglages: { ...reglages, maxAccounts: 1 },
      now: apres(120),
    });
    expect(dus.map((a) => a.compte.key)).toEqual(['moi', 'alexis']);
  });

  it('le commentaire d’amorce porte la source et rappelle le mot-clé, sans donner la ressource', () => {
    const post = { commentTriggerKeyword: 'GUIDE', resourceKind: 'guide' as const, resourceTitle: 'Automatiser vos devis' };
    const texte = texteAmorce(post, 'https://odile-engine.duckdns.org/l/abc')!;
    expect(texte).toContain('https://odile-engine.duckdns.org/l/abc');
    expect(texte).toContain('commente GUIDE');
    expect(texte).toContain('le guide « Automatiser vos devis »');
    // Rien à dire = rien de publié.
    expect(texteAmorce({ commentTriggerKeyword: null, resourceKind: 'article' as const, resourceTitle: null }, null)).toBeNull();
  });

  it('une passe commente sous le post, une seconde ne recommente pas', async () => {
    const news = db
      .insert(schema.newsItems)
      .values({ url: 'https://exemple.fr/actu', canonicalUrl: 'https://exemple.fr/actu', title: 'Actu', contentHash: `h-${Date.now()}`, lang: 'fr' })
      .returning()
      .get();
    const post = db
      .insert(schema.posts)
      .values({
        newsItemId: news.id, platform: 'linkedin', channel: 'li_personal', liAccountKey: 'moi', format: 'li_image',
        theme: 'custom:t', status: 'published', hook: 'Accroche', caption: 'Texte du post. Commente GUIDE',
        cta: 'Commente GUIDE', hashtags: '[]', commentTriggerKeyword: 'GUIDE', resourceKind: 'guide',
        resourceTitle: 'Automatiser vos devis', publishedAt: new Date(Date.now() - 60 * 60000).toISOString(),
        externalPostId: 'urn:li:share:123',
      })
      .returning()
      .get();

    const resume = await amplifierPostsPublies();
    expect(resume.candidats).toBe(1);
    expect(resume.commentaires).toBe(3);
    expect(resume.echecs).toBe(0);

    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(dejaPasses(relu).sort()).toEqual(['77', 'alexis', 'source']);
    expect(relu.amplifiedAt).toBeTruthy();

    const fichiers = fs.readdirSync(config.outboxDir).filter((f) => f.startsWith(`amplify-${post.id}-`));
    expect(fichiers).toHaveLength(3);
    const payloads = fichiers.map((f) => JSON.parse(fs.readFileSync(`${config.outboxDir}/${f}`, 'utf8')) as { role: string; actor: string; texte: string });
    const amorce = payloads.find((p) => p.role === 'amorce')!;
    expect(amorce.actor).toBe('urn:li:person:moi');
    expect(amorce.texte).toContain('commente GUIDE');
    // Le collègue apporte un vrai commentaire, sans reprendre l'appel à l'action.
    const collegue = payloads.find((p) => p.role === 'equipe')!;
    expect(collegue.texte.toLowerCase()).not.toContain('commente guide');
    expect(collegue.actor).not.toBe('urn:li:person:moi');

    // Deuxième passe : plus rien à faire.
    const second = await amplifierPostsPublies();
    expect(second.candidats).toBe(0);
    expect(fs.readdirSync(config.outboxDir).filter((f) => f.startsWith(`amplify-${post.id}-`))).toHaveLength(3);
  });

  it('la recopie Facebook ne promet pas un mot-clé que personne ne lit', () => {
    const caption = 'Trois minutes par devis.\n\nCommente GUIDE pour recevoir la méthode.\n\n#ia #pme';
    const texte = captionFacebook({
      caption,
      motcle: 'GUIDE',
      ressource: 'le guide « Automatiser vos devis »',
      urlInstagram: 'https://instagram.com/p/xyz',
    });
    expect(texte).not.toContain('Commente GUIDE pour recevoir');
    expect(texte).toContain('sur Instagram : https://instagram.com/p/xyz');
    expect(texte).toContain('le guide « Automatiser vos devis »');
    expect(texte).toContain('Trois minutes par devis.');
    // Sans mot-clé, rien à corriger : la légende passe telle quelle.
    expect(captionFacebook({ caption, motcle: null, ressource: 'x', urlInstagram: null })).toBe(caption);
  });
});
