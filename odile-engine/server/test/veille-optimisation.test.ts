import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-optimisation-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

const NOW = new Date('2026-09-28T09:00:00Z');
const ilYa = (heures: number) => new Date(NOW.getTime() - heures * 3_600_000).toISOString();

describe('un sujet vieillit avec ses articles', async () => {
  const { fraicheurSujet, sujetsDistincts } = await import('../src/scorer/sujets.js');

  it('plein tarif le premier jour, 12 % de moins par jour, expiré après sept jours', () => {
    expect(fraicheurSujet(ilYa(5), NOW)).toBe(1);
    expect(fraicheurSujet(ilYa(48), NOW)).toBe(0.88);
    expect(fraicheurSujet(ilYa(24 * 4), NOW)).toBe(0.64);
    expect(fraicheurSujet(ilYa(24 * 8), NOW)).toBe(0);
  });

  it('deux sujets du même thème ne sont pas proposés ensemble, même sur des articles différents', () => {
    const liste = sujetsDistincts(
      [
        { label: '68 % des petites entreprises utilisent l’IA : et vous ?', itemIds: [1], topics: ['adoption ia', 'pme', 'statistiques'] },
        { label: 'Seulement 5 % des PME françaises automatisent vraiment', itemIds: [2], topics: ['adoption ia', 'pme', 'statistiques', 'france'] },
        { label: 'ChatGPT affiche de la pub : ce que vos équipes y écrivent', itemIds: [3], topics: ['chatgpt', 'publicité', 'données'] },
      ],
      12,
    );
    expect(liste.map((s) => s.itemIds[0])).toEqual([1, 3]);
  });
});

describe('les sujets du moment en base', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { sujetsDuMoment } = await import('../src/scorer/sujets.js');
  const item = (title: string, publishedAt: string, topics: string[] = []) =>
    db
      .insert(schema.newsItems)
      .values({ url: `https://exemple.test/${Math.random()}`, canonicalUrl: `https://exemple.test/${Math.random()}`, title, contentHash: String(Math.random()), status: 'scored', scoreTotal: 80, lang: 'fr', publishedAt, topics: JSON.stringify(topics) })
      .returning()
      .get();
  const sujet = (label: string, itemIds: number[], score: number, topics: string[] = []) =>
    db.insert(schema.newsSubjects).values({ label, reason: 'r', angles: '[]', topics: JSON.stringify(topics), itemIds: JSON.stringify(itemIds), sourcesCount: itemIds.length, score, kind: 'actu' }).run();

  it('l’actu du matin passe devant un sujet mieux noté d’il y a cinq jours, un sujet expiré disparaît', () => {
    const vieux = item('Une étude sur l’adoption de l’IA', ilYa(24 * 5));
    const frais = item('OpenAI suspend l’entraînement d’un modèle', ilYa(3));
    const expire = item('Un vieux sujet', ilYa(24 * 9));
    sujet('Une étude d’il y a cinq jours sur l’adoption de l’IA dans les PME', [vieux.id], 104);
    sujet('OpenAI suspend un modèle : ce que ça dit des agents qui vous échappent', [frais.id], 90);
    sujet('Un sujet de la semaine dernière qui ne revient plus', [expire.id], 120);
    const liste = sujetsDuMoment(12, NOW);
    expect(liste[0]!.label).toMatch(/OpenAI suspend/);
    expect(liste.some((s) => /semaine dernière/.test(s.label))).toBe(false);
    // Le score affiché est celui du classement (note × fraîcheur)
    expect(liste.find((s) => /cinq jours/.test(s.label))!.score).toBeLessThan(90);
  });

  it('un thème publié ces dix derniers jours passe au second plan', () => {
    const publie = item('Relances de factures automatisées', ilYa(24 * 2), ['relances', 'factures', 'trésorerie']);
    db.insert(schema.posts).values({ newsItemId: publie.id, platform: 'linkedin', channel: 'li_personal', format: 'li_doc', theme: 'odile-nuit', status: 'published', hook: 'Vos relances partent toutes seules', caption: 'x', cta: '', hashtags: '[]', createdAt: ilYa(24) }).run();
    const redite = item('Encore les relances de factures', ilYa(2), ['relances', 'factures', 'trésorerie']);
    const autre = item('Gemini passe des appels à votre place', ilYa(2), ['gemini', 'téléphone', 'assistant']);
    sujet('Les relances de factures, encore une fois', [redite.id], 95, ['relances', 'factures', 'trésorerie']);
    sujet('Gemini décroche le téléphone à votre place', [autre.id], 80, ['gemini', 'téléphone', 'assistant']);
    const liste = sujetsDuMoment(12, NOW);
    const rang = (re: RegExp) => liste.findIndex((s) => re.test(s.label));
    expect(rang(/Gemini décroche/)).toBeLessThan(rang(/relances de factures, encore/));
  });
});

describe('une nouvelle grille de notation renote la semaine', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { eq } = await import('drizzle-orm');
  const { reprendreSiGrilleChangee, runScore, VERSION_GRILLE } = await import('../src/scorer/score.js');
  const { getSettingRaw } = await import('../src/db/settingsRepo.js');

  it('les articles récents repassent en file, les anciens et les utilisés ne bougent pas, les sujets d’actu sont refaits', () => {
    const creer = (status: 'scored' | 'shortlisted' | 'used', fetchedAt: string) =>
      db
        .insert(schema.newsItems)
        .values({ url: `https://g.test/${Math.random()}`, canonicalUrl: `https://g.test/${Math.random()}`, title: 't', contentHash: String(Math.random()), status, scoreTotal: 70, scoreFinal: 90, lang: 'fr', fetchedAt })
        .returning()
        .get();
    const recent = creer('shortlisted', new Date(Date.now() - 2 * 86400000).toISOString());
    const ancien = creer('scored', new Date(Date.now() - 20 * 86400000).toISOString());
    const utilise = creer('used', new Date(Date.now() - 1 * 86400000).toISOString());
    db.insert(schema.newsSubjects).values([
      { label: 'Un sujet d’actu de l’ancienne grille', reason: 'r', angles: '[]', topics: '[]', itemIds: '[]', sourcesCount: 1, score: 100, kind: 'actu' },
      { label: 'Un sujet déjà écrit', reason: 'r', angles: '[]', topics: '[]', itemIds: '[]', sourcesCount: 1, score: 100, kind: 'actu', status: 'utilise' },
      { label: 'La rentrée des dirigeants', reason: 'r', angles: '[]', topics: '[]', itemIds: '[]', sourcesCount: 0, score: 60, kind: 'saison' },
    ]).run();
    expect(reprendreSiGrilleChangee()).toBeGreaterThanOrEqual(1);
    const lire = (id: number) => db.select().from(schema.newsItems).where(eq(schema.newsItems.id, id)).get()!;
    expect(lire(recent.id).status).toBe('new');
    expect(lire(recent.id).scoreFinal).toBeNull();
    expect(lire(ancien.id).status).toBe('scored');
    expect(lire(utilise.id).status).toBe('used');
    const labels = db.select().from(schema.newsSubjects).all().map((s) => s.label);
    expect(labels).not.toContain('Un sujet d’actu de l’ancienne grille');
    expect(labels).toContain('Un sujet déjà écrit');
    expect(labels).toContain('La rentrée des dirigeants');
    expect(getSettingRaw('veille_grille_version')).toBe(VERSION_GRILLE);
    // Une seule fois par version
    expect(reprendreSiGrilleChangee()).toBe(0);
  });

  it('la notation prend les articles les plus récents d’abord', async () => {
    const vieux = db.insert(schema.newsItems).values({ url: 'https://o.test/1', canonicalUrl: 'https://o.test/1', title: 'Vieux', contentHash: 'o1', status: 'new', lang: 'fr', fetchedAt: new Date(Date.now() - 36 * 3600000).toISOString() }).returning().get();
    const neuf = db.insert(schema.newsItems).values({ url: 'https://o.test/2', canonicalUrl: 'https://o.test/2', title: 'Neuf', contentHash: 'o2', status: 'new', lang: 'fr', fetchedAt: new Date().toISOString() }).returning().get();
    await runScore(1);
    const lire = (id: number) => db.select().from(schema.newsItems).where(eq(schema.newsItems.id, id)).get()!;
    expect(lire(neuf.id).status).toBe('scored');
    expect(lire(vieux.id).status).toBe('new');
  });
});

describe('priorité aux tendances et variété des posts', async () => {
  const { recherchesDues } = await import('../src/scraper/index.js');
  const { ouverturesUsees } = await import('../src/writer/generate.js');
  const { motEnAccent } = await import('../src/scheduler/broadcast.js');

  it('au premier passage, les tendances IA passent avant les recherches PME', () => {
    const dues = recherchesDues(
      [
        { name: 'Actus · PME & IA', lastFetchedAt: null },
        { name: 'Actus · TPE & IA', lastFetchedAt: null },
        { name: 'Tendances IA · ChatGPT', lastFetchedAt: null },
        { name: 'Tendances IA · OpenAI', lastFetchedAt: null },
        { name: 'Actus · artisans & IA', lastFetchedAt: null },
      ],
      NOW,
      3,
    );
    expect(dues.map((s) => s.name)).toEqual(['Tendances IA · ChatGPT', 'Tendances IA · OpenAI', 'Actus · PME & IA']);
  });

  it('les ouvertures d’accroche trop utilisées sont repérées', () => {
    const usees = ouverturesUsees([
      'Vos appels clients cachent votre vraie rentabilité',
      'Vos posts LinkedIn, écrits pendant que vous dormez',
      '5 centres ferment, elle conseille ChatGPT à la place',
      'Vos licences IA ne prouvent rien',
      'Votre chatbot rentabilisé en 3,4 mois',
      '80% de vos salariés peuvent automatiser leurs galères',
      'Votre relance est déjà prête',
      'Une landing page en 30 minutes, pas 3 jours',
    ]);
    expect(usees).toEqual(expect.arrayContaining(['vos', 'votre', 'un chiffre']));
    expect(usees).not.toContain('une');
  });

  it('la nouvelle couverture garde un mot fort en accent', () => {
    expect(motEnAccent('Un chatbot amorti en 3,4 mois', 'chatbot')).toBe('chatbot');
    expect(motEnAccent('Amorti en 3,4 mois : le chatbot du cabinet', 'rentabilisé')).toBe('3,4');
    expect(motEnAccent('Le téléphone rapporte plus que prévu', undefined)).toBe('téléphone');
  });
});
