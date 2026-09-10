/**
 * Catalogue des modèles de génération disponibles via l'API Freepik / Magnific.
 * Chaque entrée sait construire le corps de requête de son endpoint à partir
 * d'un prompt, d'un format (4:5 ou carré), d'une qualité (pro / rapide) et
 * d'une éventuelle image de référence. Chemins et paramètres : docs.magnific.com.
 */

export type FreepikAspect = '4:5' | '1:1';
export type FreepikQuality = 'pro' | 'fast';

/** Image de référence : base64 pour les modèles qui l'acceptent, URL publique pour les autres. */
export interface FreepikReference {
  base64: string;
  mime: string;
  publicUrl?: string;
}
export interface FreepikGenOpts {
  aspect: FreepikAspect;
  quality: FreepikQuality;
  reference?: FreepikReference | null;
}

/** Convention de la famille pour recevoir une référence (null : ignorée). */
export type ReferenceKind = 'base64' | 'url' | 'style' | null;

export interface FreepikModel {
  id: string;
  label: string;
  family: 'google' | 'flux' | 'seedream' | 'mystic' | 'openai' | 'runway' | 'zimage';
  /** endpoint POST (la tâche se lit ensuite sur `${path}/{task-id}`) */
  path: string;
  /** durée indicative d'une génération */
  speed: string;
  note?: string;
  recommended?: boolean;
  reference: ReferenceKind;
  body: (prompt: string, opts: FreepikGenOpts) => Record<string, unknown>;
}

// Noms de formats selon la famille d'API
const FLUX_ASPECT: Record<FreepikAspect, string> = { '4:5': 'social_post_4_5', '1:1': 'square_1_1' };
const SEEDREAM_ASPECT: Record<FreepikAspect, string> = { '4:5': 'traditional_3_4', '1:1': 'square_1_1' };
const GOOGLE_ASPECT: Record<FreepikAspect, string> = { '4:5': '4:5', '1:1': '1:1' };
const PIXELS: Record<FreepikAspect, { width: number; height: number }> = {
  '4:5': { width: 1024, height: 1280 },
  '1:1': { width: 1024, height: 1024 },
};

const T2I = '/v1/ai/text-to-image';

/** Ajoute la référence au corps selon la convention du modèle. */
function withReference(
  body: Record<string, unknown>,
  kind: ReferenceKind,
  ref?: FreepikReference | null,
): Record<string, unknown> {
  if (!ref || !kind) return body;
  if (kind === 'base64') return { ...body, input_image: ref.base64 };
  if (kind === 'style') return { ...body, style_reference: ref.base64, adherence: 60 };
  if (kind === 'url' && ref.publicUrl) {
    return { ...body, reference_images: [{ image: ref.publicUrl, text: 'style reference', mime_type: ref.mime }] };
  }
  return body;
}

function google(prompt: string, o: FreepikGenOpts): Record<string, unknown> {
  return { prompt, aspect_ratio: GOOGLE_ASPECT[o.aspect], resolution: o.quality === 'pro' ? '2K' : '1K' };
}

export const FREEPIK_MODELS: FreepikModel[] = [
  {
    id: 'nano-banana-pro-flash',
    label: 'Google Nano Banana 2 (Pro Flash)',
    family: 'google',
    path: `${T2I}/nano-banana-pro-flash`,
    speed: '~40 s',
    note: 'Compositions fidèles, très bon rapport qualité / vitesse',
    recommended: true,
    reference: 'url',
    body: (prompt, o) => withReference(google(prompt, o), 'url', o.reference),
  },
  {
    id: 'nano-banana-pro',
    label: 'Google Nano Banana Pro',
    family: 'google',
    path: `${T2I}/nano-banana-pro`,
    speed: '~55 s',
    note: 'Fidélité maximale (crédits)',
    reference: 'url',
    body: (prompt, o) => withReference(google(prompt, o), 'url', o.reference),
  },
  {
    id: 'gemini-2-5-flash-image-preview',
    label: 'Google Nano Banana (1)',
    family: 'google',
    path: '/v1/ai/gemini-2-5-flash-image-preview',
    speed: '~13 s',
    note: 'Rapide ; format non réglable (recadré ensuite)',
    reference: 'url',
    body: (prompt, o) => withReference({ prompt }, 'url', o.reference),
  },
  {
    id: 'flux-2-klein',
    label: 'Flux.2 Klein',
    family: 'flux',
    path: `${T2I}/flux-2-klein`,
    speed: '~6 s',
    note: 'Ultra rapide, idéal pour itérer ; accepte une image de référence',
    recommended: true,
    reference: 'base64',
    body: (prompt, o) =>
      withReference(
        { prompt, aspect_ratio: FLUX_ASPECT[o.aspect], resolution: o.quality === 'pro' ? '2k' : '1k', output_format: 'jpeg' },
        'base64',
        o.reference,
      ),
  },
  {
    id: 'flux-2-pro',
    label: 'Flux.2 Pro',
    family: 'flux',
    path: `${T2I}/flux-2-pro`,
    speed: '~18 s',
    note: 'Accepte une image de référence',
    reference: 'base64',
    body: (prompt, o) => withReference({ prompt, ...PIXELS[o.aspect] }, 'base64', o.reference),
  },
  {
    id: 'flux-2-flex',
    label: 'Flux.2 Flex',
    family: 'flux',
    path: `${T2I}/flux-2-flex`,
    speed: '~30 s',
    reference: 'base64',
    body: (prompt, o) => withReference({ prompt, ...PIXELS[o.aspect], output_format: 'jpeg' }, 'base64', o.reference),
  },
  {
    id: 'flux-pro-v1-1',
    label: 'Flux Pro 1.1',
    family: 'flux',
    path: `${T2I}/flux-pro-v1-1`,
    speed: '~5 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: FLUX_ASPECT[o.aspect], output_format: 'jpeg' }),
  },
  {
    id: 'flux-kontext-pro',
    label: 'Flux.1 Kontext Pro',
    family: 'flux',
    path: `${T2I}/flux-kontext-pro`,
    speed: '~11 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: FLUX_ASPECT[o.aspect], output_format: 'jpeg' }),
  },
  {
    id: 'flux-dev',
    label: 'Flux.1 Dev',
    family: 'flux',
    path: `${T2I}/flux-dev`,
    speed: '~13 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: FLUX_ASPECT[o.aspect] }),
  },
  {
    id: 'hyperflux',
    label: 'Hyperflux',
    family: 'flux',
    path: `${T2I}/hyperflux`,
    speed: '~6 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: FLUX_ASPECT[o.aspect] }),
  },
  {
    id: 'seedream-v5-pro',
    label: 'Seedream 5 Pro',
    family: 'seedream',
    path: `${T2I}/seedream-v5-pro`,
    speed: '~45 s',
    note: 'Photoréalisme, texte propre',
    reference: null,
    body: (prompt, o) => ({
      prompt,
      aspect_ratio: SEEDREAM_ASPECT[o.aspect],
      resolution: o.quality === 'pro' ? '2k' : '1.5k',
    }),
  },
  {
    id: 'seedream-v5-lite',
    label: 'Seedream 5 Lite',
    family: 'seedream',
    path: `${T2I}/seedream-v5-lite`,
    speed: '~1 min',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: SEEDREAM_ASPECT[o.aspect] }),
  },
  {
    id: 'seedream-v4-5',
    label: 'Seedream 4.5',
    family: 'seedream',
    path: `${T2I}/seedream-v4-5`,
    speed: '~50 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: SEEDREAM_ASPECT[o.aspect] }),
  },
  {
    id: 'seedream-v4',
    label: 'Seedream 4',
    family: 'seedream',
    path: `${T2I}/seedream-v4`,
    speed: '~33 s',
    reference: null,
    body: (prompt, o) => ({ prompt, aspect_ratio: SEEDREAM_ASPECT[o.aspect] }),
  },
  {
    id: 'mystic',
    label: 'Mystic 2.5 (Magnific)',
    family: 'mystic',
    path: '/v1/ai/mystic',
    speed: '~35 s',
    note: 'Le modèle maison de Magnific, ultra réaliste ; accepte une référence de style',
    reference: 'style',
    body: (prompt, o) =>
      withReference(
        { prompt, aspect_ratio: FLUX_ASPECT[o.aspect], resolution: o.quality === 'pro' ? '2k' : '1k', model: 'realism' },
        'style',
        o.reference,
      ),
  },
  {
    id: 'z-image',
    label: 'Z-Image Turbo',
    family: 'zimage',
    path: `${T2I}/z-image`,
    speed: '~5 s',
    reference: null,
    body: (prompt, o) => ({
      prompt,
      image_size: o.aspect === '4:5' ? 'portrait_3_4' : 'square_hd',
      output_format: 'jpeg',
    }),
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (OpenAI)',
    family: 'openai',
    path: `${T2I}/gpt-image-2`,
    speed: '~1 min',
    note: 'Suit les consignes longues (crédits)',
    reference: null,
    body: (prompt, o) => ({
      prompt,
      aspect_ratio: SEEDREAM_ASPECT[o.aspect],
      resolution: '1k',
      quality: o.quality === 'pro' ? 'high' : 'medium',
      output_format: 'jpeg',
    }),
  },
  {
    id: 'runway',
    label: 'Runway',
    family: 'runway',
    path: `${T2I}/runway`,
    speed: '~24 s',
    reference: null,
    body: (prompt, o) => ({ prompt, ratio: o.aspect === '4:5' ? '1080:1440' : '1080:1080' }),
  },
];

export const DEFAULT_FREEPIK_MODEL = 'nano-banana-pro-flash';
export const FAST_FREEPIK_MODEL = 'flux-2-klein';

export function findFreepikModel(id: string | null | undefined): FreepikModel | null {
  return FREEPIK_MODELS.find((m) => m.id === id) ?? null;
}
