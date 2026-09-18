import { describe, expect, it } from 'vitest';

// Une base propre et le fournisseur factice, comme les autres fichiers : ce test
// héritait de l'environnement du fichier précédent et de la base de la veille.
process.env.DATA_DIR = `${process.cwd()}/var-test-budget-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('budget IA', async () => {
  const { coutMilli, consommationDuJour, enregistrerUsage, repartitionDuJour, verifierBudget, jourParis } = await import('../src/lib/llmBudget.js');
  const { setSetting } = await import('../src/db/settingsRepo.js');

  it('estime le coût selon le modèle : un Opus coûte plus cher qu’un Haiku', () => {
    const opus = coutMilli('claude-opus-5', 1_000_000, 100_000);
    const haiku = coutMilli('claude-haiku-4-5-20251001', 1_000_000, 100_000);
    expect(opus).toBeGreaterThan(haiku);
    expect(haiku).toBeGreaterThan(0);
  });

  it('un modèle inconnu reste facturé, jamais gratuit par défaut', () => {
    expect(coutMilli('modele-maison-42', 500_000, 50_000)).toBeGreaterThan(0);
  });

  it('compte les appels du jour', () => {
    const avant = consommationDuJour().cout;
    enregistrerUsage({ provider: 'anthropic', model: 'claude-sonnet-5', task: 'writer', inputTokens: 100_000, outputTokens: 20_000 });
    const apres = consommationDuJour();
    expect(apres.cout).toBeGreaterThan(avant);
    expect(apres.jour).toBe(jourParis());
  });

  it('la répartition dit quel métier consomme, et compte les reprises à part', () => {
    // La base de ce test survit d'une exécution à l'autre : des libellés propres à
    // cette exécution, sinon les lignes d'hier s'empilent sur celles d'aujourd'hui.
    const cle = `test-${process.pid}-${Date.now()}`;
    enregistrerUsage({ provider: 'anthropic', model: 'claude-sonnet-5', task: 'writing', label: `${cle}:guide`, inputTokens: 10_000, outputTokens: 2_000 });
    enregistrerUsage({ provider: 'anthropic', model: 'claude-sonnet-5', task: 'writing', label: `${cle}:guide`, attempt: 2, inputTokens: 10_000, outputTokens: 2_000 });
    // Une ligne d'avant le suivi par métier reste lisible sous le nom de sa tâche.
    enregistrerUsage({ provider: 'gemini', model: 'gemini-2.5-flash', task: `${cle}-scoring`, inputTokens: 5_000, outputTokens: 500 });
    // Une recherche web se paie aussi à l'unité, même sans un seul jeton compté.
    enregistrerUsage({ provider: 'anthropic', model: 'claude-sonnet-5', task: 'websearch', label: `${cle}:recherche-web`, coutSupplementMilli: 46.5 });
    const lignes = repartitionDuJour();
    const guide = lignes.find((l) => l.label === `${cle}:guide`)!;
    expect(guide.appels).toBe(2);
    expect(guide.reprises).toBe(1);
    expect(guide.coutReprises).toBeCloseTo(guide.cout / 2, 6);
    expect(lignes.find((l) => l.label === `${cle}-scoring`)?.task).toBe(`${cle}-scoring`);
    expect(lignes.find((l) => l.label === `${cle}:recherche-web`)?.cout).toBeCloseTo(0.047, 3);
  });

  it('une reprise de completeJson est enregistrée comme telle', async () => {
    const { completeJson } = await import('../src/llm/router.js');
    const { mockProvider } = await import('../src/llm/mock.js');
    const { z } = await import('zod');
    const origine = mockProvider.completeText.bind(mockProvider);
    let appel = 0;
    // Première réponse cassée, deuxième correcte : la reprise doit se voir dans la comptabilité.
    mockProvider.completeText = async (req) => {
      appel++;
      return { text: appel === 1 ? 'pas du json' : '{"ok": true}', model: 'mock', inputTokens: 100, outputTokens: 10 };
    };
    try {
      const avant = repartitionDuJour().find((l) => l.label === 'test:reprise');
      const { value } = await completeJson({ task: 'generic', label: 'test:reprise', prompt: 'x' }, z.object({ ok: z.boolean() }));
      expect(value.ok).toBe(true);
      const ligne = repartitionDuJour().find((l) => l.label === 'test:reprise')!;
      expect(ligne.appels - (avant?.appels ?? 0)).toBe(2);
      expect(ligne.reprises - (avant?.reprises ?? 0)).toBe(1);
    } finally {
      mockProvider.completeText = origine;
    }
  });

  it('les tâches facultatives cèdent la place avant les essentielles', () => {
    setSetting('llm_budget', { enabled: true, dailyEuros: 0.0005 });
    expect(verifierBudget('review').autorise).toBe(false);
    expect(verifierBudget('writer').autorise).toBe(false);
    setSetting('llm_budget', { enabled: true, dailyEuros: 500 });
    expect(verifierBudget('writer').autorise).toBe(true);
    expect(verifierBudget('review').autorise).toBe(true);
  });

  it('plafond désactivé : rien n’est refusé', () => {
    setSetting('llm_budget', { enabled: false, dailyEuros: 0 });
    expect(verifierBudget('review').autorise).toBe(true);
    setSetting('llm_budget', { enabled: true, dailyEuros: 2 });
  });
});
