/**
 * La marque sur chaque post : son hashtag, son site en fin de texte.
 *
 * Posés à la rédaction et vérifiés une dernière fois à la publication — un post
 * programmé avant un changement de réglage part quand même avec la bonne règle :
 * - Instagram : le hashtag de la marque (#OdileAI) ouvre la liste ;
 * - LinkedIn : jamais le hashtag de la marque (il n'a aucun abonné), 0 à 3
 *   hashtags précis, pour la recherche (stratégie LinkedIn 2026) ;
 * - l'adresse du site termine le texte sur la Page LinkedIn et sur Facebook, où
 *   elle est cliquable. Jamais sur un profil personnel (un lien dans le corps
 *   coûte 17 à 27 % de portée), ni sur Instagram.
 */
import { HASHTAGS_MAX, type BrandSettings } from '@odile/shared';
import { getBrand, getStrategieLinkedIn } from '../db/settingsRepo.js';

type Marque = Pick<BrandSettings, 'name' | 'siteUrl'> & Partial<Pick<BrandSettings, 'hashtagMarque' | 'siteDansLesPosts'>>;

const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** « Odile AI » → #OdileAI (ou le hashtag imposé dans Réglages → Marque). */
export function hashtagDeMarque(marque: Marque = getBrand()): string {
  const impose = (marque.hashtagMarque ?? '').trim().replace(/^#+/, '');
  const base = impose || marque.name;
  return `#${sansAccents(base).replace(/[^\p{L}\p{N}_]/gu, '')}`;
}

/** « https://www.odileai.com/ » → « odileai.com ». */
export function domaineDuSite(url: string = getBrand().siteUrl): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** L'adresse telle qu'on l'écrit : sans barre finale inutile. */
export function adresseDuSite(url: string = getBrand().siteUrl): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' && !u.search && !u.hash ? u.origin : url.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/** Le texte cite-t-il déjà le site (adresse complète ou domaine seul) ? */
export function porteLeSite(texte: string, domaine: string = domaineDuSite()): boolean {
  if (!domaine) return false;
  const d = domaine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])(?:https?:\\/\\/)?(?:www\\.)?${d}(?![\\w-])`, 'i').test(texte);
}

/** Où part le texte : la Page LinkedIn (« linkedin »), un profil personnel, Facebook, Instagram. */
export type Reseau = 'linkedin' | 'linkedin_profil' | 'facebook' | 'instagram';

/** La surface d'un post LinkedIn, d'après son canal. */
export function reseauDuCanal(channel: string): Reseau {
  return channel === 'ig' ? 'instagram' : channel === 'li_personal' ? 'linkedin_profil' : 'linkedin';
}

/**
 * Un lien (le site, la ressource) a-t-il sa place dans le texte de cette surface ?
 * Instagram jamais ; un profil seulement si la stratégie l'autorise ; la Page
 * oui par défaut — elle sert de hub de liens.
 */
export function lienPermis(reseau: Reseau): boolean {
  if (reseau === 'instagram') return false;
  if (reseau === 'facebook') return true;
  const strategie = getStrategieLinkedIn();
  return reseau === 'linkedin_profil' ? strategie.lienDansLeCorpsProfils : strategie.lienDansLeCorpsPage;
}

/**
 * Ajoute l'adresse du site en fin de texte, si elle n'y est pas déjà et si la
 * surface accepte un lien.
 */
export function avecSite(caption: string, reseau: Reseau, marque: Marque = getBrand()): string {
  if (!lienPermis(reseau) || marque.siteDansLesPosts === false) return caption;
  const domaine = domaineDuSite(marque.siteUrl);
  if (!domaine || porteLeSite(caption, domaine)) return caption;
  return `${caption.trimEnd()}\n\n${marque.name} : ${adresseDuSite(marque.siteUrl)}`;
}

/**
 * Normalise un hashtag : sans accents ni ponctuation, pour qu'un même sujet ne se
 * disperse pas entre #Productivité et #Productivite.
 */
export function hashtagPropre(brut: string): string {
  return `#${sansAccents(brut.replace(/^#+/, '')).replace(/[^\p{L}\p{N}_]/gu, '')}`;
}

/**
 * Les hashtags que la plateforme prend vraiment en compte, dédoublonnés et écrits
 * sans accents (un sujet ne se disperse pas entre deux orthographes) :
 * - Instagram : cinq au plus, celui de la marque en tête ;
 * - LinkedIn : 0 à 3 hashtags précis (réglage), jamais celui de la marque, qui
 *   n'a aucun abonné — le hashtag y sert à la recherche, pas à la portée.
 */
export function bornerHashtags(bruts: string[], platform: 'linkedin' | 'instagram', marque: string = hashtagDeMarque()): string[] {
  const linkedin = platform === 'linkedin';
  const vus = new Set<string>([marque.toLowerCase()]);
  const propres: string[] = linkedin ? [] : [marque];
  for (const h of bruts) {
    const tag = hashtagPropre(h);
    if (tag.length < 3 || vus.has(tag.toLowerCase())) continue;
    vus.add(tag.toLowerCase());
    propres.push(tag);
  }
  const max = linkedin ? getStrategieLinkedIn().hashtagsMax : HASHTAGS_MAX.instagram;
  return propres.slice(0, max);
}
