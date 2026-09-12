# Audit — connectique LinkedIn / Meta, programmation, analytics

Audit mené le 12 septembre 2026 sur la branche de développement, contre la
documentation officielle des plateformes (Instagram Graph API — content
publishing et media insights ; LinkedIn Posts API, OAuth 2.0, versioning).
Chaque constat est suivi de ce qui a été fait.

## 1. Connectique Meta / Instagram

| # | Constat | Gravité | Correctif |
|---|---|---|---|
| M1 | Le moteur servait ses rendus en **PNG** ; l'API de publication Instagram n'accepte que le **JPEG** → toute publication réelle aurait échoué au premier container. | Bloquant | `/public-assets/<id>.jpg` convertit le PNG à la volée (sharp, qualité 92, sous-échantillonnage 4:4:4, fond noir), résultat mis en cache à côté du PNG ; les publishers utilisent cette URL. |
| M2 | Les **jetons de Page** étaient stockés avec une expiration à 60 jours et déclenchaient une alerte inutile : dérivés d'un jeton utilisateur long, ils **n'expirent pas**. | Moyen | Stockés sans expiration ; le jeton utilisateur long (`fb_user`) est conservé et ré-échangé chaque nuit (`fb_exchange_token`) à moins de 20 jours, puis les jetons de Page sont re-dérivés. |
| M3 | Aucun **abonnement de l'app sur la Page** (`/{page}/subscribed_apps`) : le webhook commentaires ne recevait rien même bien configuré côté app. | Bloquant (DM) | Installation automatique à la connexion, indicateur « Webhook commentaires » et bouton Installer/Réinstaller dans Connexions & santé ; le test de connexion vérifie l'abonnement. |
| M4 | Une seule Page prise en compte (la première avec un compte Instagram). | Faible | Toutes les Pages candidates sont listées ; sélecteur « Compte publié » quand il y en a plusieurs. |
| M5 | Permission `instagram_manage_insights` jamais demandée : aucune statistique lisible. | Moyen | Ajoutée aux scopes ; relevé quotidien (voir §3). |
| M6 | Reconnexion ouverte dans un nouvel onglet, sans retour d'état dans le dashboard. | Faible | Connexion dans l'onglet courant, page de résultat détaillée (compte, Page, webhook, expiration), bouton Déconnecter. |

## 2. Connectique LinkedIn

| # | Constat | Gravité | Correctif |
|---|---|---|---|
| L1 | En-tête `LinkedIn-Version: 202506` figée dans le code : une version vit ~1 an, l'API allait renvoyer `426 Upgrade Required`. | Bloquant à terme | `LINKEDIN_VERSION` dans `.env` (défaut `202608`), partagé par le publisher, le poller de commentaires et le relevé de statistiques. |
| L2 | Le `#` était échappé dans le texte des posts : les hashtags devenaient du texte mort. | Moyen | `commentary()` n'échappe plus `#` (test unitaire) ; les autres caractères réservés du « little text » restent échappés. |
| L3 | Le `refresh_token` (fourni aux apps partenaires) n'était jamais stocké. | Moyen | Stocké chiffré s'il est présent ; job nocturne `refresh-tokens` à moins de 10 jours de l'expiration ; l'alerte email ne part que si le renouvellement est impossible ou en échec. |
| L4 | La page entreprise réutilisait le jeton personnel **sans jamais demander** `w_organization_social` : publication impossible. | Bloquant (canal entreprise) | Option « Demander aussi les droits page entreprise » (opt-in, car LinkedIn refuse la connexion si l'app n'a pas Community Management), liste des organisations administrées, liaison automatique si unique, avertissement explicite sinon. |
| L5 | Aucun moyen de savoir si un jeton marche vraiment avant la publication. | Moyen | « Tester les connexions » : appel réel de `userinfo`, de l'organisation, du compte Instagram et de la Page ; résultat mémorisé et affiché, alertes dans le tableau de bord. |

## 3. Programmation

| # | Constat | Gravité | Correctif |
|---|---|---|---|
| P1 | Impossible de choisir une date : seulement « prochain créneau » ou « dans 1 minute ». | Moyen | `POST /api/posts/:id/schedule {at}` ; « Programmer à… » dans À valider et l'éditeur, « Déplacer » sur un post programmé (dialogue date + heure, heure de Paris). |
| P2 | Le calendrier était une liste sans visibilité des créneaux libres. | Moyen | Grille de 4 semaines (liste par jour sur mobile) avec les créneaux configurés, les posts programmés/publiés et les créneaux libres cliquables (« Programmer ici ») ; `GET /api/schedule/slots` calcule les occurrences en heure de Paris (robuste aux changements d'heure, testé). |
| P3 | Le calcul d'occurrence balayait 15 jours par pas de 15 min avec un formateur `Intl` recréé à chaque pas. | Faible | Formateur mis en cache, conversion locale → UTC directe (`parisLocalToUtc`). |

## 4. Analytics

| # | Constat | Gravité | Correctif |
|---|---|---|---|
| A1 | Les clics comptaient les **aperçus de liens** (LinkedInBot, facebookexternalhit…) : un post partagé générait des « clics » avant tout lecteur humain. | Moyen | Colonne `clicks.bot` (détection par User-Agent, testée) ; toutes les statistiques excluent les robots. |
| A2 | Aucune donnée des plateformes : ni portée, ni j'aime, ni enregistrements. | Majeur | Table `post_metrics` (historique quotidien) ; job `metrics` à 9 h 10 : Instagram (`like_count`, `comments_count`, insights `reach, saved, shares, total_interactions, views` avec repli progressif si une métrique n'est pas supportée), LinkedIn (`socialActions` pour les réactions ; `organizationalEntityShareStatistics` pour les pages entreprise ; la portée d'un profil personnel n'est pas exposée par LinkedIn — indiqué tel quel). |
| A3 | Page Analytics limitée aux clics. | Moyen | Vue d'ensemble : KPI (posts, personnes atteintes, interactions, clics humains, abonnés Instagram), cartes par canal, portée + clics par jour, **meilleurs créneaux** (score moyen par jour × heure de publication), tableau des posts avec relevés (mention « partiel » avec le détail), bouton « Relever maintenant », dernier relevé. |
| A4 | La boucle d'apprentissage ne regardait que les clics. | Faible | Score de performance = clics humains + 0,5 × j'aime + 2 × commentaires + 2 × enregistrements + 3 × partages quand un relevé existe. |
| A5 | Le récap hebdomadaire ignorait la portée. | Faible | Ajoute personnes atteintes, j'aime, commentaires par post. |

## 5. Ce qui reste à valider en conditions réelles

- **Insights Instagram** : les noms de métriques évoluent (Meta a retiré
  `impressions` au profit de `views`) ; le repli progressif limite la casse
  mais un relevé « partiel » signale ce que la plateforme refuse.
- **Statistiques de page LinkedIn** : `r_organization_social` exige l'accès
  Community Management ; sans lui, seules les réactions/commentaires sont
  relevés (et seulement si l'app peut lire `socialActions`).
- **Refresh LinkedIn** : la présence du `refresh_token` dépend du statut de
  l'app ; sans lui, l'alerte 7 jours avant expiration reste le filet.
- Tout est observable dans **Connexions & santé** (jobs `refresh-tokens`,
  `metrics`, `check-connections`) et en CLI :
  `npm run job -- metrics --force`, `npm run job -- refresh-tokens`,
  `npm run job -- check-connections`.
