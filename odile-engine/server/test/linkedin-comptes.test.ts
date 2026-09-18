import { describe, expect, it } from 'vitest';

describe('texte LinkedIn : identifications et échappement', async () => {
  const { commentary } = await import('../src/publishers/linkedin.js');

  it('un nom connu devient une identification cliquable, le reste est échappé', () => {
    const texte = 'Chez Odile AI, on automatise (vraiment). Merci OpenAI !';
    const out = commentary(texte, [
      { nom: 'Odile AI', urn: 'urn:li:organization:1' },
      { nom: 'OpenAI', urn: 'urn:li:organization:2' },
    ]);
    expect(out).toBe('Chez @[Odile AI](urn:li:organization:1), on automatise \\(vraiment\\). Merci @[OpenAI](urn:li:organization:2) !');
  });

  it('identifie une seule fois, à la première apparition, sans tenir compte de la casse', () => {
    const out = commentary('odile ai puis Odile AI encore', [{ nom: 'Odile AI', urn: 'urn:li:organization:1' }]);
    expect(out).toBe('@[odile ai](urn:li:organization:1) puis Odile AI encore');
  });

  it('ne coupe jamais un mot : « Odile » n’identifie pas « Odilette »', () => {
    const out = commentary('Odilette et Odile', [{ nom: 'Odile', urn: 'urn:li:person:x' }]);
    expect(out).toBe('Odilette et @[Odile](urn:li:person:x)');
  });

  it('sans mention connue, le comportement historique est intact', () => {
    expect(commentary('Devis (express) #IA #PME')).toBe('Devis \\(express\\) #IA #PME');
    expect(commentary('a @b', [{ nom: 'zzz', urn: 'urn:li:organization:9' }])).toBe('a \\@b');
  });
});

describe('réponse sous un commentaire LinkedIn', async () => {
  const { composerReponseLinkedIn } = await import('../src/webhooks/linkedinPoller.js');
  const { dmTriggerSettingsSchema } = await import('@odile/shared');
  const reglages = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'x' });

  it('porte le lien et le prénom quand LinkedIn le donne', () => {
    const out = composerReponseLinkedIn('Merci {{prenom}} 🙌 voici {{ressource}} : {{link}}', {
      link: 'https://o/r/abc',
      ressource: 'le guide « Automatiser vos devis »',
      prenom: 'Camille',
    });
    expect(out).toBe('Merci Camille 🙌 voici le guide « Automatiser vos devis » : https://o/r/abc');
  });

  it('retire proprement le prénom quand il est inconnu', () => {
    expect(composerReponseLinkedIn('Merci {{prenom}} 🙌 voilà : {{link}}', { link: 'L' })).toBe('Merci 🙌 voilà : L');
    expect(composerReponseLinkedIn('Avec plaisir, {{prenom}} ☀️ {{link}}', { link: 'L', prenom: '  ' })).toBe('Avec plaisir ☀️ L');
    // Une ressource inconnue s'efface aussi proprement
    expect(composerReponseLinkedIn('Voici {{ressource}} : {{link}}', { link: 'L' })).toBe('Voici : L');
  });

  it('chaque phrase par défaut livre le lien — c’est le seul canal que LinkedIn autorise', () => {
    expect(reglages.linkedinReplyVariants.length).toBeGreaterThan(3);
    const emoji = /\p{Extended_Pictographic}/u;
    for (const phrase of reglages.linkedinReplyVariants) {
      expect(phrase).toContain('{{link}}');
      // Chaque phrase nomme ce qu'elle envoie : un lien court sans libellé se lit comme du spam.
      expect(phrase).toContain('{{ressource}}');
      expect(phrase).toContain('{{prenom}}');
    }
    // Registre B2B : au plus un émoji par phrase, jamais le ton « influenceur ».
    for (const phrase of reglages.linkedinReplyVariants) {
      expect((phrase.match(emoji) ?? []).length).toBeLessThanOrEqual(1);
      expect(phrase).not.toMatch(/cadeau|hop,|c’est cadeau/i);
    }
  });
});

describe('le lien dans la caption', async () => {
  const { avecLien, sansLien } = await import('../src/writer/generate.js');

  it('sansLien retire le placeholder et les URL sans laisser de trou (Instagram)', () => {
    expect(sansLien('Le guide ici : {{link}} .\n\nSource : Les Échos https://lesechos.fr/x')).toBe('Le guide ici :.\n\nSource : Les Échos');
    expect(sansLien('Commente GUIDE 👇')).toBe('Commente GUIDE 👇');
    // Une étiquette privée de son adresse ne reste pas ouverte sur le vide…
    expect(sansLien('Commente GUIDE.\n\nOu directement ici : https://o/r/abc')).toBe('Commente GUIDE.');
    // … mais une ligne qui annonce une liste garde ses deux points.
    expect(sansLien('Ce qui change :\n→ moins d’erreurs')).toBe('Ce qui change :\n→ moins d’erreurs');
  });

  it('avecLien laisse une seule adresse, la nôtre, juste sous le mot-clé (LinkedIn)', () => {
    const url = 'https://odile-engine.duckdns.org/r/ab23cd45';
    expect(avecLien('Le guide : {{link}}', url)).toBe(`Le guide : ${url}`);
    // Une URL inventée par le modèle disparaît ; la nôtre, traçable, reste.
    expect(avecLien(`Vu sur https://exemple.fr/x\n\nLe guide : ${url}`, url)).toBe(`Vu sur\n\nLe guide : ${url}`);
    // Lien oublié : il se pose juste après l'appel à l'action, pas à la fin.
    expect(
      avecLien('Trois idées.\n\nCommente GUIDE pour le recevoir.\n\nOdile AI', url, { motcle: 'GUIDE', libelle: 'Ou directement ici' }),
    ).toBe(`Trois idées.\n\nCommente GUIDE pour le recevoir.\n\nOu directement ici : ${url}\n\nOdile AI`);
    // Quand le mot-clé ouvre le diagnostic, le lien passe DEVANT l'appel à commenter :
    // il donne, le mot-clé propose.
    expect(avecLien('Trois idées.\n\nCommente CAS et je regarde.', url, { motcle: 'CAS', avantLeCta: true })).toBe(
      `Trois idées.\n\nC’est ici : ${url}\n\nCommente CAS et je regarde.`,
    );
    // Sans mot-clé (ou sans CTA repérable), en fin de texte.
    expect(avecLien('Trois idées.', url)).toBe(`Trois idées.\n\nC’est ici : ${url}`);
  });
});

describe('comptes LinkedIn multiples', async () => {
  process.env.DATA_DIR = `${process.cwd()}/var-test-comptes-${process.pid}`;
  process.env.LLM_MODE = 'mock';
  process.env.APP_SECRET ??= 'x'.repeat(48);
  const { storeToken, listStoredTokens, getStoredToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { comptesLinkedIn, compteDuPost, prochainComptePersonnel, mentionsConnues, actorUrn } = await import(
    '../src/publishers/linkedinAccounts.js'
  );
  const { db, schema } = await import('../src/db/client.js');

  it('deux profils personnels cohabitent, chacun sous sa clé', () => {
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'sub-moi', externalId: 'sub-moi', accessToken: 't1', meta: { name: 'Moi' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'sub-alexis', externalId: 'sub-alexis', accessToken: 't2', meta: { name: 'Alexis Duquenoy' } });
    // Reconnecter le même profil le met à jour au lieu d'en créer un troisième
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'sub-alexis', externalId: 'sub-alexis', accessToken: 't2b', meta: { name: 'Alexis Duquenoy' } });
    expect(listStoredTokens('linkedin', 'li_person').map((t) => t.accountKey)).toEqual(['sub-moi', 'sub-alexis']);
    expect(getStoredToken('linkedin', 'li_person', 'sub-alexis')?.accessToken).toBe('t2b');
    // Sans clé : le plus ancien, comme avant les comptes multiples
    expect(getStoredToken('linkedin', 'li_person')?.accountKey).toBe('sub-moi');
  });

  it('le post connaît son compte ; une clé périmée retombe sur un profil actif', () => {
    expect(compteDuPost({ channel: 'li_personal', liAccountKey: 'sub-alexis' })?.name).toBe('Alexis Duquenoy');
    expect(compteDuPost({ channel: 'li_personal', liAccountKey: 'sub-disparu' })?.key).toBe('sub-moi');
    expect(compteDuPost({ channel: 'li_personal', liAccountKey: null })?.key).toBe('sub-moi');
    expect(compteDuPost({ channel: 'li_org' })).toBeNull();
    expect(actorUrn('li_org', '42')).toBe('urn:li:organization:42');
  });

  it('le tour de rôle donne la main au profil qui a publié le moins récemment', () => {
    db.delete(schema.posts).run();
    const base = { platform: 'linkedin' as const, format: 'li_image' as const, theme: 't', status: 'published' as const, hook: '', caption: '', cta: '', hashtags: '[]' };
    db.insert(schema.posts).values({ ...base, channel: 'li_personal', liAccountKey: 'sub-moi', publishedAt: '2026-09-10T10:00:00.000Z' }).run();
    db.insert(schema.posts).values({ ...base, channel: 'li_personal', liAccountKey: 'sub-alexis', publishedAt: '2026-09-12T10:00:00.000Z' }).run();
    expect(prochainComptePersonnel()?.key).toBe('sub-moi');
    db.insert(schema.posts).values({ ...base, channel: 'li_personal', liAccountKey: 'sub-moi', publishedAt: '2026-09-14T10:00:00.000Z' }).run();
    expect(prochainComptePersonnel()?.key).toBe('sub-alexis');
    // Un profil en pause sort de la rotation sans être déconnecté
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'sub-alexis', externalId: 'sub-alexis', accessToken: 't2b', meta: { name: 'Alexis Duquenoy', actif: false } });
    expect(prochainComptePersonnel()?.key).toBe('sub-moi');
    expect(comptesLinkedIn('li_person').map((c) => c.actif)).toEqual([true, false]);
  });

  it('les identifications connues sont les profils et pages connectés, nommés', () => {
    storeToken({ provider: 'linkedin', subject: 'li_org', accountKey: '77', externalId: '77', accessToken: 't1', meta: { name: 'Odile AI' } });
    const noms = mentionsConnues().map((m) => `${m.nom}→${m.urn}`);
    expect(noms).toContain('Odile AI→urn:li:organization:77');
    expect(noms).toContain('Alexis Duquenoy→urn:li:person:sub-alexis');
    deleteToken('linkedin', 'li_person');
    deleteToken('linkedin', 'li_org');
  });
});

describe('santé de la chaîne commentaires (multi-comptes)', async () => {
  process.env.DATA_DIR ??= `${process.cwd()}/var-test-sante-${process.pid}`;
  process.env.APP_SECRET ??= 'x'.repeat(48);
  const { storeToken, deleteToken } = await import('../src/publishers/tokens.js');
  const { comptesLinkedIn, droitCommentaire, etatLecture, noterLecture } = await import('../src/publishers/linkedinAccounts.js');
  const { connectionWarnings } = await import('../src/publishers/refresh.js');
  const { linkedInDryPayload } = await import('../src/publishers/linkedin.js');
  const { schema } = await import('../src/db/client.js');

  const compte = (cle: string) => comptesLinkedIn('li_person').find((c) => c.key === cle)!;

  it('distingue le droit d’écrire une réponse et celui de lire les commentaires', () => {
    deleteToken('linkedin', 'li_person');
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'complet', externalId: 'P1', accessToken: 't', scopes: 'w_member_social,r_member_social', meta: { name: 'Complet' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'ecriture', externalId: 'P2', accessToken: 't', scopes: 'w_member_social', meta: { name: 'Écriture seule' } });
    storeToken({ provider: 'linkedin', subject: 'li_person', accountKey: 'muet', externalId: 'P3', accessToken: 't', scopes: 'openid,profile', meta: { name: 'Muet' } });

    expect(droitCommentaire(compte('complet'))).toMatchObject({ peutRepondre: true, peutLire: true });
    expect(droitCommentaire(compte('ecriture'))).toMatchObject({ peutRepondre: true, peutLire: false, manqueLecture: 'r_member_social' });
    expect(droitCommentaire(compte('muet'))).toMatchObject({ peutRepondre: false, manque: 'w_member_social', peutLire: false });
  });

  it('un refus de lecture est consigné sur le compte et remonte en avertissement', () => {
    noterLecture(compte('ecriture'), { ok: false, detail: 'droit r_member_social non accordé par LinkedIn' });
    const etat = etatLecture(compte('ecriture'));
    expect(etat?.ok).toBe(false);
    expect(etat?.detail).toContain('r_member_social');
    expect(etat?.at).toBeTruthy();

    const alerte = connectionWarnings().find((w) => w.message.includes('Écriture seule'));
    expect(alerte?.message).toContain('commentaires illisibles');
    expect(alerte?.message).toContain('aucune réponse automatique');

    // Un passage réussi efface l'alerte.
    noterLecture(compte('ecriture'), { ok: true, detail: '' });
    expect(etatLecture(compte('ecriture'))?.ok).toBe(true);
    expect(connectionWarnings().some((w) => w.message.includes('commentaires illisibles'))).toBe(false);
  });

  it('le payload de simulation nomme le compte qui publierait vraiment', () => {
    const post = {
      id: 1, platform: 'linkedin', channel: 'li_personal', liAccountKey: 'ecriture', format: 'li_image',
      hook: 'Accroche', caption: 'Texte', hashtags: '[]',
    } as unknown as typeof schema.posts.$inferSelect;
    const payload = linkedInDryPayload({ post, images: [], caption: 'Texte' }) as { compte: string; body: { author: string } };
    expect(payload.compte).toBe('Écriture seule');
    expect(payload.body.author).toBe('urn:li:person:P2');
  });
});

describe('les erreurs Meta parlent français', async () => {
  const { resumerErreurMeta } = await import('../src/publishers/metaErrors.js');

  it('un jeton refusé devient une consigne, pas un JSON', () => {
    const brut = 'HTTP 400 : {"error":{"message":"Invalid OAuth access token - Cannot parse access token","type":"OAuthException","code":190,"fbtrace_id":"AAhqaZkXHHU9ZZojupCLCkW"}}';
    const phrase = resumerErreurMeta(brut);
    expect(phrase).toContain('Meta n’accepte plus le jeton');
    expect(phrase).toContain('Reconnecte Instagram');
    expect(phrase).not.toContain('fbtrace_id');
  });

  it('une erreur inconnue garde le message de Meta, sans l’identifiant de trace', () => {
    expect(resumerErreurMeta('HTTP 500 : {"error":{"message":"Service temporarily unavailable","fbtrace_id":"X"}}')).toBe('Meta répond (HTTP 500) : Service temporarily unavailable');
    expect(resumerErreurMeta('')).toBe('connexion en échec');
    expect(resumerErreurMeta('x'.repeat(300)).length).toBeLessThanOrEqual(180);
  });
});
