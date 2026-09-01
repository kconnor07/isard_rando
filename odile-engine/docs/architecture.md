# Architecture d'Odile Engine

## Vue d'ensemble

```
                        ┌─────────────────────────────────────────────┐
   RSS / HN ──scrape──▶ │  news_items ──score──▶ shortlist (top 10)   │
   (14 sources, 1×/h)   └──────────────┬──────────────────────────────┘
                                       │ cadence due ? (1 post / 2 j)
                                       ▼
                    writer (Claude Sonnet 5, AIDA, ton réglable)
                                       │
                    captures d'écran (Playwright + validation vision)
                                       │
                    renderer (Eta + thèmes CSS → Chromium → PNG 1080×1350)
                                       │
              ┌──── studio de design (4 reviewers IA, ≤ 3 itérations) ────┐
              │  DA/UX · colorimétrie · relecture · engagement            │
              │  correctifs → réécriture ciblée → re-rendu → re-review    │
              └──────────────────────────┬────────────────────────────────┘
                                         ▼
                    email d'approbation (aperçus CID + 3 liens signés)
                                         │  ✅ approuver (créneau optimal)
                                         ▼
                    publish worker (5 min) ──▶ LinkedIn REST / Instagram Graph
                                         │
              webhook Meta (commentaires) ──▶ mot-clé ? ──▶ private reply DM
              poller LinkedIn (30 min) ─────▶ digest email réponses à coller
                                         │
                    /r/<code> → clics (hash IP journalier) → analytics
```

## Modules serveur (`server/src/`)

| Module | Rôle |
|---|---|
| `scraper/` | RSS avec ETag/If-Modified-Since, HN Algolia, dédoublonnage URL canonique + similarité de titres (Jaccard ≥ 0,85) |
| `scorer/` | Notation par lots de 10 (pertinence /50 + clic /50 + raison), shortlist quotidienne |
| `writer/` | Génération AIDA structurée (zod), ton depuis les réglages, régénération ciblée caption/slide |
| `render/` | Pool Chromium partagé, thèmes Eta+CSS, polices embarquées en data URI, réseau bloqué au rendu |
| `screenshot/` | Capture 1440×900 fr-FR, fermeture bannières cookies (OneTrust, Didomi, Axeptio…), validation variance sharp + vision LLM, fallback de slide |
| `design-studio/` | 4 reviewers vision (prompts versionnés dans `reviewers/`), boucle correctifs→re-rendu, critiques en base (`design_reviews`) |
| `mailer/` | SMTP agnostique (outbox locale sans SMTP), email d'approbation, relances, digests, alertes |
| `approvals/` | Jetons signés HMAC à usage unique, transitions de statut, réservation de créneau |
| `publishers/` | LinkedIn REST versionné (perso + organisation), Instagram Graph (containers/carrousel), OAuth, worker avec retries, mode dry |
| `webhooks/` | Webhook Meta (HMAC raw-body), commentaire→DM avec garde-fous Meta, poller LinkedIn |
| `shortener/` | Liens `/r/<code>` + UTM + clics anonymisés (RGPD) |
| `scheduler/` | node-cron Europe/Paris + cadence + créneaux optimaux + pipeline complet |
| `llm/` | Interface provider (Anthropic/Gemini/mock), routage par tâche, fallback, JSON validé zod avec retry |

## Choix structurants

- **SQLite (WAL)** : un seul process, zéro infra. Sauvegarde = copie de `var/data.sqlite`.
- **Aucun secret côté client** : le dashboard parle à `/api` (cookie httpOnly).
  Jetons OAuth chiffrés AES-256-GCM avec `APP_SECRET`.
- **GET sans effet de bord** sur les liens d'email (anti-préfetch des scanners) :
  l'action réelle est un POST de confirmation.
- **Mode dry par défaut** (`PUBLISH_MODE=dry`) : payloads API exacts écrits dans
  `var/outbox/` — permet de valider toute la chaîne sans comptes réels.
- **Mode mock LLM** (`LLM_MODE=mock`) : pipeline complet exécutable sans clé.
- **Limites API encodées** : 1 private reply/commentaire, 190 DM/h, caption IG
  ≤ 2 200 caractères, LinkedIn commentary échappé, containers IG pollés jusqu'à FINISHED.

## Contraintes connues

- **LinkedIn** : pas d'API DM (fallback email assisté) ; publication page
  entreprise soumise au programme Community Management (dossier) ; jetons ~60 j
  sans refresh self-serve → alerte email à J-7 (cron maintenance).
- **Meta** : mode dev suffisant pour publier sur son propre compte (testeur de
  l'app) ; Advanced Access requis seulement pour opérer des comptes tiers.
- **Sandbox de dev** : la navigation Chromium externe peut être bloquée par le
  proxy TLS de l'environnement — sans incidence en production (pas de proxy).
