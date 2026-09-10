# Audit rendus — atteindre les 4 références (code + image générée)

*10 septembre 2026 — réponse à « comment obtenir mes rendus finaux à l'identique,
même effet, même style, avec un mélange de code et d'image générée ».*

## 1. Verdict

L'architecture est la bonne : une **couche codée** (HTML/CSS rendu par Chromium :
fond, décors, typographie, boutons, pied de marque) posée sur une **couche image**
(illustration Magnific, détourée localement pour les objets). C'est exactement la
façon dont les 4 références sont construites. Ce qui sépare encore les rendus des
références tient à trois choses, dans cet ordre d'importance :

1. **Des primitives codées manquantes ou trop molles** — disques nets à bord
   lumineux, arcs fins traversant le cadre, colonne de lumière verticale, badge
   icône, sous-titre bicolore, bouton à chevron, chiffre en graisse fine, 4 objets
   aux coins, chip auteur avec photo, badge vérifié, logo centré.
2. **Un pipeline image qui abîme les objets** — détourage local qui échoue sur un
   objet sombre généré sur fond sombre, voile coloré (`hero-grade`) qui désature le
   chrome et les couleurs vives, un seul objet par post, rendu final en 1×.
3. **Aucune « recette » reliant template, mise en page, style d'image et champs du
   rédacteur** — l'utilisateur doit tout aligner à la main, et le rédacteur ne sait
   pas produire les éléments (icône, sous-titre, série d'objets) que ces mises en
   page attendent.

**Preuve** : les 4 références ont été reconstruites avec le moteur de rendu de
l'app (mêmes polices, même Chromium, même détourage local), uniquement avec du CSS
et des objets détourés. Trois sur quatre (Latência, 87 %, System Token) sont
quasi identiques ; la quatrième (Superman) est identique côté couche codée et ne
dépend plus que de la qualité de l'image générée. Les planches comparatives
« référence / moteur actuel / couches codées proposées » ont été fournies dans la
conversation (elles contiennent des visuels tiers, elles ne sont pas versionnées).

## 2. Les 4 références décomposées

Légende : **Code** = couche HTML/CSS · **Image** = génération / retouche Magnific ·
**Rédacteur** = champ à produire par le LLM.

### Réf. A — « Latência » (100 % code)

| Élément de la référence | Aujourd'hui | Écart | Correctif |
|---|---|---|---|
| Grille de points fine, violette, fondue vers les bords | `decor: points` / thème Halo Bleu | OK (densité un peu faible) | Code : pas de 21 px, opacité 0,6 |
| 2 disques nets à bord lumineux (haut-gauche, bas-droite), halo doux à l'extérieur | Orbes **floutés** (`blur`) | Le bord net + le liseré blanc-violet font tout le style | Code : nouveau décor `disques` (radial-gradient à bord dur + `box-shadow` double) |
| Arcs fins concentriques (cercle 1,5 px) traversant le cadre | `decor: arcs` (bordure 2 px, 16 % opacité, sous les orbes) | Trop discrets, pas alignés sur les disques | Code : arcs liés aux disques (même centre, rayon +190 px, opacité 0,34) |
| Badge icône rond en verre au-dessus du titre (chrono « MS ») | Aucun | Élément signature de la référence | Code + Rédacteur : champ `icon` (catalogue de ~24 icônes SVG inline : chrono, tendance, bouclier, éclair, cible, euro, robot, mail, calendrier…) |
| Titre 1 mot, dégradé horizontal blanc → violet lettre par lettre | Dégradé seulement sur le hook des thèmes intégrés (bleu) ; `titleGradient: accent` en template maison (dégradé 100°) | Manque le dégradé horizontal pur | Code : `titleGradient: horizontal` |
| Sous-titre sur 2 tons (gris dégradé puis blanc) | Aucun (le `body` est gris uniforme) | Hiérarchie titre / sous-titre / corps absente | Code + Rédacteur : champ `subtitle` (2 lignes, ton 1 / ton 2) |
| Bouton verre « › Texte » avec chevron dans un cercle | `ctaStyle: verre` sans chevron, seulement sur les slides `cta`/`echo` | CTA impossible sur une slide hook/content | Code : `ctaStyle: chevron`, `ctaLabel` rendu sur toute slide |
| 2ᵉ badge icône posé sur l'arc en bas | Aucun | — | Code : slot `icon2` optionnel (position sur l'arc) |

Effort : ~1 jour. Aucune image nécessaire.

### Réf. B — « 87 % » (code + 4 objets détourés)

| Élément | Aujourd'hui | Écart | Correctif |
|---|---|---|---|
| Dégradé vertical lavande clair (haut) → violet profond | `gradientAngle` + 2 couleurs | Le 3ᵉ ton (clair en haut sur 10 %) manque | Code : `bg0` optionnel (bande claire en haut) |
| Anneaux concentriques fins, grands, centrés derrière le texte | `decor: anneaux` (pas de 150 px, masque à 62 %) | Anneaux trop serrés et trop courts | Code : variante `anneaux-larges` (pas 170 px, masque 60 %, opacité 0,075) |
| 4 pièces 3D aux 4 coins, débordant du cadre, inclinées | 2 objets flottants max (`float1/2`), coins intérieurs | 4 slots + débordement + miroir | Code : `floats[]` jusqu'à 4 (`asset, coin, taille, rotation, miroir`), ancrage négatif |
| Chip « trio d'avatars » + micro-texte 3 lignes | Aucun | Preuve sociale visuelle | Code + réglages marque : `avatars` (jusqu'à 3 images) + `avatarsText` |
| « 87 % » graisse **fine** (300), dégradé blanc → violet | `big-number` graisse 900 | Le poids fin est la clé du look premium | Code : `bigNumberWeight` (300 / 500 / 900) |
| Corps 2 lignes : régulière puis grasse | `body` uniforme | — | Code : `body` accepte `**gras**` → 2 tons |
| Bouton dégradé blanc → violet, texte sombre, « ↗ » | `ctaStyle: degrade` (blanc → accent) existe | Flèche `→` au lieu de `↗` ; CTA absent des slides `value_prop` | Code : `ctaArrow: ↗`, CTA rendu partout |
| Logo centré en bas, sans compteur | Logo à gauche + compteur à droite | — | Code : `footerLayout: centre` |
| Objets sombres fusionnés à la palette | Détourage local isnet | **Échoue sur objet sombre / fond sombre** (3 pièces sur 4 perdues lors du test) | Image : générer les objets sur fond **gris neutre 50 %** (`#7f7f7f`) et non sur `bg1` → détourage fiable ; halo accent + ombre portée sous chaque objet côté code |
| 4 objets de la même famille (2 pièces × 2 faces) | 1 objet par post | — | Image + agent visuel : `objectSet` (2 à 4 objets, même matière, même éclairage, le 1ᵉʳ objet servant d'`input_image` aux suivants) |

Effort : ~1,5 jour.

### Réf. C — « System Token » (code + 1 objet chrome détouré)

| Élément | Aujourd'hui | Écart | Correctif |
|---|---|---|---|
| Colonne de lumière bleue verticale sur noir, fines stries verticales | Orbes de verre (Verre Bleu) | La colonne est le décor de la référence | Code : décor `colonne` (ellipse radiale + `repeating-linear-gradient` masqué) |
| Halo bleu diffus **sous** l'objet | `hero-scrim` seulement | — | Code : `objectGlow` (radial accent derrière le détourage) |
| Objet chrome énorme, ancré en haut (la pince déborde), titre dessous | `hero-contain` : objet centré à 40 %, 84 % du canevas → chevauche le titre | Position / taille non pilotables | Code : `objectPlacement` (`haut` / `centre` / `droite-deborde` / `coins`) + `objectSize` |
| Chrome irisé, magenta / cyan vifs | `hero-grade` (mix-blend `color` bleu) **désature** l'iridescence (visible sur la planche) | Le voile coloré est contre-productif sur les détourages et les images de qualité | Code : `heroGrade: aucun \| teinte \| doux`, **désactivé** par défaut sur les détourages |
| Titre 2 lignes : blanc 800 puis argent dégradé 800 | 1 ligne + mot serif italique | — | Code : `titleSplit: 2-lignes` + `titleGradient: argent` sur la 2ᵉ |
| Pilule logo en verre en haut au centre | Logo en bas à gauche | — | Code : `brandPosition: haut-centre` |
| Qualité du chrome | Flux.2 Klein 1K par défaut | Klein copie la composition de la référence et reste plat | Image : pour `chrome`, Mystic (`style_reference` = System Token) ou Nano Banana Pro 2K ; `upscale-precision` avant détourage pour des arêtes nettes |

Effort : ~1 jour.

### Réf. D — « Superman » (image plein cadre + code)

| Élément | Aujourd'hui | Écart | Correctif |
|---|---|---|---|
| Image plein cadre : sujet de dos, petit, haut du cadre ; horizon lumineux à 60 % ; ciel étoilé ; bas vide | Prompt `full` déjà proche (sujet 2/3 haut, bas vide) | Le sujet occupe souvent tout le cadre ; horizon rarement là | Image : prompt « sujet 25–35 % de la hauteur, ligne d'horizon à 55–65 %, tiers bas vide », Nano Banana Pro 2K / Mystic 2K avec la référence Superman (déjà câblée) |
| Couleurs vives conservées (cape jaune-vert) | `hero-grade` bleu → cape grise-verte sur la planche | Le voile tue l'image | Code : `heroGrade: aucun` par défaut dès qu'une référence de style est active |
| Chip auteur haut-gauche : **photo**, nom, coche, tagline | `showAuthor` (templates maison) avec le logo en avatar | Photo + tagline manquent | Code + réglages marque : `avatarAssetId`, `tagline` (existe déjà) dans la chip |
| Badge vérifié rond en verre haut-droite | Aucun | — | Code : `showVerifiedBadge` |
| Titre bas-gauche 3 lignes, graisse 500, argent dégradé, mot serif italique dans **la couleur de l'image** | Titre 800 centré, accent = bleu marque | Graisse et alignement existent en template maison ; la couleur tirée de l'image n'existe pas | Code : `accentFromImage` (couleur dominante saturée extraite avec sharp `stats()` → `--accent` de la slide) |

Effort : ~1 jour.

## 3. Écarts transversaux du pipeline image

1. **Détourage sur fond sombre** — les styles `objets` et `chrome` demandent un
   fond uni `bg1` (sombre pour tous les templates sombres). Le modèle isnet
   sépare mal un objet sombre d'un fond sombre : lors du test, 3 pièces sur 4 ont
   été perdues ou rognées. Correctif : générer sur **gris neutre 50 %** (aucune
   fuite de couleur, contraste garanti pour objets clairs et sombres), ou
   `remove-background` Magnific quand `PUBLIC_URL` est en https.
2. **Voile coloré `hero-grade`** — utile pour ramener une image quelconque vers
   le bleu Odile, il devient nuisible dès que l'image est générée dans la palette
   (ce qui est le cas maintenant) : il désature chrome, verre, cape. À rendre
   optionnel, désactivé par défaut.
3. **Résolution** — l'image est générée en 1K/2K puis réduite en 1080 × 1350 JPEG
   88, et la slide est rendue en 1×. Correctif : conserver le master 2K, rendre
   avec `deviceScaleFactor: 2` (2160 × 2700) et exporter en 2160 (LinkedIn accepte
   jusqu'à 7680 px, Instagram rééchantillonne mieux depuis 2160). Coût nul.
4. **Un seul objet par post** — impossible de composer « pièces aux 4 coins ».
   Correctif : `objectSet` dans l'agent visuel (2 à 4 concepts d'une même famille,
   le 1ᵉʳ objet généré servant d'`input_image` aux suivants pour garder matière et
   éclairage).
5. **Routage modèle par style** — Flux.2 Klein est rapide mais copie la
   composition de la référence et manque de relief. Recommandation : `full` et
   `chrome` → Nano Banana Pro (2K) ou Mystic (`style_reference`) ; `objets` →
   Flux.2 Klein avec `input_image` = 1ᵉʳ objet de la série. Le réglage global
   « modèle » devient un modèle **par style** (3 champs).
6. **Aucune porte qualité** — ajouter avant enregistrement : couverture alpha du
   détourage entre 5 et 60 % du canevas, boîte englobante ne touchant pas les bords
   (sinon objet rogné → regénérer), détection de texte parasite (1 appel vision
   Claude ≈ 0,001 €) → une regénération automatique.
7. **Fusion à la palette** (objets « fondus au fond » de la réf. B) — halo accent
   flouté + ombre portée colorée sous chaque détourage, côté code. Pas besoin de
   `relight` par défaut.

8. **Couleur dominante « pop »** (demande du 10/09 : des images vives comme le
   Superman) — la référence tient à **une seule couleur signature très saturée**
   (la cape jaune-vert) posée sur la palette du template (bleu nuit), reprise
   ensuite par le mot accentué du titre. Aujourd'hui le prompt fait l'inverse :
   « `accent` comme SEULE couleur d'accent » et « toute teinte hors palette
   interdite », donc le modèle rend des images monochromes bleu-sur-bleu, puis le
   voile `hero-grade` finit d'aplatir ce qui restait. Correctif :
   - un champ `popColor` par template (`auto` = complémentaire de l'accent :
     bleu → jaune-vert, violet → orange, cyan → corail, ou une couleur choisie) ;
   - dans le prompt `full` : « the hero subject carries ONE vivid signature colour
     (`popColor`), highly saturated, strongly lit ; everything else stays in the
     palette ; high contrast, deep blacks, crisp highlights » ;
   - `accentFromImage` (réf. D) : le mot accentué du titre prend cette couleur,
     extraite de l'image rendue (`sharp.stats()` sur les pixels saturés) — sinon
     `popColor` du template ;
   - `heroGrade: aucun` et saturation conservée (aucun `grayscale`, aucun
     `mix-blend-mode: color`) ; en option un léger `contrast(1.08) saturate(1.1)`
     côté CSS pour le punch.

## 4. Écarts éditeur / UX

- Pas de contrôle de mise en page par slide : position et taille de l'objet,
  4 objets flottants, icône, sous-titre, CTA sur n'importe quelle slide.
- Pas de **recette** : il faut aligner template, style d'image, modèle et agent à
  la main. Proposer 4 recettes — **Signal** (réf. A), **Pièces** (réf. B),
  **Chrome** (réf. C), **Horizon** (réf. D) — qui fixent en un clic paramètres du
  template, `imageStyle`, modèle et mise en page ; le rédacteur choisit la recette
  par post (mapping archétype ↔ recette) et remplit les champs qu'elle attend.
- Pas de comparaison avec la référence dans l'éditeur : ajouter un bouton
  « Comparer » qui affiche la référence de style à côté du rendu.
- Le rédacteur ne connaît pas les nouveaux champs : `icon`, `subtitle`, `ctaLabel`
  sur toute slide, `objectSet`, `bigNumber` avec unité.

## 5. Plan priorisé

| Priorité | Contenu | Effort | Effet attendu |
|---|---|---|---|
| **P0 — couche codée** | Décors `disques`, `colonne`, `anneaux-larges` ; badge icône + sous-titre + CTA sur toute slide (`chevron`, `↗`) ; `bigNumberWeight` ; 4 slots d'objets avec débordement / rotation / miroir ; `objectPlacement` + `objectGlow` ; `heroGrade` optionnel ; chip auteur v2 (photo, tagline) + badge vérifié + `brandPosition` / `footerLayout` ; rendu 2× | ~3 jours | Réfs A, B, C atteintes avec les objets déjà produits par l'app ; réf. D côté code |
| **P1 — pipeline image** | Couleur signature `popColor` dans les prompts + `accentFromImage` ; fond gris neutre pour les détourages ; `objectSet` (2–4 objets) dans l'agent visuel ; modèle par style ; portes qualité + 1 regénération | ~2 jours | Détourages fiables, séries d'objets cohérentes, images plein cadre au niveau de la réf. D |
| **P2 — recettes & pilotage** | 4 recettes prêtes ; champs rédacteur (`icon`, `subtitle`, `ctaLabel`, `objectSet`) ; « Comparer à la référence » ; agent « directeur artistique » qui note le rendu face à la référence (vision Claude) et relance une fois | ~2 jours | Un post « à la hauteur » sans réglage manuel |

## 6. Ce que le POC démontre, et ses limites

- Les mises en page des 4 références sont reproductibles à l'identique avec du
  CSS et les polices déjà embarquées (Inter variable 100–900, Playfair italique,
  Fragment Mono) : aucune police ni bibliothèque à ajouter.
- Le détourage local suffit pour des objets contrastés (pièce Bitcoin, pince
  chrome : propres du premier coup) ; il échoue sur objets sombres / fond sombre,
  d'où le point 3.1 obligatoire.
- Les objets du POC ont été découpés dans les références elles-mêmes pour isoler
  la couche codée ; en production ils viennent de Magnific, et c'est là que se
  joue le dernier écart (qualité du chrome, du sujet plein cadre) — traité par le
  routage modèle par style et les références de style déjà en place.

## 7. Prérequis côté serveur (rappel)

`git pull`, `FREEPIK_API_KEY` dans `.env`, rebuild Docker, import des 3 images de
référence dans **Images**, sélection dans **Réglages › Références de style**,
« Illustrations en noir et blanc » décoché. Régénérer toutes les clés API partagées
pendant le développement une fois l'app stable.
