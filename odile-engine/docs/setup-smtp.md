# Configurer l'email (validation des posts)

Le moteur envoie : les emails d'approbation (cœur du workflow), les relances,
les digests de commentaires LinkedIn, les alertes et le récap hebdo.
Un SMTP fiable est donc important — et ta boîte perso (Gmail direct) finirait
en spam.

## Option recommandée : Brevo (gratuit, 300 emails/jour)

1. Compte sur [brevo.com](https://www.brevo.com) → *SMTP & API* → **SMTP**.
2. Récupère : serveur `smtp-relay.brevo.com`, port `587`, login (ton email
   Brevo) et la **clé SMTP** générée.
3. `.env` :
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<login Brevo>
   SMTP_PASS=<clé SMTP>
   SMTP_SECURE=false
   MAIL_FROM="Odile Engine <engine@odileai.com>"
   APPROVAL_EMAIL_TO=<ton email>
   ```
4. **Authentifie le domaine** (indispensable pour la délivrabilité) : Brevo →
   *Senders, Domains & Dedicated IPs* → *Domains* → ajoute `odileai.com` et
   crée les enregistrements **SPF + DKIM** proposés chez ton registrar.

Alternatives équivalentes : Resend, Mailgun, Postmark (même principe SMTP).

## Test

Dashboard → **Réglages** → *Email de validation* → **Envoyer un email de test**,
ou vérifie l'état SMTP dans **Connexions & santé**.

## Développement local

Sans `SMTP_HOST`, les emails sont écrits dans `server/var/outbox/emails/`
(JSON avec le HTML complet). Avec le compose de dev, **Mailpit** les affiche
dans une vraie boîte : http://localhost:8025.

## Bon à savoir

- Les liens Approuver/Rejeter ne déclenchent **rien au GET** : les scanners
  d'emails d'entreprise qui pré-visitent les liens ne peuvent pas approuver un
  post à ta place — l'action réelle est le bouton de confirmation (POST).
- Chaque lien est à usage unique et expire après 7 jours ; relance automatique
  après 24 h sans réponse (2 max, réglable).
