import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-video-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.PUBLIC_URL = 'https://odile-engine.duckdns.org';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('script prononcé par l’avatar', async () => {
  const { scriptParle } = await import('../src/video/index.js');

  it('retire ce qui ne se prononce pas : URL, hashtags, émojis', () => {
    const brut = 'Vos devis en 90 secondes 🚀 !\n\nTout est là : https://odileai.com/guide #IA #PME';
    expect(scriptParle(brut)).toBe('Vos devis en 90 secondes !\n\nTout est là :');
  });

  it('garde la ponctuation de respiration et borne la longueur', () => {
    expect(scriptParle('Une phrase. Une autre.')).toBe('Une phrase. Une autre.');
    expect(scriptParle('a'.repeat(2000)).length).toBe(1400);
    expect(scriptParle('court', 3)).toBe('cou');
  });
});

describe('fabrication d’une vidéo avatar', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { eq } = await import('drizzle-orm');

  let appels: { url: string; method: string; body: unknown }[] = [];
  const vraiFetch = globalThis.fetch;

  beforeAll(async () => {
    // La clé passe par le stockage chiffré du dashboard, comme en production.
    const { setOauthApps } = await import('../src/db/oauthApps.js');
    setOauthApps({
      linkedinClientId: '', metaAppId: '', metaVerifyToken: '', metaConfigId: '',
      framerProjectUrl: '', heygenApiKey: 'cle-de-test',
    });
    setSetting('video', {
      enabled: true, everyNPosts: 3, avatarType: 'avatar', avatarId: 'av-odile', avatarStyle: 'normal',
      voiceId: 'voix-fr', voiceSpeed: 1, backgroundType: 'couleur', backgroundValue: '', captions: true,
      targetSeconds: 45, testMode: false,
    });
  });

  function fauxHeyGen(etats: string[]) {
    let i = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      appels.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('/v2/video/generate')) {
        return new Response(JSON.stringify({ error: null, data: { video_id: 'vid-123' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/v1/video_status.get')) {
        const statut = etats[Math.min(i++, etats.length - 1)]!;
        const data = statut === 'completed'
          ? { status: 'completed', video_url: 'https://files.heygen.ai/vid-123.mp4', thumbnail_url: 'https://files.heygen.ai/vid.jpg', duration: 38.5, error: null }
          : statut === 'failed'
            ? { status: 'failed', video_url: null, error: { message: 'avatar introuvable' } }
            : { status: statut, video_url: null, error: null };
        return new Response(JSON.stringify({ code: 100, data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('.mp4')) {
        return new Response(Buffer.from('MP4-de-test-' + 'x'.repeat(500)), { status: 200, headers: { 'content-type': 'video/mp4' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  }

  function nouveauPost(script: string | null) {
    return db
      .insert(schema.posts)
      .values({
        platform: 'instagram', channel: 'ig', format: 'reel', theme: 'odile-nuit', status: 'reviewing',
        hook: 'Vos devis en 90 secondes', caption: 'Commente OUTIL', cta: '', hashtags: '[]',
        commentTriggerKeyword: 'OUTIL', videoScript: script,
      })
      .returning()
      .get();
  }

  it('demande la vidéo au bon format, sans ce qui ne se prononce pas', async () => {
    appels = [];
    fauxHeyGen(['processing']);
    const { lancerVideo } = await import('../src/video/index.js');
    const post = nouveauPost('Vos devis en 90 secondes 🚀 ! Tout est là : https://odileai.com #IA');
    const res = await lancerVideo(post.id);
    globalThis.fetch = vraiFetch;

    expect(res.lance).toBe(true);
    const demande = appels.find((a) => a.url.includes('/v2/video/generate'))!;
    const corps = demande.body as {
      dimension: { width: number; height: number };
      caption: boolean;
      test?: boolean;
      video_inputs: { character: Record<string, string>; voice: Record<string, unknown>; background: Record<string, string> }[];
    };
    expect(corps.dimension).toEqual({ width: 1080, height: 1920 });
    expect(corps.caption).toBe(true);
    expect(corps.test).toBeUndefined();
    expect(corps.video_inputs[0]!.character).toEqual({ type: 'avatar', avatar_id: 'av-odile', avatar_style: 'normal' });
    expect(corps.video_inputs[0]!.voice.voice_id).toBe('voix-fr');
    expect(corps.video_inputs[0]!.voice.input_text).not.toMatch(/https?:|#|🚀/);
    expect(corps.video_inputs[0]!.background.type).toBe('color');

    const enBase = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(enBase.videoStatus).toBe('pending');
    expect(enBase.videoProviderId).toBe('vid-123');
  });

  it('rapatrie le MP4 dès qu’il est prêt — l’adresse HeyGen expire, la nôtre non', async () => {
    appels = [];
    fauxHeyGen(['processing', 'completed']);
    const { lancerVideo, finaliserVideo, urlVideo } = await import('../src/video/index.js');
    const post = nouveauPost('Un script assez long pour passer la longueur minimale exigée avant de lancer la fabrication.');
    await lancerVideo(post.id);
    expect(await finaliserVideo(post.id)).toBe('en_cours');
    expect(await finaliserVideo(post.id)).toBe('prete');
    globalThis.fetch = vraiFetch;

    const enBase = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(enBase.videoStatus).toBe('ready');
    expect(enBase.videoDurationMs).toBe(38500);
    expect(enBase.videoAssetId).toBeTruthy();
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, enBase.videoAssetId!)).get()!;
    expect(asset.kind).toBe('video');
    expect(asset.mime).toBe('video/mp4');
    expect(urlVideo(asset.id)).toBe(`https://odile-engine.duckdns.org/public-assets/${asset.id}.mp4`);
  });

  it('un refus de HeyGen est enregistré avec son motif, jamais avalé', async () => {
    appels = [];
    fauxHeyGen(['failed']);
    const { lancerVideo, finaliserVideo } = await import('../src/video/index.js');
    const post = nouveauPost('Un script assez long pour passer la longueur minimale exigée avant de lancer la fabrication.');
    await lancerVideo(post.id);
    expect(await finaliserVideo(post.id)).toBe('echec');
    globalThis.fetch = vraiFetch;
    const enBase = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(enBase.videoStatus).toBe('failed');
    expect(enBase.videoError).toContain('avatar introuvable');
  });

  it('refuse de lancer quand le script est trop court ou l’avatar absent', async () => {
    const { lancerVideo } = await import('../src/video/index.js');
    const court = nouveauPost('trop court');
    expect((await lancerVideo(court.id)).raison).toBe('script trop court');
    setSetting('video', { enabled: true, everyNPosts: 3, avatarType: 'avatar', avatarId: '', avatarStyle: 'normal', voiceId: '', voiceSpeed: 1, backgroundType: 'couleur', backgroundValue: '', captions: true, targetSeconds: 45, testMode: false });
    const sansAvatar = nouveauPost('Un script assez long pour passer la longueur minimale exigée avant de lancer la fabrication.');
    expect((await lancerVideo(sansAvatar.id)).raison).toBe('avatar ou voix non choisis');
  });
});

describe('publication d’une vidéo', async () => {
  const { instagramDryPayload } = await import('../src/publishers/instagram.js');
  const { facebookMirrorDryPayload } = await import('../src/publishers/facebook.js');
  const { linkedInDryPayload } = await import('../src/publishers/linkedin.js');

  const post = { id: 7, hook: 'Vos devis en 90 secondes', channel: 'ig', format: 'reel' } as never;
  const video = {
    assetId: 'asset-1',
    path: '/tmp/x.mp4',
    publicUrl: 'https://odile-engine.duckdns.org/public-assets/asset-1.mp4',
    coverUrl: 'https://odile-engine.duckdns.org/public-assets/cover-1.jpg',
    durationMs: 38500,
  };
  const input = { post, images: [], caption: 'Commente OUTIL', video };

  it('Instagram publie un Reel avec sa couverture et le partage au fil', () => {
    const payload = instagramDryPayload(input) as { steps: { call: string; body?: Record<string, unknown> }[] };
    const container = payload.steps[0]!.body!;
    expect(container.media_type).toBe('REELS');
    expect(container.video_url).toBe(video.publicUrl);
    expect(container.cover_url).toBe(video.coverUrl);
    expect(container.share_to_feed).toBe(true);
  });

  it('LinkedIn passe par l’envoi en trois temps puis référence l’URN de la vidéo', () => {
    const postLi = { ...(post as unknown as Record<string, unknown>), channel: 'li_personal' } as never;
    const payload = linkedInDryPayload({ ...input, post: postLi }) as {
      uploads: { call: string }[];
      body: { content: { media: { id: string } } };
    };
    expect(payload.uploads.map((u) => u.call).join(' ')).toMatch(/initializeUpload.*4 Mo.*finalizeUpload/s);
    expect(payload.body.content.media.id).toContain('urn:li:video:');
  });

  it('Facebook publie la vidéo sur la Page, pas une photo', () => {
    const payload = facebookMirrorDryPayload(input) as { call: string; body: Record<string, unknown> };
    expect(payload.call).toContain('/videos');
    expect(payload.body.file_url).toBe(video.publicUrl);
  });
});
