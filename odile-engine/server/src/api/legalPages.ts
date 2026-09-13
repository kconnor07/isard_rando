/**
 * Pages publiques exigées par Meta (et utiles pour LinkedIn) : politique de
 * confidentialité et instructions de suppression des données.
 *
 * Elles décrivent le fonctionnement réel du moteur : jetons chiffrés, données
 * de commentaires Instagram reçues par webhook, empreinte d'IP quotidienne sur
 * les liens courts, durées de purge effectivement appliquées (voir
 * scheduler/jobs.ts). Toute évolution du traitement doit être répercutée ici.
 */
import { config } from '../config.js';
import { getBrand } from '../db/settingsRepo.js';
import { escapeHtml } from './pages.js';

const SHELL = (title: string, body: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark }
  body{margin:0;background:#07070c;color:#e8edf6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
       line-height:1.6;font-size:16px}
  main{max-width:760px;margin:0 auto;padding:56px 24px 96px}
  h1{font-size:30px;line-height:1.2;margin:0 0 8px}
  h2{font-size:19px;margin:38px 0 10px;color:#fff}
  p,li{color:#b9c3d4}
  li{margin:6px 0}
  a{color:#4aa8ff}
  .date{color:#7c879b;font-size:14px;margin:0 0 28px}
  .card{background:#101018;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:20px 24px;margin:26px 0}
  footer{margin-top:48px;border-top:1px solid rgba(255,255,255,.08);padding-top:18px;color:#7c879b;font-size:14px}
</style></head><body><main>${body}</main></body></html>`;

/** Adresse de contact affichée sur les pages légales. */
function contactEmail(): string {
  return config.CONTACT_EMAIL;
}

const MAJ = '13 septembre 2026';

export function privacyPage(): string {
  const marque = escapeHtml(getBrand().name || 'Odile AI');
  const mail = escapeHtml(contactEmail());
  const base = escapeHtml(config.PUBLIC_URL);
  return SHELL(
    `Politique de confidentialité — ${marque}`,
    `<h1>Politique de confidentialité</h1>
<p class="date">${marque} — Odile Engine. Dernière mise à jour : ${MAJ}.</p>

<p>Odile Engine est l'outil interne avec lequel ${marque} prépare et publie ses propres
publications sur LinkedIn et Instagram. Il n'est ouvert à aucun autre utilisateur :
seule l'équipe de ${marque} y accède, derrière un mot de passe.</p>

<h2>1. Données traitées</h2>
<ul>
  <li><b>Comptes connectés.</b> Jetons d'accès LinkedIn et Meta, identifiants et noms des
  comptes, pages et comptes Instagram liés, permissions accordées et dates d'expiration.
  Les jetons sont chiffrés (AES-256-GCM) avant d'être enregistrés et ne sont jamais affichés
  en clair dans l'interface.</li>
  <li><b>Publications.</b> Textes, visuels et légendes produits par l'outil, identifiants des
  publications une fois en ligne, et leurs statistiques publiques agrégées (impressions,
  réactions, commentaires, partages).</li>
  <li><b>Commentaires Instagram.</b> Lorsqu'une personne commente une publication de ${marque},
  Meta nous transmet l'identifiant du commentaire, son texte, ainsi que l'identifiant et le nom
  d'utilisateur public de son auteur. Ces données servent uniquement à envoyer une réponse
  privée unique lorsque le commentaire contient le mot-clé annoncé dans la publication
  (par exemple « GUIDE »).</li>
  <li><b>Clics sur les liens courts.</b> Date, type d'appareil déclaré par le navigateur, page
  d'origine, et une empreinte de l'adresse IP recalculée chaque jour avec un sel secret.
  <b>Aucune adresse IP n'est conservée en clair</b> et l'empreinte ne permet pas de retrouver
  la personne.</li>
  <li><b>Accès à l'outil.</b> Un cookie de session pour l'administration. Aucun cookie
  publicitaire, aucun traceur tiers, aucune revente de données.</li>
</ul>

<h2>2. Pourquoi ces données</h2>
<p>Publier les contenus de ${marque} sur ses propres comptes, mesurer leur portée, et répondre
automatiquement aux personnes qui demandent une ressource en commentaire. Base légale :
l'intérêt légitime de ${marque} à communiquer sur ses réseaux, et pour la réponse privée, la
demande explicite de la personne qui a commenté avec le mot-clé.</p>

<h2>3. Qui d'autre y a accès</h2>
<ul>
  <li><b>LinkedIn et Meta</b> : destinataires des publications et des réponses privées.</li>
  <li><b>Fournisseurs d'IA</b> (Anthropic, Google) : ils reçoivent uniquement la matière
  éditoriale — actualités sourcées et textes rédigés. Les commentaires, noms d'utilisateurs et
  données de clics ne leur sont jamais transmis.</li>
  <li><b>Hébergeur</b> du serveur et <b>fournisseur d'e-mail</b> pour les seules notifications
  internes d'approbation.</li>
</ul>
<p>Les données ne sont ni vendues, ni louées, ni utilisées à des fins publicitaires.</p>

<h2>4. Durées de conservation</h2>
<ul>
  <li>Jetons d'accès : jusqu'à la déconnexion du compte depuis l'outil, ou leur expiration.</li>
  <li>Contenu brut des notifications de commentaires : effacé automatiquement au bout de 30 jours.</li>
  <li>Journaux techniques d'exécution : 90 jours.</li>
  <li>Publications et statistiques agrégées : conservées tant que ${marque} en a besoin pour
  son pilotage éditorial.</li>
</ul>

<h2>5. Vos droits</h2>
<p>Vous pouvez demander l'accès, la rectification ou la suppression des données vous concernant,
ou vous opposer à leur traitement, en écrivant à <a href="mailto:${mail}">${mail}</a>. Nous
répondons sous 30 jours. Vous pouvez aussi saisir la CNIL (<a href="https://www.cnil.fr">cnil.fr</a>).</p>

<div class="card">
  <b>Supprimer vos données</b>
  <p style="margin:8px 0 0">La marche à suivre est détaillée sur la page
  <a href="${base}/suppression-donnees">${base}/suppression-donnees</a>.</p>
</div>

<footer>Contact : <a href="mailto:${mail}">${mail}</a></footer>`,
  );
}

export function dataDeletionPage(): string {
  const marque = escapeHtml(getBrand().name || 'Odile AI');
  const mail = escapeHtml(contactEmail());
  const base = escapeHtml(config.PUBLIC_URL);
  return SHELL(
    `Suppression des données — ${marque}`,
    `<h1>Suppression de vos données</h1>
<p class="date">${marque} — Odile Engine. Dernière mise à jour : ${MAJ}.</p>

<p>Si vous avez commenté une publication Instagram ou LinkedIn de ${marque}, notre outil a pu
enregistrer votre commentaire, votre nom d'utilisateur public et l'identifiant de votre compte,
uniquement pour vous envoyer la réponse privée que vous demandiez. Vous pouvez faire effacer
ces informations à tout moment.</p>

<h2>Demander la suppression</h2>
<ol>
  <li>Écrivez à <a href="mailto:${mail}?subject=Suppression%20de%20mes%20donn%C3%A9es">${mail}</a>
  avec l'objet « Suppression de mes données ».</li>
  <li>Indiquez votre nom d'utilisateur Instagram ou LinkedIn — c'est la seule information dont
  nous avons besoin pour retrouver vos données.</li>
  <li>Nous supprimons votre commentaire, votre identifiant, votre nom d'utilisateur et la trace
  de la réponse privée envoyée, puis nous vous confirmons la suppression.</li>
</ol>
<p>Délai maximum : <b>30 jours</b>, en pratique sous quelques jours.</p>

<h2>Autres moyens, immédiats</h2>
<ul>
  <li><b>Supprimez votre commentaire</b> depuis Instagram ou LinkedIn : il disparaît de la
  publication ; écrivez-nous ensuite si vous souhaitez aussi effacer notre copie.</li>
  <li><b>Retirez l'accès de l'application</b> dans les réglages de votre compte
  (Facebook : Paramètres → Applications et sites web ; Instagram : Paramètres → Applications
  et sites web).</li>
</ul>

<h2>Ce qui n'est pas concerné</h2>
<p>Les statistiques agrégées (nombre total de vues, de réactions, de clics) ne contiennent
aucune donnée permettant de vous identifier et ne peuvent donc pas être rattachées à une
personne.</p>

<footer>Politique de confidentialité complète :
<a href="${base}/confidentialite">${base}/confidentialite</a> — Contact :
<a href="mailto:${mail}">${mail}</a></footer>`,
  );
}
