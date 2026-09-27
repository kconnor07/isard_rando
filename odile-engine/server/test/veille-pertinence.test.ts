import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-pertinence-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

describe('un sujet par article', async () => {
  const { memesArticles, sujetsDistincts } = await import('../src/scorer/sujets.js');

  it('deux sujets bâtis sur le même article sont des jumeaux, quel que soit leur titre', () => {
    expect(memesArticles([12], [12])).toBe(true);
    expect(memesArticles([12], [12, 40])).toBe(true);
    expect(memesArticles([1, 2, 3, 4], [4, 9, 10, 11])).toBe(false);
    expect(memesArticles([1, 2, 3, 4], [1, 2, 9])).toBe(true);
    expect(memesArticles([], [1])).toBe(false);
  });

  it('la liste ne montre pas deux fois le même article ni deux fois le même titre', () => {
    const liste = sujetsDistincts(
      [
        { label: 'Seules 5 % des PME françaises automatisent : et si c’était votre opportunité ?', itemIds: [7] },
        { label: 'Pourquoi 95 % des PME françaises ratent le coche de l’automatisation', itemIds: [7] },
        { label: 'Le chiffre d’affaires invisible de votre téléphone', itemIds: [9] },
        { label: 'Transformer vos appels téléphoniques invisibles en CA', itemIds: [9] },
        { label: 'Facture électronique : ce qui change pour les TPE en 2027', itemIds: [11, 12] },
        { label: 'La rentrée des dirigeants', itemIds: [] },
      ],
      12,
    );
    expect(liste.map((s) => s.itemIds)).toEqual([[7], [9], [11, 12], []]);
  });
});

describe('les jumeaux en base', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { enregistrerSujet, marquerSujet, sujetsDuMoment } = await import('../src/scorer/sujets.js');
  const item = (title: string) =>
    db
      .insert(schema.newsItems)
      .values({ url: `https://exemple.test/${Math.random()}`, canonicalUrl: `https://exemple.test/${Math.random()}`, title, contentHash: String(Math.random()), status: 'scored', scoreTotal: 80, lang: 'fr' })
      .returning()
      .get();
  const sujet = (label: string, itemIds: number[], score = 90) =>
    enregistrerSujet({ label, reason: 'une raison assez longue', angles: [], topics: [], itemIds, sourcesCount: 1, score, kind: 'actu' });

  it('un article relabellisé d’une construction à l’autre reste un seul sujet', () => {
    const a = item('Seules 5% des PME françaises automatisent réellement leurs tâches avec l’IA');
    expect(sujet('Seulement 5 % des PME françaises automatisent : et si c’était votre opportunité ?', [a.id])).toBe(true);
    expect(sujet('Pourquoi 95 % des PME françaises ratent le coche', [a.id])).toBe(false);
    expect(sujet('Seules 5 % des PME automatisent : pourquoi ce retard ?', [a.id])).toBe(false);
    expect(sujetsDuMoment(50).filter((s) => s.items.some((i) => i.id === a.id))).toHaveLength(1);
  });

  it('écarter un sujet écarte ses jumeaux, et l’article ne revient plus sous un autre titre', () => {
    const b = item('How Justin Hallman made invisible phone revenue visible');
    const c = item('Une autre actualité sans rapport');
    // Deux sujets créés avant la correction, sur le même article
    db.insert(schema.newsSubjects).values([
      { label: 'Le chiffre d’affaires invisible de votre téléphone', reason: 'r', angles: '[]', topics: '[]', itemIds: JSON.stringify([b.id]), sourcesCount: 1, score: 94, kind: 'actu' },
      { label: 'Enfin relier les appels téléphoniques aux ventes réelles', reason: 'r', angles: '[]', topics: '[]', itemIds: JSON.stringify([b.id]), sourcesCount: 1, score: 93, kind: 'actu' },
    ]).run();
    const visible = sujetsDuMoment(50).filter((s) => s.items.some((i) => i.id === b.id));
    expect(visible).toHaveLength(1);
    expect(marquerSujet(visible[0]!.id, 'ecarte')).toBe(2);
    expect(sujetsDuMoment(50).some((s) => s.items.some((i) => i.id === b.id))).toBe(false);
    expect(sujet('Transformer vos appels invisibles en chiffre d’affaires', [b.id])).toBe(false);
    // Un article sans lien, lui, fait toujours un sujet
    expect(sujet('Une actualité sans rapport devient un sujet', [c.id], 70)).toBe(true);
  });
});

describe('recherches d’actualités et sources', async () => {
  const { lienReel, estRechercheActus } = await import('../src/scraper/rss.js');
  const { SEED_SOURCES, REEQUILIBRAGE_V4, rechercheActus, reequilibrerSources, seedSourcesIfEmpty } = await import('../src/scraper/sources.js');
  const { db, schema } = await import('../src/db/client.js');
  const { eq } = await import('drizzle-orm');

  it('le lien Bing redevient l’adresse de l’article', () => {
    const bing = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=abc&url=https%3a%2f%2fwww.batiactu.com%2fedito%2fgouvernement-ia-tpe-pme.php&c=123&mkt=fr-fr';
    expect(lienReel(bing)).toBe('https://www.batiactu.com/edito/gouvernement-ia-tpe-pme.php');
    expect(lienReel('https://www.lesechos.fr/article')).toBe('https://www.lesechos.fr/article');
    expect(estRechercheActus(rechercheActus('PME intelligence artificielle'))).toBe(true);
    expect(estRechercheActus('https://www.maddyness.com/feed/')).toBe(false);
  });

  it('les recherches d’actualités sont des requêtes simples en français, et le rééquilibrage vise des sources existantes', () => {
    const actus = SEED_SOURCES.filter((s) => estRechercheActus(s.url));
    expect(actus.length).toBeGreaterThanOrEqual(8);
    for (const s of actus) {
      expect(s.name).toMatch(/^(Actus|Tendances IA) · /);
      expect(s.lang).toBe('fr');
      // Bing ne renvoie rien sur une requête avec OU ou parenthèses
      expect(new URL(s.url).searchParams.get('q')).not.toMatch(/\bOR\b|[()"]/);
    }
    const noms = new Set(SEED_SOURCES.map((s) => s.name));
    for (const r of REEQUILIBRAGE_V4) expect(noms.has(r.name), r.name).toBe(true);
    expect(new Set(SEED_SOURCES.map((s) => s.name)).size).toBe(SEED_SOURCES.length);
  });

  it('une base existante reçoit les recherches et le rééquilibrage, une seule fois, sans remonter de poids', () => {
    // Une base d'avant la veille v4 : les anciennes sources, dont une déjà rabaissée par l'apprentissage
    db.insert(schema.newsSources).values({ name: 'TechCrunch AI', kind: 'rss', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', lang: 'en', weight: 1.2 }).run();
    db.insert(schema.newsSources).values({ name: 'Zapier Blog', kind: 'rss', url: 'https://zapier.com/blog/feeds/latest/', lang: 'en', weight: 0.6 }).run();
    db.insert(schema.newsSources).values({ name: 'The Verge', kind: 'rss', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', weight: 1.0 }).run();
    seedSourcesIfEmpty();
    const lire = (name: string) => db.select().from(schema.newsSources).where(eq(schema.newsSources.name, name)).get()!;
    // L'actu IA reste une matière première : TechCrunch n'est ramené qu'à 1.0
    expect(lire('TechCrunch AI').weight).toBe(1.0);
    expect(lire('Zapier Blog').weight).toBe(0.6);
    expect(lire('The Verge').enabled).toBe(false);
    expect(lire('Actus · PME & IA').enabled).toBe(true);
    // Le fondateur réactive The Verge : le démarrage suivant ne la désactive pas de nouveau
    db.update(schema.newsSources).set({ enabled: true }).where(eq(schema.newsSources.name, 'The Verge')).run();
    seedSourcesIfEmpty();
    expect(lire('The Verge').enabled).toBe(true);
    expect(reequilibrerSources()).toBeGreaterThan(0);
  });

  it('un article trouvé par une recherche d’actualités cite son vrai média', async () => {
    const { sourceReelle } = await import('../src/writer/source.js');
    const src = db.select().from(schema.newsSources).where(eq(schema.newsSources.name, 'Actus · PME & IA')).get()!;
    const n = db
      .insert(schema.newsItems)
      .values({ sourceId: src.id, url: 'https://www.batiactu.com/edito/ia-tpe-pme.php', canonicalUrl: 'https://www.batiactu.com/edito/ia-tpe-pme.php', title: 'Le gouvernement veut l’IA dans les TPE-PME', contentHash: 'h-batiactu', lang: 'fr' })
      .returning()
      .get();
    expect(sourceReelle(n.id)?.media).toBe('Batiactu');
  });
});

describe('les tendances IA', async () => {
  const { SEED_SOURCES, TENDANCES_IA, estTendanceIA } = await import('../src/scraper/sources.js');
  const { recherchesDues } = await import('../src/scraper/index.js');
  const { estRechercheActus } = await import('../src/scraper/rss.js');
  const NOW = new Date('2026-09-27T12:00:00Z');
  const ilYa = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

  it('les grands noms de l’IA ont chacun leur recherche d’actualité', () => {
    const tendances = SEED_SOURCES.filter((s) => estTendanceIA(s.name));
    expect(tendances).toHaveLength(TENDANCES_IA.length);
    const requetes = tendances.map((s) => new URL(s.url).searchParams.get('q'));
    for (const q of ['ChatGPT', 'OpenAI', 'Claude Anthropic', 'Google Gemini', 'Mistral AI', 'intelligence artificielle']) expect(requetes).toContain(q);
    for (const s of tendances) expect(estRechercheActus(s.url)).toBe(true);
  });

  it('une tendance repasse toutes les 3 h, une actu PME toutes les 8 h, jamais plus de quatre à la fois', () => {
    const sources = [
      { name: 'Tendances IA · ChatGPT', lastFetchedAt: ilYa(4) },
      { name: 'Tendances IA · OpenAI', lastFetchedAt: ilYa(2) },
      { name: 'Actus · PME & IA', lastFetchedAt: ilYa(5) },
      { name: 'Actus · TPE & IA', lastFetchedAt: ilYa(9) },
      { name: 'Tendances IA · Gemini', lastFetchedAt: null },
    ];
    expect(recherchesDues(sources, NOW).map((s) => s.name)).toEqual(['Tendances IA · Gemini', 'Tendances IA · ChatGPT', 'Actus · TPE & IA']);
    const beaucoup = Array.from({ length: 9 }, (_, i) => ({ name: `Tendances IA · ${i}`, lastFetchedAt: null }));
    expect(recherchesDues(beaucoup, NOW)).toHaveLength(4);
  });
});
