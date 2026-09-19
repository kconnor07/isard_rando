/**
 * Ce que le tunnel fera vraiment, en phrases — pour le tableau de bord et les réglages.
 *
 * Les informations existent (droits des comptes, lien de rendez-vous, nom de la page,
 * posts en attente) mais éparpillées : ici elles deviennent des avertissements avec
 * l'action à faire, à côté de ceux des connexions.
 */
import { getDmTriggers } from '../db/settingsRepo.js';
import { comptesLinkedIn, droitCommentaire } from '../publishers/linkedinAccounts.js';
import type { ConnectionWarning } from '../publishers/refresh.js';
import { bloquants, postsAVerifier, verifierPost } from '../writer/conformite.js';

export function avertissementsDuTunnel(): ConnectionWarning[] {
  const out: ConnectionWarning[] = [];
  const dm = getDmTriggers();
  if (dm.linkedinOffer === 'diagnostic' && !dm.rdvUrl.trim()) {
    out.push({
      provider: 'linkedin',
      subject: 'tunnel',
      level: 'warn',
      message: 'Aucun lien de rendez-vous : sur LinkedIn, la réponse au mot-clé et le bouton des guides renvoient vers la page d’accueil — renseigne-le dans Réglages → Commentaire → DM.',
    });
  }
  for (const page of comptesLinkedIn('li_org')) {
    if (/^Organisation \d+$/.test(page.name) || page.name === 'Page entreprise') {
      out.push({
        provider: 'linkedin',
        subject: 'li_org',
        level: 'warn',
        message: 'La page entreprise n’a pas de nom : elle s’affiche par son numéro et ne peut pas être identifiée (@) dans les posts — « Renommer » dans Connexions & santé.',
      });
    }
  }
  const muets = comptesLinkedIn('li_person').filter((c) => c.actif && !droitCommentaire(c).peutLire);
  if (muets.length > 0) {
    out.push({
      provider: 'linkedin',
      subject: 'li_person',
      level: 'warn',
      message: `LinkedIn ne laisse pas lire les commentaires de ${muets.map((c) => c.name).join(', ')} : les réponses au mot-clé y sont manuelles (le texte prêt est sur chaque post publié).`,
    });
  }
  const programmesBloques = postsAVerifier().filter((p) => p.status === 'scheduled' && bloquants(verifierPost(p)).length > 0);
  if (programmesBloques.length > 0) {
    out.push({
      provider: 'linkedin',
      subject: 'posts',
      level: 'error',
      message: `${programmesBloques.length} post(s) programmé(s) ne tiendront pas leurs promesses en l’état (${programmesBloques.map((p) => `#${p.id}`).join(', ')}) : ouvre « À valider » et clique « Réaligner ».`,
    });
  }
  return out;
}
