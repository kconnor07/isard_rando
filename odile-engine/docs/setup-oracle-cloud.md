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

# Code
git clone https://github.com/kconnor07/isard_rando.git
cd isard_rando/odile-engine

# Configuration
cp .env.example .env
nano .env      # APP_SECRET (openssl rand -base64 32), ADMIN_PASSWORD,
               # PUBLIC_URL=https://engine.odileai.com, DOMAIN=engine.odileai.com,
               # clés IA + SMTP (voir les autres guides)

# Lancement (build ~5-10 min la première fois sur ARM)
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs -f app   # suivre le démarrage
```

Caddy obtient automatiquement le certificat HTTPS (Let's Encrypt) dès que le
DNS pointe vers la VM. Ouvre ensuite **https://engine.odileai.com** → dashboard.

## 5. Vérifier

1. Dashboard → **Connexions & santé** : SMTP ✅, Chromium ✅, Claude/Gemini ✅.
2. Connecte LinkedIn et Meta (boutons de la même page — guides dédiés).
3. Laisse `PUBLISH_MODE=dry` le temps de valider un premier cycle complet
   (email reçu → approbation → payload dans la outbox), puis passe
   `PUBLISH_MODE=live` dans `.env` et relance :
   `docker compose -f docker/docker-compose.yml up -d`.

## Exploitation

```bash
# Mise à jour du code
git pull && docker compose -f docker/docker-compose.yml up -d --build

# Sauvegarde de la base (quotidienne conseillée, via cron système)
docker compose -f docker/docker-compose.yml exec app \
  sh -c 'cp /data/data.sqlite /data/backup-$(date +%F).sqlite'

# Logs
docker compose -f docker/docker-compose.yml logs -f --tail 100 app
```

La base, les visuels et la outbox vivent dans le volume Docker `odile-data`
(persistant entre mises à jour).
