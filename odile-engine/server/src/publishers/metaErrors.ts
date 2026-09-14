/**
 * Traduction des refus de l'API Graph en cause et en marche à suivre.
 *
 * Meta renvoie un numéro et une phrase en anglais, souvent sans rapport visible
 * avec le réglage fautif : « (#3) Application does not have the capability »
 * ne parle ni de produit Messenger ni de configuration d'app. Cette table dit,
 * pour chaque refus rencontré, ce qui manque et où le corriger.
 */
export interface CauseMeta {
  /** ce qui bloque, en une phrase */
  cause: string;
  /** la manipulation exacte, côté Meta ou côté Instagram */
  remede: string;
  /** true : la correction se fait dans l'app Meta, pas dans le moteur */
  cotePlateforme: boolean;
}

const TABLE: { test: RegExp; cause: CauseMeta }[] = [
  {
    // Refus au niveau de l'app, pas du jeton : la permission peut être accordée et
    // l'appel refusé quand même. Deux causes réelles, invisibles depuis le jeton.
    test: /\(#3\)|does not have the capability/i,
    cause: {
      cause:
        'L’app Meta n’a pas la capacité « messagerie » pour ce compte. Deux causes possibles : la permission instagram_manage_messages est en accès standard (elle ne vaut alors que pour les personnes ayant un rôle dans l’app), ou le compte Instagram refuse l’accès à ses messages aux applications tierces.',
      remede:
        'App Meta → Cas d’utilisation → « Gérer les messages et les contenus sur Instagram » : vérifie que instagram_manage_messages est en accès AVANCÉ (l’accès avancé passe par la vérification de l’app). Côté Instagram : autorise l’accès aux messages — app Instagram → Paramètres → Confidentialité des messages (compte professionnel « Entreprise », la section n’apparaît pas pour un compte « Créateur »), ou depuis Meta Business Suite → Boîte de réception.',
      cotePlateforme: true,
    },
  },
  {
    test: /\(#10\)|2534015|access to messages/i,
    cause: {
      cause: 'Le compte Instagram refuse l’accès à sa messagerie aux outils connectés.',
      remede:
        'Instagram (application mobile) → Paramètres → Messages et réponses aux stories → Contrôle des messages → Outils connectés → activer « Autoriser l’accès aux messages ».',
      cotePlateforme: true,
    },
  },
  {
    test: /\(#200\)|requires .*permission|permission.*required/i,
    cause: {
      cause: 'Le jeton utilisé ne porte pas la permission exigée par cet appel.',
      remede:
        'Ajoute la permission manquante (nommée dans le message) à la configuration Facebook Login for Business, puis reconnecte le compte : un jeton de Page ne gagne une permission qu’en étant re-fabriqué.',
      cotePlateforme: true,
    },
  },
  {
    test: /\(#190\)|access token.*(expired|invalid)|session has expired/i,
    cause: { cause: 'Le jeton Meta n’est plus valide (expiré, révoqué, ou mot de passe changé).', remede: 'Reconnecte Instagram depuis Connexions & santé.', cotePlateforme: false },
  },
  {
    test: /2534022|not eligible|already replied|one message/i,
    cause: {
      cause:
        'Ce commentaire n’accepte plus de réponse privée : Meta n’en autorise qu’une seule par commentaire, et seulement dans les 7 jours.',
      remede: 'Teste sur un commentaire récent, écrit depuis un autre compte Instagram que celui de la marque.',
      cotePlateforme: false,
    },
  },
  {
    test: /\(#551\)|\(#368\)|cannot receive|blocked/i,
    cause: { cause: 'Cette personne ne peut pas recevoir de message du compte (restriction ou blocage).', remede: 'Rien à corriger côté moteur : teste avec un autre compte.', cotePlateforme: false },
  },
  {
    test: /\(#613\)|rate limit|too many calls/i,
    cause: { cause: 'Quota Meta atteint pour cette heure.', remede: 'Attends une heure : les envois reprennent seuls.', cotePlateforme: false },
  },
  {
    test: /\(#100\).*comment|Unsupported get request|does not exist/i,
    cause: {
      cause: 'Meta ne reconnaît pas l’objet visé (commentaire ou compte) avec ce jeton.',
      remede: 'Vérifie que la Page rattachée est bien celle du compte Instagram concerné, puis reconnecte.',
      cotePlateforme: true,
    },
  },
];

/** Cause et marche à suivre pour un message d'erreur Graph brut. `null` si inconnu. */
export function expliquerErreurMeta(brut: string | null | undefined): CauseMeta | null {
  if (!brut) return null;
  return TABLE.find((e) => e.test.test(brut))?.cause ?? null;
}
