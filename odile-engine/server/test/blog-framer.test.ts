import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-blog-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('article de blog : HTML, données structurées, slug', async () => {
  const { articleHtml, articleJsonLd, slugDisponible } = await import('../src/blog/writer.js');
  const { articleSchema } = await import('@odile/shared');
  const article = articleSchema.parse({
    title: 'Automatisation IA pour les PME de Toulouse : par où commencer',
    slug: 'automatisation-ia-pme-toulouse',
    metaTitle: 'Automatisation IA PME Toulouse : par où commencer',
    metaDescription: 'Ce qu’une PME de Toulouse peut automatiser avec l’IA, combien ça coûte et par où commencer, expliqué simplement par une agence locale.',
    excerpt: 'Un résumé en deux phrases qui donne envie de lire la suite et cite Toulouse comme il se doit.',
    coverTitle: 'L’IA au travail dans les PME',
    coverAccentWord: 'travail',
    keyTakeaways: ['Première réponse directe, citable.', 'Deuxième réponse directe, avec un ordre de grandeur.', 'Troisième réponse, orientée action.'],
    sections: [
      { h2: 'Pourquoi maintenant <b>?</b>', paragraphs: ['Un paragraphe assez long pour passer la validation du schéma, avec une idée.'], bullets: ['Un point', 'Deux points'], h3s: [] },
      { h2: 'Par où commencer', paragraphs: ['Un second paragraphe assez long pour passer la validation du schéma, avec une idée.'], bullets: [], h3s: [{ h3: 'Le premier process', paragraphs: ['Une réponse courte mais suffisante à la sous-question posée ici.'] }] },
      { h2: 'Ce que fait l’agence', paragraphs: ['Un troisième paragraphe assez long pour passer la validation du schéma, avec une idée.'], bullets: [], h3s: [] },
    ],
    faq: [
      { question: 'Combien ça coûte ?', answer: 'Une fourchette réaliste, ce qui la fait varier, et par quoi commencer pour limiter le risque.' },
      { question: 'Mes données restent-elles en France ?', answer: 'Cela dépend de l’outil ; voici ce qu’il faut vérifier et ce que prévoit le RGPD pour une PME.' },
      { question: 'Combien de temps avant un résultat ?', answer: 'Quelques semaines pour un premier process, avec un exemple concret et mesurable à la clé.' },
    ],
    sources: [{ title: 'Bpifrance — baromètre', url: 'https://www.bpifrance.fr/' }],
    keywords: ['automatisation IA', 'PME Toulouse', 'agence IA'],
    internalLinks: [{ label: 'Prendre rendez-vous', path: '/contact' }],
  });

  it('le HTML suit la structure SEO/GEO : réponse directe, H2/H3, FAQ, sources, liens internes absolus', () => {
    const html = articleHtml(article, 'https://odileai.com/');
    expect(html.startsWith('<p><strong>En bref</strong></p><ul><li>')).toBe(true);
    expect(html).toContain('<h2>Pourquoi maintenant &lt;b&gt;?&lt;/b&gt;</h2>');
    expect(html).toContain('<h3>Le premier process</h3>');
    expect(html).toContain('<h2>Questions fréquentes</h2>');
    expect(html).toContain('<a href="https://odileai.com/contact">Prendre rendez-vous</a>');
    expect(html).toContain('rel="noopener nofollow"');
    expect(html).not.toMatch(/\{\{link\}\}/);
  });

  it('le JSON-LD porte Article, FAQPage et l’organisation locale', () => {
    const json = JSON.parse(
      articleJsonLd(article, { url: 'https://odileai.com/blog/x', siteUrl: 'https://odileai.com', brand: 'Odile AI', author: 'Alexis Duquenoy', ville: 'Toulouse', datePublished: '2026-09-16', coverUrl: 'https://o/c.jpg', logoUrl: null }),
    ) as { '@graph': Record<string, unknown>[] };
    const types = json['@graph'].map((n) => n['@type']);
    expect(types).toEqual(['Organization', 'Article', 'FAQPage']);
    const faq = json['@graph'][2] as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(3);
    const org = json['@graph'][0] as { address: { addressLocality: string } };
    expect(org.address.addressLocality).toBe('Toulouse');
  });

  it('le slug est normalisé et unique', () => {
    expect(slugDisponible('Été à Toulouse : l’IA !')).toBe('ete-a-toulouse-l-ia');
  });
});

describe('correspondance des champs Framer', async () => {
  const { devinerChamps, fieldDataPour } = await import('../src/blog/framer.js');
  const { blogFieldMapSchema } = await import('@odile/shared');
  const fields = [
    { id: 'f1', name: 'Title', type: 'string' },
    { id: 'f2', name: 'Contenu', type: 'formattedText' },
    { id: 'f3', name: 'Image de couverture', type: 'image' },
    { id: 'f4', name: 'Date de publication', type: 'date' },
    { id: 'f5', name: 'Meta description', type: 'string' },
    { id: 'f6', name: 'Résumé', type: 'string' },
  ];

  it('devine par nom puis par type, sans écraser un choix explicite', () => {
    const champs = devinerChamps(fields, blogFieldMapSchema.parse({ excerpt: 'f5' }));
    // Le choix explicite (extrait = f5) tient, et ce champ n'est pas réutilisé pour la méta.
    expect(champs).toMatchObject({ title: 'f1', body: 'f2', cover: 'f3', date: 'f4', excerpt: 'f5', metaDescription: '' });
    // Sans choix explicite, « Meta description » va à la méta et « Résumé » à l'extrait — jamais le même champ deux fois.
    const auto = devinerChamps(fields, blogFieldMapSchema.parse({}));
    expect(auto.metaDescription).toBe('f5');
    expect(auto.excerpt).toBe('f6');
    expect(champs.metaTitle).toBe('');
  });

  it('ne pose que les champs connus, avec le bon type et le HTML déclaré', () => {
    const champs = devinerChamps(fields, blogFieldMapSchema.parse({}));
    const data = fieldDataPour(
      { slug: 's', title: 'T', bodyHtml: '<p>x</p>', excerpt: 'E', coverUrl: 'https://o/c.jpg', coverAlt: 'alt', date: '2026-09-16T00:00:00.000Z', metaTitle: 'MT', metaDescription: 'MD', keywords: ['a', 'b'], jsonLd: '{}', author: 'A' },
      champs,
      fields,
    );
    expect(data.f1).toEqual({ type: 'string', value: 'T' });
    expect(data.f2).toEqual({ type: 'formattedText', value: '<p>x</p>', contentType: 'html' });
    expect(data.f3).toEqual({ type: 'image', value: 'https://o/c.jpg', alt: 'alt' });
    expect(data.f4?.type).toBe('date');
    // metaTitle et keywords n'ont pas de champ : ils ne partent pas, sans erreur
    expect(Object.keys(data).sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
  });
});

describe('chaîne du blog en mode mock', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { runBlogPipeline, blogDue, publierArticle } = await import('../src/blog/pipeline.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { eq } = await import('drizzle-orm');

  it('rédige, fabrique la couverture au template, met en attente ; publie à blanc dans la outbox', async () => {
    setSetting('blog', { enabled: true, everyDays: 7, ville: 'Toulouse', collectionId: 'col-1', fields: { title: 'f1', body: 'f2' } });
    expect(blogDue().due).toBe(true);
    const res = await runBlogPipeline();
    const row = db.select().from(schema.articles).where(eq(schema.articles.id, res.articleId)).get()!;
    expect(row.status).toBe('awaiting_approval');
    expect(row.title).toMatch(/Toulouse/);
    expect(row.slug).toMatch(/^[a-z0-9-]+$/);
    expect(row.coverAssetId).toBeTruthy();
    expect(row.bodyHtml).toContain('<h2>');
    expect(JSON.parse(row.jsonLd)['@graph']).toHaveLength(3);
    expect(blogDue().due).toBe(false);

    const pub = await publierArticle(row.id);
    expect(pub.url).toMatch(/^file:\/\//);
    expect(db.select().from(schema.articles).where(eq(schema.articles.id, row.id)).get()!.status).toBe('published');
  }, 60_000);
});

describe('le blog est nourri par la veille', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { choisirSujet, dossierDeVeille, sujetDepuisArticle } = await import('../src/blog/writer.js');

  const reglages = {
    enabled: true, everyDays: 7, ville: 'Toulouse', zones: ['Haute-Garonne', 'Occitanie'],
    cibles: ['artisans', 'PME'], authorName: 'Odile', sitePages: [], collectionId: 'col-1',
    fields: { title: 'f1', body: 'f2' },
  } as unknown as Parameters<typeof choisirSujet>[0];

  it('réunit les meilleures actualités récentes, celles du même sujet en tête, et écarte les trop vieilles', () => {
    const source = db.insert(schema.newsSources).values({ name: 'Les Échos', kind: 'rss', url: 'https://echos.fr/rss' }).returning().get();
    const ajoute = (t: string, score: number, topics: string[], jours: number, statut: 'new' | 'shortlisted' | 'discarded' = 'new') =>
      db.insert(schema.newsItems).values({
        sourceId: source.id, url: `https://echos.fr/${t}`, canonicalUrl: `https://echos.fr/${t}`, title: t,
        summary: `Résumé de ${t}`, contentHash: `${t}-${Date.now()}`, lang: 'fr', scoreFinal: score,
        topics: JSON.stringify(topics), status: statut,
        fetchedAt: new Date(Date.now() - jours * 86400000).toISOString(),
      }).returning().get();

    const principal = ajoute('facturation-ia', 90, ['facturation', 'automatisation'], 1, 'shortlisted');
    ajoute('devis-automatiques', 70, ['facturation'], 2);
    ajoute('chatbot-support', 85, ['chatbot'], 3);
    ajoute('vieille-actu', 99, ['facturation'], 40);
    ajoute('ecartee', 95, ['facturation'], 1, 'discarded');

    const dossier = dossierDeVeille(principal, 3);
    expect(dossier[0]!.title).toBe('facturation-ia');
    // Sujet partagé d'abord, même avec une note plus basse que le chatbot.
    expect(dossier[1]!.title).toBe('devis-automatiques');
    expect(dossier.map((d) => d.title)).not.toContain('vieille-actu');
    expect(dossier.map((d) => d.title)).not.toContain('ecartee');
  });

  it('la matière donnée au rédacteur porte les URL réelles, datées et sourcées', () => {
    const sujet = choisirSujet(reglages);
    expect(sujet.dossier.length).toBeGreaterThan(1);
    expect(sujet.matiere).toContain('Les Échos');
    expect(sujet.matiere).toContain('URL : https://echos.fr/');
    expect(sujet.matiere).toMatch(/\[1\] .+ \(\d{4}-\d{2}-\d{2}\)/);
    // Régénérer un article reprend son brief et rafraîchit le dossier.
    const repris = sujetDepuisArticle({ brief: 'Un brief déjà écrit', newsItemId: null });
    expect(repris.brief).toBe('Un brief déjà écrit');
    expect(repris.matiere).toContain('URL : https://echos.fr/');
  });
});

describe('deux brouillons ne se disputent plus le slug vide', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { ouvrirBrouillon } = await import('../src/blog/pipeline.js');
  it('un brouillon après une rédaction en échec (slug jamais nommé) s’insère quand même', () => {
    // Un ancien brouillon resté avec le slug vide par défaut, comme en production avant le correctif
    db.insert(schema.articles).values({ status: 'failed', brief: 'échec', slug: '' }).run();
    const a = ouvrirBrouillon({ brief: 'sujet A', newsItemId: null });
    const b = ouvrirBrouillon({ brief: 'sujet B', newsItemId: null });
    expect(a.slug).toMatch(/^brouillon-/);
    expect(b.slug).toMatch(/^brouillon-/);
    expect(a.slug).not.toBe(b.slug);
    expect(a.status).toBe('drafting');
  });
});
