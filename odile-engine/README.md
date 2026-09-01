# Odile Engine 🚀

Moteur de veille, rédaction, design et publication **LinkedIn + Instagram** pour
[Odile AI](https://odileai.com) — agence d'automatisation IA pour PME/TPE.

## Ce qu'il fait

1. **Veille horaire** : 14 sources IA (FR + EN, extensibles depuis le dashboard),
   dédoublonnage, scoring IA « pertinence PME/TPE + potentiel de clic », shortlist quotidienne.
2. **Rédaction AIDA** en français, ton humain réglable (curseurs dans le dashboard),
   au moins un post tous les 2 jours (cadence configurable).
3. **Visuels brandés** : 3 thèmes (Odile Nuit, Violet Glow, Cyan Tech), rendu
   Chromium 1080×1350, captures d'écran réelles des outils cités (validées par
   analyse pixel + vision IA).
4. **Studio de design multi-agents** : 4 reviewers IA (direction artistique,
   colorimétrie/lisibilité, relecture orthographique, engagement) critiquent
   chaque visuel et itèrent jusqu'à validation.
5. **Validation humaine obligatoire** : email avec aperçus + liens signés
   Approuver / Modifier / Rejeter. Rien ne part sans ton accord.
6. **Publication automatique** au créneau optimal (étude algo dans
   [docs/instagram-algorithme-2026.md](docs/instagram-algorithme-2026.md)) :
   LinkedIn (profil + page entreprise) et Instagram (carrousels + statiques).
7. **Commentaire → DM** façon ManyChat : mot-clé commenté sur Instagram → message
   privé automatique avec lien tracké. LinkedIn (pas d'API DM) : email avec
   réponse pré-rédigée à coller en 1 clic.
8. **Tracking de clics** intégré (`/r/<code>` + UTM) et analytics dans le dashboard.

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

`npx tsx src/cli.ts <cmd>` depuis `server/` :
`scrape` · `score` · `shortlist` · `draft` · `render --post N` · `review --post N` ·
`pipeline` · `publish-due` · `gallery` (planche de contrôle des 3 thèmes) ·
`fixture` · `seed` · `poll-li-comments`

## Déploiement production

Guide pas à pas : [docs/setup-oracle-cloud.md](docs/setup-oracle-cloud.md) (VM
gratuite Oracle ARM), puis [docs/setup-meta.md](docs/setup-meta.md),
[docs/setup-linkedin.md](docs/setup-linkedin.md), [docs/setup-smtp.md](docs/setup-smtp.md).

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

## Architecture

Voir [docs/architecture.md](docs/architecture.md). En bref : Node 22 + TypeScript,
Fastify, SQLite (better-sqlite3 + Drizzle), node-cron, Playwright/Chromium, Eta,
nodemailer, React 19 + Tailwind 4. Abstraction LLM Claude (rédaction) + Gemini
(scoring/vision) avec fallback et mode mock.

⚠️ **Sécurité** : tous les secrets vivent côté serveur (`.env`). Le bundle web ne
contient aucune clé (contrairement au `vite.config.ts` historique de la racine du
dépôt, à ne pas imiter). Les jetons OAuth sont chiffrés AES-256-GCM en base.
