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
import { desc, eq } from 'drizzle-orm';
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
}

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

/** Choisit le sujet du prochain article : une actualité shortlistée, sinon une intention locale à tour de rôle. */
export function choisirSujet(reglages: BlogSettings, newsItemId?: number): SujetArticle {
  const news = newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsItemId)).get()
    : db
        .select()
        .from(schema.newsItems)
        .where(eq(schema.newsItems.status, 'shortlisted'))
        .orderBy(desc(schema.newsItems.scoreFinal))
        .limit(1)
        .get();
  const nb = db.select({ id: schema.articles.id }).from(schema.articles).all().length;
  // Une fois sur deux, l'article part d'une intention locale plutôt que de l'actualité :
  // c'est ce qui construit le référencement de fond, l'actualité apporte la fraîcheur.
  if (news && nb % 2 === 0) {
    return {
      brief: `Transposer cette actualité pour les entreprises de ${reglages.ville} : ${news.title}`,
      newsItemId: news.id,
      matiere: [news.title, news.summary ?? '', news.contentText?.slice(0, 3000) ?? '', `Source : ${news.url}`].filter(Boolean).join('\n\n'),
    };
  }
  const zone = reglages.zones[1 % Math.max(1, reglages.zones.length)] ?? reglages.ville;
  const intention = INTENTIONS_LOCALES[nb % INTENTIONS_LOCALES.length]!.replaceAll('{ville}', reglages.ville).replaceAll('{zone}', zone);
  return { brief: intention, newsItemId: null, matiere: '' };
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
${sujet.matiere ? `\nMATIÈRE PREMIÈRE (à transposer, jamais à recopier) :\n"""\n${sujet.matiere.slice(0, 3500)}\n"""` : ''}

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
- Chaque affirmation chiffrée est attribuée (« selon … »). Sources : 2 à 6 références fiables et récentes
  (études, organismes publics, éditeurs, presse économique) avec leur URL exacte — jamais d'URL inventée :
  en cas de doute sur l'adresse exacte, cite le titre sans URL dans le texte et n'ajoute pas la source.
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
