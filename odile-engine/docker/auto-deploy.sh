#!/usr/bin/env bash
# Déploiement automatique : lancé toutes les dix minutes par une minuterie systemd
# (voir install-auto-deploy.sh), le serveur regarde si la branche suivie a avancé sur
# GitHub. Si oui, il lance deploy.sh, qui met la branche à jour, reconstruit l'image,
# redémarre et vérifie la version servie. Un commit poussé part ainsi en production
# sans connexion SSH ; les tests ont été passés avant de pousser, c'est la règle.
#   ./docker/auto-deploy.sh <branche>        (à la main, pour essayer)
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
LOG="${AUTO_DEPLOY_LOG:-${HOME:-/tmp}/odile-auto-deploy.log}"

# Un seul déploiement à la fois : un build qui dure plus de dix minutes ne doit pas
# en déclencher un second par-dessus.
exec 9>/tmp/odile-auto-deploy.lock
if ! flock -n 9; then
  echo "déploiement déjà en cours, on laisse finir"
  exit 0
fi

git fetch -q origin "$BRANCH"
LOCALE="$(git rev-parse HEAD)"
DISTANTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCALE" == "$DISTANTE" ]]; then
  exit 0
fi

echo "$(date -Is) → nouvelle version ${DISTANTE:0:7} sur $BRANCH (en place : ${LOCALE:0:7})" | tee -a "$LOG"
if ./docker/deploy.sh "$BRANCH" >>"$LOG" 2>&1; then
  echo "$(date -Is) ✓ version ${DISTANTE:0:7} déployée" | tee -a "$LOG"
else
  echo "$(date -Is) ✗ échec du déploiement de ${DISTANTE:0:7} — détail dans $LOG" | tee -a "$LOG"
  exit 1
fi
