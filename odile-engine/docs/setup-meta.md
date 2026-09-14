# Connecter Instagram (Meta) — publication + commentaire→DM

Instagram n'accepte les publications par API que pour un **compte professionnel
lié à une Page Facebook**, via une **app Meta Developer**. Compte ~30-45 min la
première fois. Tout est gratuit.

## 1. Préparer le compte Instagram

1. Application Instagram → Profil → ☰ → **Paramètres** → *Compte* →
   **Passer à un compte professionnel** (choisis « Entreprise »). Gratuit,
   réversible, 2 minutes.
2. Crée (ou utilise) une **Page Facebook** pour Odile AI :
   [facebook.com/pages/create](https://www.facebook.com/pages/create).
3. Lie les deux : Page Facebook → **Paramètres** → *Comptes liés* →
   **Instagram** → connecte le compte pro.

## 2. Créer l'app Meta Developer

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
   **Create App** → cas d'usage « Autre » → type **Business**.
2. Nom : `Odile Engine`. Une fois créée, copie dans le dashboard →
   **Connexions & santé** → *Applications LinkedIn et Meta* :
   - **App ID** (tableau de bord de l'app),
   - **App Secret** (*App settings* → *Basic*),
   - un **verify token** pour le webhook (bouton « Générer »), puis
     **Enregistrer les clés**. (À défaut, `.env` : `META_APP_ID`,
     `META_APP_SECRET`, `META_VERIFY_TOKEN`.)
3. *App settings* → *Basic* : renseigne **App domains** (`engine.odileai.com`)
   et les deux URL que le moteur sert lui-même :
   - **Privacy Policy URL** : `https://engine.odileai.com/confidentialite`
   - **User Data Deletion** → *Data Deletion Instructions URL* :
     `https://engine.odileai.com/suppression-donnees`

   Ces pages sont publiques et décrivent le traitement réel (jetons chiffrés,
   commentaires reçus par webhook, empreinte d'IP quotidienne sur les liens
   courts, durées de purge). L'adresse de contact qui y apparaît se règle avec
   `CONTACT_EMAIL` dans le `.env` (par défaut `contact@odileai.com`).
4. **Add product** → **Facebook Login** → *Settings* → **Valid OAuth Redirect
   URIs** : `https://engine.odileai.com/oauth/meta/callback`.

## 2 bis. Connexion Facebook pour les entreprises (configuration)

Meta bascule les apps Business sur *Facebook Login for Business*. Dans ce mode,
c'est une **configuration** qui définit les permissions ET les actifs proposés à
la connexion (Page + compte Instagram) — et l'URL OAuth doit porter son
`config_id`. Sans configuration, le dialogue accorde bien les permissions mais
n'attache aucun actif au jeton : `/me/accounts` renvoie alors des Pages sans
`instagram_business_account`, et la connexion échoue sur « aucun compte
Instagram professionnel ».

1. App Meta → **Connexion Facebook pour les entreprises** → *Configurations* →
   **Créer une configuration**.
2. Type de jeton : **jeton d'accès utilisateur**.
3. Autorisations : `pages_show_list`, `pages_read_engagement`, `instagram_basic`,
   `instagram_content_publish` (socle) ; ajouter `pages_manage_metadata`,
   `instagram_manage_comments`, `instagram_manage_messages`,
   `instagram_manage_insights` si les cas d'utilisation les proposent.
4. Actifs : **Pages** et **comptes Instagram**.
5. Copier l'**ID de configuration** dans le dashboard → Connexions & santé →
   *Applications LinkedIn et Meta* → champ « ID de configuration », puis
   **Enregistrer les clés**. (À défaut, `.env` : `META_CONFIG_ID`.)

Dès qu'il est renseigné, le moteur construit l'URL avec `config_id` et sans
`scope` ; laissé vide, il conserve le dialogue OAuth classique.

## 2 ter. Publier aussi sur la Page Facebook (facultatif)

Réglages → **Miroir Facebook** recopie chaque publication Instagram sur la Page
liée : mêmes visuels, même légende, juste après Instagram, sans créneau ni
validation séparés. Une image devient une photo, un carrousel une publication à
plusieurs photos.

Cela exige la permission **`pages_manage_posts`**, distincte de celles
d'Instagram : ajoutez-la aux autorisations de l'app (ou de la configuration
Login for Business), puis reconnectez le compte. Sans elle, la recopie est
refusée avec un message explicite et la publication Instagram reste intacte.

## 2 quater. Commentaire → DM : ce que Meta permet, et ce qu'il ne permet pas

Instagram **n'émet aucun événement d'abonnement** et n'expose pas la liste des
abonnés : envoyer un message dès qu'une personne s'abonne est impossible avec
l'API officielle, quel que soit l'outil. L'état d'abonnement n'est lisible que
pour une personne qui a déjà écrit au compte (`is_user_follow_business`).

D'où le parcours en deux temps proposé par Réglages → Commentaire → DM →
« Demander l'abonnement avant d'envoyer le lien » :

1. commentaire avec le mot-clé → message privé qui invite à s'abonner **sans
   donner le lien** ;
2. la personne répond → son abonnement est vérifié → remerciement + lien ;
   si elle n'est pas abonnée, une relance part à la place.

Le webhook doit alors être abonné aux champs **`comments`** et **`messages`**
(App Meta → Webhooks → Instagram), et l'app installée sur la Page.

## 3. Connecter le compte depuis le dashboard

⚠️ Si Facebook répond « **Invalid Scopes** » en listant `pages_manage_metadata`,
`instagram_manage_comments`, `instagram_manage_messages` ou
`instagram_manage_insights`, c'est que l'app ne déclare pas encore les cas
d'utilisation qui donnent accès à ces permissions. Deux options :

- **tout de suite** : cocher « Connexion minimale » sous le bouton Connecter —
  le moteur ne demande que les quatre permissions de publication et Instagram se
  connecte. Commentaires, réponses privées et statistiques de portée restent
  inactifs ;
- **complet** : dans l'app Meta, section *Cas d'utilisation*, ajouter et
  personnaliser ceux qui couvrent la gestion de Page et l'API Instagram, puis
  reconnecter sans cocher la case.


Dashboard → **Connexions & santé** → **Connecter** (Instagram). La fenêtre Meta
demande : gestion des Pages, contenu Instagram, commentaires, messages,
statistiques (`instagram_manage_insights`, pour la portée et les enregistrements
dans Analytics). Accepte tout : le moteur détecte la Page liée, enregistre le
compte et **installe l'app sur la Page** (abonnement webhooks). Si plusieurs
Pages ont un compte Instagram pro, choisis celui à publier dans le sélecteur
« Compte publié ».

ℹ️ **Mode développement Meta** : tant que l'app est en mode dev, seuls ses
utilisateurs de rôle (toi = admin) peuvent l'utiliser — c'est exactement notre
cas (publier sur NOTRE compte). **L'App Review / Advanced Access n'est
nécessaire que pour opérer les comptes d'autres personnes.** Ajoute simplement
ton compte dans *App roles* si besoin.

## 4. Webhook commentaires (commentaire → DM)

1. Dans l'app : **Add product** → **Webhooks** → objet **Instagram**.
2. Callback URL : `https://engine.odileai.com/webhooks/meta` (« Webhook
   Meta » dans la carte des clés, bouton copier).
   Verify token : la valeur enregistrée dans cette carte.
   Meta appelle le serveur (GET) et doit afficher « validé ».
3. Abonne le champ **comments**.
4. Produit **Instagram** → active la réception des webhooks pour le compte
   connecté (bouton *Subscribe*).
5. L'app doit aussi être **installée sur la Page** : le moteur le fait à la
   connexion (`POST /{page}/subscribed_apps`). Connexions & santé affiche
   « Webhook commentaires : app installée » ; sinon, bouton **Installer**.

Test : commente « OUTIL » sous un de tes posts publiés par le moteur → le
commentaire apparaît dans le dashboard (Commentaires & DM) et la private reply
part automatiquement (ou en simulation si `PUBLISH_MODE=dry`).

## Limites Meta encodées dans le moteur

- 1 seule réponse privée par commentaire, envoyée dans les 7 jours.
- Maximum ~200 DM/heure (garde-fou à 190).
- 50 publications API / 24 h (très au-dessus de notre cadence).
- **Images en JPEG uniquement** : Instagram refuse le PNG. Le moteur sert ses
  rendus convertis en JPEG (`/public-assets/<id>.jpg`) — rien à faire.
- **Jetons** : le jeton utilisateur long dure ~60 jours ; le moteur le
  ré-échange chaque nuit quand il reste moins de 20 jours (job
  `refresh-tokens`). Les jetons de Page (ceux qui publient) dérivent d'un jeton
  long et **n'expirent pas**. Une reconnexion manuelle n'est nécessaire que si
  le mot de passe Facebook change, si les droits de l'app sont révoqués, ou si
  le renouvellement échoue (le dashboard et un email préviennent).
- **Statistiques** : portée, enregistrements, partages et interactions des
  posts sont relevés chaque matin à 9 h 10 (`instagram_manage_insights`), les
  impressions ayant été remplacées par « vues » par Meta. Bouton « Relever
  maintenant » dans Analytics.
