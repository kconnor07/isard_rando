# Connecter LinkedIn — profil personnel + page entreprise

## 1. Créer l'app LinkedIn (10 min)

1. [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) →
   **Create app**.
2. Associe l'app à la **Page LinkedIn d'Odile AI** (obligatoire) et valide-la
   depuis la Page (Settings → *Verify*).
3. Onglet **Products**, demande :
   - **Sign In with LinkedIn using OpenID Connect** (instantané),
   - **Share on LinkedIn** (instantané) → permission `w_member_social`.
4. Onglet **Auth** :
   - copie `Client ID` et `Client Secret` dans le dashboard → **Connexions &
     santé** → *Applications LinkedIn et Meta* → **Enregistrer les clés**
     (ou, à défaut, dans `.env` : `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`),
   - **Authorized redirect URLs** : l'URL « Redirection LinkedIn » affichée
     dans cette même carte (`https://engine.odileai.com/oauth/linkedin/callback`).

## 2. Connecter le profil depuis le dashboard

Dashboard → **Connexions & santé** → **Connecter** (LinkedIn). Autorise : le
moteur peut alors publier sur ton **profil personnel** (canal par défaut — la
meilleure portée organique).

⚠️ Le jeton LinkedIn dure ~60 jours. LinkedIn ne fournit un `refresh_token`
qu'aux apps de son programme partenaire : s'il est fourni, le moteur renouvelle
le jeton tout seul chaque nuit (job `refresh-tokens`, 4 h 30) ; sinon il envoie
un email d'alerte 7 jours avant l'expiration — un clic « Reconnecter » suffit.
Le bouton **Tester les connexions** (Connexions & santé) appelle LinkedIn avec
le jeton stocké et affiche l'état réel.

ℹ️ **Version d'API** : chaque version LinkedIn (`AAAAMM`) vit environ un an.
Le moteur utilise `LINKEDIN_VERSION` du `.env` (défaut `202608`) ; si LinkedIn
renvoie `426 Upgrade Required` ou refuse la version, change la valeur dans
`.env` et redémarre — pas besoin de redéployer le code.

## 3. Page entreprise (optionnel)

Publier au nom de la **page entreprise** exige la permission
`w_organization_social` du programme **Community Management API** :

1. Onglet *Products* → **Community Management API** → *Request access* —
   formulaire de candidature (activité, usage). Délai : quelques jours à
   quelques semaines.
2. Une fois l'accès accordé : Dashboard → Connexions & santé → coche
   **« Demander aussi les droits page entreprise »** puis **Reconnecter**.
   Le moteur demande alors `w_organization_social` + `r_organization_social`,
   liste les pages que tu administres et lie automatiquement la page s'il n'y
   en a qu'une (sinon tu choisis dans la liste). Sans l'accès Community
   Management, LinkedIn **refuse toute la connexion** avec cette option cochée :
   décoche-la en attendant.
3. Sans l'accès, tu peux quand même préparer le canal en saisissant l'ID
   numérique de la page (**Saisir l'ID**, ex. `115786063`, visible dans l'URL
   d'admin de la page) — la publication échouera tant que le droit n'est pas
   accordé, le dashboard le signale.
4. Le canal « LinkedIn entreprise » devient sélectionnable par post et dans la
   rotation automatique ; ses statistiques (impressions, clics, partages)
   sont relevées chaque matin (`r_organization_social`).

En attendant l'accès, le moteur fonctionne intégralement sur le profil perso.

## Ce que LinkedIn n'autorise PAS (et comment on contourne)

- **Pas d'API de messages privés** → le système commentaire→DM automatique est
  impossible côté LinkedIn. Le moteur **détecte les commentaires** sur tes
  posts (toutes les 30 min) et t'envoie un **email avec la réponse pré-rédigée**
  (lien tracké inclus) à coller en un clic — 30 secondes par lead.
- La lecture des commentaires utilise l'API socialActions ; selon le niveau
  d'accès de l'app elle peut être limitée — le moteur se dégrade proprement et
  le dashboard reste la source de vérité.
- **Pas de portée pour un profil personnel** : LinkedIn n'expose les
  impressions que pour les pages entreprise. Pour le profil, Analytics montre
  les réactions et commentaires (socialActions) et les clics trackés.
- Les hashtags s'écrivent en clair dans le texte (`#IA`) : LinkedIn les rend
  cliquables lui-même. Le moteur échappe les autres caractères réservés.
