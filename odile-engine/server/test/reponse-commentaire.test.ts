import { describe, expect, it } from 'vitest';

describe('refus Meta traduits en marche à suivre', async () => {
  const { expliquerErreurMeta } = await import('../src/publishers/metaErrors.js');

  it('(#3) désigne la capacité messagerie absente de l’app, pas une permission', () => {
    const brut =
      'HTTP 400 sur https://graph.facebook.com/v21.0/17841413031371776/messages: {"error":{"message":"(#3) Application does not have the capability to make this API call.","type":"OAuthException","code":3}}';
    const cause = expliquerErreurMeta(brut);
    expect(cause?.cause).toMatch(/messagerie/i);
    expect(cause?.remede).toMatch(/Messenger/);
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
  const { buildReply } = await import('../src/webhooks/commentDm.js');
  const { dmTriggerSettingsSchema } = await import('@odile/shared');

  it('est active par défaut et ne promet un DM que s’il est parti', () => {
    const s = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'lien : {{link}}' });
    expect(s.publicReply).toBe(true);
    expect(s.publicReplyTemplate).toMatch(/privé/i);
    // Le repli donne le lien publiquement : personne ne reste sans réponse.
    expect(buildReply(s.publicReplyFallback, 'https://odile.test/r/abc')).toContain('https://odile.test/r/abc');
    expect(buildReply(s.publicReplyTemplate, 'https://odile.test/r/abc')).not.toContain('odile.test');
  });
});
