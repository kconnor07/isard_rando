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
2. Nom : `Odile Engine`. Une fois créée, note dans `.env` :
   - `META_APP_ID` : App ID (tableau de bord de l'app),
   - `META_APP_SECRET` : *App settings* → *Basic* → App Secret.
3. *App settings* → *Basic* : renseigne **App domains** (`engine.odileai.com`)
   et une URL de politique de confidentialité (celle d'odileai.com convient).
4. **Add product** → **Facebook Login** → *Settings* → **Valid OAuth Redirect
   URIs** : `https://engine.odileai.com/oauth/meta/callback`.

## 3. Connecter le compte depuis le dashboard

Dashboard → **Connexions & santé** → **Connecter** (Instagram). La fenêtre Meta
demande : gestion des Pages, contenu Instagram, commentaires, messages.
Accepte tout : le moteur détecte la Page liée et enregistre le compte.

ℹ️ **Mode développement Meta** : tant que l'app est en mode dev, seuls ses
utilisateurs de rôle (toi = admin) peuvent l'utiliser — c'est exactement notre
cas (publier sur NOTRE compte). **L'App Review / Advanced Access n'est
nécessaire que pour opérer les comptes d'autres personnes.** Ajoute simplement
ton compte dans *App roles* si besoin.

## 4. Webhook commentaires (commentaire → DM)

1. Dans l'app : **Add product** → **Webhooks** → objet **Instagram**.
2. Callback URL : `https://engine.odileai.com/webhooks/meta`
   Verify token : la valeur de `META_VERIFY_TOKEN` de ton `.env`.
   Meta appelle le serveur (GET) et doit afficher « validé ».
3. Abonne le champ **comments**.
4. Produit **Instagram** → active la réception des webhooks pour le compte
   connecté (bouton *Subscribe*).

Test : commente « OUTIL » sous un de tes posts publiés par le moteur → le
commentaire apparaît dans le dashboard (Commentaires & DM) et la private reply
part automatiquement (ou en simulation si `PUBLISH_MODE=dry`).

## Limites Meta encodées dans le moteur

- 1 seule réponse privée par commentaire, envoyée dans les 7 jours.
- Maximum ~200 DM/heure (garde-fou à 190).
- 50 publications API / 24 h (très au-dessus de notre cadence).
- Jeton long-lived ~60 jours : le moteur t'alerte par email 7 jours avant
  l'expiration — un clic sur « Reconnecter » suffit.
