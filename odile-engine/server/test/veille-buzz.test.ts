import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-buzz-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

const NOW = new Date('2026-11-01T08:00:00Z');
const ilYa = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('les échos : une histoire reprise par cinq médias reste une histoire reprise', async () => {
  const { fusionnerLesEchos } = await import('../src/scraper/index.js');

  it('le survivant compte les doublons écartés, leurs sources et leur meilleur signal social', () => {
    const rows = [
      { id: 1, title: 'OpenAI lance GPT-6 avec une mémoire illimitée', sourceId: 10, engagement: 20, engagementRaw: 'a', echoes: 0, echoSources: null },
      { id: 2, title: 'OpenAI lance GPT-6 avec une mémoire illimitée', sourceId: 11, engagement: 80, engagementRaw: '{"hnPoints":900}', echoes: 0, echoSources: null },
      { id: 3, title: 'OpenAI lance GPT-6 avec une mémoire illimitée', sourceId: 12, engagement: null, engagementRaw: null, echoes: 1, echoSources: '[13]' },
      { id: 4, title: 'Une boulangerie de Muret automatise ses commandes', sourceId: 14, engagement: null, engagementRaw: null, echoes: 0, echoSources: null },
    ];
    const poids = (sid: number | null) => (sid === 10 ? 1.4 : 1.0);
    const { survivants, ecartes } = fusionnerLesEchos(rows, poids);
    expect(ecartes.sort()).toEqual([2, 3]);
    expect(survivants).toHaveLength(1);
    const s = survivants[0]!;
    expect(s.id).toBe(1);
    // Deux doublons, dont un qui portait déjà un écho : trois médias de plus.
    expect(s.echoes).toBe(3);
    expect(s.echoSources.sort()).toEqual([11, 12, 13]);
    expect(s.engagement).toBe(80);
    expect(s.engagementRaw).toBe('{"hnPoints":900}');
  });
});

describe('ce qui chauffe', async () => {
  const { memeHistoire, chaleur, tendancesDuMoment } = await import('../src/scorer/buzz.js');
  const item = (id: number, title: string, extra: Partial<Parameters<typeof tendancesDuMoment>[0][number]> = {}) => ({
    id,
    title,
    url: `https://exemple.test/${id}`,
    lang: 'en',
    sourceId: id,
    sourceName: `Source ${id}`,
    publishedAt: ilYa(3),
    fetchedAt: ilYa(2),
    engagement: null,
    echoes: 0,
    echoSources: [] as number[],
    scoreTotal: null,
    scoreClick: null,
    ...extra,
  });

  it('deux titres racontent la même histoire quand ils se ressemblent, ou nomment le même acteur et se recoupent', () => {
    expect(memeHistoire('OpenAI lance Sora 3, la vidéo générée en temps réel', 'Sora 3 : OpenAI dévoile la vidéo générée en temps réel')).toBe(true);
    expect(memeHistoire('OpenAI lance Sora 3, la vidéo générée en temps réel', 'OpenAI attaqué en justice par le New York Times')).toBe(false);
    expect(memeHistoire('Mistral présente son modèle vocal Voxtral 2', 'Voxtral 2 : Mistral mise sur la voix')).toBe(true);
    expect(memeHistoire('Une boulangerie automatise ses commandes', 'Un cabinet comptable automatise ses relances')).toBe(false);
  });

  it('la chaleur monte avec la reprise, les signaux sociaux, la fraîcheur et le clic', () => {
    const seul = chaleur({ medias: 1, engagement: 0, ageHeures: 30, click: 0 });
    const repris = chaleur({ medias: 5, engagement: 0, ageHeures: 30, click: 0 });
    const chaud = chaleur({ medias: 5, engagement: 80, ageHeures: 2, click: 45 });
    expect(seul).toBeLessThan(repris);
    expect(repris).toBeLessThan(chaud);
    expect(chaud).toBeGreaterThan(90);
  });

  it('une histoire reprise par trois médias passe devant un article isolé, même mieux noté ; le français donne son titre', () => {
    const tendances = tendancesDuMoment(
      [
        item(1, 'DeepSeek releases V4, a free model that beats GPT-5 on coding', { scoreTotal: 60 }),
        item(2, 'DeepSeek V4 : le modèle gratuit qui bat GPT-5 en coding', { lang: 'fr', scoreTotal: 55, echoes: 1, echoSources: [20] }),
        item(3, 'DeepSeek V4 released: free model beats GPT-5 at coding', { engagement: 70 }),
        item(4, 'Une étude Bpifrance sur les PME et l’IA', { scoreTotal: 90, scoreClick: 30 }),
        item(5, 'Un outil viral que personne ne reprend', { scoreClick: 44, scoreTotal: 50 }),
      ],
      NOW,
    );
    expect(tendances[0]!.label).toBe('DeepSeek V4 : le modèle gratuit qui bat GPT-5 en coding');
    expect(tendances[0]!.itemId).toBe(1);
    expect(tendances[0]!.medias).toBe(4);
    expect(tendances[0]!.engagement).toBe(70);
    expect(tendances[0]!.items).toHaveLength(3);
    // Un article isolé n'est chaud que par son clic ou son engagement : l'étude, non ; l'outil viral, oui.
    expect(tendances.map((t) => t.itemId)).toContain(5);
    expect(tendances.map((t) => t.itemId)).not.toContain(4);
  });
});

describe('les nouvelles sources lisent ce qu’elles doivent lire', async () => {
  const { modelToItem, paperToItem } = await import('../src/scraper/huggingface.js');
  const { resolveHnQuery, AI_PATTERN } = await import('../src/scraper/hackernews.js');
  const { repoToItem } = await import('../src/scraper/github.js');
  const { echoFactor, blendScore } = await import('../src/scorer/blend.js');

  it('un modèle Hugging Face devient une actualité lisible, avec sa tâche en français et sa traction', () => {
    const item = modelToItem({ id: 'mistralai/Voxtral-2-Small', likes: 1200, downloads: 85000, trendingScore: 640, createdAt: '2026-10-30T10:00:00Z', pipeline_tag: 'automatic-speech-recognition' })!;
    expect(item.title).toBe('Voxtral-2-Small (mistralai) — nouveau modèle ouvert : transcription de la parole');
    expect(item.url).toBe('https://huggingface.co/mistralai/Voxtral-2-Small');
    expect(item.summary).toMatch(/1.200 likes/);
    expect(item.engagement).toBeGreaterThan(80);
    expect(modelToItem({ id: 'sans-organisation' })).toBeNull();
    const papier = paperToItem({ paper: { id: '2610.12345', title: 'Agents that read invoices', summary: 'We show…', upvotes: 40 }, publishedAt: '2026-10-31T00:00:00Z', numComments: 3 })!;
    expect(papier.url).toBe('https://huggingface.co/papers/2610.12345');
    expect(papier.summary).toMatch(/40 votes, 3 commentaires/);
  });

  it('Hacker News : la fenêtre glisse, et les noms de modèles comptent comme de l’IA', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(resolveHnQuery('…created_at_i>{24h}&x', now)).toBe(`…created_at_i>${Math.floor(now.getTime() / 1000) - 86_400}&x`);
    expect(resolveHnQuery('…created_at_i>{7d}', now)).toBe(`…created_at_i>${Math.floor(now.getTime() / 1000) - 7 * 86_400}`);
    for (const t of ['DeepSeek V4 is out', 'Show HN: Cursor for lawyers', 'Qwen3 beats everything', 'Sora is now free', 'Why GPUs are scarce', 'OpenClaw, a coding agent']) {
      expect(AI_PATTERN.test(t), t).toBe(true);
    }
    expect(AI_PATTERN.test('A new CSS reset for 2027')).toBe(false);
  });

  it('GitHub : un dépôt de voix ou d’OCR compte, un thème CSS non', () => {
    const base = { html_url: 'u', stargazers_count: 900, language: 'Python', created_at: '2026-10-25T00:00:00Z' };
    expect(repoToItem({ ...base, full_name: 'a/voicebox', description: 'Local speech to text for your meetings' })?.title).toMatch(/voicebox/);
    expect(repoToItem({ ...base, full_name: 'a/invoice-ocr', description: 'OCR invoices into your accounting software' })).not.toBeNull();
    expect(repoToItem({ ...base, full_name: 'a/theme', description: 'A dark theme for your terminal' })).toBeNull();
  });

  it('un écho pèse +10 % sur le score mélangé, jusqu’à +30 %', () => {
    expect(echoFactor(0)).toBe(1);
    expect(echoFactor(2)).toBe(1.2);
    expect(echoFactor(9)).toBe(1.3);
    const base = { scoreLLM: 70, sourceWeight: 1, publishedAt: ilYa(8), now: NOW };
    expect(blendScore({ ...base, echoes: 3 })).toBeGreaterThan(blendScore(base));
  });
});

describe('les sujets gardent les tendances, et l’API les montre à chaud', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { grouperParSujet } = await import('../src/scorer/sujets.js');
  const { buildServer } = await import('../src/api/server.js');

  it('un article repris par d’autres médias, ou chaud, fait un sujet à lui seul', () => {
    const groupes = grouperParSujet([
      { id: 1, title: 'OpenAI lance GPT-6', topics: ['openai', 'modèles'], sourceId: 1, score: 60, echoes: 3, echoSources: [2, 3, 4] },
      { id: 2, title: 'Un artisan automatise ses devis', topics: ['devis', 'artisans'], sourceId: 5, score: 62, chaud: true },
      { id: 3, title: 'Une étude sur le télétravail', topics: ['télétravail'], sourceId: 6, score: 65 },
    ]);
    const gpt = groupes.find((g) => g.itemIds.includes(1))!;
    expect(gpt.medias).toBe(4);
    // La reprise fait monter le groupe au-dessus d'un article isolé pourtant mieux noté.
    expect(gpt.score).toBeGreaterThan(65);
    expect(groupes.find((g) => g.itemIds.includes(2))!.chaud).toBe(true);
    expect(groupes.find((g) => g.itemIds.includes(3))!.medias).toBe(1);
  });

  it('GET /api/news/tendances rend les histoires chaudes des dernières heures, non notées comprises', async () => {
    const src = (name: string) => db.insert(schema.newsSources).values({ name, kind: 'rss', url: `https://${name}.test/feed`, lang: 'fr', weight: 1 }).returning().get();
    const a = src('Numerama');
    const b = src('01net');
    const c = src('BFM Tech');
    // L'API compte depuis l'heure réelle : les dates du test aussi.
    const ilYaReel = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const inserer = (title: string, sourceId: number, extra: Partial<typeof schema.newsItems.$inferInsert> = {}) =>
      db
        .insert(schema.newsItems)
        .values({ sourceId, url: `https://x.test/${Math.random()}`, canonicalUrl: `https://x.test/${Math.random()}`, title, contentHash: String(Math.random()), lang: 'fr', status: 'new', fetchedAt: ilYaReel(1), publishedAt: ilYaReel(2), ...extra })
        .returning()
        .get();
    inserer('Mistral lance Voxtral 2, un modèle vocal ouvert', a.id, { echoes: 2, echoSources: JSON.stringify([b.id, c.id]) });
    inserer('Voxtral 2 : Mistral mise sur la voix pour les entreprises', b.id);
    inserer('Un article isolé et sans signal', c.id);
    inserer('Une vieille histoire reprise partout', a.id, { echoes: 5, fetchedAt: ilYaReel(80), publishedAt: ilYaReel(80) });
    const app = await buildServer();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'motdepasse-test' } });
    const brut = login.headers['set-cookie'];
    const cookie = Array.isArray(brut) ? brut.join('; ') : String(brut);
    const res = await app.inject({ method: 'GET', url: '/api/news/tendances', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const tendances = res.json() as { label: string; medias: number; sources: string[] }[];
    // Note : fetchedAt réel = maintenant (la base impose sa valeur par défaut au test) ; la fenêtre est de 36 h.
    expect(tendances.length).toBeGreaterThanOrEqual(1);
    expect(tendances[0]!.label).toMatch(/Voxtral 2/);
    expect(tendances[0]!.medias).toBeGreaterThanOrEqual(3);
    expect(tendances.some((t) => /article isolé/.test(t.label))).toBe(false);
    await app.close();
  });
});
