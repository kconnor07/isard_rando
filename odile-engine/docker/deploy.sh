#!/usr/bin/env bash
# Déploiement d'Odile Engine sur le serveur : met la branche à jour, reconstruit
# l'image avec le numéro de commit, redémarre, puis affiche la version servie.
#   cd ~/isard_rando/odile-engine && ./docker/deploy.sh
set -euo pipefail
# Ce script tourne sur le serveur (Ubuntu). Lancé depuis un Mac, il demanderait le
# mot de passe du Mac (sudo) et construirait l'image au mauvais endroit.
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "✗ Ce script se lance SUR LE SERVEUR, pas sur le Mac."
  echo "  1. ssh -i <clé> ubuntu@<IP du serveur>"
  echo "  2. cd ~/isard_rando/odile-engine && ./docker/deploy.sh"
  exit 1
fi
cd "$(dirname "$0")/.."
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
echo "→ mise à jour de la branche $BRANCH"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "✗ des fichiers suivis ont été modifiés localement, la mise à jour s'arrêterait dessus :"
  git status --porcelain --untracked-files=no | sed 's/^/    /'
  echo "  → pour abandonner ces modifications puis relancer :  git checkout -- . && ./docker/deploy.sh"
  exit 1
fi
git fetch origin "$BRANCH"
git checkout -q "$BRANCH"
git pull --ff-only origin "$BRANCH"
export GIT_SHA
GIT_SHA="$(git rev-parse --short HEAD)"
echo "→ construction de l'image ($GIT_SHA)"
sudo -E docker compose --env-file .env -f docker/docker-compose.yml up -d --build
PUBLIC_URL="$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '\r' | sed -e "s/^['\"]//" -e "s/['\"]$//" || true)"
health() {
  # Le port n'est pas publié sur l'hôte : on interroge l'application depuis son conteneur,
  # puis l'URL publique (Caddy) si elle est renseignée.
  sudo docker compose -f docker/docker-compose.yml exec -T app node -e "fetch('http://127.0.0.1:3080/healthz').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))" 2>/dev/null \
    || { [[ -n "$PUBLIC_URL" ]] && curl -fs "$PUBLIC_URL/healthz" 2>/dev/null; }
}
echo "→ attente du démarrage"
for i in $(seq 1 20); do
  sleep 3
  if out="$(health)"; then
    echo "→ en ligne : $out"
    if [[ "$out" == *"\"version\":\"$GIT_SHA\""* ]]; then echo "✓ version $GIT_SHA servie"; else echo "✗ la version servie n'est pas $GIT_SHA — vérifiez la sortie du build ci-dessus"; fi
    exit 0
  fi
done
echo "✗ l'application ne répond pas — sudo docker compose -f docker/docker-compose.yml logs --tail=100 app"
exit 1
