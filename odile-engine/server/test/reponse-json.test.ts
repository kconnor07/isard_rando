import { describe, expect, it } from 'vitest';
import { z } from 'zod';

process.env.DATA_DIR = `${process.cwd()}/var-test-json-${process.pid}`;
process.env.LLM_MODE = 'mock';
process.env.PUBLISH_MODE = 'dry';
process.env.APP_SECRET ??= 'x'.repeat(48);

describe('réparation des réponses JSON du modèle', async () => {
  const { appliquerCorrections, corrigerDepassements, couperAuMot, decrireIssues, reparerJson } = await import('../src/llm/provider.js');

  it('les retours à la ligne bruts dans les chaînes et les virgules finales sont réparés, le reste est intact', () => {
    const brut = '{\n  "titre": "Ligne un\nLigne deux",\n  "liste": ["a", "b",],\n  "n": 1,\n}';
    const objet = JSON.parse(reparerJson(brut)) as { titre: string; liste: string[]; n: number };
    expect(objet.titre).toBe('Ligne un\nLigne deux');
    expect(objet.liste).toEqual(['a', 'b']);
    expect(objet.n).toBe(1);
    const valide = '{"a":"déjà \\"échappé\\" \\n ok","b":[1,2]}';
    expect(reparerJson(valide)).toBe(valide);
  });

  it('un dépassement modeste est coupé sur un mot, un gros dépassement est laissé au modèle', () => {
    // 27 caractères pour 25 admis : dépassement modeste ; 40 pour 10 : trop gros pour couper
    const schema = z.object({ metaTitle: z.string().max(25), long: z.string().max(10), tags: z.array(z.string()).max(2) });
    const objet = { metaTitle: 'Agence IA à Toulouse : prix', long: 'x'.repeat(40), tags: ['a', 'b', 'c'] };
    const issues = schema.safeParse(objet).error!.issues;
    expect(corrigerDepassements(objet, issues)).toBe(2);
    expect(objet.metaTitle.length).toBeLessThanOrEqual(25);
    expect(objet.metaTitle.endsWith('…')).toBe(true);
    expect(objet.tags).toEqual(['a', 'b']);
    expect(objet.long.length).toBe(40);
    expect(couperAuMot('Agents IA pour PME à Toulouse', 14)).toBe('Agents IA…');
  });

  it('les corrections ciblées s’appliquent au chemin zod et la description des défauts donne la taille', () => {
    const objet = { sections: [{ paragraphs: ['un', 'deux'] }], meta: 'x' };
    expect(appliquerCorrections(objet, [{ path: 'sections.0.paragraphs.1', value: 'deux corrigé' }, { path: 'meta', value: 'y' }, { path: 'absent.0', value: 1 }])).toBe(2);
    expect(objet.sections[0]!.paragraphs[1]).toBe('deux corrigé');
    expect(objet.meta).toBe('y');
    const schema = z.object({ meta: z.string().max(0) });
    expect(decrireIssues(schema.safeParse(objet).error!.issues, objet)).toContain('meta (1 caractères)');
  });
});

describe('completeJson : reprises économes', async () => {
  const { completeJson } = await import('../src/llm/router.js');
  const { mockProvider } = await import('../src/llm/mock.js');
  // 29 caractères pour 26 admis : coupé sur place, sans second appel
  const schema = z.object({ metaTitle: z.string().max(26), body: z.string().min(5).max(50) });
  const brancher = (reponses: ((prompt: string) => { text: string; truncated?: boolean })[]) => {
    const origine = mockProvider.completeText.bind(mockProvider);
    let i = 0;
    const prompts: string[] = [];
    mockProvider.completeText = async (req) => {
      prompts.push(req.prompt);
      const r = reponses[Math.min(i++, reponses.length - 1)]!(req.prompt);
      return { text: r.text, truncated: r.truncated, model: 'mock', inputTokens: 10, outputTokens: 10 };
    };
    return { prompts, restaurer: () => (mockProvider.completeText = origine), appels: () => i };
  };

  it('un titre un peu trop long passe sans second appel', async () => {
    const b = brancher([() => ({ text: '{"metaTitle":"Agence IA à Toulouse : tarifs","body":"assez long pour passer"}' })]);
    try {
      const { value } = await completeJson({ task: 'generic', label: 'test:coupe', prompt: 'x' }, schema);
      expect(value.metaTitle.length).toBeLessThanOrEqual(26);
      expect(b.appels()).toBe(1);
    } finally {
      b.restaurer();
    }
  });

  it('un défaut de fond demande une correction ciblée, pas une réécriture', async () => {
    const b = brancher([
      () => ({ text: '{"metaTitle":"ok","body":"trop"}' }),
      (prompt) => {
        expect(prompt).toContain('"corrections"');
        expect(prompt).toContain('body (4 caractères)');
        return { text: '{"corrections":[{"path":"body","value":"maintenant assez long"}]}' };
      },
    ]);
    try {
      const { value } = await completeJson({ task: 'generic', label: 'test:patch', prompt: 'x' }, schema);
      expect(value.body).toBe('maintenant assez long');
      expect(b.appels()).toBe(2);
    } finally {
      b.restaurer();
    }
  });

  it('une réponse tronquée est régénérée plus courte, et l’erreur finale dit la cause', async () => {
    const b = brancher([() => ({ text: '{"metaTitle":"ok","body":"coupé au mil', truncated: true }), () => ({ text: 'pas du json' })]);
    try {
      await expect(completeJson({ task: 'generic', label: 'test:tronque', prompt: 'x', maxTokens: 50 }, schema)).rejects.toThrow(
        /après 2 tentatives .*test:tronque.*JSON non parsable/,
      );
      expect(b.prompts[1]).toContain('plus de place');
      expect(b.prompts[1]).toContain('tronquée');
    } finally {
      b.restaurer();
    }
  });
});
