import { describe, expect, it } from 'vitest';

describe('porte d’abonnement avant le lien', async () => {
  const { buildReply } = await import('../src/webhooks/commentDm.js');
  const { dmTriggerSettingsSchema } = await import('@odile/shared');

  it('les messages du parcours sont fournis par défaut', () => {
    const s = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'lien : {{link}}' });
    expect(s.requireFollow).toBe(false);
    expect(s.askFollowTemplate).toMatch(/abonne/i);
    expect(s.thanksTemplate).toContain('{{link}}');
    expect(s.remindTemplate).toMatch(/abonn/i);
  });

  it('le lien remplace {{link}} dans chaque message du parcours', () => {
    const s = dmTriggerSettingsSchema.parse({ keywords: ['GUIDE'], replyTemplate: 'lien : {{link}}' });
    expect(buildReply(s.thanksTemplate, 'https://odile.test/r/abc')).toContain('https://odile.test/r/abc');
    // La demande d'abonnement ne doit pas dévoiler le lien avant l'heure
    expect(buildReply(s.askFollowTemplate, 'https://odile.test/r/abc')).not.toContain('odile.test');
  });
});
