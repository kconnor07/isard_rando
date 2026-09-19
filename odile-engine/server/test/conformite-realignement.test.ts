import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-conformite-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';

describe('conformité et réalignement des posts', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getDmTriggers } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { verifierPost, motifDeRefus } = await import('../src/writer/conformite.js');
  const { realignerSansModele } = await import('../src/scheduler/realigner.js');
  const { schedulePost } = await import('../src/approvals/service.js');
  const { buildCaption } = await import('../src/publishers/types.js');

  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', diagnosticKeywords: ['CAS', 'DIAGNOSTIC', 'AUDIT'], rdvUrl: '' });
  deleteToken('linkedin', 'li_person');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'khaled', externalId: 'khaled', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled Aboubakar' } });

  const creer = (values: Partial<typeof schema.posts.$inferInsert>) =>
    db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'Accroche', caption: 'x', cta: 'x', hashtags: '[]', ...values })
      .returning()
      .get();

  it('un ancien post LinkedIn : compte non choisi, lien absent, DM promis, trop de hashtags, date orpheline', () => {
    const post = creer({
      caption: 'Vous perdez du temps sur vos devis.\n\nCommente GUIDE, je t’envoie la checklist en message privé.',
      cta: 'Commente GUIDE',
      commentTriggerKeyword: 'GUIDE',
      hashtags: JSON.stringify(['#IA', '#PME', '#Toulouse', '#automatisation', '#devis', '#agence', '#nocode', '#outil']),
      scheduledAt: '2026-09-14T10:59:00.000Z',
    });
    const lien = createLink('https://source.test/article', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id }).where(eq(schema.posts.id, post.id)).run();
    const avant = verifierPost(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!);
    const codes = avant.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['compte-non-attribue', 'lien-absent', 'dm-promis', 'hashtags', 'date-orpheline', 'motcle-hors-liste', 'rdv-manquant', 'tu-vous']));
    expect(motifDeRefus(avant)).toMatch(/ne peut pas partir/);

    const { corrections, post: apres } = realignerSansModele(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!);
    expect(corrections.join(' | ')).toMatch(/compte attribué : Khaled Aboubakar/);
    expect(corrections.join(' | ')).toMatch(/lien de la ressource reposé/);
    expect(corrections.join(' | ')).toMatch(/hashtags ramenés à 3/);
    expect(corrections.join(' | ')).toMatch(/date orpheline effacée/);
    expect(apres.liAccountKey).toBe('khaled');
    expect(apres.caption).toContain(`https://odile.test/r/${lien.code}`);
    expect(apres.scheduledAt).toBeNull();
    // Ce qui reste demande une réécriture : la promesse de message privé
    const restants = verifierPost(apres).map((p) => p.code);
    expect(restants).toContain('dm-promis');
    expect(restants).not.toContain('lien-absent');
    expect(restants).not.toContain('compte-non-attribue');
    // …et tant qu'elle est là, on ne programme pas
    const refus = schedulePost(post.id, new Date(Date.now() + 3 * 3600_000).toISOString());
    expect(refus.ok).toBe(false);
    expect(refus.message).toMatch(/message privé/);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!.status).toBe('awaiting_approval');
  });

  it('Instagram : une adresse dans la légende est retirée, le mot-clé absent est ajouté', () => {
    const post = creer({ platform: 'instagram', channel: 'ig', format: 'carousel', caption: 'Regarde : https://odile.test/r/abc123\nEt www.exemple.fr/page', cta: 'Commente OUTIL et je t’envoie le lien', commentTriggerKeyword: 'OUTIL', resourceKind: 'outil', resourceTitle: 'Fireflies' });
    const avant = verifierPost(post).map((p) => p.code);
    expect(avant).toEqual(expect.arrayContaining(['url-instagram', 'motcle-absent']));
    const { post: apres, corrections } = realignerSansModele(post);
    expect(apres.caption).not.toMatch(/https?:|www\./);
    expect(apres.caption).toMatch(/Commente OUTIL/);
    expect(corrections.join(' | ')).toMatch(/adresse retirée/);
    expect(verifierPost(apres).filter((p) => p.niveau === 'bloquant')).toEqual([]);
  });

  it('un compte au jeton expiré bloque le post, et le dit avec son nom', () => {
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'alexis', externalId: 'alexis', accessToken: 't', scopes: 'w_member_social', expiresAt: '2020-01-01T00:00:00.000Z', meta: { name: 'Alexis Duquenoy' } });
    const post = creer({ liAccountKey: 'alexis', caption: 'Texte conforme.\n\nL’analyse : https://odile.test/r/zzz999\nCommente CAS', commentTriggerKeyword: 'CAS' });
    const problemes = verifierPost(post);
    expect(problemes.find((p) => p.code === 'compte-en-panne')?.message).toMatch(/Alexis Duquenoy ne peut pas publier : jeton expiré/);
    expect(problemes.filter((p) => p.niveau === 'bloquant').map((p) => p.code)).toEqual(['compte-en-panne']);
  });

  it('les hashtags déjà dans la légende ne sont pas répétés en pied de post', () => {
    const post = creer({ caption: 'Texte #IA utile.', hashtags: JSON.stringify(['#IA', '#PME']) });
    expect(buildCaption(post)).toBe('Texte #IA utile.\n\n#PME');
  });
});
