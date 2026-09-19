import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-doc-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('document PDF LinkedIn', async () => {
  const fs = await import('node:fs');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');
  const { envoyerDocumentLinkedIn, titreDocument } = await import('../src/publishers/linkedinDocument.js');
  const { linkedInDryPayload } = await import('../src/publishers/linkedin.js');
  const { documentDue } = await import('../src/writer/generate.js');
  const { RENDER_SIZES } = await import('@odile/shared');

  beforeAll(() => {
    setSetting('cadence', { days: 3, rotation: ['li_personal'], broadcast: false, docEveryNPosts: 3 });
  });

  it('un post LinkedIn sur trois part en document, et jamais si le réglage est à zéro', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(documentDue)).toEqual([true, false, false, true, false, false, true]);
    setSetting('cadence', { days: 3, rotation: ['li_personal'], broadcast: false, docEveryNPosts: 0 });
    expect([0, 3, 6].map(documentDue)).toEqual([false, false, false]);
    setSetting('cadence', { days: 3, rotation: ['li_personal'], broadcast: false, docEveryNPosts: 3 });
  });

  it('le document garde la page 4:5 des slides', () => {
    expect(RENDER_SIZES.li_doc).toEqual({ width: 1080, height: 1350 });
  });

  it('le titre du document est une accroche propre, coupée à la longueur affichée', () => {
    expect(titreDocument('  Trois minutes\n  par devis  ')).toBe('Trois minutes par devis');
    expect(titreDocument('')).toBe('Document');
    const long = titreDocument('A'.repeat(200));
    expect(long).toHaveLength(96);
    expect(long.endsWith('…')).toBe(true);
  });

  it('le payload à blanc décrit l’envoi du document, pas une suite d’images', () => {
    const post = {
      id: 1, platform: 'linkedin', channel: 'li_personal', format: 'li_doc', hook: 'Trois minutes par devis',
      caption: 'Texte', hashtags: '[]',
    } as unknown as typeof schema.posts.$inferSelect;
    const payload = linkedInDryPayload({
      post,
      images: [0, 1, 2].map((idx) => ({ idx, assetId: `a${idx}`, path: '/tmp/x.png', publicUrl: '' })),
      caption: 'Texte du post',
    }) as { uploads: { call: string; pages?: number }[]; body: { content: { media: { id: string; title: string } } } };
    expect(payload.uploads[0]!.call).toContain('/rest/documents?action=initializeUpload');
    expect(payload.uploads[1]!.pages).toBe(3);
    expect(payload.body.content.media.id).toContain('urn:li:document:');
    expect(payload.body.content.media.title).toBe('Trois minutes par devis');
  });

  it('l’envoi déclare le propriétaire puis dépose le PDF en une seule fois', async () => {
    const pdf = `${process.env.DATA_DIR}/doc.pdf`;
    fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4 faux document'));
    const appels: { url: string; method: string; body: string; type: string }[] = [];
    const vrai = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const entetes = (init?.headers ?? {}) as Record<string, string>;
      appels.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : `<${(init?.body as Buffer | undefined)?.length ?? 0} octets>`,
        type: entetes['content-type'] ?? '',
      });
      if (url.includes('action=initializeUpload')) {
        return new Response(
          JSON.stringify({ value: { document: 'urn:li:document:D55', uploadUrl: 'https://www.linkedin.com/dms-uploads/D55/0' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 201 });
    }) as typeof globalThis.fetch;
    try {
      const urn = await envoyerDocumentLinkedIn({ token: 'jeton', owner: 'urn:li:person:moi', fichier: pdf });
      expect(urn).toBe('urn:li:document:D55');
    } finally {
      globalThis.fetch = vrai;
    }
    expect(appels).toHaveLength(2);
    expect(JSON.parse(appels[0]!.body)).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:moi' } });
    expect(appels[1]!.method).toBe('PUT');
    expect(appels[1]!.url).toContain('dms-uploads');
    expect(appels[1]!.type).toBe('application/pdf');
    expect(appels[1]!.body).toBe('<22 octets>');
  });
});

describe('le PDF se feuillette avant l’envoi', async () => {
  const fs = await import('node:fs');
  const { eq } = await import('drizzle-orm');
  const sharp = (await import('sharp')).default;
  const { db, schema } = await import('../src/db/client.js');
  const { saveAsset } = await import('../src/render/renderer.js');
  const { documentDuPost } = await import('../src/publishers/linkedinDocument.js');

  it('le dashboard ouvre le fichier que LinkedIn recevra, refait seulement si une slide change', async () => {
    const post = db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', format: 'li_doc', theme: 'odile-nuit', status: 'reviewing', hook: 'Doc à feuilleter', caption: 'x', cta: 'x', hashtags: '[]' })
      .returning()
      .get();
    const png = await sharp({ create: { width: 108, height: 135, channels: 3, background: '#123456' } }).png().toBuffer();
    const rendre = (idx: number) => {
      const slide = db.insert(schema.slides).values({ postId: post.id, idx, kind: 'hook', content: JSON.stringify({ kind: 'hook', title: 'T' }) }).returning().get();
      db.update(schema.slides).set({ renderAssetId: saveAsset(png, 'render', { postId: post.id, slideId: slide.id }) }).where(eq(schema.slides.id, slide.id)).run();
      return slide;
    };
    const premiere = rendre(0);
    rendre(1);
    const un = await documentDuPost(post.id);
    expect(un.pages).toBe(2);
    expect(fs.readFileSync(un.path).subarray(0, 4).toString()).toBe('%PDF');
    // Rien n'a changé : même fichier, pas de nouvelle fabrication
    expect((await documentDuPost(post.id)).assetId).toBe(un.assetId);
    // Une slide re-rendue : le PDF est refait
    db.update(schema.slides).set({ renderAssetId: saveAsset(png, 'render', { postId: post.id, slideId: premiere.id }) }).where(eq(schema.slides.id, premiere.id)).run();
    expect((await documentDuPost(post.id)).assetId).not.toBe(un.assetId);
  }, 60_000);
});
