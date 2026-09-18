import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-diffusion-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('diffusion simultanée', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { surfacesConnectees, surfacesManquantes, diffuserPartout, freresDuGroupe, adapterLegende, motcleDeSurface } = await import(
    '../src/scheduler/broadcast.js'
  );
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

  it('changer de plateforme change le mot à commenter', async () => {
    const { getDmTriggers } = await import('../src/db/settingsRepo.js');
    const dm = getDmTriggers();
    const parent = { id: 1, platform: 'instagram' as const, commentTriggerKeyword: 'GUIDE' };
    // Même plateforme : le mot du parent, sans quoi le texte publié et la base se
    // contrediraient. Vers LinkedIn : un mot du diagnostic, parce que là-bas le
    // mot-clé n'envoie pas la ressource (elle est dans le lien) mais ouvre le cas.
    expect(motcleDeSurface(parent, 'instagram')).toBe('GUIDE');
    expect(dm.diagnosticKeywords).toContain(motcleDeSurface(parent, 'linkedin'));
    expect(dm.keywords.map((m) => m.toUpperCase())).toContain(
      motcleDeSurface({ id: 1, platform: 'linkedin', commentTriggerKeyword: 'CAS' }, 'instagram'),
    );
    // Un post sans mot-clé n'en gagne pas un en changeant de compte.
    expect(motcleDeSurface({ id: 2, platform: 'instagram', commentTriggerKeyword: null }, 'linkedin')).toBeNull();
  });

  it('LinkedIn garde le lien en emplacement, Instagram n’en garde aucun', async () => {
    const { config } = await import('../src/config.js');
    // Le lien du parent redevient {{link}} : chaque copie posera le sien.
    const post = {
      caption: `Voilà ${config.PUBLIC_URL}/r/ab23cd45 et https://x.y/z fin`,
      cta: 'Commente GUIDE',
      commentTriggerKeyword: 'GUIDE',
      hook: 'h',
    };
    expect((await adapterLegende(post, 'instagram', 'linkedin')).caption).toBe('Voilà {{link}} et fin');
    expect((await adapterLegende(post, 'linkedin', 'instagram')).caption).toBe('Voilà et fin');
    // Un texte venu d'Instagram n'a aucun lien : LinkedIn en reçoit un, devant le
    // mot-clé — le lien donne la ressource, le mot-clé ouvre le diagnostic.
    const sansRien = { caption: 'Trois idées.\n\nCommente GUIDE pour le recevoir.', cta: 'Commente GUIDE', commentTriggerKeyword: 'GUIDE', hook: 'h' };
    expect((await adapterLegende(sansRien, 'instagram', 'linkedin')).caption).toBe(
      'Trois idées.\n\nC’est ici : {{link}}\n\nCommente GUIDE pour le recevoir.',
    );
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
    // Un carrousel Instagram devient un document PDF sur LinkedIn : le carrousel natif du réseau.
    expect(freres.map((f) => `${f.channel}:${f.liAccountKey ?? ''}:${f.format}`).sort()).toEqual(['li_org:77:li_doc', 'li_personal:alexis:li_doc', 'li_personal:moi:li_doc']);
    for (const f of freres) {
      expect(f.broadcastGroup).toBe(groupe);
      expect(f.resourceUrl).toBe(parent.resourceUrl);
      expect(f.commentTriggerKeyword).toBe('GUIDE');
      expect(f.linkId).not.toBe(parent.linkId);
      const lienFrere = db.select().from(schema.links).where(eq(schema.links.id, f.linkId!)).get()!;
      expect(lienFrere.targetUrl).toBe('https://odile-engine.duckdns.org/guide/abc');
      // Sur LinkedIn, la description porte le lien — celui de CETTE copie, jamais un autre.
      expect(f.caption).toContain(`/r/${lienFrere.code}`);
      expect(f.caption).not.toContain('{{link}}');
      const slides = db.select().from(schema.slides).where(eq(schema.slides.postId, f.id)).orderBy(schema.slides.idx).all();
      expect(slides.map((s) => s.renderAssetId)).toEqual(['asset-0', 'asset-1', 'asset-2']);
    }
  });

  it('quatre copies d’un sujet comptent pour une seule validation', async () => {
    const { sujetsEnAttente } = await import('../src/scheduler/cadence.js');
    const { formatPourPlateforme } = await import('../src/api/routes/apiPosts.js');
    const attente = sujetsEnAttente();
    // Le parent Instagram et ses trois copies LinkedIn : un sujet, quatre posts.
    expect(attente.posts).toBeGreaterThanOrEqual(4);
    expect(attente.sujets).toBeLessThan(attente.posts);
    // Un format appartient à sa plateforme ; le reel est commun.
    expect(formatPourPlateforme('li_doc', 'instagram')).toBe('carousel');
    expect(formatPourPlateforme('carousel', 'linkedin')).toBe('li_doc');
    expect(formatPourPlateforme('static', 'linkedin')).toBe('li_image');
    expect(formatPourPlateforme('reel', 'instagram')).toBe('reel');
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
