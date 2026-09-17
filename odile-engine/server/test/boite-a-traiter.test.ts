import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-boite-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('commentaires sans mot-clé', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { interetProbable, preparerSansMotCle } = await import('../src/webhooks/commentDm.js');
  const { repondreSousCommentaire } = await import('../src/webhooks/reponsePublique.js');
  const { eq } = await import('drizzle-orm');
  const fs = await import('node:fs');
  const { config } = await import('../src/config.js');

  it('reconnaît une demande, ignore une politesse', () => {
    for (const texte of [
      'Très intéressant, je veux bien la méthode',
      'guide svp',
      'Combien ça coûte pour une TPE ?',
      'Est-ce que ça marche avec Sage ?',
      'Je suis preneur, comment on fait pour tester chez nous',
      'Ça m’intéresse beaucoup',
    ]) {
      expect(interetProbable(texte), texte).toBe(true);
    }
    for (const texte of ['👏', 'Bravo !', 'Top', 'Excellent 🔥', '💪💪', '']) {
      expect(interetProbable(texte), texte).toBe(false);
    }
  });

  const creer = (texte: string, motcle: string | null) => {
    const post = db
      .insert(schema.posts)
      .values({
        platform: 'linkedin', channel: 'li_personal', format: 'li_image', theme: 'custom:t', status: 'published',
        hook: 'Accroche', caption: 'Texte', cta: 'Commente GUIDE', hashtags: '[]',
        commentTriggerKeyword: motcle, resourceKind: 'guide', resourceTitle: 'Automatiser vos relances',
        publishedAt: new Date().toISOString(), externalPostId: 'urn:li:share:1',
      })
      .returning()
      .get();
    return db
      .insert(schema.comments)
      .values({
        platform: 'linkedin', externalId: `c-${Math.random()}`, postId: post.id, externalPostId: post.externalPostId,
        authorName: 'marie.dupont', text: texte, createdTime: new Date().toISOString(), raw: '{}',
      })
      .returning()
      .get();
  };

  it('prépare une réponse nommée, sans rien envoyer', () => {
    const c = creer('Très intéressant, je veux bien la méthode', 'GUIDE');
    expect(preparerSansMotCle(c.id)).toBe(true);
    const relu = db.select().from(schema.comments).where(eq(schema.comments.id, c.id)).get()!;
    expect(relu.suggestedReply).toContain('Automatiser vos relances');
    // Rien n'est parti : ni mot-clé reconnu, ni réponse publique, ni DM.
    expect(relu.matchedKeyword).toBeNull();
    expect(relu.publicReplyStatus).toBe('none');
    expect(relu.dmStatus).toBe('none');
  });

  it('ne prépare rien sur un applaudissement, ni sur un post sans promesse', () => {
    expect(preparerSansMotCle(creer('Bravo 👏', 'GUIDE').id)).toBe(false);
    expect(preparerSansMotCle(creer('Je veux bien la méthode', null).id)).toBe(false);
  });

  it('la réponse envoyée à la demande part sous le commentaire', async () => {
    const c = creer('Ça m’intéresse, comment on fait ?', 'GUIDE');
    preparerSansMotCle(c.id);
    const relu = db.select().from(schema.comments).where(eq(schema.comments.id, c.id)).get()!;
    await repondreSousCommentaire(relu, relu.suggestedReply!);
    const fichier = fs.readdirSync(config.outboxDir).filter((f) => f.startsWith(`reponse-${c.id}-`)).at(-1)!;
    const paye = JSON.parse(fs.readFileSync(`${config.outboxDir}/${fichier}`, 'utf8')) as { platform: string; commentaire: string; texte: string };
    expect(paye.platform).toBe('linkedin');
    expect(paye.commentaire).toBe(relu.externalId);
    expect(paye.texte).toContain('Automatiser vos relances');
  });
});
