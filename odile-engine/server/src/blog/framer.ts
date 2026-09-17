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
  const typeDe = (id: string) => fields.find((f) => f.id === id)?.type ?? 'string';
  const data: Record<string, EntreeChamp> = {};
  const pose = (id: string, valeur: unknown, extra: Partial<EntreeChamp> = {}) => {
    if (!id || valeur === null || valeur === undefined || valeur === '') return;
    data[id] = { type: typeDe(id), value: valeur, ...extra };
  };
  pose(champs.title, contenu.title);
  pose(champs.body, contenu.bodyHtml, { contentType: 'html' });
  pose(champs.excerpt, contenu.excerpt);
  pose(champs.cover, contenu.coverUrl, { alt: contenu.coverAlt });
  pose(champs.date, contenu.date);
  pose(champs.metaTitle, contenu.metaTitle);
  pose(champs.metaDescription, contenu.metaDescription);
  pose(champs.keywords, contenu.keywords.join(', '));
  pose(champs.jsonLd, contenu.jsonLd, typeDe(champs.jsonLd) === 'formattedText' ? { contentType: 'html' } : {});
  pose(champs.author, contenu.author);
  return data;
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
}

/**
 * Dépose l'article dans la collection, puis publie et déploie le site — sauf en
 * brouillon (l'article attend alors dans Framer). En mode dry, le payload part
 * dans var/outbox et rien ne touche Framer.
 */
export async function publierDansFramer(contenu: ContenuAPublier, reglages: BlogSettings): Promise<PublicationFramer> {
  if (!reglages.collectionId) throw new Error('Aucune collection Framer choisie pour le blog (Réglages du blog)');
  if (config.PUBLISH_MODE === 'dry') {
    const file = path.join(config.outboxDir, `blog-${contenu.slug}-${Date.now()}.json`);
    fs.mkdirSync(config.outboxDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ collection: reglages.collectionId, fields: reglages.fields, item: contenu }, null, 2));
    return { itemId: `dry-${contenu.slug}`, url: `file://${file}`, draft: reglages.publishAsDraft };
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
    const fieldData = fieldDataPour(contenu, champs, fields);
    await collection.addItems([{ slug: contenu.slug, draft: reglages.publishAsDraft, fieldData } as never]);
    const items = await collection.getItems();
    const item = items.find((i) => i.slug === contenu.slug);
    let url: string | null = null;
    if (!reglages.publishAsDraft) {
      const result = await framer.publish();
      const hosts = await framer.deploy(result.deployment.id);
      const host = hosts.find((h) => !/framer\.app$/.test(String((h as { name?: string }).name ?? ''))) ?? hosts[0];
      const nom = host ? String((host as { name?: string }).name ?? '') : '';
      if (nom) url = `https://${nom}/blog/${contenu.slug}`;
      logger.info({ slug: contenu.slug, host: nom }, 'article publié et site déployé');
    } else {
      logger.info({ slug: contenu.slug }, 'article déposé en brouillon dans Framer');
    }
    return { itemId: item?.id ?? null, url, draft: reglages.publishAsDraft };
  } finally {
    await framer.disconnect().catch(() => undefined);
  }
}
