/**
 * Rédaction d'un article de blog pour le site — référencement local (Toulouse) et
 * moteurs génératifs.
 *
 * Ce que les bonnes pratiques du marché demandent, et que le prompt impose :
 *   SEO — une intention de recherche par article, mot-clé principal dans le titre,
 *   la balise title (≤ 60), la méta-description (≤ 155), le H1 et le premier
 *   paragraphe ; hiérarchie H2/H3 lisible ; 1 200 à 1 800 mots ; paragraphes
 *   courts ; maillage interne vers les pages du site ; sources externes fiables ;
 *   slug court ; ancrage local naturel (ville, zones, tissu économique).
 *   GEO — une réponse directe en tête (« En bref »), des chiffres sourcés, des
 *   définitions nettes, des listes structurées, une FAQ formulée comme on parle
 *   à un assistant, des entités nommées, un auteur identifié, des données
 *   structurées (JSON-LD : Article + FAQPage + Organisation locale).
 */
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { articleSchema, type Article, type BlogSettings } from '@odile/shared';
import { db, schema } from '../db/client.js';
import { getBrand } from '../db/settingsRepo.js';
import { BudgetDepasseError, verifierBudget } from '../lib/llmBudget.js';
import { completeJson } from '../llm/router.js';
import { escapeHtml } from '../render/renderer.js';

export interface SujetArticle {
  /** ce dont l'article parle, en une phrase */
  brief: string;
  /** actualité de départ, s'il y en a une */
  newsItemId: number | null;
  matiere: string;
  /** les actualités du dossier de veille qui nourrissent l'article (traçabilité) */
  dossier: { id: number; titre: string; url: string }[];
}

type NewsRow = typeof schema.newsItems.$inferSelect;

/** Fenêtre de veille exploitable par un article : au-delà, ce n'est plus de l'actualité. */
const FENETRE_VEILLE_JOURS = 21;
/** Nombre d'actualités réunies pour nourrir un article. */
const TAILLE_DOSSIER = 5;

/**
 * Intentions de recherche locales, à faire tourner quand aucune actualité ne
 * s'impose : ce que tape un dirigeant toulousain qui cherche de l'aide.
 */
export const INTENTIONS_LOCALES = [
  'automatisation IA pour PME à {ville} : par où commencer',
  'agence IA à {ville} : comment choisir, combien ça coûte',
  'automatiser ses devis et relances quand on est artisan à {ville}',
  'assistant IA pour répondre aux clients d’un commerce de {ville}',
  'cabinet comptable ou juridique à {ville} : quelles tâches confier à l’IA',
  'RGPD et IA dans une PME de {ville} : ce qu’il faut vérifier',
  'n8n, Make ou Zapier pour une PME : lequel choisir en {zone}',
  'combien de temps une PME de {ville} gagne réellement avec l’automatisation',
  'IA et recrutement dans les PME de {zone} : trier sans discriminer',
  'automatiser la facturation et le suivi de trésorerie d’une TPE à {ville}',
  'les aides et dispositifs pour digitaliser une PME en {zone}',
  'cas concrets : ce que les PME de {ville} automatisent en premier',
];

/** Titres déjà publiés : le rédacteur ne doit pas les cannibaliser. */
function titresRecents(): string[] {
  return db
    .select({ title: schema.articles.title })
    .from(schema.articles)
    .orderBy(desc(schema.articles.id))
    .limit(25)
    .all()
    .map((a) => a.title)
    .filter(Boolean);
}

/** Les sujets d'une actualité, tels que le rescoring les a posés. */
function sujetsDe(item: Pick<NewsRow, 'topics'>): string[] {
  if (!item.topics) return [];
  try {
    const brut = JSON.parse(item.topics) as unknown;
    return Array.isArray(brut) ? brut.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Nom lisible de la source d'une actualité (« Les Échos »), vide si inconnue. */
function nomDeLaSource(item: NewsRow): string {
  if (!item.sourceId) return '';
  return (
    db.select({ name: schema.newsSources.name }).from(schema.newsSources).where(eq(schema.newsSources.id, item.sourceId)).get()?.name ?? ''
  );
}

/**
 * Le dossier de veille qui nourrit un article.
 *
 * Un article de blog vaut par ce qu'il apporte de vérifiable : des faits récents,
 * datés, sourcés. Plutôt qu'une seule actualité, on réunit les meilleures des trois
 * dernières semaines, en tête celles qui partagent les sujets de l'article. Leurs URL
 * sont réelles — ce sont les seules que le rédacteur a le droit de citer, ce qui règle
 * du même coup le problème des adresses inventées.
 */
export function dossierDeVeille(principal: NewsRow | null, taille = TAILLE_DOSSIER): NewsRow[] {
  const depuis = new Date(Date.now() - FENETRE_VEILLE_JOURS * 86400000).toISOString();
  const candidats = db
    .select()
    .from(schema.newsItems)
    .where(
      and(
        gte(schema.newsItems.fetchedAt, depuis),
        ne(schema.newsItems.status, 'discarded'),
        principal ? ne(schema.newsItems.id, principal.id) : undefined,
      ),
    )
    .orderBy(desc(schema.newsItems.scoreFinal), desc(schema.newsItems.scoreTotal))
    .limit(60)
    .all();

  // Les actualités qui partagent les sujets de l'article passent devant : un dossier
  // cohérent fait un article qui creuse, une pile d'actus sans lien fait une revue de presse.
  const sujetsPrincipaux = new Set(principal ? sujetsDe(principal) : []);
  const proximite = (item: NewsRow) => sujetsDe(item).filter((t) => sujetsPrincipaux.has(t)).length;
  const note = (item: NewsRow) => item.scoreFinal ?? item.scoreTotal ?? 0;
  const tries = sujetsPrincipaux.size
    ? candidats.slice().sort((a, b) => proximite(b) - proximite(a) || note(b) - note(a))
    : candidats;
  return [...(principal ? [principal] : []), ...tries].slice(0, taille);
}

/** Le dossier mis en forme pour le rédacteur : chaque pièce datée, sourcée, avec son extrait. */
function matiereDuDossier(dossier: NewsRow[]): string {
  return dossier
    .map((item, i) => {
      const source = nomDeLaSource(item);
      const date = (item.publishedAt ?? item.fetchedAt).slice(0, 10);
      const extrait = (item.contentText ?? item.summary ?? '').slice(0, i === 0 ? 3000 : 1200).trim();
      const entete = `[${i + 1}] ${item.title}${source ? ` — ${source}` : ''} (${date})`;
      return [entete, `URL : ${item.url}`, extrait ? ['"""', extrait, '"""'].join('\n') : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

/**
 * Choisit le sujet du prochain article.
 *
 * L'angle alterne : une actualité transposée pour la fraîcheur, une intention de
 * recherche locale pour le référencement de fond. Dans les deux cas, l'article est
 * nourri par le dossier de veille — c'est ce qui le rend daté, sourcé et citable.
 */
export function choisirSujet(reglages: BlogSettings, newsItemId?: number): SujetArticle {
  const principal =
    (newsItemId
      ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsItemId)).get()
      : db
          .select()
          .from(schema.newsItems)
          .where(eq(schema.newsItems.status, 'shortlisted'))
          .orderBy(desc(schema.newsItems.scoreFinal))
          .limit(1)
          .get()) ?? null;
  const nb = db.select({ id: schema.articles.id }).from(schema.articles).all().length;
  // Une actualité imposée à la main est toujours l'angle ; sinon on alterne.
  const partDeLActu = Boolean(principal) && (Boolean(newsItemId) || nb % 2 === 0);
  const dossier = dossierDeVeille(partDeLActu ? principal : null);
  const matiere = matiereDuDossier(dossier);
  const trace = dossier.map((d) => ({ id: d.id, titre: d.title, url: d.url }));

  if (partDeLActu && principal) {
    return {
      brief: `Transposer cette actualité pour les entreprises de ${reglages.ville} : ${principal.title}`,
      newsItemId: principal.id,
      matiere,
      dossier: trace,
    };
  }
  const zone = reglages.zones[1 % Math.max(1, reglages.zones.length)] ?? reglages.ville;
  const intention = INTENTIONS_LOCALES[nb % INTENTIONS_LOCALES.length]!.replaceAll('{ville}', reglages.ville).replaceAll('{zone}', zone);
  return { brief: intention, newsItemId: null, matiere, dossier: trace };
}

/**
 * Reconstruit le sujet d'un article existant : même brief, même actualité de départ,
 * mais dossier de veille rafraîchi — régénérer un article doit profiter de ce que le
 * moteur a collecté depuis.
 */
export function sujetDepuisArticle(row: { brief: string; newsItemId: number | null }): SujetArticle {
  const principal = row.newsItemId
    ? (db.select().from(schema.newsItems).where(eq(schema.newsItems.id, row.newsItemId)).get() ?? null)
    : null;
  const dossier = dossierDeVeille(principal);
  return {
    brief: row.brief,
    newsItemId: row.newsItemId,
    matiere: matiereDuDossier(dossier),
    dossier: dossier.map((d) => ({ id: d.id, titre: d.title, url: d.url })),
  };
}

/** Rédige l'article structuré. */
export async function redigerArticle(sujet: SujetArticle, reglages: BlogSettings): Promise<Article> {
  const verdict = verifierBudget('writing');
  if (!verdict.autorise) throw new BudgetDepasseError(verdict);
  const brand = getBrand();
  const site = brand.siteUrl || 'https://odileai.com';
  const pages = reglages.sitePages.length
    ? reglages.sitePages.map((p) => `- ${p.label} → ${p.path}`).join('\n')
    : '- Accueil → /\n- Contact → /contact';
  const dejaPublies = titresRecents();

  const prompt = `Tu rédiges un article de blog pour le site de ${brand.name} (${site}), agence d'automatisation IA
pour PME et TPE installée à ${reglages.ville}. Auteur affiché : ${reglages.authorName}.

SUJET : ${sujet.brief}
${
  sujet.matiere
    ? `
DOSSIER DE VEILLE — ce que le moteur a collecté ces trois dernières semaines. C'est ta matière première :
des faits récents, datés, attribuables. Tu t'en sers pour ancrer l'article dans l'actualité (« depuis … »,
« selon … »), jamais pour recopier une phrase. Toutes les pièces ne servent pas : garde celles qui éclairent
le sujet, ignore les autres. LES URL CI-DESSOUS SONT RÉELLES ET VÉRIFIÉES — ce sont les seules que tu peux
citer avec leur adresse exacte dans "sources".

${sujet.matiere.slice(0, 9000)}
`
    : ''
}

LECTEURS : ${reglages.cibles.join(', ')} — des dirigeants pressés, pas des techniciens.
ANCRAGE LOCAL : ${reglages.ville} et ses alentours (${reglages.zones.join(', ')}). L'ancrage doit être
naturel et utile — tissu économique local, exemples types d'entreprises d'ici, réalités du terrain —
jamais du bourrage de mots-clés, jamais de faux clients ni de faux chiffres locaux.
${dejaPublies.length ? `\nARTICLES DÉJÀ PUBLIÉS (ne pas refaire le même, ne pas cannibaliser) :\n${dejaPublies.map((t) => `- ${t}`).join('\n')}` : ''}

RÉFÉRENCEMENT NATUREL (SEO) — règles impératives :
- UNE intention de recherche par article ; le mot-clé principal figure dans title, metaTitle (≤ 60 caractères),
  metaDescription (120-155 caractères, incitative, avec la ville), le H1 et le premier paragraphe.
- 1 200 à 1 800 mots au total. Paragraphes de 2 à 4 phrases. Phrases courtes. Aucun jargon non expliqué.
- Hiérarchie : 4 à 7 H2 qui répondent chacun à une sous-question, des H3 quand un H2 se subdivise.
- Des listes quand il y a une énumération, des ordres de grandeur réalistes (fourchettes, pas de chiffres inventés
  présentés comme des faits — quand tu cites un chiffre précis, il vient d'une source que tu listes).
- Maillage interne : 2 à 4 liens vers ces pages du site, choisis quand ils servent le lecteur :
${pages}
- slug court (3 à 6 mots, sans accent, tirets).

MOTEURS GÉNÉRATIFS (GEO — ChatGPT, Perplexity, Google AI Overviews, Claude) — règles impératives :
- keyTakeaways : 3 à 6 phrases autonomes qui répondent directement à la question, citables telles quelles.
- Définis les notions clés en une phrase nette, une fois. Nomme les entités (outils, organismes, lieux, ${brand.name}).
- Chaque affirmation chiffrée est attribuée (« selon … »). Sources : 2 à 6 références fiables et récentes,
  prises EN PRIORITÉ dans le dossier de veille ci-dessus (leurs URL sont vérifiées). Toute autre source ne
  s'ajoute que si tu es certain de son adresse exacte — jamais d'URL inventée : dans le doute, cite le titre
  dans le texte sans ajouter la source.
- FAQ : 3 à 7 questions formulées comme on les pose à un assistant (« Combien coûte… ? », « Est-ce que… ? »),
  réponses complètes en 2 à 5 phrases, qui se suffisent à elles-mêmes.
- Dernière section : ce que ${brand.name} fait concrètement pour ce type d'entreprise, sans discours commercial creux —
  un diagnostic gratuit, des exemples de ce qui se met en place, un lien interne vers le contact.

COUVERTURE : coverTitle = un titre court et frappant (≤ 8 mots) pour l'image de couverture, coverAccentWord = LE mot fort de ce titre.

Tout en français. Vouvoiement. Ton d'agence qui explique simplement et prouve. Zéro emoji.`;

  const { value } = await completeJson({ task: 'writing', tier: 'best', prompt, maxTokens: 12000 }, articleSchema, { attempts: 2 });
  return value;
}

/** Le corps de l'article en HTML propre, tel que Framer l'attend dans un champ « texte formaté ». */
export function articleHtml(article: Article, siteUrl: string): string {
  const abs = (path: string) => (path.startsWith('http') ? path : `${siteUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`);
  const lienInterne = (texte: string) => {
    // Les liens internes proposés sont posés en fin de l'intro, sous forme de liste discrète.
    return texte;
  };
  const parts: string[] = [];
  parts.push(`<p><strong>En bref</strong></p><ul>${article.keyTakeaways.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ul>`);
  for (const s of article.sections) {
    parts.push(`<h2>${escapeHtml(s.h2)}</h2>`);
    for (const p of s.paragraphs) parts.push(`<p>${escapeHtml(lienInterne(p))}</p>`);
    if (s.bullets.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
    for (const h of s.h3s) {
      parts.push(`<h3>${escapeHtml(h.h3)}</h3>`);
      for (const p of h.paragraphs) parts.push(`<p>${escapeHtml(p)}</p>`);
    }
  }
  if (article.internalLinks.length) {
    parts.push(`<p><strong>Pour aller plus loin</strong></p><ul>${article.internalLinks
      .map((l) => `<li><a href="${escapeHtml(abs(l.path))}">${escapeHtml(l.label)}</a></li>`)
      .join('')}</ul>`);
  }
  parts.push(`<h2>Questions fréquentes</h2>`);
  for (const f of article.faq) parts.push(`<h3>${escapeHtml(f.question)}</h3><p>${escapeHtml(f.answer)}</p>`);
  if (article.sources.length) {
    parts.push(`<h2>Sources</h2><ul>${article.sources
      .map((src) => `<li><a href="${escapeHtml(src.url)}" rel="noopener nofollow" target="_blank">${escapeHtml(src.title)}</a></li>`)
      .join('')}</ul>`);
  }
  return parts.join('\n');
}

/** Données structurées : Article + FAQPage + l'organisation locale. À injecter sur la page par le site. */
export function articleJsonLd(article: Article, args: { url: string; siteUrl: string; brand: string; author: string; ville: string; datePublished: string; coverUrl: string | null; logoUrl: string | null }): string {
  const org = {
    '@type': 'Organization',
    '@id': `${args.siteUrl.replace(/\/$/, '')}/#organization`,
    name: args.brand,
    url: args.siteUrl,
    ...(args.logoUrl ? { logo: { '@type': 'ImageObject', url: args.logoUrl } } : {}),
    address: { '@type': 'PostalAddress', addressLocality: args.ville, addressCountry: 'FR' },
    areaServed: args.ville,
  };
  const graph = [
    org,
    {
      '@type': 'Article',
      '@id': `${args.url}#article`,
      headline: article.title,
      description: article.metaDescription,
      inLanguage: 'fr-FR',
      datePublished: args.datePublished,
      dateModified: args.datePublished,
      author: { '@type': 'Person', name: args.author, worksFor: { '@id': org['@id'] } },
      publisher: { '@id': org['@id'] },
      mainEntityOfPage: { '@type': 'WebPage', '@id': args.url },
      keywords: article.keywords.join(', '),
      about: [{ '@type': 'Place', name: args.ville }],
      ...(args.coverUrl ? { image: [args.coverUrl] } : {}),
    },
    {
      '@type': 'FAQPage',
      '@id': `${args.url}#faq`,
      mainEntity: article.faq.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    },
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

/** Un slug unique : le sien, sinon suffixé. */
export function slugDisponible(souhaite: string, saufId?: number): string {
  const base = souhaite
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
  const existants = new Set(
    db
      .select({ slug: schema.articles.slug, id: schema.articles.id })
      .from(schema.articles)
      .all()
      .filter((a) => a.id !== saufId)
      .map((a) => a.slug),
  );
  if (!existants.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!existants.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}
