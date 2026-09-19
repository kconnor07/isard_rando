import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = `${process.cwd()}/var-test-miroir-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

const image = (i: number) => ({ idx: i, assetId: `a${i}`, path: `/tmp/a${i}.png`, publicUrl: `https://exemple.test/public-assets/a${i}.jpg` });
const input = (n: number) => ({ post: {} as never, images: Array.from({ length: n }, (_, i) => image(i)), caption: 'Légende du post\n\n#ia #pme' });

describe('recopie sur la Page Facebook', async () => {
  const { facebookMirrorDryPayload, PAGE_PUBLISH_SCOPE } = await import('../src/publishers/facebook.js');

  it('une image : une photo publiée avec sa légende', () => {
    const payload = facebookMirrorDryPayload(input(1)) as { call: string; body: { url: string; caption: string } };
    expect(payload.call).toContain('/photos');
    expect(payload.body.url).toBe('https://exemple.test/public-assets/a0.jpg');
    expect(payload.body.caption).toContain('Légende du post');
  });

  it('un carrousel : les images sont déposées sans publication, puis attachées à un seul post', () => {
    const payload = facebookMirrorDryPayload(input(4)) as { steps: { call: string; body: Record<string, unknown> }[] };
    const depots = payload.steps.filter((s) => s.call.includes('/photos'));
    expect(depots).toHaveLength(4);
    expect(depots.every((s) => s.body.published === false)).toBe(true);
    const feed = payload.steps.at(-1)!;
    expect(feed.call).toContain('/feed');
    expect((feed.body.attached_media as unknown[]).length).toBe(4);
    expect(feed.body.message).toContain('#ia #pme');
  });

  it('la publication sur une Page dépend d’une permission distincte d’Instagram', async () => {
    const { META_EXTRA_SCOPES } = await import('../src/publishers/oauth.js');
    expect(PAGE_PUBLISH_SCOPE).toBe('pages_manage_posts');
    expect(META_EXTRA_SCOPES).toContain(PAGE_PUBLISH_SCOPE);
  });
});
