# Déployer Odile Engine sur Oracle Cloud (gratuit, ARM)

Objectif : une VM **Always Free** Ampere A1 (4 OCPU / 24 Go RAM — largement
suffisant) qui fait tourner tout le moteur 24/7 pour 0 €/mois.

## 1. Créer le compte et la VM

1. Compte sur [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) —
   carte bancaire demandée pour vérification, jamais débitée en Always Free.
2. **Région** : choisis-en une proche (Paris `eu-paris-1` ou Francfort
   `eu-frankfurt-1`) — ⚠️ elle est définitive pour les ressources Free.
3. Menu ☰ → *Compute* → *Instances* → **Create instance** :
   - Image : **Ubuntu 24.04 (aarch64)**.
   - Shape : **Ampere → VM.Standard.A1.Flex**, 4 OCPU / 24 Go (le max gratuit).
   - Ajoute ta clé SSH publique.
4. 💡 **Astuce capacité ARM** : l'erreur « Out of capacity » est fréquente.
   Réessaie à différentes heures (tôt le matin), ou change de *fault domain* ;
   en dernier recours passe le compte en *Pay As You Go* (les ressources A1
   restent gratuites dans les limites Always Free) — la capacité se libère
   presque toujours ainsi.

## 2. Ouvrir les ports 80 et 443

Réseau → *Virtual Cloud Networks* → ta VCN → *Security Lists* → *Default* →
**Add Ingress Rules** :

| Source CIDR | Protocole | Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

Puis sur la VM (le pare-feu Ubuntu d'Oracle bloque aussi) :

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. DNS

Chez ton registrar (domaine odileai.com), crée un enregistrement **A** :
`engine.odileai.com → <IP publique de la VM>`. Attends la propagation
(`dig engine.odileai.com` doit renvoyer l'IP).

## 4. Installer Docker et déployer

```bash
ssh ubuntu@<IP>
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# Code (le moteur vit sur cette branche)
git clone https://github.com/kconnor07/isard_rando.git
cd isard_rando
git checkout claude/linkedin-instagram-auto-publish-v11wef
cd odile-engine

# Configuration
cp .env.example .env
nano .env      # APP_SECRET (openssl rand -base64 32), ADMIN_PASSWORD,
               # PUBLIC_URL=https://engine.odileai.com, DOMAIN=engine.odileai.com,
               # clés IA + SMTP (voir les autres guides)

# Lancement (build ~5-10 min la première fois sur ARM)
docker compose --env-file .env -f docker/docker-compose.yml up -d --build
docker compose --env-file .env -f docker/docker-compose.yml logs -f app   # suivre le démarrage
```

Caddy obtient automatiquement le certificat HTTPS (Let's Encrypt) dès que le
DNS pointe vers la VM. Ouvre ensuite **https://engine.odileai.com** → dashboard.

## 5. Vérifier

1. Dashboard → **Connexions & santé** : SMTP ✅, Chromium ✅, Claude/Gemini ✅.
2. Connecte LinkedIn et Meta (boutons de la même page — guides dédiés).
3. Laisse `PUBLISH_MODE=dry` le temps de valider un premier cycle complet
   (email reçu → approbation → payload dans la outbox), puis passe
   `PUBLISH_MODE=live` dans `.env` et relance :
   `docker compose --env-file .env -f docker/docker-compose.yml up -d`.

## Exploitation

```bash
# Mise à jour du code
git pull && docker compose --env-file .env -f docker/docker-compose.yml up -d --build

# Sauvegarde de la base (quotidienne conseillée, via cron système)
docker compose --env-file .env -f docker/docker-compose.yml exec app \
  sh -c 'cp /data/data.sqlite /data/backup-$(date +%F).sqlite'

# Logs
docker compose --env-file .env -f docker/docker-compose.yml logs -f --tail 100 app
```

La base, les visuels et la outbox vivent dans le volume Docker `odile-data`
(persistant entre mises à jour).

### Déploiement automatique (sans SSH au quotidien)

Une minuterie systemd peut regarder GitHub toutes les dix minutes et déployer ce qui
est nouveau sur la branche suivie — utile quand les commits viennent d'un assistant
qui n'a pas la clé SSH du serveur. Installation, une seule fois, sur le serveur :

```bash
cd ~/isard_rando/odile-engine && git pull
sudo ./docker/install-auto-deploy.sh claude/linkedin-instagram-auto-publish-v11wef
```

Chaque passage qui trouve une nouvelle version lance `deploy.sh` (mise à jour, image,
redémarrage, vérification de la version servie) et l'écrit dans
`~/odile-auto-deploy.log`. Pour suspendre : `sudo systemctl disable --now
odile-auto-deploy.timer`. La règle qui va avec : on ne pousse sur la branche suivie
qu'un code dont les tests passent.

### Cohabiter avec un autre projet sur la même machine

Quand une autre application tient déjà les ports 80 et 443 (son propre Caddy), Odile
Engine peut tourner à côté : `touch .cohabitation` à la racine, puis `./docker/deploy.sh`
n'allume que l'application, sous le nom de conteneur `odile-engine-app-1`, sur le réseau
Docker partagé `odile-web` (voir `docker/cohabitation.yml`). Côté autre projet :
`docker network create odile-web`, `docker network connect odile-web <son-caddy>`, et un
bloc `odile-engine.duckdns.org { reverse_proxy odile-engine-app-1:3080 }` dans son Caddyfile.

### Si le site ne répond plus

La machine accepte les connexions mais aucune réponse HTTP ne revient : le conteneur
ou Caddy est figé (disque plein, mémoire). Sans ordinateur, la console Oracle Cloud
(navigateur du téléphone) suffit : Compute → Instances → l'instance → **Reboot**. Les
conteneurs redémarrent seuls (`restart: unless-stopped`) avec la version déjà en place.
Avec un ordinateur : `./docker/dc.sh ps`, `df -h`, `free -m`, puis `./docker/dc.sh restart`.
