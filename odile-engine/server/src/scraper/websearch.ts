import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { extractJson } from '../llm/provider.js';
import { BudgetDepasseError, enregistrerUsage, verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { canonicalizeUrl, contentHash } from './dedupe.js';

interface HarvestSpec {
  sourceName: string;
  weight: number;
  /** langue d'origine du contenu trouvé (le writer transpose l'anglais) */
  lang: 'fr' | 'en';
  prompt: string;
}

const GENERAL_HARVEST: HarvestSpec = {
  sourceName: 'Recherche web IA',
  weight: 1.2,
  lang: 'fr',
  prompt: `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
Odile ne fait pas de posts « actu outil » : elle raconte des bénéfices, des capacités et des
résultats d'entreprises. Cherche sur le web (dernières 24-48 h) sur TROIS axes :
1. CAS D'ENTREPRISES : des entreprises (PME de préférence, US ou FR) qui ont mis en place de
   l'IA/automatisation avec des RÉSULTATS MESURÉS (temps gagné, CA, conversion, coûts) —
   études de cas, retours d'expérience, interviews.
2. CONTENU SOCIAL US QUI PERFORME : threads X/Twitter ou vidéos qui buzzent en ce moment sur
   l'IA appliquée au business — la preuve sociale est faite, on l'adaptera au public français.
   Donne l'URL du contenu original.
3. DONNÉES ET ÉTUDES : statistiques récentes d'adoption de l'IA par les PME, benchmarks,
   rapports chiffrés exploitables dans un post.
Ignore : annonces produit sans application concrète, levées de fonds, recherche fondamentale,
géopolitique.

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 3 à 6 items —
"title" en français, "url" = la source précise (pas une home page), "summary" = 2 phrases
factuelles écrites par toi (avec les chiffres clés), "why" = pourquoi ça fera un bon post PME France.`,
};

const LINKEDIN_HARVEST: HarvestSpec = {
  sourceName: 'LinkedIn US (posts viraux)',
  weight: 1.3,
  lang: 'en',
  prompt: `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
Objectif : RECYCLER des posts LinkedIn anglophones qui ont déjà prouvé leur performance,
en les réécrivant plus tard en français (angle et structure repris, contenu 100 % original).

Cherche sur le web des posts LinkedIn EN ANGLAIS des 7 derniers jours à TRÈS FORT engagement
(milliers de réactions, centaines de commentaires ou largement repris ailleurs) sur : l'IA
appliquée au business, l'automatisation pour les petites entreprises, des résultats chiffrés
obtenus avec l'IA, des méthodes/process concrets. Les grands créateurs du sujet (par exemple
Allie K. Miller, Zain Kahn, Ruben Hassid, Greg Isenberg…) sont de bons points de départ,
mais tout post qui performe compte.

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 2 à 5 items —
"title" en français (l'idée du post), "url" = l'URL du post LinkedIn (linkedin.com/posts/…) ou
de l'article qui le reprend, "summary" = le contenu détaillé du post : son message, ses points
clés et TOUS ses chiffres (c'est la matière première de notre réécriture), "why" = ce qui a
fait marcher ce post (le hook, la structure, l'émotion) et l'engagement constaté.`,
};

const LINKEDIN_FR_HARVEST: HarvestSpec = {
  sourceName: 'LinkedIn FR (posts qui performent)',
  weight: 1.3,
  lang: 'fr',
  prompt: `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
LinkedIn n'offre aucune API de lecture des posts : c'est toi qui cherches sur le web.

Cherche des posts LinkedIn EN FRANÇAIS des 7 derniers jours à fort engagement (centaines de
réactions ou plus, nombreux commentaires, repris ailleurs) sur : l'IA et l'automatisation dans
les PME/TPE françaises, des dirigeants qui racontent ce qu'ils ont mis en place et ce que ça a
donné, des méthodes concrètes, des chiffres. Les créateurs francophones du sujet sont de bons
points de départ, mais tout post qui performe compte — et les auteurs ou entreprises de
notoriété sont à nommer précisément (on pourra les identifier dans nos posts).

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 2 à 5 items —
"title" = l'idée du post, "url" = l'URL du post (linkedin.com/posts/…) ou de l'article qui le
reprend, "summary" = le contenu détaillé du post avec son auteur ou son entreprise et TOUS ses
chiffres, "why" = ce qui a fait marcher ce post (hook, structure, émotion) et l'engagement constaté.`,
};

const YOUTUBE_HARVEST: HarvestSpec = {
  sourceName: 'YouTube (vidéos du moment)',
  weight: 1.1,
  lang: 'fr',
  prompt: `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
Au-delà des chaînes que nous suivons déjà par flux, cherche sur le web les vidéos YouTube des
7 derniers jours (français ou anglais) qui font le plus de vues sur : l'IA appliquée au business,
l'automatisation pour les petites entreprises, des démonstrations concrètes (un process automatisé
de bout en bout, un cas client chiffré), des tutoriels qu'un dirigeant peut suivre.
Ignore : actus produit sans application, débats généraux, vidéos de plus de 7 jours.

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 2 à 5 items —
"title" en français, "url" = l'URL de la vidéo (youtube.com/watch?v=…), "summary" = ce que
montre la vidéo, ses étapes et ses chiffres, avec le nom de la chaîne, "why" = pourquoi ça fera
un bon post pour une PME française.`,
};

const SKILLS_HARVEST: HarvestSpec = {
  sourceName: 'Compétences & skills IA',
  weight: 1.2,
  lang: 'fr',
  prompt: `Nous alimentons la veille d'Odile AI, agence française d'automatisation IA pour PME/TPE.
Axe « compétences » : ce qu'un dirigeant, une équipe ou un agent IA doit savoir faire demain.
Cherche sur le web (14 derniers jours) : les nouvelles capacités des assistants et agents IA
(skills, connecteurs MCP, actions, modèles de workflows n8n/Make/Zapier) qui changent quelque
chose pour une petite entreprise ; les compétences humaines qui montent (prompting métier,
supervision d'agents, données propres) avec des études ou des offres d'emploi qui les citent ;
des formations ou guides concrets. Toujours avec l'angle « voilà ce que ça permet de faire lundi
matin », jamais l'annonce pour elle-même.

Renvoie UNIQUEMENT un objet JSON : {"items":[{"title","url","summary","why"}]} avec 2 à 5 items —
"title" en français (la compétence ou la capacité, formulée comme un bénéfice), "url" = la
source précise, "summary" = ce que c'est, ce que ça permet, les chiffres s'il y en a, "why" =
pourquoi une PME française devrait s'y intéresser maintenant.`,
};

/**
 * Les axes élargis tournent : un seul par jour (LinkedIn FR, puis YouTube, puis
 * compétences), pour couvrir les trois en trois jours sans tripler la dépense —
 * chaque récolte est un appel avec recherches web. Chacun est désactivable depuis
 * le dashboard (sa source « websearch » porte le réglage).
 */
export function axeElargiDuJour(now = new Date()): HarvestSpec {
  const axes = [LINKEDIN_FR_HARVEST, YOUTUBE_HARVEST, SKILLS_HARVEST];
  const jour = Math.floor(now.getTime() / 86400000);
  return axes[jour % axes.length]!;
}

const resultSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(5).max(200),
        url: z.string().url(),
        summary: z.string().max(700),
        why: z.string().max(300),
      }),
    )
    .max(6),
});

export interface WebsearchSummary {
  skipped?: string;
  found: number;
  inserted: number;
}

function getHarvestSource(spec: HarvestSpec) {
  let source = db
    .select()
    .from(schema.newsSources)
    .where(eq(schema.newsSources.name, spec.sourceName))
    .get();
  if (!source) {
    source = db
      .insert(schema.newsSources)
      .values({ name: spec.sourceName, kind: 'websearch', url: 'internal:websearch', lang: spec.lang, weight: spec.weight })
      .returning()
      .get();
  }
  return source;
}

async function harvest(client: Anthropic, spec: HarvestSpec): Promise<WebsearchSummary> {
  const source = getHarvestSource(spec);
  if (!source.enabled) return { skipped: 'source désactivée', found: 0, inserted: 0 };

  const webSearchTool = (type: string) =>
    ({ type, name: 'web_search', max_uses: 5 }) as unknown as Anthropic.Messages.ToolUnion;

  // Cet appel passe par le SDK sans le routeur : il échappait au compteur et au
  // plafond. Une recherche web se paie aussi à l'unité (10 $ les mille), en plus
  // des jetons — la ligne le comptabilise.
  const verdict = verifierBudget('websearch');
  if (!verdict.autorise) throw new BudgetDepasseError(verdict);

  let text = '';
  for (const toolType of ['web_search_20260209', 'web_search_20250305']) {
    try {
      const response = await client.messages.create({
        model: config.ANTHROPIC_MODEL_WRITER,
        max_tokens: 16000,
        tools: [webSearchTool(toolType)],
        messages: [{ role: 'user', content: spec.prompt }],
      });
      const recherches = response.usage.server_tool_use?.web_search_requests ?? 0;
      enregistrerUsage({
        provider: 'anthropic',
        model: config.ANTHROPIC_MODEL_WRITER,
        task: 'websearch',
        label: 'veille:recherche-web',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        coutSupplementMilli: recherches * 9.3,
      });
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) break;
    } catch (err) {
      logger.warn({ toolType, err: String(err).slice(0, 200) }, 'websearch : variante d’outil en échec');
    }
  }
  if (!text) return { skipped: 'aucune réponse du modèle', found: 0, inserted: 0 };

  const parsed = resultSchema.safeParse(JSON.parse(extractJson(text)));
  if (!parsed.success) {
    logger.warn({ source: spec.sourceName, issues: parsed.error.issues.slice(0, 3) }, 'websearch : JSON invalide');
    return { skipped: 'réponse invalide', found: 0, inserted: 0 };
  }

  let inserted = 0;
  for (const item of parsed.data.items) {
    const canonical = canonicalizeUrl(item.url);
    const rows = db
      .insert(schema.newsItems)
      .values({
        sourceId: source.id,
        url: item.url,
        canonicalUrl: canonical,
        contentHash: contentHash(canonical),
        title: item.title,
        summary: `${item.summary} — ${item.why}`,
        publishedAt: new Date().toISOString(),
        lang: spec.lang,
      })
      .onConflictDoNothing({ target: schema.newsItems.contentHash })
      .returning({ id: schema.newsItems.id })
      .all();
    if (rows.length > 0) inserted++;
  }
  return { found: parsed.data.items.length, inserted };
}

/**
 * Collecte quotidienne par recherche web (Claude + outil serveur web_search),
 * en trois passes : veille générale (cas d'entreprises, social US, études),
 * posts LinkedIn anglophones performants à recycler, puis l'axe élargi du jour
 * (LinkedIn FR, YouTube ou compétences, à tour de rôle). Les items stockent
 * titre + URL + un résumé original écrit par le modèle, puis suivent le circuit
 * normal (scoring → shortlist → réécriture).
 */
export async function runWebsearch(): Promise<WebsearchSummary> {
  if (config.LLM_MODE === 'mock') return { skipped: 'mode mock', found: 0, inserted: 0 };
  if (!config.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY absente', found: 0, inserted: 0 };

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const total: WebsearchSummary = { found: 0, inserted: 0 };
  for (const spec of [GENERAL_HARVEST, LINKEDIN_HARVEST, axeElargiDuJour()]) {
    const result = await harvest(client, spec);
    total.found += result.found;
    total.inserted += result.inserted;
  }
  return total;
}
