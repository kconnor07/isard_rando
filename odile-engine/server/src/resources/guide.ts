/**
 * La ressource promise, livrée pour de vrai.
 *
 * Un post qui annonce « je t'envoie le guide » doit envoyer un guide, pas l'article
 * qui l'a inspiré. Ce module fabrique ce qui a été promis :
 *   — « guide » : rédaction structurée, mise en page aux couleurs de la marque, PDF ;
 *   — « outil » : l'adresse officielle de l'outil dont parle le post ;
 *   — « article » : la source elle-même, comme avant.
 *
 * Le PDF est servi publiquement (route `/guide/:id`), sans quoi la personne qui
 * reçoit le lien en message privé tomberait sur une page de connexion.
 */
import { eq } from 'drizzle-orm';
import { guideSchema, type Guide } from '@odile/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getDefaultTheme, getDmTriggers } from '../db/settingsRepo.js';
import { verifierBudget, BudgetDepasseError } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { createLink } from '../shortener/index.js';
import { completeJson } from '../llm/router.js';
import { getBrowser } from '../render/browser.js';
import { buildCustomThemeCss, getCustomTheme } from '../render/custom-theme.js';
import { assetDataUri, escapeHtml, saveAsset } from '../render/renderer.js';
import { baseCss, defaultBrandLogoDataUri, fontFaceCss, themeCss } from '../render/themes.js';

export interface RessourceLivree {
  kind: 'article' | 'guide' | 'outil';
  url: string;
  title: string;
  assetId?: string | null;
}

/** Adresse publique d'un guide livré (le lien part en message privé). */
/**
 * Le bouton « Prendre 20 minutes » d'un guide PDF passe par un lien court `guide-N`
 * dont la cible est figée à la fabrication. Renseigner le lien de rendez-vous après
 * coup doit atteindre les guides déjà envoyés : on change la cible, pas le PDF.
 */
export function reciblerLiensDesGuides(cible: string): number {
  const propre = cible.trim();
  if (!propre) return 0;
  const liens = db.select({ id: schema.links.id, label: schema.links.label, targetUrl: schema.links.targetUrl }).from(schema.links).all().filter((l) => /^guide-\d+$/.test(l.label ?? '') && l.targetUrl !== propre);
  for (const l of liens) db.update(schema.links).set({ targetUrl: propre }).where(eq(schema.links.id, l.id)).run();
  if (liens.length > 0) logger.info({ liens: liens.length, cible: propre }, 'liens de rendez-vous des guides reciblés');
  return liens.length;
}

export function urlDuGuide(assetId: string): string {
  return `${config.PUBLIC_URL.replace(/\/$/, '')}/guide/${assetId}`;
}

/** Rédige le contenu du guide à partir du post et de l'actualité qui l'a inspiré. */
async function redigerGuide(args: {
  titre: string;
  hook: string;
  caption: string;
  newsTitle: string;
  newsText: string;
  marque: string;
}): Promise<Guide> {
  const verdict = verifierBudget('guide');
  if (!verdict.autorise) throw new BudgetDepasseError(verdict);
  const prompt = `Tu rédiges un guide PDF offert par ${args.marque} à la personne qui a commenté un post.
Ce guide EST la promesse du post : il doit tenir cette promesse, seul, sans renvoyer ailleurs.

TITRE PROMIS : ${args.titre}
ACCROCHE DU POST : ${args.hook}
LÉGENDE DU POST : ${args.caption}
ACTUALITÉ SOURCE : ${args.newsTitle}
${args.newsText ? `MATIÈRE PREMIÈRE :\n"""\n${args.newsText.slice(0, 3500)}\n"""` : ''}

Règles :
— français, vouvoiement, ton d'agence qui explique simplement à un dirigeant de PME ;
— du concret : des étapes qu'on peut appliquer lundi matin, des exemples, des ordres de grandeur ;
— aucune promesse commerciale creuse, aucun jargon, aucune phrase recopiée de la source ;
— 3 à 7 sections, chacune avec un corps de texte suivi de 2 à 5 étapes actionnables ;
— une checklist finale de 3 à 8 lignes, chacune vérifiable d'un coup d'œil ;
— la conclusion rappelle en deux phrases ce que ${args.marque} peut faire ensuite, sans insister.`;
  const { value } = await completeJson(
    { task: 'writing', label: 'post:guide', prompt, maxTokens: 3400 },
    guideSchema,
  );
  return value;
}

export interface PorteDeSortie {
  /** adresse cliquable (lien court tracké) */
  url: string;
  /** libellé du bouton : « Prendre 20 minutes » */
  libelle: string;
}

/**
 * Mise en page du guide aux couleurs de la marque, réutilisée telle quelle par le PDF.
 *
 * Le guide est le moment où la personne a la plus forte intention : elle a commenté,
 * ouvert le message privé, cliqué, et elle lit. Sans lien cliquable, tout ce chemin
 * ne produit aucun contact — c'est l'endroit du parcours où la valeur se perdait.
 */
export function guideHtml(
  guide: Guide,
  marque: { nom: string; site: string },
  logoDataUri: string | null,
  sortie?: PorteDeSortie | null,
): string {
  const theme = getDefaultTheme();
  const custom = getCustomTheme(theme);
  const couleurs = custom ? buildCustomThemeCss(custom) : themeCss(theme);
  const section = (s: Guide['sections'][number], i: number) => `
    <section class="bloc">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <h2>${escapeHtml(s.title)}</h2>
      <p>${escapeHtml(s.body)}</p>
      ${
        s.steps.length
          ? `<ul class="etapes">${s.steps.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
          : ''
      }
    </section>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><style>
${fontFaceCss()}
${baseCss()}
${couleurs}
/* Feuille A4 : le canevas du moteur est fait pour des slides, celui-ci pour une page. */
html, body, .slide { width: auto; height: auto; }
body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; }
@page { size: A4; margin: 0; }
/* L'accent du template est profond : sur fond sombre, les petits éléments le
   reprennent éclairci, sinon ils disparaissent à l'impression comme à l'écran. */
:root { --accent-clair: color-mix(in srgb, var(--accent) 45%, #9fc0ff); }
.page { position: relative; width: 210mm; padding: 26mm 20mm; background: var(--bg); overflow: hidden; }
.couv {
  min-height: 245mm; display: flex; flex-direction: column; justify-content: center; gap: 12mm;
  page-break-after: always;
}
/* Décor du template, en sourdine : un disque de lumière derrière le titre. */
.couv::before {
  content: ''; position: absolute; z-index: 0;
  top: -30mm; right: -40mm; width: 170mm; height: 170mm; border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, color-mix(in srgb, var(--accent) 70%, #000) 0%, color-mix(in srgb, var(--accent) 38%, transparent) 46%, transparent 72%);
}
.couv > * { position: relative; z-index: 1; }
.couv h1::after {
  content: ''; display: block; width: 28mm; height: 1.4mm; margin-top: 6mm; border-radius: 1mm;
  background: linear-gradient(90deg, var(--accent-clair), transparent);
}
.marque { display: flex; align-items: center; gap: 5mm; }
.marque img { height: 12mm; }
.marque span { font-family: 'Fragment Mono', monospace; font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.75; }
h1 { font-size: 30pt; line-height: 1.08; letter-spacing: -0.03em; font-weight: 800; }
.sous { font-size: 13pt; line-height: 1.5; opacity: 0.8; max-width: 150mm; }
.intro { font-size: 11.5pt; line-height: 1.65; opacity: 0.88; }
.bloc { margin-bottom: 10mm; page-break-inside: avoid; }
.bloc .num { font-family: 'Fragment Mono', monospace; font-size: 9pt; letter-spacing: 0.2em; color: var(--accent-clair); margin-bottom: 2mm; }
.bloc h2 { font-size: 16pt; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 3mm; }
.bloc p { font-size: 11pt; line-height: 1.6; opacity: 0.86; }
.etapes { list-style: none; margin-top: 4mm; display: flex; flex-direction: column; gap: 2.5mm; }
.etapes li { font-size: 10.5pt; line-height: 1.45; padding-left: 8mm; position: relative; }
.etapes li::before { content: '→'; position: absolute; left: 0; color: var(--accent-clair); font-weight: 700; }
.check { margin-top: 6mm; padding: 8mm; border-radius: 8mm; page-break-inside: avoid;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 42%, transparent), color-mix(in srgb, var(--accent) 10%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent-clair) 45%, transparent); }
.check h2 { font-size: 14pt; margin-bottom: 4mm; }
.check li { list-style: none; font-size: 10.5pt; line-height: 1.5; padding-left: 8mm; position: relative; margin-bottom: 2mm; }
.check li::before { content: '☐'; position: absolute; left: 0; color: var(--accent-clair); }
.fin { margin-top: 10mm; font-size: 11pt; line-height: 1.6; opacity: 0.86; }
/* La porte de sortie : le seul endroit du guide où l'on demande quelque chose. */
.sortie { margin-top: 10mm; padding: 8mm; border-radius: 8mm; page-break-inside: avoid;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), color-mix(in srgb, var(--accent) 16%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent-clair) 55%, transparent); }
.sortie-titre { font-size: 14pt; font-weight: 700; margin-bottom: 3mm; }
.sortie p { font-size: 10.5pt; line-height: 1.55; opacity: 0.9; margin-bottom: 5mm; }
.sortie-bouton { display: inline-block; padding: 3.5mm 7mm; border-radius: 99mm; text-decoration: none;
  background: var(--text); color: #0b0b12; font-size: 10.5pt; font-weight: 700; }
.pied { margin-top: 12mm; padding-top: 5mm; border-top: 1px solid rgba(255,255,255,0.14);
  font-family: 'Fragment Mono', monospace; font-size: 8.5pt; letter-spacing: 0.1em; opacity: 0.5; }
.pied a { color: inherit; text-decoration: none; }
</style></head>
<body class="slide">
  <div class="page couv">
    <div class="marque">${logoDataUri ? `<img src="${logoDataUri}" alt="">` : ''}<span>${escapeHtml(marque.nom)}</span></div>
    <h1>${escapeHtml(guide.title)}</h1>
    <p class="sous">${escapeHtml(guide.subtitle)}</p>
    <p class="intro">${escapeHtml(guide.intro)}</p>
  </div>
  <div class="page">
    ${guide.sections.map(section).join('')}
    <div class="check">
      <h2>À vérifier avant de vous lancer</h2>
      <ul>${guide.checklist.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </div>
    <p class="fin">${escapeHtml(guide.closing)}</p>
    ${
      sortie
        ? `<div class="sortie">
      <div class="sortie-titre">Et chez vous ?</div>
      <p>Vingt minutes suffisent à repérer les deux tâches qui vous coûtent le plus de temps. C'est gratuit et sans engagement.</p>
      <a class="sortie-bouton" href="${escapeHtml(sortie.url)}">${escapeHtml(sortie.libelle)} →</a>
    </div>`
        : ''
    }
    <div class="pied"><a href="${escapeHtml(marque.site)}">${escapeHtml(marque.nom)} · ${escapeHtml(marque.site.replace(/^https?:\/\//, ''))}</a></div>
  </div>
</body></html>`;
}

/** Fabrique le PDF du guide et l'enregistre comme asset. */
async function imprimerPdf(html: string, postId: number): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate('document.fonts.ready');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return saveAsset(Buffer.from(pdf), 'guide', { postId }, undefined, { ext: 'pdf', mime: 'application/pdf' });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Livre la ressource promise par un post. Jamais bloquant : si la fabrication
 * échoue, le motif est enregistré et le lien retombe sur l'article source —
 * mieux vaut une source qu'un lien mort.
 */
export async function livrerRessource(postId: number): Promise<RessourceLivree> {
  const post = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
  if (!post) throw new Error(`Post ${postId} introuvable`);
  const news = post.newsItemId
    ? db.select().from(schema.newsItems).where(eq(schema.newsItems.id, post.newsItemId)).get()
    : null;
  const secours: RessourceLivree = {
    kind: 'article',
    url: news?.url ?? 'https://odileai.com',
    title: news?.title ?? 'Article source',
  };

  const marque = getBrand();
  // Le pied affichait le handle (« odileai ») au lieu du site : une adresse qui ne mène nulle part.
  const infos = { nom: marque.name, site: marque.siteUrl || 'https://odileai.com' };

  if (post.resourceKind === 'outil') {
    const url = post.resourceUrl?.trim();
    if (!url) return secours;
    return { kind: 'outil', url, title: post.resourceTitle ?? 'Outil' };
  }
  if (post.resourceKind !== 'guide') return secours;

  try {
    const guide = await redigerGuide({
      titre: post.resourceTitle ?? post.hook,
      hook: post.hook,
      caption: post.caption,
      newsTitle: news?.title ?? '',
      newsText: news?.contentText ?? news?.summary ?? '',
      marque: infos.nom,
    });
    const logo = logoDataUri();
    // Un lien court tracké : on saura combien de guides mènent à un rendez-vous.
    const dm = getDmTriggers();
    const cible = dm.rdvUrl.trim() || infos.site;
    const lien = createLink(cible, {
      postId,
      label: `guide-${postId}`,
      utm: { utm_source: 'guide', utm_medium: 'pdf', utm_campaign: `post-${postId}` },
    });
    const sortie: PorteDeSortie = { url: lien.shortUrl, libelle: dm.rdvLabel.trim() || 'Prendre 20 minutes' };
    const assetId = await imprimerPdf(guideHtml(guide, infos, logo, sortie), postId);
    logger.info({ postId, assetId, titre: guide.title }, 'guide livré');
    return { kind: 'guide', url: urlDuGuide(assetId), title: guide.title, assetId };
  } catch (err) {
    const motif = err instanceof Error ? err.message : String(err);
    db.update(schema.posts).set({ resourceError: motif.slice(0, 400) }).where(eq(schema.posts.id, postId)).run();
    logger.error({ postId, err: motif }, 'fabrication du guide en échec — retour à l’article source');
    return secours;
  }
}

/** Logo de la marque en data URI, sinon le logo officiel embarqué. */
function logoDataUri(): string | null {
  return assetDataUri(getBrand().logoAssetId) ?? defaultBrandLogoDataUri();
}
