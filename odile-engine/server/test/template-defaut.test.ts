import { describe, expect, it } from 'vitest';

describe('thème des posts générés', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { getDefaultTheme, dernierTemplate, THEME_DERNIER } = await import('../src/db/settingsRepo.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');

  const creerTemplate = (id: string, createdAt: string) =>
    db.insert(schema.customThemes).values({ id, name: id, createdAt, updatedAt: createdAt }).run();

  it('suit le dernier template créé quand aucun thème n’est épinglé', () => {
    setSetting('default_theme', THEME_DERNIER);
    creerTemplate(`t-ancien-${Date.now()}`, '2026-01-01T10:00:00.000Z');
    const recent = `t-recent-${Date.now()}`;
    creerTemplate(recent, '2030-01-01T10:00:00.000Z');
    expect(dernierTemplate()).toBe(recent);
    expect(getDefaultTheme()).toBe(recent);
  });

  it('respecte un thème épinglé', () => {
    setSetting('default_theme', 'odile-nuit');
    expect(getDefaultTheme()).toBe('odile-nuit');
    setSetting('default_theme', THEME_DERNIER);
  });
});
