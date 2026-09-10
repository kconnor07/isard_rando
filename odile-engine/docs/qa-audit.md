# Audit QA — Odile Engine (10 septembre 2026)

Passe de test de A à Z réalisée en mode `mock` (aucune clé requise) avec un
navigateur piloté (Playwright) et des appels API directs, sur la base de démo.

## Ce qui a été vérifié

| Zone | Vérifications | Résultat |
|---|---|---|
| Connexion | mauvais mot de passe (message), bon mot de passe, déconnexion | OK |
| 11 pages du dashboard | rendu, aucune erreur console, aucune réponse API ≥ 400 | OK |
| Réglages | lecture + réécriture de chacune des 12 clés | OK |
| Veille | liste, sources (25), « Générer un post » → pipeline complet en tâche de fond | OK |
| Pipeline | rédaction → capture → illustrations → agent visuel → rendu → studio → email | OK (post en « à valider » en < 2 min) |
| Éditeur de post | régénération slide / caption, re-rendu, studio, email, bibliothèque, visuels proposés | OK |
| Validation | approuver, déprogrammer, ré-approuver, publier maintenant, rejeter | OK |
| Publication | worker `publish-due` en dry-run → payload dans `var/outbox` | OK |
| Liens email | pages `/a/<token>` approuver / modifier / rejeter | OK |
| Templates | 40 paramètres, aperçu par type de slide, duplication, thème par défaut | OK |
| Images | import (N&B), génération (mock), détourage local, bibliothèque, pose sur slide | OK |
| Magnific (réel) | 1 génération Flux.2 Klein + 1 retouche par instruction avec la vraie clé | OK (6 s / 7 s) |

## Défauts trouvés et corrigés pendant l'audit

1. **Régénération d'une slide ou de la caption en mode mock → erreur 500.** Le
   fournisseur mock ne connaissait pas ces prompts. Il y répond désormais, et
   une réponse LLM invalide renvoie une 422 lisible au lieu d'une 500.
2. **Post programmé sans aucune action** dans l'éditeur (impossible de changer
   d'avis). Ajout de « Publier maintenant » (avance le créneau) et « Annuler la
   programmation » (retour dans « À valider », job annulé).
3. **Post rejeté : le bouton « Approuver » était affiché mais refusé** par le
   serveur. Un post rejeté ou en échec de publication peut maintenant être
   repris et reprogrammé.
4. Chip auteur et objet flottant se chevauchaient en haut à gauche → l'objet se
   place à droite quand la chip est active.
5. Panneau « Visuels proposés » : bouton « Illustration » coupé sur les cartes
   étroites → mise en page sur deux lignes.

## Non testable dans cet environnement (à vérifier sur le serveur)

- **Captures d'écran** : le Chromium du bac à sable n'a pas d'accès réseau
  direct ; sur le serveur, le module fonctionne (déjà constaté en production).
- Publication **réelle** LinkedIn / Instagram (OAuth), webhooks Meta, SMTP
  réel, LLM Anthropic / Gemini en live : dépendent des clés et comptes.
- Détourage **Magnific** et images de référence : demandent une `PUBLIC_URL`
  en https (c'est le cas en production).

## Points d'attention avant de compter dessus au quotidien

- Renseigner `FREEPIK_API_KEY` dans `.env` : toute la génération passe alors
  par Magnific (plus de 429 Gemini). Le choix du modèle par défaut se fait dans
  Réglages › Illustrations IA.
- Les images sont en **noir et blanc par défaut** (réglage). Les références de
  niveau « premium » fournies sont en couleur : décocher le réglage pour ce rendu.
- Régénérer les clés qui ont transité par le chat (Anthropic, Gemini, Brevo,
  Magnific) une fois tout stabilisé.
- Le détourage local charge un modèle (~1,5 Go de RAM en pointe) : correct sur
  l'instance A1 actuelle, à surveiller si d'autres services s'y ajoutent.

## Améliorations recommandées (par ordre d'impact)

1. **Brief visuel automatique par post** : le writer produit déjà une idée
   d'image par slide ; faire enchaîner par l'agent visuel génération → détourage
   → pose sur la slide (aujourd'hui la pose est manuelle) pour sortir des
   carrousels « niveau référence » sans intervention.
2. **Studio de design calibré sur des références** : donner aux reviewers 3-4
   visuels de référence (ceux fournis) en exemple pour tirer les scores vers ce
   niveau, et ajouter un reviewer « composition / hiérarchie ».
3. **Calendrier interactif** : vue mensuelle, glisser-déposer pour changer un
   créneau, créneaux LinkedIn / Instagram distincts visibles.
4. **Sécurité de l'accès** : mot de passe unique aujourd'hui → limitation des
   tentatives, lien magique par email ou TOTP ; rotation des clés documentée.
5. **Observabilité** : page « Jobs » avec le détail des erreurs, alerte email
   après deux pipelines consécutifs en échec, compteur de crédits Magnific.
6. **Tests automatisés dans le dépôt** : transformer ces scripts QA en tests
   Playwright exécutés en CI à chaque push.
7. **Performance des aperçus de templates** : les images de bibliothèque sont
   injectées en data-URI dans le CSS (lourd avec plusieurs objets) → les servir
   par URL locale autorisée au rendu.
8. **Sauvegardes** : dump SQLite quotidien + copie des assets vers un stockage
   objet (Oracle Object Storage), restauration testée.
9. **Multi-marques** : si l'outil doit servir plusieurs clients d'Odile, isoler
   marque / templates / comptes sociaux par espace de travail.
