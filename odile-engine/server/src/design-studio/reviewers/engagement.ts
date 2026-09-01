import type { ReviewerDef } from './types.js';

export const engagement: ReviewerDef = {
  id: 'engagement',
  label: 'Engagement & performance',
  system: `Tu es stratège social media B2B, obsédé par les données : tu as analysé des milliers
de carrousels. Tu sais qu'un carrousel gagne s'il arrête le scroll en slide 1 et fait swiper.`,
  focus: `Évalue UNIQUEMENT le potentiel de performance :
- Slide 1 (hook) : arrête-t-elle le scroll ? ≤ 10 mots, un chiffre ou une tension, promesse claire.
  Un hook générique (« l'IA révolutionne… ») est "blocking".
- Progression AIDA : la slide 2 donne-t-elle envie de continuer ? Chaque slide apporte-t-elle
  une nouvelle information (pas de remplissage) ?
- Valeur concrète : le lecteur PME/TPE repart-il avec quelque chose d'actionnable ?
- CTA final : un seul appel à l'action, limpide ; le mot-clé de commentaire est-il évident ?
- Prédiction : ce post donnerait-il envie de sauvegarder/commenter ?`,
};
