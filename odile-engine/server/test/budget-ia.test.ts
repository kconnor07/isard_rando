import { describe, expect, it } from 'vitest';

describe('budget IA', async () => {
  const { coutMilli, consommationDuJour, enregistrerUsage, verifierBudget, jourParis } = await import('../src/lib/llmBudget.js');
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
