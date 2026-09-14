import { describe, expect, it } from 'vitest';

describe('la ressource promise est celle qui est livrée', async () => {
  const { guideSchema, ressourcePromiseSchema } = await import('@odile/shared');
  const { guideHtml, urlDuGuide } = await import('../src/resources/guide.js');

  const guide = guideSchema.parse({
    title: 'Automatiser vos devis',
    subtitle: 'La méthode en cinq étapes.',
    intro: 'Le devis est la tâche qui revient le plus souvent.',
    sections: [
      { title: 'Mesurer', body: 'Chronométrez trois devis.', steps: ['Noter', 'Chronométrer'] },
      { title: 'Isoler', body: 'Les données déjà connues.', steps: [] },
      { title: 'Brancher', body: 'La génération se fait seule.', steps: ['Modèle', 'Base'] },
    ],
    checklist: ['Trois devis chronométrés', 'Tarifs à jour', 'Un modèle validé'],
    closing: 'On installe la chaîne avec vos outils.',
  });

  it('le rédacteur ne peut promettre que ce que le moteur sait livrer', () => {
    expect(ressourcePromiseSchema.parse({ kind: 'guide', title: 'Le guide' }).kind).toBe('guide');
    expect(ressourcePromiseSchema.parse({ kind: 'outil', title: 'Zapier', toolUrl: 'https://zapier.com' }).toolUrl)
      .toBe('https://zapier.com');
    // Rien d'autre : un « webinaire » ou un « audit » n'aurait personne pour le fabriquer.
    expect(ressourcePromiseSchema.safeParse({ kind: 'webinaire', title: 'x' }).success).toBe(false);
  });

  it('un guide vide ou bâclé est refusé avant d’être mis en page', () => {
    expect(guideSchema.safeParse({ ...guide, sections: [] }).success).toBe(false);
    expect(guideSchema.safeParse({ ...guide, checklist: ['une seule'] }).success).toBe(false);
  });

  it('la mise en page porte le contenu du guide et le nom de la marque', () => {
    const html = guideHtml(guide, { nom: 'Odile AI', site: 'odileai.com' }, null);
    expect(html).toContain('Automatiser vos devis');
    expect(html).toContain('Chronométrez trois devis.');
    expect(html).toContain('Trois devis chronométrés');
    expect(html).toContain('Odile AI');
    // La page est en A4, prête pour l'impression PDF
    expect(html).toMatch(/@page\s*\{\s*size: A4/);
  });

  it('le lien du guide est public : il part en message privé, sans compte', () => {
    const url = urlDuGuide('abc123');
    expect(url).toMatch(/\/guide\/abc123$/);
    expect(url).not.toContain('/api/');
  });
});
