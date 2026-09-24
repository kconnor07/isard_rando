/**
 * La marque sur chaque post : son hashtag en tête, son site en fin de texte.
 *
 * Deux garanties, posées à la rédaction et vérifiées une dernière fois à la
 * publication — un post programmé avant ce réglage part quand même avec :
 * - le hashtag de la marque (#OdileAI) ouvre la liste, sur tous les réseaux ;
 * - l'adresse du site termine le texte sur LinkedIn et Facebook, où elle est
 *   cliquable. Jamais sur Instagram : la légende n'y porte aucun lien.
 */
import { HASHTAGS_MAX, type BrandSettings } from '@odile/shared';
import { getBrand } from '../db/settingsRepo.js';

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

/**
 * Ajoute l'adresse du site en fin de texte, si elle n'y est pas déjà.
 * Instagram : rien — la légende n'y porte aucun lien.
 */
export function avecSite(caption: string, reseau: 'linkedin' | 'facebook' | 'instagram', marque: Marque = getBrand()): string {
  if (reseau === 'instagram' || marque.siteDansLesPosts === false) return caption;
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
 * Les hashtags que la plateforme prend vraiment en compte : LinkedIn en ignore
 * au-delà de trois, Instagram n'en accepte plus que cinq. Le hashtag de la marque
 * ouvre toujours la liste, sur tous les réseaux ; les autres sont dédoublonnés,
 * écrits sans accents (un sujet ne se disperse pas entre deux orthographes) et
 * coupés — le modèle en propose parfois huit.
 */
export function bornerHashtags(bruts: string[], platform: 'linkedin' | 'instagram', marque: string = hashtagDeMarque()): string[] {
  const vus = new Set<string>([marque.toLowerCase()]);
  const propres: string[] = [marque];
  for (const h of bruts) {
    const tag = hashtagPropre(h);
    if (tag.length < 3 || vus.has(tag.toLowerCase())) continue;
    vus.add(tag.toLowerCase());
    propres.push(tag);
  }
  return propres.slice(0, HASHTAGS_MAX[platform]);
}
