import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-prog2-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('un post programmé reste modifiable', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { processDuePublishJobs } = await import('../src/publishers/worker.js');
  const { closeBrowser } = await import('../src/render/browser.js');
  const { DEFAULTS } = await import('@odile/shared');
  const { eq } = await import('drizzle-orm');

  it('modifier le thème efface les rendus, et la publication les refabrique au lieu d’échouer', async () => {
    const post = db
      .insert(schema.posts)
      .values({
        platform: 'linkedin',
        channel: 'li_personal',
        format: 'li_image',
        theme: DEFAULTS.theme,
        status: 'scheduled',
        hook: 'Trois devis perdus par semaine',
        caption: 'Texte du post.\n\nCommente GUIDE',
        cta: 'Commente GUIDE',
        hashtags: '["#ia"]',
        commentTriggerKeyword: 'GUIDE',
        scheduledAt: new Date(Date.now() - 60000).toISOString(),
      })
      .returning()
      .get();
    // Une slide sans rendu : exactement l'état laissé par un changement de thème
    // ou de format après la programmation.
    db.insert(schema.slides)
      .values({ postId: post.id, idx: 0, kind: 'hook', content: JSON.stringify({ kind: 'hook', title: 'Trois devis perdus par semaine' }), renderAssetId: null })
      .run();
    db.insert(schema.publishJobs).values({ postId: post.id, scheduledAt: new Date(Date.now() - 60000).toISOString() }).run();

    const resume = await processDuePublishJobs();
    expect(resume).toMatchObject({ processed: 1, published: 1, failed: 0 });
    const relu = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).get()!;
    expect(relu.status).toBe('published');
    // La slide a bien été refabriquée au passage.
    const slide = db.select().from(schema.slides).where(eq(schema.slides.postId, post.id)).get()!;
    expect(slide.renderAssetId).toBeTruthy();
    await closeBrowser();
  }, 120_000);
});
