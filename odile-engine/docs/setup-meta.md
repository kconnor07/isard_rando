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
   et une URL de politique de confidentialité (celle d'odileai.com convient).
4. **Add product** → **Facebook Login** → *Settings* → **Valid OAuth Redirect
   URIs** : `https://engine.odileai.com/oauth/meta/callback`.

## 3. Connecter le compte depuis le dashboard

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
