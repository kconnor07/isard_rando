import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-coherence-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('légendes conformes à leur plateforme', async () => {
  const { bornerHashtags, sansLien } = await import('../src/writer/generate.js');
  const { corrigerLigneSource, mediaDepuisUrl } = await import('../src/scheduler/broadcast.js');
  const { captionFacebook } = await import('../src/publishers/facebook.js');
  const { couperALaPhrase } = await import('../src/llm/provider.js');

  it('Instagram : aucune adresse, même sans https ni {{link}}', () => {
    const texte = 'Regarde ici : {{link}}\nOu sur www.odile.ai/demo et sur odile.ai/demo\nL’outil fireflies.ai reste cité.';
    const propre = sansLien(texte);
    expect(propre).not.toContain('{{link}}');
    expect(propre).not.toContain('www.odile.ai');
    expect(propre).not.toContain('odile.ai/demo');
    // un nom d'outil sans chemin n'est pas une adresse : il reste
    expect(propre).toContain('fireflies.ai');
  });

  it('les hashtags sont dédoublonnés, préfixés et bornés par plateforme — celui de la marque en tête', () => {
    const bruts = ['IA', '#PME', 'ia', '#no-code', 'automatisation', 'Toulouse', 'agence', 'x'];
    expect(bornerHashtags(bruts, 'linkedin')).toEqual(['#OdileAI', '#IA', '#PME']);
    expect(bornerHashtags(bruts, 'instagram')).toHaveLength(5);
    expect(bornerHashtags(bruts, 'instagram')[0]).toBe('#OdileAI');
    // Déjà proposé par le modèle, sous une autre casse : une seule fois, en tête.
    expect(bornerHashtags(['#odileai', 'PME', '#OdileAI'], 'linkedin')).toEqual(['#OdileAI', '#PME']);
    // Sans accents : un même sujet ne se disperse pas entre deux orthographes.
    expect(bornerHashtags(['#Productivité', 'Productivite'], 'instagram')).toEqual(['#OdileAI', '#Productivite']);
  });

  it('la ligne « Source » revient au vrai média, déduit de l’adresse si besoin', () => {
    expect(mediaDepuisUrl('https://www.actuia.com/actualite/x')).toBe('ActuIA');
    expect(mediaDepuisUrl('https://blog.exemple-media.fr/article')).toBe('Exemple-media');
    const caption = 'Accroche\n\nSource : Laboratoire américain d’expérimentation\n#IA';
    expect(corrigerLigneSource(caption, 'ActuIA')).toContain('Source : ActuIA');
    expect(corrigerLigneSource(caption, 'ActuIA')).not.toContain('Laboratoire');
    expect(corrigerLigneSource('Source : ActuIA, Marie Dupont', 'ActuIA')).toBe('Source : ActuIA, Marie Dupont');
  });

  it('Facebook : « Commentez « X » » et les promesses de DM partent, le renvoi précède les hashtags', () => {
    const out = captionFacebook({
      caption: 'Texte utile.\n\nCommentez « AGENDA » et je t’envoie tout.\nJe t’écris en message privé dès que je vois ton commentaire.',
      motcle: 'AGENDA',
      ressource: 'le guide « Agenda »',
      urlInstagram: 'https://www.instagram.com/p/abc',
      hashtags: ['#IA', '#PME'],
    });
    expect(out).not.toMatch(/commentez/i);
    expect(out).not.toMatch(/message privé/i);
    expect(out.indexOf('sur Instagram')).toBeLessThan(out.indexOf('#IA'));
    expect(out.endsWith('#IA #PME')).toBe(true);
  });

  it('un paragraphe trop long se coupe sur une fin de phrase, jamais avec une ellipse', () => {
    const phrase = 'Une phrase complète qui fait son travail. ';
    const long = phrase.repeat(12);
    const coupe = couperALaPhrase(long, 300)!;
    expect(coupe.endsWith('.')).toBe(true);
    expect(coupe.length).toBeLessThanOrEqual(300);
    expect(couperALaPhrase('a'.repeat(400), 300)).toBeNull();
  });
});

describe('identifications LinkedIn et réponses cohérentes avec le post', async () => {
  const { commentary } = await import('../src/publishers/linkedin.js');
  const { texteAmorce } = await import('../src/publishers/amplify.js');
  const { modeleDeReponse } = await import('../src/webhooks/commentDm.js');
  const { setSetting, getDmTriggers } = await import('../src/db/settingsRepo.js');

  it('un nom LinkedIn avec émoji identifie le nom écrit sans émoji, et inversement', () => {
    const urn = 'urn:li:person:k';
    expect(commentary('Merci Khaled Aboubakar pour ce retour', [{ nom: 'Khaled 💻 Aboubakar', urn }])).toBe(`Merci @[Khaled Aboubakar](${urn}) pour ce retour`);
    expect(commentary('Avec Khaled 💻 Aboubakar', [{ nom: 'Khaled Aboubakar', urn }])).toBe(`Avec @[Khaled 💻 Aboubakar](${urn})`);
    expect(commentary('Khaledine Aboubakar', [{ nom: 'Khaled Aboubakar', urn }])).toBe('Khaledine Aboubakar');
  });

  it('sans lien dans la description, l’amorce et la réponse ne prétendent pas qu’il y est', () => {
    setSetting('dm_triggers', { ...getDmTriggers(), linkedinOffer: 'diagnostic' });
    const ancien = { commentTriggerKeyword: 'GUIDE', resourceKind: 'guide' as const, resourceTitle: 'Checklist', caption: 'Commente GUIDE et je t’envoie la checklist.' };
    expect(texteAmorce(ancien)!).not.toContain('en lien dans la description');
    expect(texteAmorce(ancien)!).toContain('commente GUIDE');
    expect(modeleDeReponse('linkedin', ancien)).toBe(getDmTriggers().replyTemplate);
    const recent = { ...ancien, caption: 'Le guide : https://o/r/abc\nCommente CAS' };
    expect(texteAmorce(recent)!).toContain('en lien dans la description');
    expect(modeleDeReponse('linkedin', recent)).toContain('est en lien dans le post');
  });
});
