import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-sources2-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';
process.env.ADMIN_PASSWORD = 'motdepasse-test';

const NOW = new Date('2026-11-01T08:00:00Z');

describe('OpenRouter : un nouveau modèle devient une nouvelle lisible', async () => {
  const { modelToItem, prixParMillion, premierePhrase, FENETRE_JOURS } = await import('../src/scraper/openrouter.js');
  const particle = {
    id: 'particle-ai/particle-1',
    canonical_slug: 'particle-ai/particle-1',
    name: 'Particle AI: Particle-1',
    created: 1793207893, // 28 octobre 2026, 17 h 18 UTC
    context_length: 1048576,
    pricing: { prompt: '0.00000005', completion: '0.0000005' },
    architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
    description: 'Particle-1 is a token-efficient agentic coding model from Particle AI, post-trained on [DeepSeek V4.1](https://openrouter.ai/deepseek). It targets long coding sessions.',
    hugging_face_id: null,
  };

  it('nomme le modèle et son éditeur, dit le prix par million de tokens, le contexte et ce qu’il lit', () => {
    const item = modelToItem(particle, NOW)!;
    expect(item).not.toBeNull();
    expect(item.url).toBe('https://openrouter.ai/particle-ai/particle-1');
    expect(item.title).toBe('Particle-1 (Particle AI) — nouveau modèle');
    expect(item.summary).toContain('publié par Particle AI');
    expect(item.summary).toContain('contexte de 1 M de tokens');
    expect(item.summary).toMatch(/0,05 \$ par million de tokens en entrée, 0,5 \$ en sortie/);
    expect(item.summary).toContain('lit les images');
    expect(item.summary).toContain('post-trained on DeepSeek V4.1.');
    expect(item.summary).not.toContain('](');
    expect(item.publishedAt).toBe('2026-10-28T17:18:13.000Z');
    expect(item.engagement).toBe(25);
  });

  it('un grand éditeur est chaud d’emblée, un modèle à poids ouverts le dit dans son titre', () => {
    const gpt = modelToItem({ ...particle, id: 'openai/gpt-6.1-terra', canonical_slug: 'openai/gpt-6.1-terra', name: 'OpenAI: GPT-6.1 Terra' }, NOW)!;
    expect(gpt.engagement).toBe(45);
    const ouvert = modelToItem({ ...particle, hugging_face_id: 'particle-ai/particle-1' }, NOW)!;
    expect(ouvert.title).toBe('Particle-1 (Particle AI) — nouveau modèle à poids ouverts');
    expect(ouvert.engagement).toBe(35);
    const gratuit = modelToItem({ ...particle, pricing: { prompt: '0', completion: '0' } }, NOW)!;
    expect(gratuit.title).toContain('nouveau modèle gratuit');
    expect(gratuit.summary).toContain('gratuit');
  });

  it('ignore les variantes (:batch, :free) et les modèles arrivés il y a plus de dix jours', () => {
    expect(modelToItem({ ...particle, id: 'openai/gpt-6.1-terra:batch' }, NOW)).toBeNull();
    expect(modelToItem({ ...particle, id: 'x/y:free' }, NOW)).toBeNull();
    const vieux = Math.floor((NOW.getTime() - (FENETRE_JOURS + 1) * 86_400_000) / 1000);
    expect(modelToItem({ ...particle, created: vieux }, NOW)).toBeNull();
    expect(modelToItem({ ...particle, created: undefined }, NOW)).toBeNull();
  });

  it('prix et première phrase : robustes aux valeurs manquantes', () => {
    expect(prixParMillion('0.000001')).toBe(1);
    expect(prixParMillion('')).toBeNull();
    expect(prixParMillion(undefined)).toBeNull();
    expect(prixParMillion('abc')).toBeNull();
    expect(premierePhrase(undefined)).toBe('');
    expect(premierePhrase('Court. Puis une deuxième phrase très longue qui ne doit pas apparaître.')).toBe('Court. Puis une deuxième phrase très longue qui ne doit pas apparaître.'.slice(0, 240));
    expect(premierePhrase('Un modèle pensé pour les agents de code. Il fait aussi autre chose.')).toBe('Un modèle pensé pour les agents de code.');
  });
});

describe('Bluesky : le lien partagé et le buzz, pas le bavardage', async () => {
  const { resolveBskyQuery, postToItem, postUrl, rechercheBluesky, SIGNAL_MIN_SANS_LIEN } = await import('../src/scraper/bluesky.js');
  const base = {
    uri: 'at://did:plc:abc/app.bsky.feed.post/3mjhle3l5xk2d',
    author: { handle: 'techfr.skyfleet.blue', displayName: 'Tech FR' },
    record: { text: 'Mistral ouvre les poids de Mistral Large 4. Pour une PME, ça change le prix.', createdAt: '2026-10-29T11:27:00.000Z' },
    likeCount: 12,
    repostCount: 4,
    replyCount: 3,
  };

  it('« {24h} » devient un horodatage ISO encodé, posé dans since', () => {
    const url = resolveBskyQuery('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=OpenAI&since={24h}', NOW);
    expect(url).toBe('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=OpenAI&since=2026-10-31T08%3A00%3A00.000Z');
    expect(rechercheBluesky('intelligence artificielle', 'fr')).toBe(
      'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=intelligence+artificielle&sort=top&limit=50&lang=fr&since={24h}',
    );
  });

  it('un post qui partage un article prend l’adresse et le titre de l’article, et son buzz en signal', () => {
    const item = postToItem({
      ...base,
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: { uri: 'https://www.frandroid.com/ia/mistral-large-4', title: 'Mistral Large 4 : les poids sont ouverts', description: 'Le modèle français passe en open weights.', thumb: 'https://cdn.bsky.app/img/x.jpg' },
      },
    })!;
    expect(item.url).toBe('https://www.frandroid.com/ia/mistral-large-4');
    expect(item.title).toBe('Mistral Large 4 : les poids sont ouverts');
    expect(item.summary).toContain('Le modèle français passe en open weights.');
    expect(item.summary).toContain('partagé sur Bluesky par Tech FR');
    expect(item.summary).toContain('12 likes, 4 reposts');
    expect(item.imageUrl).toBe('https://cdn.bsky.app/img/x.jpg');
    expect(item.publishedAt).toBe('2026-10-29T11:27:00.000Z');
    // likes + 2·reposts + réponses = 23 → 20·ln(24) ≈ 64
    expect(item.engagement).toBe(64);
    expect(JSON.parse(item.engagementRaw!)).toMatchObject({ bskyLikes: 12, bskyReposts: 4, bskyAuteur: 'techfr.skyfleet.blue' });
  });

  it('sans lien, il faut du buzz : la première phrase fait titre, l’adresse est celle du post', () => {
    const item = postToItem(base)!;
    expect(item.url).toBe(postUrl(base));
    expect(item.url).toBe('https://bsky.app/profile/techfr.skyfleet.blue/post/3mjhle3l5xk2d');
    expect(item.title).toBe('Mistral ouvre les poids de Mistral Large 4.');
    expect(postToItem({ ...base, likeCount: 2, repostCount: 0, replyCount: 1 })).toBeNull();
    expect(SIGNAL_MIN_SANS_LIEN).toBe(8);
  });

  it('écarte ce qui ne parle pas d’IA, et les cartes qui renvoient vers Bluesky lui-même', () => {
    expect(postToItem({ ...base, record: { text: 'Belle balade au Capitole ce matin, soleil et marché.' }, likeCount: 300 })).toBeNull();
    const auto = postToItem({ ...base, embed: { external: { uri: 'https://bsky.app/profile/x/post/y', title: 'un post' } } })!;
    expect(auto.url).toBe(postUrl(base));
    const fr = postToItem({ ...base, record: { text: "L'intelligence artificielle dans les cabinets comptables : retour d'expérience à Toulouse." }, likeCount: 20 })!;
    expect(fr).not.toBeNull();
  });
});

describe('Mastodon : les liens que le Fédivers partage', async () => {
  const { linkToItem } = await import('../src/scraper/mastodon.js');
  const lien = {
    url: 'https://www.theguardian.com/technology/2026/oct/30/openai-agents-small-business',
    title: 'OpenAI launches agents for small businesses',
    description: 'The new agents book appointments and chase invoices.',
    provider_name: 'The Guardian',
    published_at: '2026-10-30T09:00:00.000Z',
    history: [
      { day: '1761955200', accounts: '21', uses: '23' },
      { day: '1761868800', accounts: '143', uses: '150' },
      { day: '1761782400', accounts: '400', uses: '410' },
    ],
  };

  it('compte les comptes distincts des deux derniers jours et en fait le signal', () => {
    const item = linkToItem(lien)!;
    expect(item.url).toBe(lien.url);
    expect(item.title).toBe('OpenAI launches agents for small businesses');
    expect(item.summary).toContain('partagé par 164 comptes sur Mastodon en 48 h (The Guardian)');
    expect(item.publishedAt).toBe('2026-10-30T09:00:00.000Z');
    expect(item.engagement).toBe(100);
    expect(JSON.parse(item.engagementRaw!)).toEqual({ mastoComptes: 164, mastoPartages: 173 });
  });

  it('ignore les liens hors IA et les entrées sans titre', () => {
    expect(linkToItem({ ...lien, title: 'Almost 50 arrested at protest outside US embassy', description: 'Police said…', url: 'https://www.theguardian.com/uk-news/protest' })).toBeNull();
    expect(linkToItem({ ...lien, title: '' })).toBeNull();
    expect(linkToItem({ ...lien, history: undefined })!.engagement).toBe(0);
  });
});

describe('YouTube : l’API Data remplace un flux que les serveurs ne peuvent plus lire', async () => {
  const { channelIdDe, uploadsPlaylistDe, playlistItemToItem } = await import('../src/scraper/youtube.js');

  it('retrouve la chaîne dans l’URL du flux et la liste de ses mises en ligne', () => {
    expect(channelIdDe('https://www.youtube.com/feeds/videos.xml?channel_id=UChpleBmo18P08aKCIgti38g')).toBe('UChpleBmo18P08aKCIgti38g');
    expect(channelIdDe('https://www.youtube.com/@mreflow')).toBeNull();
    expect(uploadsPlaylistDe('UChpleBmo18P08aKCIgti38g')).toBe('UUhpleBmo18P08aKCIgti38g');
  });

  it('une vidéo devient un item ; les vidéos privées ou supprimées sont ignorées', () => {
    const item = playlistItemToItem({
      snippet: {
        title: 'Les 5 agents IA que j’installe chez chaque client',
        description: 'Dans cette vidéo\n\non voit…',
        publishedAt: '2026-10-30T16:00:00Z',
        resourceId: { videoId: 'abc123XYZ' },
        thumbnails: { high: { url: 'https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg' } },
      },
    })!;
    expect(item.url).toBe('https://www.youtube.com/watch?v=abc123XYZ');
    expect(item.summary).toBe('Dans cette vidéo on voit…');
    expect(item.imageUrl).toContain('hqdefault.jpg');
    expect(playlistItemToItem({ snippet: { title: 'Private video', resourceId: { videoId: 'x' } } })).toBeNull();
    expect(playlistItemToItem({})).toBeNull();
  });
});

describe('Dates de flux : une date illisible ne fait plus tomber le flux', async () => {
  const { dateSure } = await import('../src/scraper/rss.js');

  it('garde l’ISO, lit « 29/10/2026 - 08:19 » (France Num) et rend null pour le reste', () => {
    expect(dateSure('2026-10-29T12:00:07.000Z', undefined)).toBe('2026-10-29T12:00:07.000Z');
    expect(dateSure(undefined, 'Thu, 29 Oct 2026 12:00:07 GMT')).toBe('2026-10-29T12:00:07.000Z');
    expect(dateSure(undefined, '29/10/2026 - 08:19')).toBe('2026-10-29T07:19:00.000Z');
    expect(dateSure(undefined, 'n’importe quoi')).toBeNull();
    expect(dateSure(undefined, undefined)).toBeNull();
    const deuxChiffres = dateSure(undefined, 'Thu, 29 Oct 26 13:00:00 +0100');
    expect(deuxChiffres === null || deuxChiffres.startsWith('2026-10-29')).toBe(true);
  });
});

describe('Le même lien venu d’une autre source compte comme un écho', async () => {
  const { echoDuMemeLien } = await import('../src/scraper/index.js');
  const existant = { sourceId: 10, echoes: 1, echoSources: '[12]', engagement: 20, engagementRaw: '{"hnPoints":10}' };

  it('ajoute la source aux échos et garde le meilleur signal social', () => {
    const maj = echoDuMemeLien(existant, 30, { engagement: 64, engagementRaw: '{"bskyLikes":12}' })!;
    expect(maj).toEqual({ echoes: 2, echoSources: '[12,30]', engagement: 64, engagementRaw: '{"bskyLikes":12}' });
    const faible = echoDuMemeLien(existant, 31, { engagement: 5, engagementRaw: null })!;
    expect(faible).toEqual({ echoes: 2, echoSources: '[12,31]' });
  });

  it('ne compte ni la source d’origine, ni une source déjà comptée, ni un JSON abîmé deux fois', () => {
    expect(echoDuMemeLien(existant, 10, { engagement: 90, engagementRaw: null })).toBeNull();
    expect(echoDuMemeLien(existant, 12, { engagement: 90, engagementRaw: null })).toBeNull();
    expect(echoDuMemeLien({ ...existant, echoSources: 'pas du json' }, 40, { engagement: null, engagementRaw: null })).toEqual({ echoes: 2, echoSources: '[40]' });
  });
});

describe('Les sources par défaut de la veille v6', async () => {
  const { SEED_SOURCES, PRODUCT_HUNT_IA } = await import('../src/scraper/sources.js');

  it('noms et adresses uniques, genres connus, Product Hunt recentré sur l’IA', () => {
    const noms = SEED_SOURCES.map((s) => s.name);
    expect(new Set(noms).size).toBe(noms.length);
    const urls = SEED_SOURCES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
    const genres = new Set(['rss', 'hn', 'youtube', 'reddit', 'github', 'hf', 'openrouter', 'bluesky', 'mastodon']);
    for (const s of SEED_SOURCES) expect(genres.has(s.kind)).toBe(true);
    expect(SEED_SOURCES.find((s) => s.name === 'Product Hunt')?.url).toBe(PRODUCT_HUNT_IA);
    expect(SEED_SOURCES.filter((s) => s.kind === 'bluesky').length).toBeGreaterThanOrEqual(5);
    expect(SEED_SOURCES.filter((s) => s.kind === 'mastodon').length).toBe(2);
    expect(SEED_SOURCES.find((s) => s.kind === 'openrouter')?.url).toBe('https://openrouter.ai/api/v1/models');
    for (const s of SEED_SOURCES.filter((x) => x.kind === 'bluesky')) expect(s.url).toContain('since={24h}');
    expect(SEED_SOURCES.some((s) => s.name === 'Mistral AI')).toBe(true);
    expect(SEED_SOURCES.some((s) => s.name === 'France Num')).toBe(true);
  });
});
