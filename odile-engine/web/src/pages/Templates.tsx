import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Maximize2, Star, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { LibraryImageDto } from '../api/types';
import { LibraryThumb } from '../components/LibraryPicker';
import { Empty, PageTitle } from '../components/shared';

/** Paramètres d'un template — miroir du schéma serveur. */
interface Draft {
  name: string;
  accent: string;
  secondary: string | null;
  bg1: string;
  bg2: string;
  textColor: string;
  titleFont: 'inter' | 'playfair' | 'fragment';
  titleWeight: number;
  titleCase: 'normal' | 'upper';
  titleScale: number;
  accentStyle: 'serif' | 'plain' | 'underline' | 'highlight' | 'argent';
  accentLine: boolean;
  align: 'auto' | 'left' | 'center';
  decor: 'orbes' | 'halo' | 'degrade' | 'points' | 'anneaux' | 'arcs' | 'disques' | 'colonne' | 'anneaux-larges' | 'aucun';
  bgTop: string | null;
  decorIntensity: number;
  decorPosition: 'haut-droite' | 'haut-gauche' | 'bas-droite' | 'bas-gauche' | 'centre';
  gradientAngle: number;
  vignette: number;
  backgroundAssetId: string | null;
  backgroundOpacity: number;
  bgFit: 'cover' | 'contain';
  bgPosition: 'centre' | 'haut' | 'bas';
  bgBlur: number;
  bgBlend: 'normal' | 'multiply' | 'screen' | 'soft-light' | 'luminosity';
  radius: 'pill' | 'rounded' | 'sharp';
  glass: number;
  grain: boolean;
  grainLevel: number;
  frame: 'aucun' | 'texte' | 'accent';
  padding: 'serre' | 'normal' | 'aere';
  showLogo: boolean;
  showCounter: boolean;
  brandStyle: 'auto' | 'logo' | 'initiales' | 'logo-nom' | 'aucun';
  counterStyle: 'pilule' | 'mono';
  titleGradient: 'aucun' | 'accent' | 'argent' | 'horizontal';
  ctaStyle: 'verre' | 'plein' | 'degrade' | 'chevron';
  ctaArrow: 'droite' | 'haut-droite' | 'aucune';
  bigNumberWeight: 300 | 500 | 900;
  showAuthor: boolean;
  showVerifiedBadge: boolean;
  brandPosition: 'bas' | 'bas-centre' | 'haut-centre';
  floatAssetId1: string | null;
  floatAssetId2: string | null;
  floatAssetId3: string | null;
  floatAssetId4: string | null;
  floatSize: number;
  floatLayout: 'coins' | 'haut' | 'bas' | 'cotes' | '4-coins';
  floatBleed: boolean;
  floatTilt: number;
  floatSlides: 'centrees' | 'accroche' | 'toutes';
  imageStyle: 'auto' | 'full' | 'objets' | 'chrome';
  heroGrade: 'aucun' | 'vif' | 'teinte' | 'doux';
  heroPlacement: 'centre' | 'haut' | 'droite' | 'gauche';
  heroSize: number;
  heroGlow: boolean;
  popColor: string;
  accentFromImage: boolean;
  // Personnalisation fine
  bodyFont: 'inter' | 'playfair' | 'fragment';
  bodyScale: number;
  bodyWeight: number;
  bodyOpacity: number;
  bodyColor: string | null;
  lineHeight: 'serre' | 'normal' | 'aere';
  titleTracking: number;
  titleColor: string | null;
  blockGap: number;
  subtitleScale: number;
  subtitleTone: 'voile' | 'plein';
  verticalAlign: 'centre' | 'haut' | 'bas';
  padTop: number | null;
  padSide: number | null;
  padBottom: number | null;
  badgeStyle: 'point' | 'plein' | 'contour' | 'texte';
  badgeColor: string | null;
  bulletGlyph: 'fleche' | 'point' | 'coche' | 'numero' | 'tiret';
  bulletColor: string | null;
  iconBadgeSize: number;
  annotationFont: 'caveat' | 'inter' | 'fragment';
  annotationScale: number;
  annotationColor: string | null;
  annotationTilt: number;
  ctaSize: number;
  logoSize: number;
  footerInset: number;
  footerBottom: number;
  counterSize: number;
  decorScale: number;
  bgTopSpread: number;
  heroScrim: number;
}
interface CustomTemplate extends Draft {
  id: string;
  themeId: string;
}
interface Catalogue {
  builtin: { id: string; label: string }[];
  custom: CustomTemplate[];
}

const BLANK: Draft = {
  name: 'Mon template',
  accent: '#0099ff',
  secondary: null,
  bg1: '#050508',
  bg2: '#0a1024',
  textColor: '#fdfdfd',
  titleFont: 'inter',
  titleWeight: 800,
  titleCase: 'normal',
  titleScale: 100,
  accentStyle: 'serif',
  accentLine: false,
  align: 'auto',
  decor: 'orbes',
  bgTop: null,
  decorIntensity: 100,
  decorPosition: 'haut-droite',
  gradientAngle: 168,
  vignette: 0,
  backgroundAssetId: null,
  backgroundOpacity: 35,
  bgFit: 'cover',
  bgPosition: 'centre',
  bgBlur: 0,
  bgBlend: 'normal',
  radius: 'pill',
  glass: 50,
  grain: true,
  grainLevel: 30,
  frame: 'aucun',
  padding: 'normal',
  showLogo: true,
  showCounter: true,
  brandStyle: 'auto',
  counterStyle: 'pilule',
  titleGradient: 'aucun',
  ctaStyle: 'verre',
  ctaArrow: 'droite',
  bigNumberWeight: 900,
  showAuthor: false,
  showVerifiedBadge: false,
  brandPosition: 'bas',
  floatAssetId1: null,
  floatAssetId2: null,
  floatAssetId3: null,
  floatAssetId4: null,
  floatSize: 30,
  floatLayout: 'coins',
  floatBleed: true,
  floatTilt: 12,
  floatSlides: 'centrees',
  imageStyle: 'auto',
  heroGrade: 'vif',
  heroPlacement: 'centre',
  heroSize: 100,
  heroGlow: true,
  popColor: 'auto',
  accentFromImage: true,
  bodyFont: 'inter',
  bodyScale: 100,
  bodyWeight: 500,
  bodyOpacity: 88,
  bodyColor: null,
  lineHeight: 'normal',
  titleTracking: -25,
  titleColor: null,
  blockGap: 36,
  subtitleScale: 100,
  subtitleTone: 'voile',
  verticalAlign: 'centre',
  padTop: null,
  padSide: null,
  padBottom: null,
  badgeStyle: 'point',
  badgeColor: null,
  bulletGlyph: 'fleche',
  bulletColor: null,
  iconBadgeSize: 100,
  annotationFont: 'caveat',
  annotationScale: 100,
  annotationColor: null,
  annotationTilt: -4,
  ctaSize: 100,
  logoSize: 100,
  footerInset: 96,
  footerBottom: 56,
  counterSize: 100,
  decorScale: 100,
  bgTopSpread: 15,
  heroScrim: 100,
};

/** Marges des trois réglages « serrées / normales / aérées » (miroir du serveur). */
const PADDINGS: Record<Draft['padding'], { top: number; side: number; bottom: number }> = {
  serre: { top: 84, side: 76, bottom: 140 },
  normal: { top: 104, side: 96, bottom: 150 },
  aere: { top: 128, side: 120, bottom: 172 },
};

interface StartPoint {
  id: string;
  label: string;
  hint: string;
  swatch: string;
  draft: Partial<Draft>;
}

/**
 * Recettes signature : chaque recette reproduit une mise en page de référence
 * (couche codée + style d'image), en un clic. Tout reste modifiable ensuite.
 */
const RECIPES: StartPoint[] = [
  {
    id: 'signal',
    label: 'Signal',
    hint: 'Disques violets nets, arcs fins, badge icône, titre dégradé, bouton chevron — 100 % codé',
    swatch: 'linear-gradient(150deg,#06050a,#4c1d95 55%,#c4b5fd)',
    draft: {
      accent: '#a78bfa',
      secondary: '#7c3aed',
      bg1: '#06050a',
      bg2: '#0d0716',
      decor: 'disques',
      decorPosition: 'haut-gauche',
      titleWeight: 700,
      titleScale: 140,
      titleGradient: 'horizontal',
      accentStyle: 'plain',
      align: 'center',
      ctaStyle: 'chevron',
      ctaArrow: 'aucune',
      grainLevel: 25,
      imageStyle: 'objets',
      heroPlacement: 'centre',
      subtitleScale: 105,
    },
  },
  {
    id: 'pieces',
    label: 'Pièces',
    hint: 'Dégradé lavande → violet, anneaux, 4 objets aux coins, chiffre fin, bouton dégradé ↗, logo centré',
    swatch: 'linear-gradient(180deg,#b9a8ec,#33195f 40%,#0f0722)',
    draft: {
      accent: '#a78bfa',
      secondary: '#c4b5fd',
      bg1: '#33195f',
      bg2: '#0f0722',
      bgTop: '#b9a8ec',
      bgTopSpread: 18,
      gradientAngle: 180,
      decor: 'anneaux-larges',
      titleWeight: 700,
      accentStyle: 'plain',
      align: 'center',
      bigNumberWeight: 300,
      ctaStyle: 'degrade',
      ctaArrow: 'haut-droite',
      brandPosition: 'bas-centre',
      showCounter: false,
      floatLayout: '4-coins',
      floatBleed: true,
      floatTilt: 14,
      floatSize: 32,
      imageStyle: 'objets',
    },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hint: 'Colonne de lumière bleue, objet chrome ancré en haut, titre deux lignes blanc / argent, logo en pilule',
    swatch: 'linear-gradient(180deg,#02040f,#1a4fe8 45%,#02040f)',
    draft: {
      accent: '#2f83ff',
      secondary: '#9aa3b8',
      bg1: '#02040f',
      bg2: '#061a4d',
      decor: 'colonne',
      decorPosition: 'centre',
      titleWeight: 800,
      titleScale: 120,
      accentStyle: 'argent',
      accentLine: true,
      align: 'center',
      ctaStyle: 'plein',
      imageStyle: 'chrome',
      heroPlacement: 'haut',
      heroSize: 110,
      heroGlow: true,
      brandPosition: 'haut-centre',
      brandStyle: 'logo',
    },
  },
  {
    id: 'horizon',
    label: 'Horizon',
    hint: 'Image plein cadre vive avec une couleur signature, chip auteur photo + badge vérifié, titre argent à gauche',
    swatch: 'linear-gradient(160deg,#050510,#0a2a66 55%,#d9ee4a)',
    draft: {
      accent: '#0099ff',
      secondary: '#8ecdff',
      bg1: '#050510',
      bg2: '#0a2a66',
      decor: 'halo',
      titleWeight: 500,
      titleScale: 115,
      titleGradient: 'argent',
      accentStyle: 'serif',
      align: 'left',
      showAuthor: true,
      showVerifiedBadge: true,
      imageStyle: 'full',
      heroGrade: 'vif',
      popColor: 'auto',
      accentFromImage: true,
    },
  },
];

/** Autres points de départ : palettes et ambiances, un clic charge la recette. */
const PRESETS: StartPoint[] = [
  { id: 'nuit', label: 'Nuit bleue', hint: 'Le réglage d’origine : orbes de verre bleu nuit', swatch: 'linear-gradient(150deg,#050508,#0a1024 60%,#0099ff)', draft: {} },
  {
    id: 'ambre',
    label: 'Ambre',
    hint: 'Halo chaud sur fond noir',
    swatch: 'linear-gradient(150deg,#0a0a0a,#2a1000 60%,#ff8a00)',
    draft: { accent: '#ff8a00', secondary: '#ffb35c', bg1: '#0a0a0a', bg2: '#2a1000', decor: 'halo' },
  },
  {
    id: 'papier',
    label: 'Papier',
    hint: 'Fond ivoire, encre noire, accent bleu',
    swatch: 'linear-gradient(150deg,#f6f4ef,#e9e4d8 60%,#1d4ed8)',
    draft: { accent: '#1d4ed8', bg1: '#f6f4ef', bg2: '#e9e4d8', textColor: '#0b0b0e', decor: 'degrade', grainLevel: 40, frame: 'texte' },
  },
  {
    id: 'encre',
    label: 'Encre',
    hint: 'Monochrome blanc sur noir',
    swatch: 'linear-gradient(150deg,#050506,#141418 60%,#ffffff)',
    draft: { accent: '#ffffff', secondary: '#d8d8dc', bg1: '#050506', bg2: '#101014', glass: 60 },
  },
  {
    id: 'neon',
    label: 'Néon',
    hint: 'Arcs lumineux violets, titre dégradé',
    swatch: 'linear-gradient(150deg,#07060c,#120a2a 60%,#8b5cf6)',
    draft: {
      accent: '#8b5cf6',
      secondary: '#c4b5fd',
      bg1: '#07060c',
      bg2: '#120a2a',
      decor: 'arcs',
      titleGradient: 'accent',
      titleWeight: 700,
      accentStyle: 'plain',
      align: 'center',
      vignette: 20,
      ctaStyle: 'verre',
      imageStyle: 'chrome',
    },
  },
  {
    id: 'editorial',
    label: 'Éditorial',
    hint: 'Serif, cadre fin doré, sans décor',
    swatch: 'linear-gradient(150deg,#101014,#17171c 60%,#e6c27a)',
    draft: {
      accent: '#e6c27a',
      bg1: '#101014',
      bg2: '#17171c',
      titleFont: 'playfair',
      titleWeight: 700,
      accentStyle: 'plain',
      align: 'left',
      radius: 'rounded',
      frame: 'accent',
      decor: 'aucun',
      vignette: 35,
      bodyFont: 'playfair',
      bulletGlyph: 'tiret',
    },
  },
];

/** Approximation éditable de chaque thème fourni (« Personnaliser » un thème intégré). */
const BUILTIN_RECIPES: Record<string, Partial<Draft>> = {
  'odile-nuit': { accent: '#0099ff', bg1: '#010208', bg2: '#123c7e', gradientAngle: 180, decor: 'halo', decorPosition: 'bas-droite' },
  'verre-bleu': { accent: '#0099ff', bg1: '#010207', bg2: '#0a1a42', decor: 'orbes', glass: 60 },
  'cyan-tech': { accent: '#0099ff', secondary: '#7dd3fc', bg1: '#041c38', bg2: '#010204', gradientAngle: 150, decor: 'points', titleWeight: 700 },
  'violet-glow': { accent: '#a78bfa', secondary: '#c4b5fd', bg1: '#05030a', bg2: '#150a2e', decor: 'points', decorPosition: 'centre', vignette: 20 },
  'encre-blanche': { accent: '#ffffff', secondary: '#d8d8dc', bg1: '#050506', bg2: '#101014', decor: 'orbes', glass: 60 },
  'papier-blanc': { accent: '#111114', secondary: '#6b6b75', bg1: '#f5f3ef', bg2: '#ebe7df', textColor: '#0b0b0e', decor: 'orbes', grainLevel: 40 },
};

const POP_PRESETS: { hex: string; label: string }[] = [
  { hex: '#d9ee4a', label: 'Jaune-vert' },
  { hex: '#ffb02e', label: 'Ambre' },
  { hex: '#ff7a1a', label: 'Orange' },
  { hex: '#ff6a3d', label: 'Corail' },
  { hex: '#ff3fa4', label: 'Magenta' },
  { hex: '#3ef2ff', label: 'Cyan' },
  { hex: '#ff3b3b', label: 'Rouge' },
];

const DECOR_LABELS: Record<Draft['decor'], string> = {
  orbes: 'Orbes de verre',
  halo: 'Halo diffus',
  degrade: 'Dégradé',
  points: 'Halo + grille de points',
  anneaux: 'Anneaux concentriques',
  arcs: 'Arcs lumineux',
  disques: 'Disques nets + arcs',
  colonne: 'Colonne de lumière',
  'anneaux-larges': 'Grands anneaux',
  aucun: 'Aucun décor',
};
const PREVIEW_KINDS: { id: string; label: string }[] = [
  { id: 'hook', label: 'Accroche' },
  { id: 'objet', label: 'Objet' },
  { id: 'value_prop', label: 'Chiffre' },
  { id: 'content', label: 'Contenu' },
  { id: 'liste', label: 'Liste' },
  { id: 'notifications', label: 'Notifs' },
  { id: 'capture', label: 'Capture' },
  { id: 'echo', label: 'Écho' },
  { id: 'cta', label: 'CTA' },
  { id: 'bouton', label: 'Bouton' },
];

const HEX = /^#[0-9a-f]{6}$/i;
const HEX_FIELDS = ['accent', 'bg1', 'bg2', 'textColor'] as const;
const HEX_OPTIONAL = ['secondary', 'bgTop', 'bodyColor', 'titleColor', 'badgeColor', 'bulletColor', 'annotationColor'] as const;
/** Champs couleur invalides (le serveur refuserait le brouillon). */
function invalidColors(d: Draft): string[] {
  const bad: string[] = [];
  for (const k of HEX_FIELDS) if (!HEX.test(d[k])) bad.push(k);
  for (const k of HEX_OPTIONAL) if (d[k] && !HEX.test(d[k]!)) bad.push(k);
  if (d.popColor !== 'auto' && d.popColor !== 'aucune' && !HEX.test(d.popColor)) bad.push('popColor');
  return bad;
}

/** Aperçu live : re-rendu par le serveur 350 ms après la dernière modification (le nom ne compte pas). */
function Preview({ draft, kind, valid }: { draft: Draft; kind: string; valid: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [zooming, setZooming] = useState(false);
  const { name: _name, ...rest } = draft;
  const key = JSON.stringify(rest);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/templates/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...draft, kind }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!res.ok) return;
        objectUrl = URL.createObjectURL(await res.blob());
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return objectUrl;
        });
      } catch {
        /* requête annulée ou réseau : l'aperçu précédent reste affiché */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind, valid]);

  const openZoom = async () => {
    setZooming(true);
    try {
      const res = await fetch('/api/templates/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, kind, full: true }),
        credentials: 'same-origin',
      });
      if (res.ok) setZoom(URL.createObjectURL(await res.blob()));
    } finally {
      setZooming(false);
    }
  };
  const closeZoom = () => {
    if (zoom) URL.revokeObjectURL(zoom);
    setZoom(null);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line">
      {url ? (
        <img src={url} alt="Aperçu du template" className="block w-full" />
      ) : (
        <div className="skeleton aspect-[4/5] w-full" />
      )}
      {!valid && (
        <div className="absolute inset-x-3 top-3 rounded-lg bg-red-500/80 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          Une couleur est invalide (format #rrggbb) — l’aperçu attend.
        </div>
      )}
      {loading && valid && (
        <div className="absolute right-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] text-muted backdrop-blur">
          rendu…
        </div>
      )}
      {url && (
        <button
          className="absolute bottom-3 right-3 rounded-full bg-ink/80 p-2 text-muted backdrop-blur hover:text-txt"
          title="Voir en taille réelle"
          disabled={zooming}
          onClick={() => void openZoom()}
        >
          <Maximize2 size={14} />
        </button>
      )}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={closeZoom}>
          <img src={zoom} alt="Aperçu en taille réelle" className="max-h-full max-w-full rounded-xl shadow-2xl" />
          <button className="absolute right-4 top-4 rounded-full bg-ink/80 p-2 text-txt" onClick={closeZoom} title="Fermer">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

// --- Petits contrôles ----------------------------------------------------------

/** Section repliable ; l'état ouvert/replié est mémorisé par section dans le navigateur. */
function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  const storageKey = `odile.templates.section.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) !== '0';
    } catch {
      return true;
    }
  });
  return (
    <details
      className="section-toggle border-t border-line py-3"
      open={open}
      onToggle={(e) => {
        const v = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(v);
        try {
          localStorage.setItem(storageKey, v ? '1' : '0');
        } catch {
          /* stockage indisponible */
        }
      }}
    >
      <summary className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
        <ChevronRight size={14} className="chev text-muted" />
        {title}
        {hint && <span className="ml-1 truncate text-[11px] font-normal text-muted">{hint}</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="-mt-2 text-[11px] leading-snug text-muted">{children}</p>;
}

function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="label !mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              value === o.v ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="label !mb-1">
        {label} : <span className="mono normal-case text-txt">{value}{unit}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        className="w-full accent-[color:var(--color-accent)]"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  clearable,
  placeholder,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  clearable?: boolean;
  placeholder?: string;
}) {
  const invalid = Boolean(value) && !HEX.test(value!);
  return (
    <div>
      <label className="label !mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          value={value && HEX.test(value) ? value : '#888888'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={`input mono !py-1.5 ${invalid ? '!border-red-500/70' : ''}`}
          value={value ?? ''}
          placeholder={placeholder ?? (clearable ? '= accent' : '#rrggbb')}
          title={invalid ? 'Format attendu : #rrggbb' : undefined}
          onChange={(e) => onChange(e.target.value || (clearable ? null : e.target.value))}
        />
        {clearable && value && (
          <button className="pill-btn" title="Revenir à la valeur automatique" onClick={() => onChange(null)}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="ml-6 mt-0.5 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

function StartPointCard({ p, onPick }: { p: StartPoint; onPick: () => void }) {
  return (
    <button
      className="flex items-center gap-3 rounded-xl border border-line p-2 text-left transition-colors hover:border-accent/50"
      onClick={onPick}
      title={p.hint}
    >
      <span className="h-10 w-10 shrink-0 rounded-lg border border-white/10" style={{ background: p.swatch }} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{p.label}</span>
        <span className="block truncate text-[11px] text-muted">{p.hint}</span>
      </span>
    </button>
  );
}

// --- Page ----------------------------------------------------------------------

export default function Templates() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState('value_prop');
  const [toast, setToast] = useState<string | null>(null);
  const [morePoints, setMorePoints] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalid = useMemo(() => invalidColors(draft), [draft]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const { data: catalogue } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Catalogue>('/api/templates'),
  });
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
  });
  const { data: defaultTheme } = useQuery({
    queryKey: ['settings', 'default_theme'],
    queryFn: () => api.get<{ value: string }>('/api/settings/default_theme'),
  });
  const setDefault = useMutation({
    mutationFn: (themeId: string) => api.put('/api/settings/default_theme', themeId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => alert(String(e)),
  });
  const isDefault = (themeId: string) => defaultTheme?.value === themeId;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setMany = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const reset = () => {
    setDraft(BLANK);
    setEditingId(null);
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['templates'] });
    void qc.invalidateQueries({ queryKey: ['library'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  const save = useMutation({
    mutationFn: () =>
      editingId
        ? api.put<{ ok: true }>(`/api/templates/${editingId}`, draft).then(() => editingId)
        : api.post<{ ok: true; id: string }>('/api/templates', draft).then((r) => r.id),
    onSuccess: (id) => {
      invalidate();
      // On reste sur le template (les retouches suivantes s'enregistrent dessus)
      setEditingId(id);
      setToast(editingId ? 'Modifications enregistrées' : `Template « ${draft.name} » créé`);
    },
    onError: (e) => alert(String(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/templates/${id}`),
    onSuccess: (_r, id) => {
      invalidate();
      if (editingId === id) reset();
    },
    onError: (e) => alert(String(e)),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/api/templates/${id}/duplicate`),
    onSuccess: invalidate,
    onError: (e) => alert(String(e)),
  });

  const uploadBackground = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/library', { method: 'POST', body, credentials: 'same-origin' });
    if (!res.ok) return alert('Téléversement impossible');
    const { id } = (await res.json()) as { id: string };
    set('backgroundAssetId', id);
    invalidate();
  };

  const pickBackground = (img: LibraryImageDto | null) => {
    setDraft((d) => ({
      ...d,
      backgroundAssetId: img?.id ?? null,
      // Un détourage se pose entier ; une photo remplit le cadre
      bgFit: img?.cutout ? 'contain' : 'cover',
      backgroundOpacity: img?.cutout && d.backgroundOpacity < 60 ? 85 : d.backgroundOpacity,
    }));
  };

  const applyStart = (p: StartPoint) => {
    setDraft((d) => ({ ...BLANK, name: d.name, ...p.draft }));
    setToast(`Point de départ « ${p.label} » chargé`);
  };
  const loadTemplate = (t: CustomTemplate) => {
    const { id: _id, themeId: _t, ...rest } = t;
    setEditingId(t.id);
    setDraft({ ...BLANK, ...rest });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const customizeBuiltin = (id: string, label: string) => {
    setEditingId(null);
    setDraft({ ...BLANK, name: `${label} (perso)`, ...(BUILTIN_RECIPES[id] ?? {}) });
    setToast(`Copie éditable du thème « ${label} »`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedBg = library?.find((i) => i.id === draft.backgroundAssetId) ?? null;
  const hasFloats = Boolean(draft.floatAssetId1 || draft.floatAssetId2 || draft.floatAssetId3 || draft.floatAssetId4);
  const precisePads = draft.padTop !== null || draft.padSide !== null || draft.padBottom !== null;
  const pads = PADDINGS[draft.padding];

  return (
    <div>
      <PageTitle
        title="Templates"
        accent="Templates"
        subtitle="Partez d’une recette, puis réglez tout : couleurs, typographie, mise en page, décor, matière, illustrations, objets, marque. L’aperçu se met à jour en direct."
        actions={
          editingId ? (
            <button className="btn-ghost" onClick={reset}>
              Nouveau template
            </button>
          ) : undefined
        }
      />

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-line bg-ink/95 px-4 py-2 text-sm shadow-xl backdrop-blur">
          {toast}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_22rem]">
        {/* Éditeur */}
        <div className="card p-5">
          <div className="mb-4 flex items-end gap-3">
            <div className="flex-1">
              <label className="label !mb-1">Nom du template</label>
              <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            {editingId && (
              <span className="mono mb-2 rounded-full bg-accent-soft px-2.5 py-1 text-[10px] uppercase tracking-wider text-ice">en édition</span>
            )}
          </div>

          <div className="mb-3">
            <label className="label !mb-1.5">Recettes signature — un clic règle tout, chaque paramètre reste modifiable en dessous</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {RECIPES.map((r) => (
                <StartPointCard key={r.id} p={r} onPick={() => applyStart(r)} />
              ))}
            </div>
            <button className="mt-2 text-xs text-accent hover:underline" onClick={() => setMorePoints((v) => !v)}>
              {morePoints ? 'Masquer les autres points de départ' : 'Autres points de départ (palettes, ambiances)'}
            </button>
            {morePoints && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PRESETS.map((p) => (
                  <StartPointCard key={p.id} p={p} onPick={() => applyStart(p)} />
                ))}
              </div>
            )}
          </div>

          <Section id="couleurs" title="Couleurs">
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Accent" value={draft.accent} onChange={(v) => set('accent', v ?? draft.accent)} />
              <ColorField label="Texte" value={draft.textColor} onChange={(v) => set('textColor', v ?? draft.textColor)} />
              <ColorField label="Fond — haut" value={draft.bg1} onChange={(v) => set('bg1', v ?? draft.bg1)} />
              <ColorField label="Fond — bas" value={draft.bg2} onChange={(v) => set('bg2', v ?? draft.bg2)} />
              <ColorField label="Secondaire (gros chiffres, second décor)" value={draft.secondary} onChange={(v) => set('secondary', v)} clearable />
              <ColorField label="Bande claire en haut (ex. lavande → violet)" value={draft.bgTop} onChange={(v) => set('bgTop', v)} clearable placeholder="aucune" />
              <ColorField label="Couleur des titres" value={draft.titleColor} onChange={(v) => set('titleColor', v)} clearable placeholder="= texte" />
              <ColorField label="Couleur du corps de texte" value={draft.bodyColor} onChange={(v) => set('bodyColor', v)} clearable placeholder="= texte" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Angle du dégradé" value={draft.gradientAngle} min={0} max={360} unit="°" onChange={(v) => set('gradientAngle', v)} />
              {draft.bgTop && (
                <Range label="Étalement de la bande claire" value={draft.bgTopSpread} min={5} max={45} unit=" %" onChange={(v) => set('bgTopSpread', v)} />
              )}
            </div>
            <div>
              <label className="label !mb-1.5">Couleur signature des images — UNE teinte vive portée par le sujet, reprise par le mot accentué</label>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { v: 'auto', l: 'Auto (selon l’accent)' },
                  { v: 'aucune', l: 'Aucune' },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => set('popColor', o.v)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      draft.popColor === o.v ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
                {POP_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    title={p.label}
                    onClick={() => set('popColor', p.hex)}
                    className={`h-8 w-8 rounded-full border-2 ${draft.popColor === p.hex ? 'border-white' : 'border-transparent'}`}
                    style={{ background: p.hex }}
                  />
                ))}
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-panel2"
                  value={HEX.test(draft.popColor) ? draft.popColor : '#d9ee4a'}
                  onChange={(e) => set('popColor', e.target.value)}
                  title="Couleur personnalisée"
                />
              </div>
            </div>
          </Section>

          <Section id="typo" title="Typographie">
            <Chips
              label="Police des titres"
              value={draft.titleFont}
              options={[
                { v: 'inter', l: 'Inter' },
                { v: 'playfair', l: 'Playfair (serif)' },
                { v: 'fragment', l: 'Fragment Mono' },
              ]}
              onChange={(v) => set('titleFont', v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Graisse des titres" value={draft.titleWeight} min={400} max={900} step={100} onChange={(v) => set('titleWeight', v)} />
              <Range label="Taille des titres" value={draft.titleScale} min={60} max={140} unit=" %" onChange={(v) => set('titleScale', v)} />
              <Range label="Approche des titres" value={draft.titleTracking} min={-60} max={40} unit=" ‰" onChange={(v) => set('titleTracking', v)} hint="Espacement des lettres : négatif = resserré (−25 par défaut)." />
              <Chips
                label="Interlignage"
                value={draft.lineHeight}
                options={[
                  { v: 'serre', l: 'Serré' },
                  { v: 'normal', l: 'Normal' },
                  { v: 'aere', l: 'Aéré' },
                ]}
                onChange={(v) => set('lineHeight', v)}
              />
            </div>
            <Chips
              label="Casse"
              value={draft.titleCase}
              options={[
                { v: 'normal', l: 'Normale' },
                { v: 'upper', l: 'CAPITALES' },
              ]}
              onChange={(v) => set('titleCase', v)}
            />
            <Chips
              label="Mot accentué"
              value={draft.accentStyle}
              options={[
                { v: 'serif', l: 'Serif italique' },
                { v: 'plain', l: 'Couleur seule' },
                { v: 'underline', l: 'Souligné' },
                { v: 'highlight', l: 'Surligné' },
                { v: 'argent', l: 'Argent dégradé' },
              ]}
              onChange={(v) => set('accentStyle', v)}
              hint="Le rédacteur choisit un mot par titre ; ce réglage décide comment il ressort."
            />
            <Toggle label="Mot accentué sur sa propre ligne (titre en deux lignes « Devis / Express »)" checked={draft.accentLine} onChange={(v) => set('accentLine', v)} />
            <Chips
              label="Dégradé du titre"
              value={draft.titleGradient}
              options={[
                { v: 'aucun', l: 'Aucun' },
                { v: 'accent', l: 'Blanc → accent' },
                { v: 'argent', l: 'Blanc → argent' },
                { v: 'horizontal', l: 'Horizontal blanc → accent' },
              ]}
              onChange={(v) => set('titleGradient', v)}
            />
            <Chips
              label="Graisse des gros chiffres (« 87 % »)"
              value={String(draft.bigNumberWeight) as '300' | '500' | '900'}
              options={[
                { v: '300', l: 'Fine' },
                { v: '500', l: 'Médium' },
                { v: '900', l: 'Noire' },
              ]}
              onChange={(v) => set('bigNumberWeight', Number(v) as 300 | 500 | 900)}
            />
            <div className="border-t border-line/60 pt-3">
              <Chips
                label="Police du corps de texte"
                value={draft.bodyFont}
                options={[
                  { v: 'inter', l: 'Inter' },
                  { v: 'playfair', l: 'Playfair (serif)' },
                  { v: 'fragment', l: 'Fragment Mono' },
                ]}
                onChange={(v) => set('bodyFont', v)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Taille du corps et des puces" value={draft.bodyScale} min={60} max={140} unit=" %" onChange={(v) => set('bodyScale', v)} />
              <Range label="Graisse du corps" value={draft.bodyWeight} min={400} max={700} step={100} onChange={(v) => set('bodyWeight', v)} />
              <Range label="Opacité du corps" value={draft.bodyOpacity} min={40} max={100} unit=" %" onChange={(v) => set('bodyOpacity', v)} hint="Sous 75 %, le texte devient gris et moins lisible sur une image." />
              <Range label="Taille du sous-titre" value={draft.subtitleScale} min={60} max={140} unit=" %" onChange={(v) => set('subtitleScale', v)} />
            </div>
            <Chips
              label="Sous-titre (« le tueur silencieux des | conversions »)"
              value={draft.subtitleTone}
              options={[
                { v: 'voile', l: 'Deux tons : voilé puis plein' },
                { v: 'plein', l: 'Tout en couleur du texte' },
              ]}
              onChange={(v) => set('subtitleTone', v)}
            />
          </Section>

          <Section id="mise-en-page" title="Mise en page">
            <div className="grid gap-4 sm:grid-cols-2">
              <Chips
                label="Alignement"
                value={draft.align}
                options={[
                  { v: 'auto', l: 'Auto' },
                  { v: 'left', l: 'Gauche' },
                  { v: 'center', l: 'Centré' },
                ]}
                onChange={(v) => set('align', v)}
                hint="Auto : centré sur l’accroche, le chiffre, le CTA et l’écho ; à gauche sur le contenu."
              />
              <Chips
                label="Position verticale du texte"
                value={draft.verticalAlign}
                options={[
                  { v: 'centre', l: 'Centre' },
                  { v: 'haut', l: 'Haut' },
                  { v: 'bas', l: 'Bas' },
                ]}
                onChange={(v) => set('verticalAlign', v)}
              />
            </div>
            <Range label="Espace entre les blocs (badge, titre, corps, bouton)" value={draft.blockGap} min={8} max={80} unit=" px" onChange={(v) => set('blockGap', v)} />
            <Chips
              label="Marges"
              value={draft.padding}
              options={[
                { v: 'serre', l: 'Serrées' },
                { v: 'normal', l: 'Normales' },
                { v: 'aere', l: 'Aérées' },
              ]}
              onChange={(v) => setMany({ padding: v, padTop: null, padSide: null, padBottom: null })}
            />
            <Toggle
              label="Marges précises (px)"
              checked={precisePads}
              onChange={(v) => setMany(v ? { padTop: pads.top, padSide: pads.side, padBottom: pads.bottom } : { padTop: null, padSide: null, padBottom: null })}
              hint="Distance du texte aux bords de la slide (1080 × 1350). La marge basse réserve la place du pied de marque."
            />
            {precisePads && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Range label="Haut" value={draft.padTop ?? pads.top} min={40} max={320} unit=" px" onChange={(v) => set('padTop', v)} />
                <Range label="Côtés" value={draft.padSide ?? pads.side} min={40} max={220} unit=" px" onChange={(v) => set('padSide', v)} />
                <Range label="Bas" value={draft.padBottom ?? pads.bottom} min={80} max={360} unit=" px" onChange={(v) => set('padBottom', v)} />
              </div>
            )}
          </Section>

          <Section id="decor" title="Décor">
            <Chips
              label="Décor"
              value={draft.decor}
              options={(Object.keys(DECOR_LABELS) as Draft['decor'][]).map((d) => ({ v: d, l: DECOR_LABELS[d] }))}
              onChange={(v) => set('decor', v)}
            />
            {draft.decor !== 'aucun' && (
              <>
                <Chips
                  label="Position"
                  value={draft.decorPosition}
                  options={[
                    { v: 'haut-droite', l: 'Haut droite' },
                    { v: 'haut-gauche', l: 'Haut gauche' },
                    { v: 'bas-droite', l: 'Bas droite' },
                    { v: 'bas-gauche', l: 'Bas gauche' },
                    { v: 'centre', l: 'Centre' },
                  ]}
                  onChange={(v) => set('decorPosition', v)}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Range label="Intensité du décor" value={draft.decorIntensity} min={0} max={100} unit=" %" onChange={(v) => set('decorIntensity', v)} />
                  <Range label="Échelle du décor" value={draft.decorScale} min={60} max={140} unit=" %" onChange={(v) => set('decorScale', v)} />
                </div>
              </>
            )}
            <Range label="Vignettage des bords" value={draft.vignette} min={0} max={100} unit=" %" onChange={(v) => set('vignette', v)} />
          </Section>

          <Section id="fond" title="Image de fond">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label !mb-0">Bibliothèque</span>
                <div className="flex items-center gap-2">
                  <Link to="/images" className="text-xs text-accent hover:underline">
                    Studio d'images →
                  </Link>
                  <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => fileInput.current?.click()}>
                    <Upload size={12} /> Importer
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void uploadBackground(f);
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => pickBackground(null)}
                  className={`h-16 w-[3.2rem] rounded-lg border text-[10px] text-muted ${
                    draft.backgroundAssetId === null ? 'border-accent/60 bg-accent-soft' : 'border-line'
                  }`}
                >
                  aucune
                </button>
                {library?.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => pickBackground(img)}
                    className={`h-16 w-[3.2rem] overflow-hidden rounded-lg border ${
                      draft.backgroundAssetId === img.id ? 'border-accent' : 'border-line'
                    }`}
                    title={img.prompt ?? ''}
                  >
                    <LibraryThumb img={img} className="h-full w-full" />
                  </button>
                ))}
              </div>
            </div>
            {draft.backgroundAssetId && (
              <>
                <Range label="Intensité de l'image" value={draft.backgroundOpacity} min={0} max={100} unit=" %" onChange={(v) => set('backgroundOpacity', v)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Chips
                    label="Cadrage"
                    value={draft.bgFit}
                    options={[
                      { v: 'cover', l: 'Remplir' },
                      { v: 'contain', l: selectedBg?.cutout ? 'Objet entier' : 'Entière' },
                    ]}
                    onChange={(v) => set('bgFit', v)}
                  />
                  <Chips
                    label="Position"
                    value={draft.bgPosition}
                    options={[
                      { v: 'centre', l: 'Centre' },
                      { v: 'haut', l: 'Haut' },
                      { v: 'bas', l: 'Bas' },
                    ]}
                    onChange={(v) => set('bgPosition', v)}
                  />
                </div>
                <Range label="Flou" value={draft.bgBlur} min={0} max={60} unit=" px" onChange={(v) => set('bgBlur', v)} />
                <Chips
                  label="Fusion avec le fond"
                  value={draft.bgBlend}
                  options={[
                    { v: 'normal', l: 'Normale' },
                    { v: 'multiply', l: 'Produit' },
                    { v: 'screen', l: 'Superposition' },
                    { v: 'soft-light', l: 'Lumière douce' },
                    { v: 'luminosity', l: 'Luminosité' },
                  ]}
                  onChange={(v) => set('bgBlend', v)}
                />
              </>
            )}
          </Section>

          <Section id="matiere" title="Matière & composants">
            <Chips
              label="Angles des pilules et cartes"
              value={draft.radius}
              options={[
                { v: 'pill', l: 'Pilule' },
                { v: 'rounded', l: 'Arrondi' },
                { v: 'sharp', l: 'Net' },
              ]}
              onChange={(v) => set('radius', v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Intensité du verre" value={draft.glass} min={0} max={100} unit=" %" onChange={(v) => set('glass', v)} />
              <Range label="Grain de film" value={draft.grain ? draft.grainLevel : 0} min={0} max={100} unit=" %" onChange={(v) => setDraft((d) => ({ ...d, grain: v > 0, grainLevel: v }))} />
            </div>
            <Chips
              label="Cadre fin"
              value={draft.frame}
              options={[
                { v: 'aucun', l: 'Aucun' },
                { v: 'texte', l: 'Couleur du texte' },
                { v: 'accent', l: 'Accent' },
              ]}
              onChange={(v) => set('frame', v)}
            />
            <div className="border-t border-line/60 pt-3">
              <Chips
                label="Boutons (CTA, mot-clé)"
                value={draft.ctaStyle}
                options={[
                  { v: 'verre', l: 'Verre' },
                  { v: 'plein', l: 'Plein accent' },
                  { v: 'degrade', l: 'Dégradé blanc → accent' },
                  { v: 'chevron', l: 'Verre + chevron ›' },
                ]}
                onChange={(v) => set('ctaStyle', v)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Chips
                label="Flèche des boutons"
                value={draft.ctaArrow}
                options={[
                  { v: 'droite', l: '→' },
                  { v: 'haut-droite', l: '↗' },
                  { v: 'aucune', l: 'Aucune' },
                ]}
                onChange={(v) => set('ctaArrow', v)}
              />
              <Range label="Taille des boutons" value={draft.ctaSize} min={60} max={130} unit=" %" onChange={(v) => set('ctaSize', v)} />
            </div>
            <div className="border-t border-line/60 pt-3">
              <Chips
                label="Badge (« PME · AUTOMATISATION »)"
                value={draft.badgeStyle}
                options={[
                  { v: 'point', l: 'Verre + point' },
                  { v: 'plein', l: 'Plein' },
                  { v: 'contour', l: 'Contour' },
                  { v: 'texte', l: 'Texte seul' },
                ]}
                onChange={(v) => set('badgeStyle', v)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Couleur du badge" value={draft.badgeColor} onChange={(v) => set('badgeColor', v)} clearable />
              <ColorField label="Couleur des puces" value={draft.bulletColor} onChange={(v) => set('bulletColor', v)} clearable />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Chips
                label="Puces des listes"
                value={draft.bulletGlyph}
                options={[
                  { v: 'fleche', l: '→' },
                  { v: 'point', l: '•' },
                  { v: 'coche', l: '✓' },
                  { v: 'numero', l: '01, 02…' },
                  { v: 'tiret', l: '—' },
                ]}
                onChange={(v) => set('bulletGlyph', v)}
              />
              <Range label="Taille du badge icône" value={draft.iconBadgeSize} min={60} max={140} unit=" %" onChange={(v) => set('iconBadgeSize', v)} hint="Le rond en verre avec l’icône, au-dessus du titre (slide Contenu)." />
            </div>
            <div className="border-t border-line/60 pt-3">
              <Chips
                label="Annotation manuscrite (« testé pour vous »)"
                value={draft.annotationFont}
                options={[
                  { v: 'caveat', l: 'Manuscrite (Caveat)' },
                  { v: 'inter', l: 'Inter' },
                  { v: 'fragment', l: 'Fragment Mono' },
                ]}
                onChange={(v) => set('annotationFont', v)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Range label="Taille" value={draft.annotationScale} min={60} max={140} unit=" %" onChange={(v) => set('annotationScale', v)} />
              <Range label="Inclinaison" value={draft.annotationTilt} min={-12} max={12} unit="°" onChange={(v) => set('annotationTilt', v)} />
              <ColorField label="Couleur" value={draft.annotationColor} onChange={(v) => set('annotationColor', v)} clearable placeholder="= texte" />
            </div>
          </Section>

          <Section id="illustrations" title="Illustrations IA">
            <Chips
              label="Style des images générées pour les posts qui utilisent ce template"
              value={draft.imageStyle}
              options={[
                { v: 'auto', l: 'Auto (selon la slide)' },
                { v: 'full', l: 'Plein cadre' },
                { v: 'objets', l: 'Objets détourés' },
                { v: 'chrome', l: 'Chrome & verre' },
              ]}
              onChange={(v) => set('imageStyle', v)}
              hint="« Plein cadre » : scène cinématique sous le titre. « Objets » et « Chrome & verre » : objet 3D détouré, fondu à la palette, posé en illustration ou en objet flottant."
            />
            <Chips
              label="Traitement des images plein cadre"
              value={draft.heroGrade}
              options={[
                { v: 'vif', l: 'Vif (contraste + saturation)' },
                { v: 'aucun', l: 'Aucun' },
                { v: 'doux', l: 'Voile léger' },
                { v: 'teinte', l: 'Voile accent (teinte)' },
              ]}
              onChange={(v) => set('heroGrade', v)}
            />
            <Range label="Voile de lisibilité sous le texte (images plein cadre)" value={draft.heroScrim} min={0} max={100} unit=" %" onChange={(v) => set('heroScrim', v)} hint="Assombrit le bas de l’image pour que le titre reste lisible. 0 % = image brute." />
            <Toggle label="Le mot accentué du titre prend la couleur signature détectée dans l'image" checked={draft.accentFromImage} onChange={(v) => set('accentFromImage', v)} />
            <Chips
              label="Placement d'un objet détouré (aperçu « Objet »)"
              value={draft.heroPlacement}
              options={[
                { v: 'centre', l: 'Au-dessus du titre' },
                { v: 'haut', l: 'Ancré en haut (déborde)' },
                { v: 'droite', l: 'À droite, texte à gauche' },
                { v: 'gauche', l: 'À gauche, texte à droite' },
              ]}
              onChange={(v) => set('heroPlacement', v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Taille de l'objet" value={draft.heroSize} min={60} max={140} unit=" %" onChange={(v) => set('heroSize', v)} />
              <Toggle label="Halo accent derrière l'objet" checked={draft.heroGlow} onChange={(v) => set('heroGlow', v)} />
            </div>
          </Section>

          <Section id="objets" title="Objets flottants" hint={hasFloats ? undefined : '— aucun objet choisi'}>
            <p className="text-xs text-muted">
              Jusqu'à quatre images <b>détourées</b> de la bibliothèque (objets 3D, produits…) posées en périphérie, comme des
              pièces qui flottent autour du texte. Générez-les dans <Link to="/images" className="text-accent hover:underline">Images</Link> avec « Supprimer l'arrière-plan ».
            </p>
            {([1, 2, 3, 4] as const).map((n) => {
              const key = `floatAssetId${n}` as const;
              return (
                <div key={n}>
                  <label className="label !mb-1.5">Objet {n}</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => set(key, null)}
                      className={`h-16 w-[3.2rem] rounded-lg border text-[10px] text-muted ${draft[key] === null ? 'border-accent/60 bg-accent-soft' : 'border-line'}`}
                    >
                      aucun
                    </button>
                    {library
                      ?.filter((img) => img.cutout)
                      .map((img) => (
                        <button
                          key={img.id}
                          onClick={() => set(key, img.id)}
                          className={`h-16 w-[3.2rem] overflow-hidden rounded-lg border ${draft[key] === img.id ? 'border-accent' : 'border-line'}`}
                          title={img.prompt ?? ''}
                        >
                          <LibraryThumb img={img} className="h-full w-full" />
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
            {hasFloats && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Range label="Taille" value={draft.floatSize} min={10} max={60} unit=" %" onChange={(v) => set('floatSize', v)} />
                  <Range label="Inclinaison" value={draft.floatTilt} min={0} max={30} unit="°" onChange={(v) => set('floatTilt', v)} />
                </div>
                <Chips
                  label="Disposition"
                  value={draft.floatLayout}
                  options={[
                    { v: 'coins', l: 'Coins opposés' },
                    { v: '4-coins', l: 'Quatre coins' },
                    { v: 'haut', l: 'En haut' },
                    { v: 'bas', l: 'En bas' },
                    { v: 'cotes', l: 'Sur les côtés' },
                  ]}
                  onChange={(v) => set('floatLayout', v)}
                />
                <Toggle label="Les objets débordent du cadre (coupés par les bords)" checked={draft.floatBleed} onChange={(v) => set('floatBleed', v)} />
                <Chips
                  label="Sur quelles slides"
                  value={draft.floatSlides}
                  options={[
                    { v: 'centrees', l: 'Slides centrées (accroche, chiffre, CTA)' },
                    { v: 'accroche', l: "L'accroche seulement" },
                    { v: 'toutes', l: 'Toutes' },
                  ]}
                  onChange={(v) => set('floatSlides', v)}
                />
              </>
            )}
          </Section>

          <Section id="marque" title="Marque & pied de page">
            <Toggle label="Chip auteur en haut (photo ou logo, nom, ligne, coche)" checked={draft.showAuthor} onChange={(v) => set('showAuthor', v)} hint="Photo et ligne sous le nom : Réglages → Marque." />
            <Toggle label="Badge « vérifié » en haut à droite" checked={draft.showVerifiedBadge} onChange={(v) => set('showVerifiedBadge', v)} />
            <Chips
              label="Position de la marque"
              value={draft.brandPosition}
              options={[
                { v: 'bas', l: 'Pied, à gauche' },
                { v: 'bas-centre', l: 'Pied, centré' },
                { v: 'haut-centre', l: 'Pilule en haut au centre' },
              ]}
              onChange={(v) => set('brandPosition', v)}
            />
            <Chips
              label="Marque en pied"
              value={draft.showLogo ? draft.brandStyle : 'aucun'}
              options={[
                { v: 'auto', l: 'Réglage de la marque' },
                { v: 'initiales', l: 'OA · Odile AI · @odileai' },
                { v: 'logo', l: 'Logo seul' },
                { v: 'logo-nom', l: 'Logo réduit + nom + handle' },
                { v: 'aucun', l: 'Aucune' },
              ]}
              onChange={(v) => setMany({ brandStyle: v, showLogo: v !== 'aucun' })}
              hint="« Réglage de la marque » suit Réglages → Marque → Pied de marque."
            />
            <Chips
              label="Compteur « 03/06 → swipe »"
              value={draft.showCounter ? draft.counterStyle : 'aucun'}
              options={[
                { v: 'pilule', l: 'Pilule de verre' },
                { v: 'mono', l: 'Texte mono discret' },
                { v: 'aucun', l: 'Masqué' },
              ]}
              onChange={(v) => setMany(v === 'aucun' ? { showCounter: false } : { counterStyle: v, showCounter: true })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Taille de la marque" value={draft.logoSize} min={50} max={160} unit=" %" onChange={(v) => set('logoSize', v)} />
              <Range label="Taille du compteur" value={draft.counterSize} min={60} max={140} unit=" %" onChange={(v) => set('counterSize', v)} />
              <Range label="Marge latérale du pied" value={draft.footerInset} min={40} max={160} unit=" px" onChange={(v) => set('footerInset', v)} hint="Vaut aussi pour la chip auteur et le badge vérifié." />
              <Range label="Hauteur du pied" value={draft.footerBottom} min={24} max={120} unit=" px" onChange={(v) => set('footerBottom', v)} />
            </div>
          </Section>

          {invalid.length > 0 && (
            <p className="mt-4 text-xs text-red-400">Couleur invalide : {invalid.join(', ')} — format attendu #rrggbb.</p>
          )}
          <button
            className="btn-primary mt-5 w-full justify-center"
            disabled={save.isPending || invalid.length > 0 || draft.name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            <Check size={14} />
            {editingId ? 'Enregistrer les modifications' : 'Créer le template'}
          </button>
        </div>

        {/* Aperçu live */}
        <div className="md:sticky md:top-6 md:self-start">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted/70">Aperçu</span>
            <div className="pill-bar flex-wrap">
              {PREVIEW_KINDS.map((k) => (
                <button
                  key={k.id}
                  className={`pill-btn pill-btn--text ${previewKind === k.id ? 'pill-btn--on' : ''}`}
                  onClick={() => setPreviewKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <Preview draft={draft} kind={previewKind} valid={invalid.length === 0} />
          <p className="mt-2 text-[11px] text-muted">
            Chaque type de slide a son contenu témoin. La loupe ouvre le rendu en taille réelle (1080 × 1350).
          </p>
        </div>
      </div>

      {/* Mes templates */}
      <h2 className="mb-3 mt-9 text-[15px] font-bold tracking-tight">Mes templates</h2>
      {catalogue && catalogue.custom.length === 0 && (
        <Empty>Aucun template maison pour l'instant — composez-en un ci-dessus.</Empty>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {catalogue?.custom.map((t) => (
          <div key={t.id} className={`card flex items-center gap-3 p-3 ${editingId === t.id ? 'border-accent/50' : ''}`}>
            <div
              className="h-12 w-12 shrink-0 rounded-xl border border-line"
              style={{ background: `linear-gradient(150deg, ${t.bg1}, ${t.bg2} 60%, ${t.accent})` }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t.name}</div>
              <div className="mono text-[11px] text-muted">
                {DECOR_LABELS[t.decor]} · {t.titleFont}
              </div>
            </div>
            {isDefault(t.themeId) ? (
              <span className="mono rounded-full bg-accent-soft px-2.5 py-1 text-[10px] uppercase tracking-wider text-ice">
                par défaut
              </span>
            ) : (
              <button
                className="btn-ghost !px-3 !py-1 text-xs"
                title="Tous les nouveaux posts utiliseront ce template"
                disabled={setDefault.isPending}
                onClick={() => setDefault.mutate(t.themeId)}
              >
                <Star size={12} /> Par défaut
              </button>
            )}
            <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => loadTemplate(t)}>
              Modifier
            </button>
            <button className="pill-btn" title="Dupliquer" disabled={duplicate.isPending} onClick={() => duplicate.mutate(t.id)}>
              <Copy size={13} />
            </button>
            <button
              className="pill-btn"
              title="Supprimer"
              onClick={() => {
                if (confirm(`Supprimer le template « ${t.name} » ?`)) remove.mutate(t.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-9 text-[15px] font-bold tracking-tight">Thèmes fournis</h2>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        {catalogue?.builtin.map((b) => (
          <div
            key={b.id}
            className={`flex items-center gap-2 rounded-xl border p-2 ${isDefault(b.id) ? 'border-accent/50 bg-accent-soft/40' : 'border-line'}`}
          >
            <span
              className="h-8 w-8 shrink-0 rounded-lg border border-white/10"
              style={{
                background: `linear-gradient(150deg, ${BUILTIN_RECIPES[b.id]?.bg1 ?? '#050508'}, ${BUILTIN_RECIPES[b.id]?.bg2 ?? '#0a1024'} 60%, ${BUILTIN_RECIPES[b.id]?.accent ?? '#0099ff'})`,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {b.label}
              {isDefault(b.id) && <span className="mono ml-2 text-[10px] uppercase tracking-wider text-ice">· par défaut</span>}
            </span>
            {!isDefault(b.id) && (
              <button className="pill-btn" title="Utiliser comme thème par défaut" disabled={setDefault.isPending} onClick={() => setDefault.mutate(b.id)}>
                <Star size={12} />
              </button>
            )}
            <button className="btn-ghost !px-2.5 !py-1 text-xs" title="Ouvrir une copie éditable dans l’éditeur" onClick={() => customizeBuiltin(b.id, b.label)}>
              Personnaliser
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Le thème « par défaut » habille tous les nouveaux posts ; chaque post peut ensuite en changer dans son éditeur.
        « Personnaliser » ouvre une copie approchée d’un thème fourni, à régler et enregistrer comme template maison.
      </p>
    </div>
  );
}
