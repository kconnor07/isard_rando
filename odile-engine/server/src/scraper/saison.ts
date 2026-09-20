/**
 * Le calendrier des PME : ce qui revient chaque année, à date.
 *
 * Une veille qui ne regarde que l'actualité rate la moitié des bons sujets. Un
 * dirigeant qui prépare sa clôture comptable en décembre, sa rentrée en août ou
 * ses relances d'impayés en janvier a les mêmes problèmes tous les ans, à la même
 * période — et ce sont précisément ceux qu'Odile automatise. Ces rendez-vous sont
 * connus d'avance : ils n'ont besoin d'aucune recherche, seulement d'être servis
 * au bon moment.
 */

export interface Marronnier {
  /** mois concernés, 1 = janvier */
  mois: number[];
  /** le sujet, tel qu'il sera proposé */
  label: string;
  /** pourquoi maintenant */
  reason: string;
  /** trois façons de le traiter */
  angles: { titre: string; angle: string }[];
  topics: string[];
}

export const MARRONNIERS: Marronnier[] = [
  {
    mois: [1],
    label: 'Les impayés de fin d’année et les relances qui n’ont jamais été faites',
    reason: 'Janvier est le mois où les dirigeants découvrent les factures de décembre jamais réglées, au moment où la trésorerie est la plus basse.',
    angles: [
      { titre: 'Le calcul', angle: 'Combien coûte une facture relancée trois semaines trop tard, en trésorerie et en temps passé.' },
      { titre: 'Le cas', angle: 'Une PME qui a automatisé ses relances et divisé son délai de paiement, avec les chiffres.' },
      { titre: 'La méthode', angle: 'Les trois relances à automatiser, à quel moment les envoyer, et ce qu’on écrit dedans.' },
    ],
    topics: ['facturation', 'relances', 'trésorerie'],
  },
  {
    mois: [1, 2],
    label: 'Les bonnes résolutions d’organisation qui tiennent rarement jusqu’en mars',
    reason: 'Les dirigeants prennent des résolutions d’organisation en janvier ; celles qui tiennent sont celles qui ne dépendent pas de leur discipline.',
    angles: [
      { titre: 'Le constat', angle: 'Pourquoi une résolution d’organisation échoue quand elle repose sur la volonté plutôt que sur un automatisme.' },
      { titre: 'La liste', angle: 'Cinq tâches qu’un dirigeant ne devrait plus faire à la main en 2026.' },
      { titre: 'Le premier pas', angle: 'La seule automatisation à mettre en place ce mois-ci pour sentir la différence.' },
    ],
    topics: ['organisation', 'productivité', 'automatisation'],
  },
  {
    mois: [3, 4, 5],
    label: 'La saison des déclarations : ce que la saisie comptable coûte vraiment',
    reason: 'Entre mars et mai, la préparation du bilan et des déclarations mobilise les dirigeants sur de la saisie pure.',
    angles: [
      { titre: 'Le chiffre', angle: 'Le temps qu’une TPE passe à ressaisir des justificatifs, et ce que ça représente en journées.' },
      { titre: 'Le cas', angle: 'Un cabinet ou une PME qui a supprimé la ressaisie, et ce que le comptable en dit.' },
      { titre: 'L’erreur', angle: 'Ce qui rend la saisie automatique inexploitable, et comment l’éviter dès le départ.' },
    ],
    topics: ['comptabilité', 'saisie', 'justificatifs'],
  },
  {
    mois: [6, 7],
    label: 'Tenir l’été avec une équipe réduite',
    reason: 'En juin et juillet, les congés vident les bureaux mais pas les boîtes mail : les demandes clients continuent d’arriver.',
    angles: [
      { titre: 'La réalité', angle: 'Ce qui se passe quand la personne qui répond aux clients part trois semaines.' },
      { titre: 'Le filet', angle: 'Les réponses automatiques qui tiennent vraiment la route, et celles qui font fuir.' },
      { titre: 'Le cas', angle: 'Une entreprise qui a passé l’été sans perdre une demande, avec ce qu’elle a mis en place.' },
    ],
    topics: ['congés', 'support client', 'continuité'],
  },
  {
    mois: [8, 9],
    label: 'La rentrée : reprendre sans crouler sous le retard accumulé',
    reason: 'Fin août et septembre, tout redémarre en même temps — c’est le moment où un dirigeant accepte de changer sa façon de travailler.',
    angles: [
      { titre: 'Le diagnostic', angle: 'Les trois goulots d’étranglement qui réapparaissent chaque rentrée dans une PME.' },
      { titre: 'Le plan', angle: 'Ce qu’on peut automatiser en une semaine pour que septembre ne se répète pas en octobre.' },
      { titre: 'Le cas', angle: 'Une entreprise locale qui a profité de la rentrée pour automatiser, et où elle en est trois mois après.' },
    ],
    topics: ['rentrée', 'organisation', 'priorités'],
  },
  {
    mois: [10, 11],
    label: 'Préparer le pic de fin d’année sans embaucher',
    reason: 'Octobre et novembre, les commerces et les services préparent la période la plus chargée de l’année avec les mêmes effectifs.',
    angles: [
      { titre: 'L’anticipation', angle: 'Ce qui sature en premier quand le volume double, et comment le voir venir.' },
      { titre: 'Le renfort', angle: 'Les tâches qu’une automatisation absorbe mieux qu’un renfort saisonnier, et celles où l’humain reste indispensable.' },
      { titre: 'Le cas', angle: 'Un commerce ou un service qui a tenu son pic sans recruter, avec ses chiffres.' },
    ],
    topics: ['saisonnalité', 'charge', 'service client'],
  },
  {
    mois: [11, 12],
    label: 'Le budget de l’année prochaine : où mettre l’euro d’automatisation',
    reason: 'En fin d’année, les dirigeants arbitrent leurs dépenses — c’est là que se décide l’investissement en outils et en automatisation.',
    angles: [
      { titre: 'L’arbitrage', angle: 'Comment comparer le coût d’une automatisation à celui d’une heure de travail, simplement.' },
      { titre: 'Le retour', angle: 'Les automatisations qui se remboursent en moins de trois mois dans une PME.' },
      { titre: 'Le piège', angle: 'Les projets d’IA qui coûtent cher et ne servent à personne, et comment les reconnaître avant de signer.' },
    ],
    topics: ['budget', 'retour sur investissement', 'investissement'],
  },
  {
    mois: [12],
    label: 'Le bilan de l’année, raconté par les chiffres du quotidien',
    reason: 'Décembre est le moment naturel du bilan : c’est aussi celui où l’on peut montrer ce que le temps gagné représente sur douze mois.',
    angles: [
      { titre: 'Le bilan', angle: 'Ce que douze mois d’automatisation représentent en journées rendues à l’équipe.' },
      { titre: 'La rétrospective', angle: 'Ce qui a changé cette année dans ce que l’IA sait faire pour une petite entreprise.' },
      { titre: 'La projection', angle: 'Ce qui sera possible l’année prochaine et qui ne l’était pas cette année.' },
    ],
    topics: ['bilan', 'temps gagné', 'rétrospective'],
  },
];

/**
 * Les rendez-vous du mois en cours et du suivant : on prépare toujours un peu en
 * avance, un post sur la rentrée se publie fin août, pas fin septembre.
 */
export function marronniersDuMoment(now = new Date()): Marronnier[] {
  const mois = now.getMonth() + 1;
  const suivant = (mois % 12) + 1;
  return MARRONNIERS.filter((m) => m.mois.includes(mois) || m.mois.includes(suivant));
}
