import { describe, expect, it } from 'vitest';

describe('veille GitHub', async () => {
  const { repoToItem, resolveGithubQuery } = await import('../src/scraper/github.js');

  it('les repères d’ancienneté deviennent des dates glissantes', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    expect(resolveGithubQuery('topic:mcp created:>{60d} stars:>100', now)).toBe('topic:mcp created:>2026-07-18 stars:>100');
    expect(resolveGithubQuery('pushed:>{7d}', now)).toBe('pushed:>2026-09-09');
  });

  it('un dépôt devient une actualité lisible, avec sa traction en signal social', () => {
    const item = repoToItem({
      full_name: 'acme/agent-kit',
      html_url: 'https://github.com/acme/agent-kit',
      description: 'Build AI agents that automate back-office workflows',
      stargazers_count: 2400,
      forks_count: 120,
      language: 'TypeScript',
      topics: ['ai-agents', 'automation'],
      created_at: '2026-08-01T00:00:00Z',
    });
    expect(item?.title).toBe('agent-kit — Build AI agents that automate back-office workflows');
    expect(item?.summary).toMatch(/étoiles GitHub/);
    expect(item?.summary).toMatch(/TypeScript/);
    expect(item?.engagement).toBeGreaterThan(80);
    expect(JSON.parse(item!.engagementRaw!)).toEqual({ githubStars: 2400, githubForks: 120 });
  });

  it('écarte les forks, les archives et ce qui ne parle pas d’IA ou d’automatisation', () => {
    const base = { html_url: 'u', stargazers_count: 10, language: null, created_at: '2026-08-01T00:00:00Z' };
    expect(repoToItem({ ...base, full_name: 'a/b', description: 'AI agents', fork: true })).toBeNull();
    expect(repoToItem({ ...base, full_name: 'a/b', description: 'AI agents', archived: true })).toBeNull();
    expect(repoToItem({ ...base, full_name: 'a/pretty-css', description: 'A CSS reset' })).toBeNull();
    expect(repoToItem({ ...base, full_name: 'a/ops', description: null, topics: ['mcp'] })?.title).toBe('ops');
  });
});

describe('axes élargis de la recherche web', async () => {
  const { axeElargiDuJour } = await import('../src/scraper/websearch.js');

  it('un seul axe par jour, les cinq en cinq jours', () => {
    const noms = [0, 1, 2, 3, 4, 5].map((j) => axeElargiDuJour(new Date(Date.UTC(2026, 8, 14 + j, 12))).sourceName);
    // Cinq axes distincts, puis la rotation recommence
    expect(new Set(noms.slice(0, 5)).size).toBe(5);
    expect(noms[5]).toBe(noms[0]);
    for (const attendu of [
      'LinkedIn FR (posts qui performent)',
      'Douleurs de dirigeants',
      'YouTube (vidéos du moment)',
      'Toulouse & Occitanie',
      'Compétences & skills IA',
    ]) {
      expect(noms).toContain(attendu);
    }
  });
});
