import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-diffusion-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('diffusion simultanée', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { surfacesConnectees, surfacesManquantes, diffuserPartout, freresDuGroupe, adapterLegende } = await import('../src/scheduler/broadcast.js');
  const { schedulePost, unschedulePost } = await import('../src/approvals/service.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { eq } = await import('drizzle-orm');

  beforeAll(() => {
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
    deleteToken('meta', 'ig_user');
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'moi', externalId: 'moi', accessToken: 't', meta: { name: 'Moi' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', meta: { name: 'Alexis Duquenoy' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'pause', externalId: 'pause', accessToken: 't', meta: { name: 'En pause', actif: false } });
    storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', meta: { name: 'Odile AI' } });
    storeToken({ provider: 'meta', subject: 'ig_user', externalId: 'ig1', accessToken: 't', meta: { igUsername: 'odile.ai' } });
  });

  it('les surfaces connectées : chaque profil actif, la page, Instagram', () => {
    expect(surfacesConnectees().map((s) => s.label)).toEqual(['Moi', 'Alexis Duquenoy', 'page Odile AI', 'Instagram']);
    expect(surfacesManquantes({ channel: 'li_personal', liAccountKey: 'alexis' }).map((s) => s.label)).toEqual(['Moi', 'page Odile AI', 'Instagram']);
    expect(surfacesManquantes({ channel: 'ig', liAccountKey: null }).map((s) => s.label)).toEqual(['Moi', 'Alexis Duquenoy', 'page Odile AI']);
  });

  it('en mode mock, l’adaptation garde le texte et retire tout lien pour LinkedIn', async () => {
    const post = { caption: 'Voilà {{link}} et https://x.y/z fin', cta: 'Commente GUIDE', commentTriggerKeyword: 'GUIDE', hook: 'h' };
    expect((await adapterLegende(post, 'instagram', 'linkedin')).caption).toBe('Voilà et fin');
    expect((await adapterLegende(post, 'linkedin', 'instagram')).caption).toBe(post.caption);
  });

  it('un post fabriqué est recopié partout : mêmes slides rendues, lien propre à chaque copie', async () => {
    const lien = createLink('https://odile-engine.duckdns.org/guide/abc', { label: 'test' });
    const parent = db
      .insert(schema.posts)
      .values({
        platform: 'instagram', channel: 'ig', format: 'carousel', theme: 'custom:template-1', status: 'reviewing',
        hook: 'Accroche', caption: 'Texte Instagram. Commente GUIDE', cta: 'Commente GUIDE', hashtags: '["#ia"]',
        commentTriggerKeyword: 'GUIDE', resourceKind: 'guide', resourceTitle: 'Le guide', resourceUrl: 'https://odile-engine.duckdns.org/guide/abc', linkId: lien.id,
      })
      .returning()
      .get();
    for (const idx of [0, 1, 2]) {
      db.insert(schema.slides).values({ postId: parent.id, idx, kind: idx === 0 ? 'hook' : 'content', content: '{}', renderAssetId: `asset-${idx}` }).run();
    }
    const crees = await diffuserPartout(parent.id);
    expect(crees).toHaveLength(3);
    // Une seconde passe (relance) ne duplique rien
    expect(await diffuserPartout(parent.id)).toEqual([]);

    const groupe = db.select().from(schema.posts).where(eq(schema.posts.id, parent.id)).get()!.broadcastGroup;
    expect(groupe).toBeTruthy();
    const freres = freresDuGroupe({ id: parent.id, broadcastGroup: groupe });
    expect(freres.map((f) => `${f.channel}:${f.liAccountKey ?? ''}:${f.format}`).sort()).toEqual(['li_org:77:li_image', 'li_personal:alexis:li_image', 'li_personal:moi:li_image']);
    for (const f of freres) {
      expect(f.broadcastGroup).toBe(groupe);
      expect(f.resourceUrl).toBe(parent.resourceUrl);
      expect(f.commentTriggerKeyword).toBe('GUIDE');
      expect(f.linkId).not.toBe(parent.linkId);
      const lienFrere = db.select().from(schema.links).where(eq(schema.links.id, f.linkId!)).get()!;
      expect(lienFrere.targetUrl).toBe('https://odile-engine.duckdns.org/guide/abc');
      const slides = db.select().from(schema.slides).where(eq(schema.slides.postId, f.id)).orderBy(schema.slides.idx).all();
      expect(slides.map((s) => s.renderAssetId)).toEqual(['asset-0', 'asset-1', 'asset-2']);
    }
  });

  it('programmer l’original programme les copies ; les déprogrammer les ramène toutes en attente', () => {
    const parent = db.select().from(schema.posts).where(eq(schema.posts.channel, 'ig')).all().at(-1)!;
    db.update(schema.posts).set({ status: 'awaiting_approval' }).where(eq(schema.posts.broadcastGroup, parent.broadcastGroup!)).run();
    const quand = new Date(Date.now() + 3 * 86400000).toISOString();
    expect(schedulePost(parent.id, quand).ok).toBe(true);
    const freres = freresDuGroupe(parent);
    expect(freres.every((f) => f.status === 'scheduled' && f.scheduledAt)).toBe(true);
    // Chaque copie a son propre créneau, jamais avant l'original : le même sujet ne part
    // pas à la même minute depuis trois comptes.
    for (const f of freres) expect(new Date(f.scheduledAt!).getTime()).toBeGreaterThanOrEqual(new Date(quand).getTime());
    expect(new Set(freres.map((f) => f.scheduledAt)).size).toBe(freres.length);
    expect(unschedulePost(parent.id).ok).toBe(true);
    expect(freresDuGroupe(parent).every((f) => f.status === 'awaiting_approval' && !f.scheduledAt)).toBe(true);
  });
});
