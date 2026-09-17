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
import { getBrand, getCadence } from '../db/settingsRepo.js';
import { verifierBudget } from '../lib/llmBudget.js';
import { logger } from '../lib/logger.js';
import { completeJson } from '../llm/router.js';
import { comptesLinkedIn, compteDuPost, type CompteLinkedIn } from '../publishers/linkedinAccounts.js';
import { getStoredToken } from '../publishers/tokens.js';
import { createLink } from '../shortener/index.js';
import { sansLien } from '../writer/generate.js';

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
  for (const c of comptesLinkedIn('li_person').filter((c) => c.actif)) {
    surfaces.push({ channel: 'li_personal', platform: 'linkedin', liAccountKey: c.key, label: libelle(c) });
  }
  for (const c of comptesLinkedIn('li_org').filter((c) => c.actif)) {
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

const legendeAdapteeSchema = z.object({ caption: z.string().min(1).max(2900), cta: z.string().max(280) });

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
 * Deux choses peuvent changer : la plateforme (LinkedIn veut court, sourcé, sans
 * lien ; Instagram accepte plus long et plus chaleureux) et le compte qui publie
 * (le profil d'Alexis ne parle pas comme la page de l'agence). Quand seul le compte
 * change, le texte est intégralement réécrit : trois profils qui publient le même
 * paragraphe au mot près, les lecteurs le voient — et l'algorithme aussi.
 *
 * Une adaptation par surface, réutilisée par les copies identiques. En mode mock ou
 * sans budget, on garde le texte tel quel (nettoyé de tout lien pour LinkedIn).
 */
export async function adapterLegende(
  post: Pick<Post, 'caption' | 'cta' | 'commentTriggerKeyword' | 'hook'>,
  de: 'linkedin' | 'instagram',
  vers: 'linkedin' | 'instagram',
  compte?: CompteLinkedIn | null,
): Promise<{ caption: string; cta: string }> {
  const brut = { caption: vers === 'linkedin' ? sansLien(post.caption) : post.caption, cta: vers === 'linkedin' ? sansLien(post.cta) : post.cta };
  // Même plateforme et même voix : il n'y a rien à réécrire.
  if ((de === vers && !compte) || config.LLM_MODE === 'mock') return brut;
  const verdict = verifierBudget('writing');
  if (!verdict.autorise) return brut;
  const motcle = post.commentTriggerKeyword ?? 'le mot-clé';
  const consigne =
    de === vers
      ? `Ce texte part aussi sur d'autres comptes de la même équipe. Réécris-le ENTIÈREMENT pour celui-ci :
même information, même source, même appel à l'action « Commente ${motcle} », même longueur — mais une autre
entrée en matière, un autre angle, d'autres formulations. Quelqu'un qui verrait les deux posts ne doit pas
lire un copier-coller.${vers === 'linkedin' ? ' AUCUN lien, AUCUNE URL.' : ''}
${compte ? consigneVoix(compte) : ''}`
      : vers === 'linkedin'
        ? `Adapte ce texte de post Instagram pour LinkedIn : 500 à 1 000 caractères, jamais plus de 1 200 ;
l'accroche tient dans les 200 premiers caractères ; une idée par ligne ; nomme la source en clair
(« Source : … ») ; AUCUN lien, AUCUNE URL ; nomme ${getBrand().name} une fois dans la dernière ligne ;
garde exactement le même appel à l'action « Commente ${motcle} ».
${compte ? consigneVoix(compte) : ''}`
        : `Adapte ce texte de post LinkedIn pour Instagram : ton plus chaleureux et direct, tutoiement,
1 200 à 2 000 caractères, aéré, quelques émojis sobres, AUCUN lien ; garde exactement le même appel à
l'action « Commente ${motcle} » pour recevoir la ressource en message privé.`;
  try {
    const { value } = await completeJson(
      {
        task: 'writing',
        prompt: `${consigne}\n\nACCROCHE : ${post.hook}\n\nTEXTE D'ORIGINE :\n"""\n${post.caption}\n"""\n\nCTA D'ORIGINE : ${post.cta}`,
        maxTokens: 1200,
      },
      legendeAdapteeSchema,
    );
    return vers === 'linkedin' ? { caption: sansLien(value.caption), cta: sansLien(value.cta) } : value;
  } catch (err) {
    logger.warn({ err: String(err).slice(0, 200) }, 'adaptation de légende impossible — texte d’origine conservé');
    return brut;
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
  const textes = new Map<string, { caption: string; cta: string }>();
  for (const surface of aFaire) {
    if (textes.has(cleSurface(surface))) continue;
    const compte =
      surface.platform === 'linkedin'
        ? compteDuPost({ channel: surface.channel, liAccountKey: surface.liAccountKey })
        : null;
    textes.set(cleSurface(surface), await adapterLegende(parent, parent.platform, surface.platform, compte));
  }

  const crees: number[] = [];
  const now = new Date().toISOString();
  for (const surface of aFaire) {
    const texte = textes.get(cleSurface(surface))!;
    const format = surface.platform === 'linkedin' ? 'li_image' : slides.length > 1 ? 'carousel' : 'static';
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
        hashtags: parent.hashtags,
        commentTriggerKeyword: parent.commentTriggerKeyword,
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
    db.update(schema.posts).set({ linkId: link.id }).where(eq(schema.posts.id, copie.id)).run();
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
