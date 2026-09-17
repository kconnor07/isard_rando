/**
 * Refaire les couvertures d'articles déjà en ligne.
 *
 * Changer le format ou la mise en page des couvertures ne vaut que si les
 * articles déjà publiés en profitent : sinon le blog affiche deux générations
 * d'images côte à côte. Ce module refabrique les images, remplace CELLES-LÀ dans
 * la collection Framer — et rien d'autre : le texte, le titre, la date, le slug
 * et l'adresse de l'article ne bougent pas — puis déploie le site une seule fois.
 *
 * Deux périmètres :
 * — les articles écrits par le moteur (on connaît leur titre de couverture) ;
 * — sur demande, les autres items de la collection, écrits à la main dans Framer :
 *   leur titre sert alors de titre de couverture. À n'activer qu'en connaissance
 *   de cause : une illustration choisie exprès serait remplacée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { articleSchema, type BlogSettings } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBlog } from '../db/settingsRepo.js';
import { logger } from '../lib/logger.js';
import { fabriquerCouverture } from './cover.js';
import { connexionFramer, devinerChamps, type ChampFramer } from './framer.js';
import { coverUrl } from './pipeline.js';

export interface ResumeCouvertures {
  /** couvertures refabriquées (tous articles du moteur, publiés ou non) */
  refaites: number;
  /** articles dont l'image a été remplacée dans la collection Framer */
  misAJour: number;
  /** items de la collection écrits à la main, ré-illustrés sur demande */
  horsMoteur: number;
  ignores: { quoi: string; raison: string }[];
  deploye: boolean;
}

type ArticleRow = typeof schema.articles.$inferSelect;

/** Titre à imprimer sur la couverture d'un article du moteur. */
function titreDeCouverture(a: ArticleRow): { title: string; accentWord: string } {
  const contenu = articleSchema.partial().safeParse(JSON.parse(a.content || '{}'));
  return {
    title: (contenu.success ? contenu.data.coverTitle : null) || a.title,
    accentWord: (contenu.success ? contenu.data.coverAccentWord : '') ?? '',
  };
}

/** Champ image de la collection, ou l'explication de ce qui manque. */
function champImage(fields: ChampFramer[], reglages: BlogSettings): string {
  const champs = devinerChamps(fields, reglages.fields);
  if (!champs.cover) {
    throw new Error(
      'Aucun champ image reconnu dans la collection Framer — règle la correspondance des champs dans les réglages du blog, puis relance.',
    );
  }
  return champs.cover;
}

/**
 * Refait les couvertures et les remplace en ligne.
 *
 * `itemsHorsMoteur` étend l'opération aux articles écrits directement dans Framer.
 */
export async function refaireLesCouvertures(opts: { itemsHorsMoteur?: boolean } = {}): Promise<ResumeCouvertures> {
  const reglages = getBlog();
  const resume: ResumeCouvertures = { refaites: 0, misAJour: 0, horsMoteur: 0, ignores: [], deploye: false };
  const articles = db.select().from(schema.articles).orderBy(desc(schema.articles.id)).all();

  // 1. Refabrication locale : tous les articles du moteur, publiés ou non.
  const nouvelles = new Map<number, string>();
  for (const a of articles) {
    if (!a.title && !a.brief) continue;
    try {
      const { title, accentWord } = titreDeCouverture(a);
      const assetId = await fabriquerCouverture({ title, accentWord, kicker: reglages.ville, articleId: a.id, reglages });
      db.update(schema.articles).set({ coverAssetId: assetId, updatedAt: new Date().toISOString() }).where(eq(schema.articles.id, a.id)).run();
      nouvelles.set(a.id, assetId);
      resume.refaites++;
    } catch (err) {
      resume.ignores.push({ quoi: a.slug || `article #${a.id}`, raison: err instanceof Error ? err.message : String(err) });
    }
  }

  const enLigne = articles.filter((a) => a.status === 'published' && nouvelles.has(a.id));
  if (config.PUBLISH_MODE === 'dry') {
    const fichier = path.join(config.outboxDir, `blog-couvertures-${Date.now()}.json`);
    fs.mkdirSync(config.outboxDir, { recursive: true });
    fs.writeFileSync(
      fichier,
      JSON.stringify(
        {
          format: reglages.coverRatio,
          articles: enLigne.map((a) => ({ slug: a.slug, itemId: a.framerItemId, cover: coverUrl(nouvelles.get(a.id) ?? null) })),
        },
        null,
        2,
      ),
    );
    logger.info({ fichier, articles: enLigne.length }, 'couvertures refaites (simulation — rien n’est parti chez Framer)');
    return resume;
  }
  if (enLigne.length === 0 && !opts.itemsHorsMoteur) return resume;
  if (!reglages.collectionId) throw new Error('Aucune collection Framer choisie pour le blog (Réglages du blog)');

  // 2. Remplacement dans la collection : uniquement le champ image.
  const framer = await connexionFramer();
  try {
    const collections = await framer.getCollections();
    const collection = collections.find((c) => c.id === reglages.collectionId);
    if (!collection) throw new Error(`Collection Framer ${reglages.collectionId} introuvable — rechoisis-la dans les réglages du blog`);
    const fields = (await collection.getFields()).map((f) => ({ id: f.id, name: f.name, type: f.type }));
    const cover = champImage(fields, reglages);
    const champs = devinerChamps(fields, reglages.fields);
    const items = await collection.getItems();

    const traites = new Set<string>();
    for (const a of enLigne) {
      const item = items.find((i) => i.id === a.framerItemId) ?? items.find((i) => i.slug === a.slug);
      if (!item) {
        resume.ignores.push({ quoi: a.slug || `article #${a.id}`, raison: 'introuvable dans la collection Framer' });
        continue;
      }
      const url = coverUrl(nouvelles.get(a.id) ?? null);
      if (!url) continue;
      await item.setAttributes({ fieldData: { [cover]: { type: 'image', value: url, alt: a.title } } } as never);
      traites.add(item.id);
      resume.misAJour++;
    }

    // 3. Sur demande : les articles écrits à la main, dont le titre sert de couverture.
    if (opts.itemsHorsMoteur) {
      for (const item of items) {
        if (traites.has(item.id)) continue;
        const titre = champs.title ? String((item.fieldData[champs.title] as { value?: unknown } | undefined)?.value ?? '') : '';
        if (!titre.trim()) {
          resume.ignores.push({ quoi: item.slug, raison: 'aucun titre lisible dans la collection' });
          continue;
        }
        const assetId = await fabriquerCouverture({ title: titre, accentWord: '', kicker: reglages.ville, articleId: 0, reglages });
        const url = coverUrl(assetId);
        if (!url) continue;
        await item.setAttributes({ fieldData: { [cover]: { type: 'image', value: url, alt: titre } } } as never);
        resume.horsMoteur++;
      }
    }

    // 4. Un seul déploiement pour tout le lot.
    if (resume.misAJour + resume.horsMoteur > 0) {
      const publication = await framer.publish();
      await framer.deploy(publication.deployment.id);
      resume.deploye = true;
    }
    logger.info(
      { refaites: resume.refaites, misAJour: resume.misAJour, horsMoteur: resume.horsMoteur, format: reglages.coverRatio },
      'couvertures remplacées sur le site',
    );
    return resume;
  } finally {
    await framer.disconnect().catch(() => undefined);
  }
}
