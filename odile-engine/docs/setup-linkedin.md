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
   - note `Client ID` et `Client Secret` → `.env`
     (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`),
   - **Authorized redirect URLs** :
     `https://engine.odileai.com/oauth/linkedin/callback`.

## 2. Connecter le profil depuis le dashboard

Dashboard → **Connexions & santé** → **Connecter** (LinkedIn). Autorise : le
moteur peut alors publier sur ton **profil personnel** (canal par défaut — la
meilleure portée organique).

⚠️ Le jeton LinkedIn dure ~60 jours et ne se renouvelle pas tout seul : le
moteur envoie un email d'alerte 7 jours avant — un clic « Reconnecter » suffit.

## 3. Page entreprise (optionnel)

Publier au nom de la **page entreprise** exige la permission
`w_organization_social` du programme **Community Management API** :

1. Onglet *Products* → **Community Management API** → *Request access* —
   formulaire de candidature (activité, usage). Délai : quelques jours à
   quelques semaines.
2. Une fois l'accès accordé, reconnecte le profil (le scope supplémentaire est
   demandé automatiquement), puis Dashboard → Connexions & santé →
   **Définir l'organisation** → saisis l'ID numérique de la page
   (ex. `115786063`, visible dans l'URL d'admin de la page).
3. Le canal « LinkedIn entreprise » devient sélectionnable par post et dans la
   rotation automatique.

En attendant l'accès, le moteur fonctionne intégralement sur le profil perso.

## Ce que LinkedIn n'autorise PAS (et comment on contourne)

- **Pas d'API de messages privés** → le système commentaire→DM automatique est
  impossible côté LinkedIn. Le moteur **détecte les commentaires** sur tes
  posts (toutes les 30 min) et t'envoie un **email avec la réponse pré-rédigée**
  (lien tracké inclus) à coller en un clic — 30 secondes par lead.
- La lecture des commentaires utilise l'API socialActions ; selon le niveau
  d'accès de l'app elle peut être limitée — le moteur se dégrade proprement et
  le dashboard reste la source de vérité.
