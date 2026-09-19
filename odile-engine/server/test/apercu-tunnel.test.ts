import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-tunnel-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);
process.env.PUBLIC_URL = 'https://odile.test';

describe('ce que recevra la personne, vu avant validation', async () => {
  const { eq } = await import('drizzle-orm');
  const { db, schema } = await import('../src/db/client.js');
  const { setSetting, getDmTriggers } = await import('../src/db/settingsRepo.js');
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { createLink } = await import('../src/shortener/index.js');
  const { apercuTunnel } = await import('../src/approvals/tunnel.js');

  deleteToken('linkedin', 'li_person');
  deleteToken('linkedin', 'li_org');
  storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'k', externalId: 'k', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Khaled Aboubakar' } });
  storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't', scopes: 'w_organization_social', meta: { name: 'Odile AI' } });
  setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic', rdvUrl: 'https://cal.test/odile', requireFollow: true, publicReply: true });

  it('LinkedIn : lien et cible, ressource, réponse sous le commentaire, identifications', () => {
    const post = db
      .insert(schema.posts)
      .values({ platform: 'linkedin', channel: 'li_personal', liAccountKey: 'k', format: 'li_doc', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'h', caption: 'Chez Odile AI on a testé TechCrunch.\n\nL’analyse complète : {{link}}\nCommente CAS', cta: 'Commente CAS', hashtags: '[]', commentTriggerKeyword: 'CAS', resourceKind: 'article', resourceUrl: 'https://techcrunch.com/x', mentions: JSON.stringify([{ nom: 'TechCrunch', type: 'entreprise' }, { nom: 'Meta', type: 'entreprise' }]) })
      .returning()
      .get();
    const lien = createLink('https://techcrunch.com/x', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id, caption: post.caption.replaceAll('{{link}}', lien.shortUrl) }).where(eq(schema.posts.id, post.id)).run();
    const t = apercuTunnel(post.id)!;
    expect(t.lien?.shortUrl).toBe(`https://odile.test/r/${lien.code}`);
    expect(t.lien?.cible).toContain('https://techcrunch.com/x');
    expect(t.ressource.viaLien).toBe(true);
    expect(t.ressource.url).toBe('https://techcrunch.com/x');
    expect(t.reponseLinkedIn).toContain('https://cal.test/odile');
    // Le compte ne peut pas lire ses commentaires (pas de r_member_social) : réponse manuelle, dite
    expect(t.reponseManuelle).toBe(true);
    expect(t.avertissements.join(' ')).toMatch(/coller soi-même/);
    expect(t.mentions).toEqual(
      expect.arrayContaining([
        { nom: 'Odile AI', statut: 'identifiee' },
        { nom: 'TechCrunch', statut: 'en-clair' },
        { nom: 'Meta', statut: 'absente' },
      ]),
    );
    expect(t.dmInstagram).toBeNull();
    expect(t.lienDansLePost).toBe(true);
  });

  it('Instagram : message privé en deux temps quand la porte d’abonnement est active, réponse publique, légende Facebook', () => {
    setSetting('fb_mirror', { enabled: true });
    const post = db
      .insert(schema.posts)
      .values({ platform: 'instagram', channel: 'ig', format: 'carousel', theme: 'odile-nuit', status: 'awaiting_approval', hook: 'h', caption: 'Texte.\n\nCommente OUTIL et je t’envoie l’accès en message privé.', cta: 'Commente OUTIL', hashtags: '["#IA"]', commentTriggerKeyword: 'OUTIL', resourceKind: 'outil', resourceTitle: 'Fireflies', resourceUrl: 'https://fireflies.ai' })
      .returning()
      .get();
    // Tout post a un lien court, Instagram compris : il ne figure pas dans la légende, il part en privé.
    const lien = createLink('https://odileai.com/outil', { postId: post.id, label: `post-${post.id}` });
    db.update(schema.posts).set({ linkId: lien.id }).where(eq(schema.posts.id, post.id)).run();
    const t = apercuTunnel(post.id)!;
    expect(t.lien?.shortUrl).toContain(`/r/${lien.code}`);
    expect(t.lienDansLePost).toBe(false);
    expect(t.ressource.libelle).toBe('l’accès à Fireflies');
    // Premier message sans lien (il demande une réponse), le lien part au second
    expect(t.dmInstagram?.etape1).not.toMatch(/https?:\/\//);
    expect(t.dmInstagram?.etape2).toContain(`/r/${lien.code}`);
    expect(t.reponsePublique).toBeTruthy();
    expect(t.captionFacebook).not.toMatch(/commente OUTIL et je/i);
    expect(t.captionFacebook).toMatch(/sur (notre )?Instagram/);
    expect(t.avertissements.join(' ')).toMatch(/abonnement/);
  });
});
