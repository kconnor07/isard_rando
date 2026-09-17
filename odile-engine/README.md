# Odile Engine 🚀

Moteur de veille, rédaction, design et publication **LinkedIn + Instagram** pour
[Odile AI](https://odileai.com) — agence d'automatisation IA pour PME/TPE.

## Ce qu'il fait

1. **Veille horaire** : 14 sources IA (FR + EN, extensibles depuis le dashboard),
   dédoublonnage, scoring IA « pertinence PME/TPE + potentiel de clic », shortlist quotidienne.
2. **Rédaction AIDA** en français, ton humain réglable (curseurs dans le dashboard),
   au moins un post tous les 2 jours (cadence configurable).
3. **Visuels brandés** : 6 thèmes fournis (dont deux monochromes) + vos propres
   templates composés dans l'onglet **Templates** — quatre **recettes signature**
   en un clic (Signal : disques nets, arcs, badge icône, bouton chevron ;
   Pièces : anneaux, 4 objets aux coins, chiffre fin, logo centré ; Chrome :
   colonne de lumière, objet chrome ancré en haut, titre blanc / argent ;
   Horizon : image plein cadre vive, chip auteur photo, badge vérifié), puis
   chaque paramètre réglable (couleurs et couleur signature, typographie,
   décor, image de fond, matière, illustration et placement de l'objet, objets
   flottants, pied de page — aperçu en direct par type de slide). Rendu
   Chromium suréchantillonné 2× en 1080×1350, captures d'écran réelles des
   outils cités (validées par analyse pixel + vision IA).
4. **Studio d'images** (onglet **Images**) : génération à la demande, toujours
   en noir et blanc (réglable), **détourage local** (modèle isnet embarqué, sans
   service externe), bibliothèque réutilisable en fond de template ou posée sur
   une slide. Fournisseur au choix : Gemini direct ou **Freepik / Magnific**
   (Nano Banana Pro via leur plateforme, `FREEPIK_API_KEY`).
5. **Agent visuel** : pour chaque veille transformée en post, capture les pages
   liées au sujet et à la source (site de l'outil, article) et génère des
   concepts d'illustration en trois styles fondus à la palette du template —
   **plein cadre** (scène cinématique vive avec **une couleur signature** que le
   mot accentué du titre reprend automatiquement), **objets détourés** (objet 3D
   généré sur gris neutre, détouré localement avec porte qualité, posable en
   objet flottant) et **chrome & verre** — plus des **séries d'objets** cohérents
   (2 à 4, même matière) pour les quatre coins ; proposés dans l'éditeur du
   post : un clic pour les poser sur une slide ou en objet 1 à 4, « Encore »
   pour une nouvelle passe sans limite. Modèle Magnific réglable par style.
6. **Studio de design multi-agents** : 4 reviewers IA (direction artistique,
   colorimétrie/lisibilité, relecture orthographique, engagement) critiquent
   chaque visuel et itèrent jusqu'à validation.
7. **Validation humaine obligatoire** : email avec aperçus + liens signés
   Approuver / Modifier / Rejeter. Rien ne part sans ton accord.
8. **Publication automatique** au créneau optimal (étude algo dans
   [docs/instagram-algorithme-2026.md](docs/instagram-algorithme-2026.md)) :
   LinkedIn (profil + page entreprise) et Instagram (carrousels + statiques).
9. **Deux chemins vers la ressource**, jamais trois : sur LinkedIn, le mot-clé à
   commenter **et** le lien tracké dans la description (« Ou directement ici : … »,
   un code de suivi par compte) ; sous le post, le commentaire d'amorce rappelle le
   mot-clé sans aucun lien. Sur Instagram et Facebook, aucun lien affiché — tout part
   en privé. **Commentaire → DM** façon ManyChat : mot-clé commenté sur Instagram →
   message privé automatique. LinkedIn (pas d'API DM) : réponse publique sous le
   commentaire, au nom du compte qui publie.
10. **Tracking de clics** intégré (`/r/<code>` + UTM) et analytics dans le dashboard.

## Démarrage rapide (local)

```bash
cd odile-engine
npm install
cp .env.example .env          # remplir au minimum APP_SECRET et ADMIN_PASSWORD

# Mode démo complet sans aucune clé API :
cd server
LLM_MODE=mock PUBLISH_MODE=dry npx tsx src/cli.ts fixture      # injecte une actu
LLM_MODE=mock PUBLISH_MODE=dry npx tsx src/cli.ts pipeline     # draft→render→studio→email
LLM_MODE=mock PUBLISH_MODE=dry npx tsx src/index.ts            # serveur → http://localhost:3080

# Dashboard en dev (hot reload) :
cd ../web && npm run dev                                        # → http://localhost:5173
```

Les emails partent dans `server/var/outbox/emails/` si aucun SMTP n'est configuré
(ou dans [Mailpit](http://localhost:8025) avec le compose de dev).

### Commandes CLI

Trois façons de lancer la même commande, selon l'endroit où l'on se trouve :

```bash
npm run job -- <cmd>                                   # depuis odile-engine/
cd server && npx tsx src/cli.ts <cmd>                  # depuis server/
./docker/dc.sh exec app npx tsx server/src/cli.ts <cmd>   # en production, dans le conteneur
```

En production, c'est la **troisième** qui compte : la base et les clés vivent dans
le conteneur. Lancée sur une machine de développement, une commande travaille sur
la base locale — souvent vide — et ne touche ni le site ni les réseaux.

Commandes disponibles :
`scrape` · `score` · `shortlist` · `draft` · `render --post N` · `review --post N` ·
`pipeline` · `publish-due` · `gallery` (planche de contrôle des thèmes fournis) ·
`visuals --post N [--more]` · `fixture` · `seed` · `poll-li-comments` · `amplify` ·
`blog-covers [--tous]` (refait les couvertures et remplace celles des articles en ligne)

## Déploiement production

Guide pas à pas : [docs/setup-oracle-cloud.md](docs/setup-oracle-cloud.md) (VM
gratuite Oracle ARM), puis [docs/setup-meta.md](docs/setup-meta.md),
[docs/setup-linkedin.md](docs/setup-linkedin.md), [docs/setup-smtp.md](docs/setup-smtp.md).

```bash
# Mise à jour + reconstruction + vérification de la version servie (/healthz)
./docker/deploy.sh
```

Le script met la branche courante à jour, construit l'image avec le numéro de
commit, redémarre et affiche la version en ligne (aussi visible dans
**Connexions & santé**). Si la version affichée n'est pas celle attendue, le
build a échoué : lire la sortie au-dessus.

## Architecture

Voir [docs/architecture.md](docs/architecture.md). En bref : Node 22 + TypeScript,
Fastify, SQLite (better-sqlite3 + Drizzle), node-cron, Playwright/Chromium, Eta,
nodemailer, React 19 + Tailwind 4. Abstraction LLM Claude (rédaction) + Gemini
(scoring/vision) avec fallback et mode mock.

⚠️ **Sécurité** : tous les secrets vivent côté serveur (`.env`). Le bundle web ne
contient aucune clé (contrairement au `vite.config.ts` historique de la racine du
dépôt, à ne pas imiter). Les jetons OAuth sont chiffrés AES-256-GCM en base.
