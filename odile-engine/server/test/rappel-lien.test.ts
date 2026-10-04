import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-rappel-lien-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';

describe('le lien en réponse, posté par une personne', async () => {
  const fs = await import('node:fs');
  const { db, schema } = await import('../src/db/client.js');
  const { config } = await import('../src/config.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { dejaPasses, rappelDu, rappelerLesLiens, texteDuLien, RAPPEL_LIEN } = await import('../src/publishers/rappelLien.js');
  const { captionFacebook } = await import('../src/publishers/facebook.js');
  const { eq } = await import('drizzle-orm');

  const publie = '2026-09-17T09:00:00.000Z';
  const apres = (minutes: number) => new Date(new Date(publie).getTime() + minutes * 60000);

  it('le rappel tombe après la première heure, une seule fois, jamais après deux jours', () => {
    const du = (minutes: number, dejaFaits: string[] = []) => rappelDu({ publishedAt: publie, dejaFaits, minutes: 60, now: apres(minutes) });
    expect(du(30)).toBe(false);
    expect(du(61)).toBe(true);
    expect(du(61, [RAPPEL_LIEN])).toBe(false);
    expect(du(49 * 60)).toBe(false);
  });

  const creerPost = (caption: string, publishedAt: string) => {
    const news = db
      .insert(schema.newsItems)
      .values({ url: `https://exemple.fr/${Math.random()}`, canonicalUrl: `https://exemple.fr/${Math.random()}`, title: 'Actu', contentHash: `h-${Math.random()}`, lang: 'fr' })
      .returning()
      .get();
    const post = db
      .insert(schema.posts)
      .values({
        newsItemId: news.id, platform: 'linkedin', channel: 'li_personal', liAccountKey: 'moi', format: 'li_image',
        theme: 'custom:t', status: 'published', hook: 'Accroche', caption, cta: '', hashtags: '[]',
        resourceKind: 'guide', resourceTitle: 'Automatiser vos devis', publishedAt,
      })
      .returning()
      .get();
    const lien = createLink('https://exemple.fr/guide', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id }).where(eq(schema.posts.id, post.id)).run();
    return { ...post, linkId: lien.id, lien: lien.shortUrl };
  };

  it('le texte nomme la ressource et porte le lien court, sauf si le post l’a déjà', () => {
    const sans = creerPost('Un post sans lien.\n\nEt vous, combien de devis par semaine ?', publie);
    const texte = texteDuLien(sans)!;
    expect(texte).toContain('Le guide « Automatiser vos devis »');
    expect(texte).toContain(sans.lien);
    const avec = creerPost('placeholder', publie);
    expect(texteDuLien({ ...avec, caption: `Le guide : ${avec.lien}` })).toBeNull();
  });

  it('une passe envoie un email par post, ne commente rien, et ne repasse pas', async () => {
    const post = creerPost('Un post de profil sans lien.', new Date(Date.now() - 90 * 60000).toISOString());
    const avant = fs.existsSync(config.outboxDir) ? fs.readdirSync(config.outboxDir).length : 0;
    const resume = await rappelerLesLiens();
    expect(resume.envoyes).toBeGreaterThanOrEqual(1);
    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(dejaPasses(relu)).toContain(RAPPEL_LIEN);
    // Aucun commentaire n'est parti chez LinkedIn : seul l'email est écrit.
    const fichiers = fs.existsSync(config.outboxDir) ? fs.readdirSync(config.outboxDir) : [];
    expect(fichiers.some((f) => f.startsWith(`amplify-${post.id}-`))).toBe(false);
    expect(fichiers.length).toBeGreaterThanOrEqual(avant);
    const second = await rappelerLesLiens();
    expect(second.envoyes).toBe(0);
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
    expect(captionFacebook({ caption, motcle: null, ressource: 'x', urlInstagram: null })).toBe(caption);
  });
});
