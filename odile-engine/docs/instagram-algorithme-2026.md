# Étude — Algorithme Instagram & LinkedIn 2025-2026

> Étude menée en amont du paramétrage d'Odile Engine (septembre 2026).
> Elle alimente directement les valeurs par défaut de `shared/src/constants.ts`
> (format, nombre de slides, créneaux de publication) et les prompts du writer
> et du reviewer « engagement ».

## 1. Carrousels vs posts statiques vs Reels

| Métrique | Carrousel | Post statique | Reels |
|---|---|---|---|
| Taux d'engagement moyen | **~0,55 %** (le plus haut, constant depuis 2023) | inférieur | inférieur au carrousel |
| Probabilité de recommandation | **+23 %** | référence | supérieure pour la portée |
| Engagement relatif (étude 4 M de posts) | **3,1×** vs statique | 1× | — |
| Portée | ~1,7× celle d'un statique | 1× | ~2,35× celle d'un statique |
| Temps d'attention | **15-30 s** (7 slides) | 1-2 s | variable |

Lecture : les Reels gagnent en portée brute, mais pour un compte B2B qui vise
l'engagement qualifié, les **sauvegardes** et les **clics** (notre objectif),
le carrousel est le format roi. Le temps passé à swiper est un signal de
qualité majeur pour l'algorithme, qui re-diffuse alors le post (y compris en
re-présentant la 2ᵉ slide aux personnes qui n'ont pas swipé).

**Décisions produit :**
- Format par défaut : **carrousel 5-8 slides** (`DEFAULTS.format`, `DEFAULTS.carouselSlides`).
- Les posts statiques restent disponibles pour les annonces simples (1 visuel fort).
- Mix conseillé : majorité de carrousels, statiques ponctuels. (Reels hors périmètre v1.)

## 2. Anatomie d'un carrousel performant

1. **Slide 1 = hook** : 6-10 mots max, un chiffre ou une tension, un mot accentué.
   80 % de la performance se joue ici — c'est le seul contenu vu par 100 % de l'audience.
2. **Slide 2 = promesse** : ce que le lecteur va gagner en swipant (sinon il part).
3. **Slides milieu** : 1 idée par slide, gros titres, corps court, preuves concrètes
   (captures d'écran d'outils réels = notre différenciateur).
4. **Avant-dernière slide = valeur chiffrée** (résultat, gain, stat).
5. **Dernière slide = CTA unique** : un seul appel à l'action. Le nôtre : le
   déclencheur commentaire→DM (« Commente OUTIL ») qui génère des commentaires —
   signal d'engagement le plus fort + collecte de leads.

## 3. Le levier commentaire→DM (façon ManyChat)

- Les commentaires pèsent plus que les likes dans la distribution ; sur LinkedIn,
  un post qui reçoit des commentaires dans la première heure obtient **~30 % de
  distribution en plus**.
- Un CTA « commente MOT-CLÉ » démultiplie les commentaires ET fournit une raison
  légitime d'envoyer un DM avec le lien (l'algorithme pénalise les liens sortants
  dans le corps du post ; le lien part donc en message privé).
- Contraintes Meta API à respecter (implémentées dans `webhooks/commentDm.ts`) :
  **1 seule private reply par commentaire**, envoyée **sous 7 jours**, max
  **200 DM/heure**, uniquement en réponse à une action de l'utilisateur.
- LinkedIn n'a **pas d'API DM** : le moteur détecte les commentaires et envoie
  un email avec la réponse pré-rédigée à coller en 1 clic (fallback assisté).

## 4. Créneaux de publication (heure de Paris)

| Plateforme | Jours forts | Heures fortes |
|---|---|---|
| LinkedIn (B2B) | mardi → jeudi | 8h-11h (pic 8h30-10h), second créneau 15h-17h |
| Instagram | mardi, jeudi + samedi matin | 9h-11h et 12h-13h ; 18h30-20h en secondaire |

**Décisions produit** (`DEFAULTS.publishSlots`) :
- LinkedIn : mar/mer/jeu 8h30.
- Instagram : mar 11h30, jeu 18h30, sam 11h00.
- L'approbation d'un post réserve automatiquement le **prochain créneau libre**
  (`scheduler/cadence.ts#nextPublishSlot`), avec option « publier immédiatement ».

## 5. Hooks : patterns qui performent (B2B automatisation IA)

À encoder dans le prompt du writer et le reviewer « engagement » :
- **Chiffre + promesse** : « Vos devis en 90 secondes chrono »
- **Tension/contraste** : « Vos concurrents l'utilisent déjà »
- **Perte évitée** : « 4 h par semaine perdues sur… »
- **Curiosité spécifique** : « L'outil que personne ne connaît pour… »
- **Anti-pattern** : titres génériques (« L'IA révolutionne les entreprises »),
  jargon technique, plus de 10 mots sur la slide 1.

## 6. Signaux algorithme à optimiser (par ordre d'impact)

1. **Temps passé** (swipe carrousel) → 1 idée par slide, lecture fluide.
2. **Sauvegardes** → contenu « référence » : listes d'outils, méthodes, tutos.
3. **Commentaires** → CTA mot-clé + question finale dans la caption.
4. **Partages/DM** → propositions de valeur immédiatement utiles.
5. Éviter : liens sortants dans la caption (→ le lien va dans le DM ou en
   commentaire), engagement bait grossier (« like si… »), hashtags spam
   (5-8 hashtags ciblés suffisent).

## Sources

- [Carousel vs Reels vs Static Posts: Which Gets More Engagement in 2026?](https://instacarousel.com/blog/carousel-vs-reels-engagement/)
- [Instagram Content Formats: All 5 Ranked](https://creatorflow.so/blog/instagram-content-formats-guide/)
- [Instagram Algorithm 2026 — What Actually Works](https://aipowereddahlia.com/blog/instagram-algorithm-2026-what-works)
- [Instagram Algorithm Updates 2026: What Changed](https://www.outfame.com/blog/instagram-algorithm-updates-2026-what-changed)
- [Sprout Social — Best Times to Post on Social Media 2026](https://sproutsocial.com/insights/best-times-to-post-on-social-media/)
- [Buffer — Best Time to Post on LinkedIn (4.8M posts analysés)](https://buffer.com/resources/best-time-to-post-on-linkedin/)
- [Instagram Comment Automation: The Complete 2026 Guide](https://www.wati.io/en/blog/instagram-comment-automation/)
- [Instagram Private Replies API](https://postproxy.dev/how-to/instagram-comment-to-dm-private-reply/)
