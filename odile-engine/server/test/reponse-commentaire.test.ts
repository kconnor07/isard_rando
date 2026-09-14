import { describe, expect, it } from 'vitest';

describe('refus Meta traduits en marche à suivre', async () => {
  const { expliquerErreurMeta } = await import('../src/publishers/metaErrors.js');

  it('(#3) désigne la capacité messagerie absente de l’app, pas une permission', () => {
    const brut =
      'HTTP 400 sur https://graph.facebook.com/v21.0/17841413031371776/messages: {"error":{"message":"(#3) Application does not have the capability to make this API call.","type":"OAuthException","code":3}}';
    const cause = expliquerErreurMeta(brut);
    expect(cause?.cause).toMatch(/messagerie/i);
    // La marche à suivre vise la console « cas d'utilisation », seule en vigueur.
    expect(cause?.remede).toMatch(/Cas d’utilisation/);
    expect(cause?.remede).toMatch(/AVANCÉ/);
    // La correction est côté app Meta : le moteur ne peut rien y faire seul.
    expect(cause?.cotePlateforme).toBe(true);
  });

  it('(#10) renvoie au réglage « Outils connectés » du compte Instagram', () => {
    const cause = expliquerErreurMeta('(#10) Application does not have permission for this action');
    expect(cause?.remede).toMatch(/Outils connectés/);
  });

  it('un jeton expiré renvoie à la reconnexion, sans manipulation chez Meta', () => {
    const cause = expliquerErreurMeta('{"error":{"message":"Error validating access token: Session has expired","code":190}}');
    expect(cause?.cotePlateforme).toBe(false);
    expect(cause?.remede).toMatch(/[Rr]econnecte/);
  });

  it('un refus inconnu ne fabrique pas d’explication', () => {
    expect(expliquerErreurMeta('quelque chose d’inédit')).toBeNull();
    expect(expliquerErreurMeta(null)).toBeNull();
  });
});

describe('réponse publique sous le commentaire', async () => {
  const { choisirVariante } = await import('../src/webhooks/commentDm.js');
  const { dmTriggerSettingsSchema } = await import('@odile/shared');
  const reglages = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'lien : {{link}}' });

  it('est active par défaut, avec plusieurs phrases de chaque côté', () => {
    expect(reglages.publicReply).toBe(true);
    expect(reglages.publicReplyVariants.length).toBeGreaterThan(3);
    expect(reglages.publicReplyFallbackVariants.length).toBeGreaterThan(2);
  });

  it('aucune phrase ne porte de lien : tout se passe en privé', () => {
    for (const phrase of [...reglages.publicReplyVariants, ...reglages.publicReplyFallbackVariants]) {
      expect(phrase).not.toMatch(/\{\{link\}\}|https?:\/\//);
    }
  });

  it('chaque phrase renvoie vers les messages privés et porte un émoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const phrase of reglages.publicReplyVariants) {
      expect(phrase).toMatch(/privé|DM|message/i);
      expect(phrase).toMatch(emoji);
    }
    for (const phrase of reglages.publicReplyFallbackVariants) {
      expect(phrase).toMatch(emoji);
    }
  });

  it('deux commentaires qui se suivent ne reçoivent pas la même phrase', () => {
    const vues = [101, 102, 103, 104].map((id) => choisirVariante(reglages.publicReplyVariants, id));
    expect(new Set(vues).size).toBe(4);
    // La liste tourne en boucle sans jamais sortir de ses bornes
    expect(choisirVariante(reglages.publicReplyVariants, 0)).toBe(reglages.publicReplyVariants[0]);
    expect(choisirVariante([], 3)).toBeNull();
    expect(choisirVariante(['  ', 'une phrase'], 7)).toBe('une phrase');
  });
});
