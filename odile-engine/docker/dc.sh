#!/usr/bin/env bash
# Raccourci docker compose pour ce projet, avec les bons drapeaux.
#
# Le .env vit à la racine d'odile-engine/ alors que le compose est dans docker/ :
# sans --env-file, docker compose cherche docker/.env, ne trouve pas DOMAIN et
# s'arrête sur « required variable DOMAIN is missing a value ».
#
#   ./docker/dc.sh logs --tail=40 caddy     # voir les journaux de Caddy
#   ./docker/dc.sh restart caddy            # forcer une nouvelle demande de certificat
#   ./docker/dc.sh ps                       # état des conteneurs
#
# Pour déployer une nouvelle version, utiliser ./docker/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  echo "✗ .env introuvable dans $(pwd) — copier .env.example et le remplir."
  exit 1
fi
SUDO=""
docker info >/dev/null 2>&1 || SUDO="sudo"
exec $SUDO docker compose --env-file .env -f docker/docker-compose.yml "$@"
