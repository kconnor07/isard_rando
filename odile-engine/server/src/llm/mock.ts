import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

/**
 * Provider factice : réponses plausibles et déterministes pour chaque tâche,
 * afin de tester tout le pipeline (scrape→score→draft→review→email) sans clé API.
 */
export const mockProvider: LlmProvider = {
  name: 'mock',
  isConfigured: () => true,

  async completeText(req: LlmRequest): Promise<LlmResponse> {
    return { text: buildMockText(req), model: 'mock-1' };
  },
};

function buildMockText(req: LlmRequest): string {
  switch (req.task) {
    case 'scoring': {
      // Le prompt du scorer étiquette chaque item "[id=N]" — on les note tous.
      const ids = [...req.prompt.matchAll(/\[id=(\d+)\]/g)].map((m) => Number(m[1]));
      const scores = ids.map((id, i) => ({
        id,
        relevance: 30 + ((id + i) % 20),
        click: 25 + ((id * 7) % 25),
        reason: 'Mock : sujet IA actionnable pour une PME (score simulé).',
      }));
      return JSON.stringify({ scores });
    }
    case 'writing':
      return JSON.stringify(MOCK_GENERATED_POST);
    case 'review': {
      // Itération 1 : échec avec correctifs → exerce la boucle d'amélioration.
      const iteration = Number(/It[ée]ration\s*:\s*(\d+)/i.exec(req.prompt)?.[1] ?? '1');
      if (iteration <= 1) {
        return JSON.stringify({
          score: 68,
          verdict: 'Mock : bon départ mais le hook manque de tension et un titre déborde.',
          issues: [
            {
              severity: 'major',
              slideIdx: 0,
              target: 'title',
              problem: 'Le titre du hook est trop long, risque de débordement.',
              fix: 'Raccourcir le titre du hook sous 8 mots.',
            },
          ],
        });
      }
      return JSON.stringify({
        score: 88,
        verdict: 'Mock : hiérarchie claire, contrastes conformes, prêt à publier.',
        issues: [],
      });
    }
    case 'vision_check':
      return JSON.stringify({ ok: true, reason: 'Mock : capture nette montrant un vrai site.' });
    default:
      return 'Réponse mock.';
  }
}

const MOCK_GENERATED_POST = {
  hook: "Cette IA rédige vos devis en 90 secondes (et vos concurrents l'utilisent déjà)",
  caption:
    "⏱️ 4 heures. C'est le temps moyen qu'une TPE passe chaque semaine sur ses devis.\n\nUne nouvelle génération d'outils IA vient de changer la donne : description du besoin → devis complet, chiffré et personnalisé, en 90 secondes.\n\nCe que ça change concrètement :\n→ Réponse aux prospects le jour même (au lieu de J+3)\n→ Zéro erreur de calcul\n→ Un taux de signature qui grimpe de 20 à 30 %\n\nOn a testé l'outil, capturé les écrans et résumé la méthode dans ce carrousel. 👇\n\nCommente OUTIL et je t'envoie le guide complet en message privé.",
  hashtags: ['#IA', '#PME', '#automatisation', '#productivité', '#TPE'],
  cta: "Commente OUTIL pour recevoir le guide complet en DM 📩",
  slides: [
    {
      kind: 'hook',
      annotation: 'testé pour vous',
      title: 'Vos devis en 90 secondes chrono',
      accentWord: '90 secondes',
      body: "L'IA qui répond à vos prospects avant vos concurrents.",
    },
    {
      kind: 'content',
      badge: 'LE PROBLÈME',
      title: '4 h par semaine perdues',
      accentWord: 'perdues',
      body: 'Rédaction, calculs, relances : le devis est le goulot d’étranglement n°1 des TPE.',
      bigNumber: '4h',
    },
    {
      kind: 'content',
      badge: 'LA SOLUTION',
      title: "L'IA rédige, vous validez",
      accentWord: 'validez',
      bullets: [
        'Décrivez le besoin en 2 phrases',
        "L'IA génère le devis chiffré",
        'Vous relisez et envoyez',
      ],
    },
    {
      kind: 'screenshot',
      badge: 'VU DE L’INTÉRIEUR',
      title: "L'outil en action",
      body: 'Capture réelle : un devis complet généré à partir de 2 phrases.',
      toolName: 'DevisIA',
    },
    {
      kind: 'value_prop',
      badge: 'RÉSULTAT',
      title: '+27 % de devis signés',
      accentWord: '+27 %',
      body: 'Répondre le jour même change tout : le premier arrivé rafle la mise.',
      bigNumber: '+27%',
    },
    {
      kind: 'cta',
      title: 'Envie du guide complet ?',
      accentWord: 'guide',
      body: 'Méthode pas à pas + 3 outils comparés pour automatiser vos devis.',
      ctaLabel: 'Commente OUTIL 👇',
    },
  ],
  screenshotUrl: 'https://odileai.com',
  commentTrigger: { enabled: true, keyword: 'OUTIL' },
};
