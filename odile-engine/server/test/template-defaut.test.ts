import { afterAll, describe, expect, it } from 'vitest';

describe('thème des posts générés', async () => {
  const { db, schema } = await import('../src/db/client.js');
  const { eq } = await import('drizzle-orm');
  const { getDefaultTheme, dernierTemplate, setSetting, THEME_DERNIER } = await import('../src/db/settingsRepo.js');

  // Horodatages uniques et postérieurs à tout l'existant : le test ne dépend pas
  // du contenu de la base et n'y laisse rien (voir afterAll).
  const marque = Date.now();
  const ancien = `t-ancien-${marque}`;
  const recent = `t-recent-${marque}`;
  const iso = (msApres: number) => new Date(4_000_000_000_000 + marque + msApres).toISOString();
  const creer = (id: string, createdAt: string) =>
    db.insert(schema.customThemes).values({ id, name: id, createdAt, updatedAt: createdAt }).run();

  afterAll(() => {
    for (const id of [ancien, recent]) db.delete(schema.customThemes).where(eq(schema.customThemes.id, id)).run();
    setSetting('default_theme', THEME_DERNIER);
  });

  it('suit le dernier template créé quand aucun thème n’est épinglé', () => {
    setSetting('default_theme', THEME_DERNIER);
    creer(ancien, iso(0));
    creer(recent, iso(60_000));
    // Le thème se désigne par « custom:<slug> » : l'identifiant nu ne rend rien.
    expect(dernierTemplate()).toBe(`custom:${recent}`);
    expect(getDefaultTheme()).toBe(`custom:${recent}`);
  });

  it('respecte un thème épinglé', () => {
    setSetting('default_theme', 'odile-nuit');
    expect(getDefaultTheme()).toBe('odile-nuit');
  });
});
