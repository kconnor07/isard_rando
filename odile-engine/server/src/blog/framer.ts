/**
 * Publication d'un article dans une collection CMS Framer, par l'API serveur.
 *
 * `framer-api` ouvre une connexion (WebSocket) au projet avec la clé d'API créée
 * dans les réglages du site, puis expose les mêmes méthodes que l'API des plugins :
 * collections, champs, ajout d'items, publication, déploiement. Une image se
 * donne par son URL publique — Framer la copie chez lui.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BlogSettings } from '@odile/shared';
import { config } from '../config.js';
import { getOauthApps } from '../db/oauthApps.js';
import { getBrand } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';

export interface ChampFramer {
  id: string;
  name: string;
  type: string;
}
export interface CollectionFramer {
  id: string;
  name: string;
  fields: ChampFramer[];
}

/** Une entrée de champ telle que Framer l'attend (type + valeur). */
export type EntreeChamp = { type: string; value: unknown; contentType?: string; alt?: string };

export interface ContenuAPublier {
  slug: string;
  title: string;
  bodyHtml: string;
  excerpt: string;
  coverUrl: string | null;
  coverAlt: string;
  date: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  jsonLd: string;
  author: string;
}

/**
 * Devine la correspondance des champs quand elle n'a pas été réglée : par nom
 * (title, body, cover…) puis par type (le premier « texte formaté » est le corps,
 * la première image est la couverture).
 */
export function devinerChamps(fields: ChampFramer[], regles: BlogSettings['fields']): BlogSettings['fields'] {
  const out = { ...regles };
  // Un champ ne sert qu'à une chose : ce qui est déjà attribué (réglage ou devinette) est écarté.
  const pris = () => new Set(Object.values(out).filter(Boolean));
  const parNom = (motifs: RegExp, types?: string[]) =>
    fields.find((f) => !pris().has(f.id) && motifs.test(f.name) && (!types || types.includes(f.type)))?.id ?? '';
  const parType = (type: string) => fields.find((f) => !pris().has(f.id) && f.type === type)?.id ?? '';
  // Du plus précis au plus vague : « Meta description » doit tomber sur la méta, pas sur l'extrait.
  out.metaTitle ||= parNom(/(meta.?title|seo.?title|titre.?seo|balise.?title)/i, ['string']);
  out.metaDescription ||= parNom(/(meta.?desc|seo.?desc|description.?seo)/i, ['string']);
  out.jsonLd ||= parNom(/(json.?ld|schema|structured|donn[ée]es.?structur)/i, ['string', 'formattedText']);
  out.keywords ||= parNom(/(keywords|mots.?cl|tags)/i, ['string']);
  out.author ||= parNom(/(author|auteur)/i, ['string']);
  out.title ||= parNom(/^(title|titre|name|nom|headline)$/i, ['string']);
  out.body ||= parNom(/(body|content|contenu|corps|texte|article)/i, ['formattedText']) || parType('formattedText');
  out.cover ||= parNom(/(cover|couverture|image|thumbnail|vignette|hero|featured)/i, ['image']) || parType('image');
  out.date ||= parNom(/(date|published|publi)/i, ['date']) || parType('date');
  out.excerpt ||= parNom(/(excerpt|extrait|summary|résumé|resume|description|intro|chapo)/i, ['string']);
  return out;
}

/** Construit le `fieldData` d'un item à partir de la correspondance des champs. */
export function fieldDataPour(contenu: ContenuAPublier, champs: BlogSettings['fields'], fields: ChampFramer[]): Record<string, EntreeChamp> {
  return fieldDataEtIgnores(contenu, champs, fields).data;
}

/** Libellés lisibles des champs de la correspondance, pour dire ce qui n'arrive pas sur le site. */
export const LIBELLES_CHAMPS: Record<keyof BlogSettings['fields'], string> = {
  title: 'titre',
  body: 'corps',
  excerpt: 'extrait',
  cover: 'couverture',
  date: 'date',
  metaTitle: 'balise title',
  metaDescription: 'méta-description',
  keywords: 'mots-clés',
  jsonLd: 'JSON-LD',
  author: 'auteur',
};

/**
 * Le `fieldData` et, à côté, les champs qui avaient une valeur mais aucune
 * colonne où aller : un référencement dont la méta-description ne part pas
 * doit se voir, pas se deviner.
 */
export function fieldDataEtIgnores(contenu: ContenuAPublier, champs: BlogSettings['fields'], fields: ChampFramer[]): { data: Record<string, EntreeChamp>; ignores: string[] } {
  const typeDe = (id: string) => fields.find((f) => f.id === id)?.type ?? 'string';
  const data: Record<string, EntreeChamp> = {};
  const ignores: string[] = [];
  const pose = (cle: keyof BlogSettings['fields'], valeur: unknown, extra: Partial<EntreeChamp> = {}) => {
    if (valeur === null || valeur === undefined || valeur === '') return;
    const id = champs[cle];
    if (!id) {
      ignores.push(LIBELLES_CHAMPS[cle]);
      return;
    }
    data[id] = { type: typeDe(id), value: valeur, ...extra };
  };
  pose('title', contenu.title);
  pose('body', contenu.bodyHtml, { contentType: 'html' });
  pose('excerpt', contenu.excerpt);
  pose('cover', contenu.coverUrl, { alt: contenu.coverAlt });
  pose('date', contenu.date);
  pose('metaTitle', contenu.metaTitle);
  pose('metaDescription', contenu.metaDescription);
  pose('keywords', contenu.keywords.join(', '));
  pose('jsonLd', contenu.jsonLd, typeDe(champs.jsonLd) === 'formattedText' ? { contentType: 'html' } : {});
  pose('author', contenu.author);
  return { data, ignores };
}

/**
 * La correspondance effective des champs (réglée ou devinée) et ce qui reste sans
 * colonne : le dashboard l'affiche pour que « — automatique — » ne soit plus une
 * promesse aveugle.
 */
export async function correspondanceDesChamps(reglages: BlogSettings): Promise<{ champs: BlogSettings['fields']; manquants: string[]; noms: Record<string, string> }> {
  const framer = await connexion();
  try {
    const collections = await framer.getCollections();
    const collection = collections.find((c) => c.id === reglages.collectionId);
    if (!collection) throw new Error('Collection Framer introuvable — rechoisis-la dans les réglages du blog');
    const fields = (await collection.getFields()).map((f) => ({ id: f.id, name: f.name, type: f.type }));
    const champs = devinerChamps(fields, reglages.fields);
    const manquants = (Object.keys(LIBELLES_CHAMPS) as (keyof BlogSettings['fields'])[]).filter((k) => !champs[k]).map((k) => LIBELLES_CHAMPS[k]);
    const noms: Record<string, string> = {};
    for (const [k, id] of Object.entries(champs)) if (id) noms[k] = fields.find((f) => f.id === id)?.name ?? id;
    return { champs, manquants, noms };
  } finally {
    await framer.disconnect().catch(() => undefined);
  }
}

/** Connexion au projet Framer, partagée avec les autres modules du blog. */
export async function connexionFramer() {
  return connexion();
}

async function connexion() {
  const apps = getOauthApps();
  if (!apps.framerProjectUrl || !apps.framerApiKey) {
    throw new Error('Framer non connecté — renseigne l’adresse du projet et la clé d’API dans Connexions & santé');
  }
  const { connect } = await import('framer-api');
  return connect(apps.framerProjectUrl, apps.framerApiKey);
}

/** Les collections du projet et leurs champs (pour choisir la collection du blog dans le dashboard). */
export async function listerCollections(): Promise<CollectionFramer[]> {
  const framer = await connexion();
  try {
    const collections = await framer.getCollections();
    const out: CollectionFramer[] = [];
    for (const c of collections) {
      const fields = await c.getFields();
      out.push({ id: c.id, name: c.name, fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type })) });
    }
    return out;
  } finally {
    await framer.disconnect().catch(() => undefined);
  }
}

export interface PublicationFramer {
  itemId: string | null;
  url: string | null;
  draft: boolean;
  /** champs qui avaient une valeur mais aucune colonne dans la collection (méta, JSON-LD…) */
  champsIgnores: string[];
  /** pages du site avec des modifications non publiées : l'article est déposé, le site n'a PAS été publié */
  pagesNonPubliees: string[];
}

/**
 * Publier le site publie tout : une page « Contact » en cours de refonte partirait
 * avec l'article. Les pages du blog lui-même ne comptent pas (c'est lui qui change).
 */
export function pagesQuiPartiraient(changes: readonly { path: string; status: string }[]): string[] {
  return changes.filter((c) => !/^\/blog(\/|$)/.test(c.path)).map((c) => `${c.path} (${c.status === 'added' ? 'ajoutée' : c.status === 'removed' ? 'supprimée' : 'modifiée'})`);
}

/**
 * Dépose l'article dans la collection, puis publie et déploie le site — sauf en
 * brouillon (l'article attend alors dans Framer). En mode dry, le payload part
 * dans var/outbox et rien ne touche Framer.
 */
export async function publierDansFramer(contenu: ContenuAPublier, reglages: BlogSettings, opts: { itemId?: string | null } = {}): Promise<PublicationFramer> {
  if (!reglages.collectionId) throw new Error('Aucune collection Framer choisie pour le blog (Réglages du blog)');
  if (config.PUBLISH_MODE === 'dry') {
    const file = path.join(config.outboxDir, `blog-${contenu.slug}-${Date.now()}.json`);
    fs.mkdirSync(config.outboxDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ collection: reglages.collectionId, fields: reglages.fields, itemId: opts.itemId ?? null, item: contenu }, null, 2));
    return { itemId: opts.itemId ?? `dry-${contenu.slug}`, url: `file://${file}`, draft: reglages.publishAsDraft, champsIgnores: [], pagesNonPubliees: [] };
  }
  const framer = await connexion();
  try {
    const collections = await framer.getCollections();
    const collection = collections.find((c) => c.id === reglages.collectionId);
    if (!collection) throw new Error(`Collection Framer ${reglages.collectionId} introuvable — rechoisis-la dans les réglages du blog`);
    const fields = (await collection.getFields()).map((f) => ({ id: f.id, name: f.name, type: f.type }));
    const champs = devinerChamps(fields, reglages.fields);
    if (!champs.title || !champs.body) {
      throw new Error('Impossible de reconnaître les champs « titre » et « corps » de la collection — règle la correspondance dans les réglages du blog');
    }
    const { data: fieldData, ignores } = fieldDataEtIgnores(contenu, champs, fields);
    if (ignores.length > 0) logger.warn({ slug: contenu.slug, ignores }, 'champs sans colonne Framer : ils ne partent pas sur le site');
    // Avec l'identifiant de l'item, Framer met à jour au lieu de créer : c'est ainsi
    // qu'un article déjà en ligne reçoit un texte, une méta ou un JSON-LD refaits.
    await collection.addItems([{ ...(opts.itemId ? { id: opts.itemId } : {}), slug: contenu.slug, draft: reglages.publishAsDraft, fieldData } as never]);
    const items = await collection.getItems();
    const item = items.find((i) => (opts.itemId ? i.id === opts.itemId : i.slug === contenu.slug)) ?? items.find((i) => i.slug === contenu.slug);
    let url: string | null = null;
    if (!reglages.publishAsDraft) {
      // Des retouches en cours ailleurs sur le site ? On ne publie pas par-dessus.
      let pagesNonPubliees: string[] = [];
      try {
        pagesNonPubliees = pagesQuiPartiraient((await framer.getUnpublishedPageChanges()).map((c) => ({ path: c.path, status: c.status })));
      } catch (err) {
        logger.warn({ err: String(err).slice(0, 200) }, 'modifications non publiées du site illisibles — publication comme avant');
      }
      if (pagesNonPubliees.length > 0) {
        logger.warn({ slug: contenu.slug, pages: pagesNonPubliees }, 'site non publié : des pages ont des modifications en attente dans Framer');
        return { itemId: item?.id ?? opts.itemId ?? null, url: null, draft: true, champsIgnores: ignores, pagesNonPubliees };
      }
      const result = await framer.publish();
      // L'API nomme l'hôte `hostname` (et non `name`) : lire le mauvais champ laissait
      // l'adresse vide sur tous les articles publiés. Sans domaine personnalisé, `deploy`
      // ne renvoie rien : l'adresse se déduit alors du site de la marque.
      type Hote = { hostname?: string; name?: string; isPrimary?: boolean; type?: string };
      const hosts = (await framer.deploy(result.deployment.id)) as Hote[];
      const nomDe = (h: Hote | undefined) => String(h?.hostname ?? h?.name ?? '');
      const host =
        hosts.find((h) => h.isPrimary && !/framer\.(app|website)$/.test(nomDe(h))) ??
        hosts.find((h) => !/framer\.(app|website)$/.test(nomDe(h))) ??
        hosts[0];
      const nom = nomDe(host);
      url = nom ? `https://${nom}/blog/${contenu.slug}` : `${(getBrand().siteUrl || 'https://odileai.com').replace(/\/$/, '')}/blog/${contenu.slug}`;
      logger.info({ slug: contenu.slug, host: nom || 'site de la marque', url }, 'article publié et site déployé');
    } else {
      logger.info({ slug: contenu.slug }, 'article déposé en brouillon dans Framer');
    }
    return { itemId: item?.id ?? opts.itemId ?? null, url, draft: reglages.publishAsDraft, champsIgnores: ignores, pagesNonPubliees: [] };
  } finally {
    await framer.disconnect().catch(() => undefined);
  }
}
