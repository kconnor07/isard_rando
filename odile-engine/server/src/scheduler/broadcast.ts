/**
 * Diffusion simultanée : un sujet, tous les comptes.
 *
 * Quand le réglage est actif, chaque post fabriqué est recopié sur les autres
 * surfaces connectées — chaque profil LinkedIn de l'équipe, la page entreprise,
 * Instagram (et la Page Facebook dans la foulée, par le miroir). Les posts d'un
 * groupe partagent l'actualité, les slides rendues, la ressource promise ; seul
 * le texte change de plateforme quand il le faut. Une décision prise sur l'un
 * (approuver, rejeter, programmer) vaut pour tous — voir approvals/service.ts.
 */
import { and, eq, ne } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { getBrand, getCadence, getDmTriggers } from '../db/settingsRepo.js';
import { verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { comptesLinkedIn, compteDuPost, type CompteLinkedIn } from '../publishers/linkedinAccounts.js';
import { getStoredToken } from '../publishers/tokens.js';
import { createLink } from '../shortener/index.js';
import { PROMESSE_DM } from '../writer/conformite.js';
import { avecLien, bornerHashtags, captionPorteLeMotCle, optionsDuLien, sansLien } from '../writer/generate.js';
import { nommerRessource } from '../webhooks/commentDm.js';

const nanoGroupe = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

type Post = typeof schema.posts.$inferSelect;

export interface SurfaceDiffusion {
  channel: 'li_personal' | 'li_org' | 'ig';
  platform: 'linkedin' | 'instagram';
  /** clé du compte LinkedIn ; null pour Instagram */
  liAccountKey: string | null;
  /** libellé humain : « Alexis Duquenoy », « page Odile AI », « Instagram » */
  label: string;
}

/** Une surface, telle qu'un post la désigne. */
export function surfaceDuPost(post: Pick<Post, 'channel' | 'liAccountKey'>): SurfaceDiffusion {
  if (post.channel === 'ig') return { channel: 'ig', platform: 'instagram', liAccountKey: null, label: 'Instagram' };
  const compte = comptesLinkedIn(post.channel === 'li_org' ? 'li_org' : 'li_person').find((c) => c.key === post.liAccountKey);
  return {
    channel: post.channel,
    platform: 'linkedin',
    liAccountKey: post.liAccountKey ?? null,
    label: compte ? libelle(compte) : post.channel === 'li_org' ? 'page LinkedIn' : 'profil LinkedIn',
  };
}

function libelle(c: CompteLinkedIn): string {
  return c.subject === 'li_org' ? `page ${c.name}` : c.name;
}

/**
 * Toutes les surfaces connectées et actives, dans un ordre stable : les profils
 * dans l'ordre de connexion, puis les pages, puis Instagram.
 */
export function surfacesConnectees(): SurfaceDiffusion[] {
  const surfaces: SurfaceDiffusion[] = [];
  // Un compte en panne ne reçoit pas de copie : elle coûterait une réécriture par
  // le modèle pour un post que la validation refuserait ensuite.
  for (const c of comptesLinkedIn('li_person').filter((c) => c.actif && !c.enPanne)) {
    surfaces.push({ channel: 'li_personal', platform: 'linkedin', liAccountKey: c.key, label: libelle(c) });
  }
  for (const c of comptesLinkedIn('li_org').filter((c) => c.actif && !c.enPanne)) {
    surfaces.push({ channel: 'li_org', platform: 'linkedin', liAccountKey: c.key, label: libelle(c) });
  }
  if (getStoredToken('meta', 'ig_user')) {
    surfaces.push({ channel: 'ig', platform: 'instagram', liAccountKey: null, label: 'Instagram' });
  }
  return surfaces;
}

/** Les surfaces qui manquent encore à un post pour couvrir tous les comptes. */
export function surfacesManquantes(post: Pick<Post, 'channel' | 'liAccountKey'>): SurfaceDiffusion[] {
  const memeSurface = (s: SurfaceDiffusion) =>
    s.channel === post.channel && (s.channel === 'ig' || s.liAccountKey === (post.liAccountKey ?? null));
  return surfacesConnectees().filter((s) => !memeSurface(s));
}

/**
 * Ce qu'une légende adaptée doit respecter pour sa surface — vérifié à la validation,
 * pour que le modèle corrige lui-même (boucle de completeJson) au lieu qu'une copie
 * parte avec un mot-clé qu'elle ne demande pas ou une promesse impossible.
 */
function legendeAdapteeSchema(vers: 'linkedin' | 'instagram', motcle: string | null) {
  // Instagram coupe à 2 200 caractères, hashtags compris : on garde de la marge.
  const max = vers === 'instagram' ? 2000 : 2900;
  return z.object({ caption: z.string().min(1).max(max), cta: z.string().max(280) }).superRefine((v, ctx) => {
    if (motcle && !captionPorteLeMotCle(v.caption, motcle)) {
      ctx.addIssue({ code: 'custom', path: ['caption'], message: `la légende doit contenir « Commente ${motcle} » (ce mot exactement)` });
    }
    // Même motif que le contrôle de conformité : sinon le modèle rend un texte que la
    // validation refuse ensuite, et chaque « Réaligner » recommence sans converger.
    if (vers === 'linkedin' && (PROMESSE_DM.test(v.caption) || PROMESSE_DM.test(v.cta))) {
      ctx.addIssue({ code: 'custom', path: ['caption'], message: 'sur LinkedIn rien ne part en message privé : le lien est dans le post, le mot-clé ouvre le diagnostic' });
    }
    if (vers === 'instagram' && /https?:\/\/|\{\{link\}\}|www\./i.test(v.caption)) {
      ctx.addIssue({ code: 'custom', path: ['caption'], message: 'aucune adresse ni {{link}} sur Instagram : la ressource part en message privé' });
    }
  });
}

/** La ligne « Source : … » d'une légende, remise sur le vrai média quand le modèle l'a inventée. */
export function corrigerLigneSource(caption: string, media: string | null): string {
  if (!media) return caption;
  const lignes = caption.split('\n');
  const i = lignes.findIndex((l) => /^\s*source\s*:/i.test(l));
  if (i === -1) return caption;
  if (lignes[i]!.toLowerCase().includes(media.toLowerCase())) return caption;
  lignes[i] = `Source : ${media}`;
  return lignes.join('\n');
}

/**
 * Le lien court du parent redevient un emplacement `{{link}}`.
 *
 * Chaque copie pose ensuite le sien : deux comptes qui publient le même lien,
 * ce sont des clics que l'on ne sait plus attribuer. La cible, elle, ne change
 * pas — c'est toujours la ressource promise.
 */
export function enEmplacement(texte: string): string {
  const base = config.PUBLIC_URL.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return texte.replace(new RegExp(`${base}/r/[a-z2-9]+`, 'gi'), '{{link}}');
}

/** Le média et le titre de l'actualité d'origine : ce que la ligne « Source » doit dire. */
export function sourceReelle(newsItemId: number | null): { media: string; titre: string; url: string } | null {
  if (!newsItemId) return null;
  const news = db.select().from(schema.newsItems).where(eq(schema.newsItems.id, newsItemId)).get();
  if (!news) return null;
  const source = news.sourceId ? db.select({ name: schema.newsSources.name }).from(schema.newsSources).where(eq(schema.newsSources.id, news.sourceId)).get() : null;
  return { media: source?.name || mediaDepuisUrl(news.url), titre: news.title, url: news.url };
}

/** Un nom de média lisible depuis l'adresse de l'article (« actuia.com » → « ActuIA »). */
export function mediaDepuisUrl(url: string): string {
  let hote = '';
  try {
    hote = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
  const connus: Record<string, string> = {
    'actuia.com': 'ActuIA',
    'journaldunet.com': 'JDN',
    'techcrunch.com': 'TechCrunch',
    'lesechos.fr': 'Les Echos',
    'frenchweb.fr': 'FrenchWeb',
    'siecledigital.fr': 'Siècle Digital',
    'maddyness.com': 'Maddyness',
    'theverge.com': 'The Verge',
    'wired.com': 'Wired',
    'venturebeat.com': 'VentureBeat',
    'zdnet.fr': 'ZDNet',
    'numerama.com': 'Numerama',
    '01net.com': '01net',
    'usine-digitale.fr': 'L’Usine Digitale',
    'blogdumoderateur.com': 'Blog du Modérateur',
    'openai.com': 'OpenAI',
    'anthropic.com': 'Anthropic',
    'blog.google': 'Google',
    'microsoft.com': 'Microsoft',
    'youtube.com': 'YouTube',
    'github.com': 'GitHub',
    'news.ycombinator.com': 'Hacker News',
    'reddit.com': 'Reddit',
  };
  if (connus[hote]) return connus[hote]!;
  const racine = hote.split('.').slice(-2, -1)[0] ?? hote;
  return racine ? racine.charAt(0).toUpperCase() + racine.slice(1) : hote;
}

function nomsDeclares(mentions: string | null): string[] {
  try {
    const liste = mentions ? (JSON.parse(mentions) as { nom?: string }[]) : [];
    return liste.map((m) => m.nom?.trim() ?? '').filter((n) => n.length >= 2);
  } catch {
    return [];
  }
}

/** Comment nommer la ressource sur la ligne du lien : ce qu'elle est, pas ce qu'on aimerait qu'elle soit. */
function libelleRessource(post: { resourceKind?: string | null; resourceTitle?: string | null }): string {
  const titre = post.resourceTitle?.trim();
  if (post.resourceKind === 'guide') return titre ? `Le guide « ${titre} »` : 'Le guide';
  if (post.resourceKind === 'outil') return titre ? `L’accès à ${titre}` : 'L’accès à l’outil';
  return 'L’analyse complète';
}

/** La voix du compte qui publiera la copie : « je » pour un profil, « nous » pour la page. */
function consigneVoix(compte: CompteLinkedIn): string {
  return compte.subject === 'li_org'
    ? `VOIX : la page entreprise ${compte.name}. Écris au « nous » — la voix de l'agence, collective mais
incarnée. Aucun « je », aucune anecdote personnelle, aucun ton de communiqué (« nous sommes ravis de »).`
    : `VOIX : ${compte.name}${compte.role ? ` (${compte.role})` : ''}, depuis son profil personnel. Écris à la
PREMIÈRE PERSONNE DU SINGULIER (« je », « ce que j'en retiens ») : un point de vue assumé de praticien,
jamais un résumé neutre ni un communiqué.`;
}

/**
 * Le même sujet, écrit pour une autre surface.
 *
 * Deux choses peuvent changer : la plateforme (LinkedIn veut court et sourcé, avec
 * le lien dans la description ; Instagram accepte plus long et plus chaleureux, et
 * n'affiche aucun lien — tout part en privé) et le compte qui publie (le profil
 * d'Alexis ne parle pas comme la page de l'agence). Quand seul le compte change, le
 * texte est intégralement réécrit : trois profils qui publient le même paragraphe au
 * mot près, les lecteurs le voient — et l'algorithme aussi.
 *
 * Le texte rendu porte l'emplacement `{{link}}`, jamais une adresse : c'est la copie
 * qui y posera son propre lien court. Une adaptation par surface, réutilisée par les
 * copies identiques ; en mode mock ou sans budget, le texte d'origine est conservé.
 */
export async function adapterLegende(
  post: Pick<Post, 'caption' | 'cta' | 'commentTriggerKeyword' | 'hook'> &
    Partial<Pick<Post, 'newsItemId' | 'resourceKind' | 'resourceTitle' | 'mentions'>>,
  de: 'linkedin' | 'instagram',
  vers: 'linkedin' | 'instagram',
  compte?: CompteLinkedIn | null,
  motcleCible?: string | null,
): Promise<{ caption: string; cta: string; motcle: string | null; echec?: string }> {
  const dm = getDmTriggers();
  const brand = getBrand();
  const source = sourceReelle(post.newsItemId ?? null);
  // Les noms que la réécriture doit garder tels quels : ce sont eux que le publisher
  // transforme en identifications ; reformulés, ils disparaîtraient en silence.
  const nomsAGarder = [brand.name, ...nomsDeclares(post.mentions ?? null)];
  // LinkedIn garde le lien (sous forme d'emplacement) ; Instagram n'en montre aucun.
  const pose = (t: { caption: string; cta: string }, motcle: string | null) =>
    vers === 'linkedin'
      ? {
          caption: avecLien(enEmplacement(t.caption), '{{link}}', optionsDuLien(motcle)),
          cta: enEmplacement(t.cta),
          motcle,
        }
      : { caption: sansLien(t.caption), cta: sansLien(t.cta), motcle };
  // Sans réécriture, le mot du parent reste : changer le mot dans la base sans le
  // changer dans le texte ferait un post qui demande un mot et un moteur qui en
  // attend un autre.
  const brut = pose({ caption: post.caption, cta: post.cta }, post.commentTriggerKeyword);
  // Même plateforme et même voix : il n'y a rien à réécrire.
  if ((de === vers && !compte) || config.LLM_MODE === 'mock') return brut;
  const verdict = verifierBudget('writing');
  if (!verdict.autorise) return { ...brut, echec: 'plafond IA du jour atteint — texte d’origine conservé' };
  const motcleVoulu = motcleCible ?? post.commentTriggerKeyword;
  const motcle = motcleVoulu ?? 'le mot-clé';
  // Ce que l'appel à l'action promet dépend de la plateforme : sur LinkedIn le lien
  // donne déjà la ressource, le mot-clé ouvre donc le diagnostic ; sur Instagram il
  // n'y a pas de lien, et c'est le mot-clé qui envoie la ressource en privé.
  const consigneCta =
    vers !== 'linkedin'
      ? `APPEL À L'ACTION : « Commente ${motcle} » (ce mot exactement) pour recevoir la ressource en
message privé. AUCUN lien, AUCUNE URL.`
      : dm.linkedinOffer === 'diagnostic'
        ? `APPEL À L'ACTION, dans cet ordre et sur deux lignes : d'abord la ressource et son adresse,
en la nommant pour ce qu'elle est — « ${libelleRessource(post)} : {{link}} » (écris {{link}} tel quel,
c'est un emplacement ; ne présente JAMAIS ce lien comme un audit ou un diagnostic, il mène à ${nommerRessource(post)}) —
puis « Commente ${motcle} » (ce mot exactement) qui n'ouvre PAS la ressource — elle est déjà dans le lien — mais ${dm.diagnosticPromise}.
AUCUNE autre URL, aucune promesse de message privé (impossible sur LinkedIn).`
        : `APPEL À L'ACTION : « Commente ${motcle} » (ce mot exactement), puis juste en dessous la ligne
« Ou directement ici : {{link}} » — écris {{link}} tel quel, c'est un emplacement. AUCUNE autre URL.`;
  const ligneSource = source ? `SOURCE RÉELLE de l'information : ${source.media} — « ${source.titre} ». La ligne « Source : ${source.media} » doit le dire mot pour mot ; n'invente ni média ni date.` : '';
  const ligneNoms = `NOMS À CONSERVER TELS QUELS (ils seront identifiés) : ${nomsAGarder.join(', ')}. Ne mélange jamais tutoiement et vouvoiement.`;
  const consigne =
    de === vers
      ? `Ce texte part aussi sur d'autres comptes de la même équipe. Réécris-le ENTIÈREMENT pour celui-ci :
même information, même source, même longueur — mais une autre entrée en matière, un autre angle, d'autres
formulations. Quelqu'un qui verrait les deux posts ne doit pas lire un copier-coller.
Nomme ${brand.name} une fois, naturellement, dans la dernière ligne. ${ligneSource}
${ligneNoms}
${consigneCta}
${compte ? consigneVoix(compte) : ''}`
      : vers === 'linkedin'
        ? `Réécris ce texte de post Instagram pour LinkedIn — pas une traduction : une autre entrée en matière,
un autre angle, d'autres formulations. 500 à 1 000 caractères, jamais plus de 1 200 ;
l'accroche tient dans les 200 premiers caractères ; une idée par ligne ; nomme la source en clair
(« Source : … ») ; nomme ${brand.name} une fois dans la dernière ligne. ${ligneSource}
${ligneNoms}
${consigneCta}
${compte ? consigneVoix(compte) : ''}`
        : `Adapte ce texte de post LinkedIn pour Instagram : ton plus chaleureux et direct, tutoiement,
1 200 à 2 000 caractères, aéré, quelques émojis sobres. ${ligneSource}
${ligneNoms}
${consigneCta}`;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        label: 'post:diffusion',
        // Même modèle que le parent : une copie écrite par un modèle plus petit se voit.
        tier: 'best',
        prompt: `${consigne}\n\nACCROCHE : ${post.hook}\n\nTEXTE D'ORIGINE :\n"""\n${
          vers === 'linkedin' ? enEmplacement(post.caption) : post.caption
        }\n"""\n\nCTA D'ORIGINE : ${post.cta}`,
        maxTokens: 2500,
      },
      legendeAdapteeSchema(vers, motcleVoulu),
    );
    return pose({ ...value, caption: corrigerLigneSource(value.caption, source?.media ?? null) }, motcleVoulu);
  } catch (err) {
    const cause = String(err).slice(0, 200);
    logger.warn({ err: cause }, 'adaptation de légende impossible — texte d’origine conservé');
    return { ...brut, echec: `texte non adapté à ce compte (${cause.slice(0, 120)}) — texte d’origine conservé, à réécrire` };
  }
}

/**
 * Le mot à commenter, sur la surface qui reçoit la copie.
 *
 * Les deux plateformes ne promettent pas la même chose : sur Instagram le mot-clé
 * envoie la ressource en message privé, sur LinkedIn il ouvre le diagnostic (la
 * ressource, elle, est dans le lien du post). Une copie qui change de plateforme
 * change donc de mot ; une copie qui reste sur la même garde celui du parent.
 */
export function motcleDeSurface(parent: Pick<Post, 'id' | 'platform' | 'commentTriggerKeyword'>, vers: 'linkedin' | 'instagram'): string | null {
  if (!parent.commentTriggerKeyword || vers === parent.platform) return parent.commentTriggerKeyword;
  const dm = getDmTriggers();
  const liste = vers === 'linkedin' && dm.linkedinOffer === 'diagnostic' ? dm.diagnosticKeywords : dm.keywords;
  const mot = liste.length ? liste[parent.id % liste.length] : null;
  return (mot ?? parent.commentTriggerKeyword).toUpperCase();
}

/**
 * Où commence l'appel à l'action d'une légende : la suite de lignes finales qui
 * portent le lien, le « Commente MOT » ou une promesse d'envoi. Tout ce qui précède
 * est le post que le fondateur a lu et validé — on n'y touche pas.
 */
export function separerBlocFinal(caption: string): { corps: string; blocFinal: string } {
  const lignes = caption.split('\n');
  const estFinale = (l: string) => !l.trim() || /commente[sz]?\s/i.test(l) || /\{\{link\}\}|\/r\/[a-z2-9]{6,}|https?:\/\//i.test(l) || PROMESSE_DM.test(l) || /^\s*(c[’']est ici|ou directement ici|le lien|👉)/i.test(l);
  let debut = lignes.length;
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (!estFinale(lignes[i]!)) break;
    debut = i;
  }
  // Un texte entièrement « final » n'a pas de corps : on réécrit alors tout.
  if (debut === 0) return { corps: '', blocFinal: caption.trim() };
  return { corps: lignes.slice(0, debut).join('\n').trimEnd(), blocFinal: lignes.slice(debut).join('\n').trim() };
}

/**
 * Réécrit seulement la FIN d'un post LinkedIn : le corps validé reste mot pour mot,
 * l'appel à l'action redevient conforme (lien de la ressource, mot de diagnostic,
 * aucune promesse de message privé). « Réaligner » abîmait un bon post en le
 * réécrivant en entier ; ici il ne corrige que ce qui cloche.
 */
export async function reecrireLeBlocFinal(
  post: Pick<Post, 'id' | 'caption' | 'cta' | 'hook' | 'commentTriggerKeyword'> & Partial<Pick<Post, 'resourceKind' | 'resourceTitle'>>,
  motcleCible: string | null,
): Promise<{ caption: string; cta: string; motcle: string | null; echec?: string }> {
  const dm = getDmTriggers();
  const { corps, blocFinal } = separerBlocFinal(post.caption);
  const motcle = motcleCible ?? post.commentTriggerKeyword;
  const brut = { caption: post.caption, cta: post.cta, motcle };
  if (config.LLM_MODE === 'mock') return brut;
  const verdict = verifierBudget('writing');
  if (!verdict.autorise) return { ...brut, echec: 'plafond IA du jour atteint — texte d’origine conservé' };
  const mot = motcle ?? 'le mot-clé';
  const consigne =
    dm.linkedinOffer === 'diagnostic'
      ? `Deux lignes, dans cet ordre : d'abord ${libelleRessource(post)} et son adresse — « … : {{link}} » (écris {{link}} tel quel, c'est un emplacement ; ne présente jamais ce lien comme un audit ou un diagnostic, il mène à ${nommerRessource(post)}) — puis « Commente ${mot} » (ce mot exactement), qui n'ouvre PAS la ressource mais ${dm.diagnosticPromise}.`
      : `Deux lignes : « Commente ${mot} » (ce mot exactement), puis « Ou directement ici : {{link}} » (écris {{link}} tel quel, c'est un emplacement).`;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        label: 'post:fin-de-post',
        tier: 'best',
        prompt: `Voici un post LinkedIn validé. Son texte ne doit PAS changer : réécris UNIQUEMENT son appel à l'action final.

${consigne}
Sur LinkedIn rien ne part en message privé : n'écris jamais « je t'envoie », « en DM », « en message privé ».
Même voix et même niveau de langue que le texte (ne mélange pas tutoiement et vouvoiement). Deux lignes, 240 caractères au plus.

TEXTE DU POST (à ne pas réécrire) :
"""
${corps || post.hook}
"""

APPEL À L'ACTION ACTUEL (à remplacer) :
"""
${blocFinal}
"""`,
        maxTokens: 500,
      },
      z
        .object({ blocFinal: z.string().min(1).max(400), cta: z.string().max(280) })
        .superRefine((v, ctx) => {
          if (motcle && !captionPorteLeMotCle(v.blocFinal, motcle)) {
            ctx.addIssue({ code: 'custom', path: ['blocFinal'], message: `l'appel à l'action doit contenir « Commente ${motcle} » (ce mot exactement)` });
          }
          if (PROMESSE_DM.test(v.blocFinal) || PROMESSE_DM.test(v.cta)) {
            ctx.addIssue({ code: 'custom', path: ['blocFinal'], message: 'sur LinkedIn rien ne part en message privé : le lien est dans le post, le mot-clé ouvre le diagnostic' });
          }
        }),
    );
    const caption = corps ? `${corps}\n\n${value.blocFinal.trim()}` : value.blocFinal.trim();
    return { caption: avecLien(caption, '{{link}}', optionsDuLien(motcle)), cta: value.cta.trim() || value.blocFinal.trim(), motcle };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ...brut, echec: `fin de post non réécrite (${cause.slice(0, 120)}) — texte d’origine conservé, à corriger à la main` };
  }
}

/**
 * Recopie un post fabriqué sur chaque surface où il n'est pas encore : mêmes
 * slides rendues, même ressource, lien court propre à chaque copie (les clics
 * restent attribuables au compte). Renvoie les identifiants créés.
 */
export async function diffuserPartout(parentId: number): Promise<number[]> {
  const parent = db.select().from(schema.posts).where(eq(schema.posts.id, parentId)).get();
  if (!parent) throw new Error(`Post ${parentId} introuvable`);
  const manquantes = surfacesManquantes(parent);
  if (manquantes.length === 0) return [];

  const groupe = parent.broadcastGroup ?? nanoGroupe();
  if (!parent.broadcastGroup) {
    db.update(schema.posts).set({ broadcastGroup: groupe }).where(eq(schema.posts.id, parentId)).run();
  }
  // Les copies déjà faites (relance de fabrication) ne sont pas refaites.
  const dejaLa = db
    .select({ channel: schema.posts.channel, liAccountKey: schema.posts.liAccountKey })
    .from(schema.posts)
    .where(and(eq(schema.posts.broadcastGroup, groupe), ne(schema.posts.id, parentId)))
    .all();
  const aFaire = manquantes.filter(
    (s) => !dejaLa.some((d) => d.channel === s.channel && (s.channel === 'ig' || d.liAccountKey === s.liAccountKey)),
  );
  if (aFaire.length === 0) return [];

  const slides = db.select().from(schema.slides).where(eq(schema.slides.postId, parentId)).orderBy(schema.slides.idx).all();
  const lienParent = parent.linkId ? db.select().from(schema.links).where(eq(schema.links.id, parent.linkId)).get() : null;
  const cible = lienParent?.targetUrl ?? parent.resourceUrl ?? 'https://odileai.com';

  // Une adaptation par surface : changer de plateforme demande une traduction,
  // changer de compte demande une autre voix. Deux surfaces identiques la partagent.
  const cleSurface = (s: SurfaceDiffusion) => `${s.platform}|${s.liAccountKey ?? ''}`;
  const textes = new Map<string, { caption: string; cta: string; motcle: string | null; echec?: string }>();
  for (const surface of aFaire) {
    if (textes.has(cleSurface(surface))) continue;
    const compte =
      surface.platform === 'linkedin'
        ? compteDuPost({ channel: surface.channel, liAccountKey: surface.liAccountKey })
        : null;
    textes.set(
      cleSurface(surface),
      await adapterLegende(parent, parent.platform, surface.platform, compte, motcleDeSurface(parent, surface.platform)),
    );
  }

  const crees: number[] = [];
  const now = new Date().toISOString();
  for (const surface of aFaire) {
    const texte = textes.get(cleSurface(surface))!;
    // Plusieurs slides : sur LinkedIn, leur équivalent natif n'est pas une suite
    // d'images mais le document PDF, que l'on feuillette sans quitter le fil.
    const format =
      surface.platform === 'linkedin'
        ? slides.length > 1
          ? 'li_doc'
          : 'li_image'
        : slides.length > 1
          ? 'carousel'
          : 'static';
    const copie = db
      .insert(schema.posts)
      .values({
        newsItemId: parent.newsItemId,
        platform: surface.platform,
        channel: surface.channel,
        liAccountKey: surface.liAccountKey,
        format,
        theme: parent.theme,
        language: parent.language,
        status: 'reviewing',
        archetype: parent.archetype,
        hook: parent.hook,
        caption: texte.caption,
        cta: texte.cta,
        hashtags: JSON.stringify(bornerHashtags(JSON.parse(parent.hashtags) as string[], surface.platform)),
        commentTriggerKeyword: texte.motcle,
        // Une adaptation ratée n'est pas masquée : la copie porte la raison, le
        // fondateur la voit avant de valider, au lieu d'un texte du parent qui part.
        error: texte.echec ?? null,
        resourceKind: parent.resourceKind,
        resourceTitle: parent.resourceTitle,
        resourceUrl: parent.resourceUrl,
        resourceAssetId: parent.resourceAssetId,
        mentions: parent.mentions,
        toneSnapshot: parent.toneSnapshot,
        reviewSummary: parent.reviewSummary,
        broadcastGroup: groupe,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.posts.id })
      .get();
    const link = createLink(cible, {
      postId: copie.id,
      label: `post-${copie.id}`,
      utm: { utm_source: surface.platform, utm_medium: 'social', utm_campaign: `post-${copie.id}` },
    });
    // Chaque copie pose son propre lien court à l'emplacement laissé par l'adaptation :
    // même destination, un code par compte — les clics restent attribuables.
    db.update(schema.posts)
      .set({
        linkId: link.id,
        caption: texte.caption.replaceAll('{{link}}', link.shortUrl),
        cta: texte.cta.replaceAll('{{link}}', link.shortUrl),
      })
      .where(eq(schema.posts.id, copie.id))
      .run();
    for (const slide of slides) {
      db.insert(schema.slides)
        .values({
          postId: copie.id,
          idx: slide.idx,
          kind: slide.kind,
          content: slide.content,
          renderAssetId: slide.renderAssetId,
          screenshotAssetId: slide.screenshotAssetId,
          heroAssetId: slide.heroAssetId,
        })
        .run();
    }
    crees.push(copie.id);
  }
  logger.info({ parentId, groupe, copies: crees.length, surfaces: aFaire.map((s) => s.label) }, 'post diffusé sur tous les comptes');
  return crees;
}

/** Les autres posts d'un groupe de diffusion. */
export function freresDuGroupe(post: Pick<Post, 'id' | 'broadcastGroup'>): Post[] {
  if (!post.broadcastGroup) return [];
  return db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.broadcastGroup, post.broadcastGroup), ne(schema.posts.id, post.id)))
    .all();
}

/** Diffusion active ? (réglage lu à chaque fois : il se change depuis le dashboard) */
export function diffusionActive(): boolean {
  return getCadence().broadcast;
}
