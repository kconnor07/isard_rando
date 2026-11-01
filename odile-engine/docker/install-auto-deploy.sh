#!/usr/bin/env bash
# Installe, sur le serveur, la minuterie systemd du déploiement automatique : toutes
# les dix minutes, auto-deploy.sh compare la branche suivie à GitHub et déploie ce qui
# est nouveau. À lancer une seule fois, avec sudo, depuis le dépôt :
#   sudo ./docker/install-auto-deploy.sh claude/linkedin-instagram-auto-publish-v11wef
# Suivre :     journalctl -u odile-auto-deploy.service -n 50 ; cat ~/odile-auto-deploy.log
# Désactiver : sudo systemctl disable --now odile-auto-deploy.timer
set -euo pipefail
BRANCH="${1:?indiquez la branche à suivre, par exemple main}"
if [[ "$(id -u)" -ne 0 ]]; then
  echo "✗ à lancer avec sudo : il écrit dans /etc/systemd/system"
  exit 1
fi
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Le déploiement tourne sous l'utilisateur propriétaire du dépôt (ubuntu), pas root :
# git refuse un dépôt qui ne lui appartient pas, et deploy.sh fait lui-même ses sudo.
RUN_AS="${SUDO_USER:-$(stat -c %U "$REPO")}"
HOME_RUN_AS="$(getent passwd "$RUN_AS" | cut -d: -f6)"

cat >/etc/systemd/system/odile-auto-deploy.service <<UNIT
[Unit]
Description=Odile Engine — déploiement automatique de la branche $BRANCH
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_AS
Environment=HOME=$HOME_RUN_AS
WorkingDirectory=$REPO
ExecStart=$REPO/docker/auto-deploy.sh $BRANCH
UNIT

cat >/etc/systemd/system/odile-auto-deploy.timer <<UNIT
[Unit]
Description=Odile Engine — regarde GitHub toutes les dix minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now odile-auto-deploy.timer
systemctl list-timers odile-auto-deploy.timer --no-pager
echo "✓ déploiement automatique de « $BRANCH » actif ; journal : $HOME_RUN_AS/odile-auto-deploy.log"
