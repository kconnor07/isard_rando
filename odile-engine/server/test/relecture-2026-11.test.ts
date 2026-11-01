import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-relecture-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('relecture : la ligne du site ne masque pas la question finale', async () => {
  const { finitSurUneQuestion } = await import('../src/writer/reglesLinkedIn.js');

  it('une Page finit sur sa question même quand l’adresse du site suit', () => {
    expect(finitSurUneQuestion('Un devis en 4 minutes.\n\nEt chez vous ?\n\nOdile AI : https://odileai.com')).toBe(true);
    expect(finitSurUneQuestion('Un devis en 4 minutes.\n\nEt chez vous ?\n\nhttps://odileai.com/audit')).toBe(true);
    expect(finitSurUneQuestion('Et chez vous ?\n\nSource : Les Echos\n#IA #PME')).toBe(true);
    expect(finitSurUneQuestion('Un devis en 4 minutes.\n\nOdile AI : https://odileai.com')).toBe(false);
    expect(finitSurUneQuestion('Un devis en 4 minutes.')).toBe(false);
  });
});

describe('relecture : une adresse nue se détecte et se retire', async () => {
  const { sansLien } = await import('../src/writer/generate.js');
  const { contientUnLien } = await import('../src/writer/reglesLinkedIn.js');

  it('le domaine de la marque écrit sans https est un lien, et sansLien sait l’enlever', () => {
    expect(contientUnLien('Plus de détails sur odileai.com.')).toBe(true);
    const propre = sansLien('Plus de détails sur odileai.com.\n\nEt chez vous ?');
    expect(contientUnLien(propre)).toBe(false);
    expect(propre).toContain('Et chez vous ?');
    expect(sansLien('Voir www.odileai.com/audit demain')).not.toMatch(/odileai/);
    expect(sansLien('Un texte sans adresse.')).toBe('Un texte sans adresse.');
  });
});

describe('relecture : une recherche d’actualités n’est pas un média de plus', async () => {
  const { compteCommeEcho } = await import('../src/scraper/index.js');
  const { rechercheActus } = await import('../src/scraper/sources.js');

  it('seules deux vraies sources distinctes font un écho', () => {
    expect(compteCommeEcho('https://www.actuia.com/feed/', 'https://www.numerama.com/feed/')).toBe(true);
    expect(compteCommeEcho('https://mastodon.social/api/v1/trends/links?limit=40', null)).toBe(true);
    expect(compteCommeEcho(rechercheActus('PME intelligence artificielle'), 'https://www.numerama.com/feed/')).toBe(false);
    expect(compteCommeEcho('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=OpenAI', rechercheActus('TPE IA'))).toBe(false);
  });
});

describe('relecture : un brouillon abandonné ne bloque pas un post validé', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { verifierPost } = await import('../src/writer/conformite.js');

  it('à la validation le second est arrêté ; une fois validé, seul un post engagé l’arrête', () => {
    const news = db
      .insert(schema.newsItems)
      .values({ url: `https://www.lesechos.fr/${Math.random()}`, canonicalUrl: `https://www.lesechos.fr/${Math.random()}`, title: 'Les PME et les devis', contentHash: String(Math.random()), status: 'shortlisted', lang: 'fr' })
      .returning()
      .get();
    const base = { platform: 'linkedin' as const, channel: 'li_personal' as const, format: 'li_image' as const, theme: 't', hook: 'h', caption: 'Texte.\n\nEt chez vous ?', cta: '', hashtags: '[]', newsItemId: news.id };
    const brouillon = db.insert(schema.posts).values({ ...base, liAccountKey: 'khaled', status: 'awaiting_approval' }).returning().get();
    const valide = db.insert(schema.posts).values({ ...base, liAccountKey: 'alexis', status: 'scheduled' }).returning().get();
    expect(verifierPost({ ...valide, status: 'awaiting_approval' }).map((p) => p.code)).toContain('sujet-deja-pris');
    expect(verifierPost(valide).map((p) => p.code)).not.toContain('sujet-deja-pris');
    db.update(schema.posts).set({ status: 'published', publishedAt: new Date().toISOString() }).where(eq(schema.posts.id, brouillon.id)).run();
    expect(verifierPost(valide).map((p) => p.code)).toContain('sujet-deja-pris');
  });
});

describe('relecture : un fait avec un « $ » reste intact', async () => {
  const { integrerLeFait } = await import('../src/writer/faits.js');

  it('le remplacement ne lit pas « $& » comme un motif', async () => {
    const texte = await integrerLeFait('Avant.\n\n[FAIT VÉCU : à compléter]\n\nEt chez vous ?', { texte: 'Un devis à 3 000 $& parti trop tard, $$ compris', accordClient: false }, 'vous');
    expect(texte).toBe('Avant.\n\nUn devis à 3 000 $& parti trop tard, $$ compris\n\nEt chez vous ?');
  });
});

describe('relecture : les reposts gardent leurs textes et comptent leurs essais', async () => {
  const { memoireDesReposts, repostsDuPost, ESSAIS_MAX } = await import('../src/publishers/repost.js');

  it('liste de textes, compteur d’essais, ou rien', () => {
    expect(memoireDesReposts({ reposts: null })).toEqual({ prepares: [], essais: 0 });
    expect(memoireDesReposts({ reposts: '{"essais":2}' })).toEqual({ prepares: [], essais: 2 });
    expect(memoireDesReposts({ reposts: '[{"compte":"alexis","nom":"Alexis","texte":"Mon avis."}]' }).prepares).toHaveLength(1);
    expect(repostsDuPost({ reposts: '{"essais":1}' })).toEqual([]);
    expect(memoireDesReposts({ reposts: 'pas du json' })).toEqual({ prepares: [], essais: 0 });
    expect(ESSAIS_MAX).toBe(3);
  });
});

describe('relecture : « marquer publié » ne vaut que pour un post de profil', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { buildServer } = await import('../src/api/server.js');

  it('un post Instagram ou un post encore à valider sont refusés', async () => {
    const ig = db.insert(schema.posts).values({ platform: 'instagram', channel: 'ig', format: 'carousel', theme: 't', status: 'scheduled', hook: 'h', caption: 'x', cta: '', hashtags: '[]' }).returning().get();
    const attente = db.insert(schema.posts).values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'khaled', format: 'li_image', theme: 't', status: 'awaiting_approval', hook: 'h', caption: 'x', cta: '', hashtags: '[]' }).returning().get();
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const brut = login.headers['set-cookie'];
    const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
    const refusIg = await app.inject({ method: 'POST', url: `/api/posts/${ig.id}/mark-published`, headers: { cookie }, payload: {} });
    expect(refusIg.statusCode).toBe(409);
    const refusAttente = await app.inject({ method: 'POST', url: `/api/posts/${attente.id}/mark-published`, headers: { cookie }, payload: {} });
    expect(refusAttente.statusCode).toBe(409);
    await app.close();
    const statuts = db.select().from(schema.posts).all().filter((p) => p.id === ig.id || p.id === attente.id).map((p) => p.status).sort();
    expect(statuts).toEqual(['awaiting_approval', 'scheduled']);
  });
});
