import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-tunnel-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('gabarits de message : la ressource est nommée', async () => {
  const { buildReply, nommerRessource } = await import('../src/webhooks/commentDm.js');
  const { dmTriggerSettingsSchema } = await import('@odile/shared');
  const reglages = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'x' });

  it('nomme ce qui a été promis, avec son titre exact', () => {
    expect(nommerRessource({ resourceKind: 'guide', resourceTitle: 'Automatiser vos devis' })).toBe(
      'le guide « Automatiser vos devis »',
    );
    expect(nommerRessource({ resourceKind: 'outil', resourceTitle: 'n8n' })).toBe('l’accès à n8n');
    expect(nommerRessource({ resourceKind: 'article', resourceTitle: null })).toBe('l’analyse complète');
    expect(nommerRessource(null)).toBe('ce qui était promis');
  });

  it('remplit tous les placeholders et efface proprement ceux qu’on ne connaît pas', () => {
    const modele = 'Merci {{prenom}}, voici {{ressource}} : {{link}}. Un point sur votre cas ? {{rdv}}';
    expect(
      buildReply(modele, {
        link: 'https://o/r/abc',
        ressource: 'le guide « X »',
        prenom: 'Camille',
        rdv: 'https://cal.com/odile',
      }),
    ).toBe('Merci Camille, voici le guide « X » : https://o/r/abc. Un point sur votre cas ? https://cal.com/odile');
    // Sans prénom ni rendez-vous : aucune accolade ne fuit, aucune virgule orpheline
    expect(buildReply(modele, { link: 'L', ressource: 'le guide' })).toBe('Merci, voici le guide : L. Un point sur votre cas ?');
    expect(buildReply('lien : {{link}}', 'https://o/r/x')).toBe('lien : https://o/r/x');
  });

  it('les défauts Instagram nomment la ressource et posent une question', () => {
    expect(reglages.thanksTemplate).toContain('{{ressource}}');
    expect(reglages.thanksTemplate).toMatch(/\?|dis-moi/i);
    expect(reglages.qualifyTemplate).toContain('{{rdv}}');
  });

  it('les défauts LinkedIn restent sobres : au plus un émoji, jamais « cadeau »', () => {
    const emoji = /\p{Extended_Pictographic}/gu;
    for (const phrase of reglages.linkedinReplyVariants) {
      expect(phrase).toContain('{{ressource}}');
      expect((phrase.match(emoji) ?? []).length).toBeLessThanOrEqual(1);
      expect(phrase).not.toMatch(/cadeau/i);
    }
  });
});

describe('le mot-clé est garanti dans la caption', async () => {
  const { captionPorteLeMotCle, writerResponseSchema } = await import('../src/writer/generate.js');
  it('reconnaît le mot-clé sans tenir compte de la casse ni des accents', () => {
    expect(captionPorteLeMotCle('… Commente GUIDE et je t’envoie tout.', 'GUIDE')).toBe(true);
    expect(captionPorteLeMotCle('… commente méthode pour le recevoir', 'METHODE')).toBe(true);
    // Le mot doit être entier : « GUIDES » ne déclenchera pas le détecteur
    expect(captionPorteLeMotCle('… Commente GUIDES', 'GUIDE')).toBe(false);
    // Sans l'appel à l'action, personne ne sait quoi faire
    expect(captionPorteLeMotCle('Le guide arrive bientôt.', 'GUIDE')).toBe(false);
  });

  it('le rédacteur refuse une caption qui ne porte pas l’appel à l’action', () => {
    const schema = writerResponseSchema(0);
    const base = {
      hook: 'Vos devis en 90 secondes',
      caption: 'Un texte sans appel à l’action.',
      cta: '',
      hashtags: ['#IA'],
      archetype: 'chiffre_3d',
      slides: [{ kind: 'hook', title: 'Vos devis en 90 secondes', body: 'Court.' }],
      screenshotUrl: null,
      commentTrigger: { enabled: true, keyword: 'GUIDE' },
    };
    const refus = schema.safeParse(base);
    expect(refus.success).toBe(false);
    if (!refus.success) expect(JSON.stringify(refus.error.issues)).toMatch(/Commente GUIDE/);

    const ok = schema.safeParse({ ...base, caption: 'Un texte utile.\n\nCommente GUIDE et je t’envoie la méthode.' });
    expect(ok.success).toBe(true);

    // Un mot-clé en deux mots ou avec un chiffre ne serait jamais reconnu par le détecteur
    const mauvais = schema.safeParse({ ...base, caption: 'Commente MON GUIDE', commentTrigger: { enabled: true, keyword: 'MON GUIDE' } });
    expect(mauvais.success).toBe(false);
  });
});

describe('la slide CTA dit ce qui se passe vraiment', async () => {
  const { promesseDuMotCle } = await import('../src/render/renderer.js');

  it('Instagram promet un message privé, LinkedIn une réponse sous le commentaire', () => {
    expect(promesseDuMotCle({ platform: 'instagram', resourceKind: 'guide' })).toBe('et reçois le guide en message privé');
    // Sur LinkedIn aucun DM n'arrive jamais : promettre un DM perd le lead.
    expect(promesseDuMotCle({ platform: 'linkedin', resourceKind: 'guide' })).toBe(
      'et je te réponds sous ton commentaire avec le guide',
    );
    expect(promesseDuMotCle({ platform: 'instagram', resourceKind: 'outil' })).toContain('l’accès à l’outil');
  });
});

describe('le guide PDF a une porte de sortie', async () => {
  const { guideHtml } = await import('../src/resources/guide.js');
  const { guideSchema } = await import('@odile/shared');
  const guide = guideSchema.parse({
    title: 'Automatiser vos devis',
    subtitle: 'La méthode en quatre étapes',
    intro: 'Ce guide part d’un constat simple et donne la marche à suivre, sans jargon technique inutile.',
    sections: [1, 2, 3].map((n) => ({
      title: `Étape ${n}`,
      body: 'Un paragraphe assez long pour passer la validation du schéma zod.',
      steps: ['Faire ceci', 'Puis cela'],
    })),
    checklist: ['Premier point', 'Deuxième point', 'Troisième point'],
    closing: 'Ce que l’agence peut faire ensuite, en deux phrases courtes et honnêtes.',
  });

  it('le pied mène au vrai site et le bloc final au rendez-vous', () => {
    const html = guideHtml(guide, { nom: 'Odile AI', site: 'https://odileai.com' }, null, {
      url: 'https://odile-engine.duckdns.org/r/abc123',
      libelle: 'Prendre 20 minutes',
    });
    expect(html).toContain('href="https://odile-engine.duckdns.org/r/abc123"');
    expect(html).toContain('Prendre 20 minutes →');
    expect(html).toContain('Et chez vous ?');
    // Le pied affichait le handle (« odileai ») : une adresse qui ne mène nulle part.
    expect(html).toContain('href="https://odileai.com"');
    expect(html).toContain('Odile AI · odileai.com');
  });

  it('sans rendez-vous réglé, le guide reste propre — pas de bouton mort', () => {
    const html = guideHtml(guide, { nom: 'Odile AI', site: 'https://odileai.com' }, null, null);
    // La règle CSS reste (quelques octets) ; c'est le bloc qui ne doit pas être posé.
    expect(html).not.toContain('class="sortie-bouton"');
    expect(html).not.toContain('Et chez vous ?');
    expect(html).toContain('Odile AI · odileai.com');
  });
});
