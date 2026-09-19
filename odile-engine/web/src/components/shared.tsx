import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { humanizeError } from '../api/client';

export const STATUS_LABELS: Record<string, { label: string; dot: string; text: string }> = {
  draft: { label: 'Brouillon', dot: 'bg-white/25', text: 'text-muted' },
  reviewing: { label: 'Studio design', dot: 'bg-white/45', text: 'text-muted' },
  awaiting_approval: { label: 'À valider', dot: 'bg-accent', text: 'text-ice' },
  approved: { label: 'Approuvé', dot: 'bg-white/70', text: 'text-txt' },
  scheduled: { label: 'Programmé', dot: 'bg-accent/70', text: 'text-ice' },
  publishing: { label: 'Publication…', dot: 'bg-accent animate-pulse', text: 'text-ice' },
  published: { label: 'Publié', dot: 'bg-transparent ring-1 ring-white/70', text: 'text-muted' },
  rejected: { label: 'Rejeté', dot: 'bg-transparent ring-1 ring-white/25', text: 'text-muted' },
  failed: { label: 'Échec', dot: 'bg-white ring-2 ring-white/25', text: 'text-txt' },
};

export const CHANNEL_LABELS: Record<string, string> = {
  ig: 'Instagram',
  li_personal: 'LinkedIn perso',
  li_org: 'LinkedIn entreprise',
};

/** Formats de post (miroir de POST_FORMATS côté serveur). */
export const FORMAT_LABELS: Record<string, string> = {
  carousel: 'Carrousel',
  static: 'Image unique (Instagram)',
  li_image: 'Image LinkedIn',
  li_doc: 'Document PDF (LinkedIn)',
  reel: 'Vidéo verticale (Reel)',
};

/** Types de slide et champs, en français (les clés restent celles du schéma). */
export const SLIDE_KIND_LABELS: Record<string, string> = {
  hook: 'Accroche',
  content: 'Contenu',
  value_prop: 'Chiffre clé',
  screenshot: 'Capture',
  notifications: 'Notifications',
  cta: 'Appel à l’action',
};
export const SLIDE_FIELD_LABELS: Record<string, string> = {
  annotation: 'Annotation manuscrite',
  badge: 'Badge',
  title: 'Titre',
  subtitle: 'Sous-titre (« partie voilée | partie pleine »)',
  accentWord: 'Mot accentué',
  bigNumber: 'Gros chiffre',
  ctaLabel: 'Bouton d’action',
  body: 'Corps de texte',
  imageIdea: 'Idée d’illustration IA',
  bullets: 'Puces (une par ligne)',
  notifications: 'Notifications (une par ligne : titre | détail)',
  toolName: 'Nom de l’outil',
  toolUrl: 'URL de l’outil (capture)',
  icon: 'Icône',
  kind: 'Type de slide',
};

/** `simulated` : publié en mode simulation — le statut « publié » ne doit pas laisser croire le contraire. */
export function StatusBadge({ status, simulated }: { status: string; simulated?: boolean }) {
  const s = STATUS_LABELS[status] ?? { label: status, dot: 'bg-white/30', text: 'text-muted' };
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] uppercase tracking-wide ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {simulated && <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px]">simulation</span>}
    </span>
  );
}

/**
 * Titre de page — `accent` met un mot en Playfair italique, le même dispositif
 * que le mot accentué des slides : l'outil parle la langue de ce qu'il produit.
 */
export function PageTitle({
  title,
  accent,
  subtitle,
  actions,
}: {
  title: string;
  accent?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const idx = accent ? title.toLowerCase().indexOf(accent.toLowerCase()) : -1;
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
          {idx === -1 ? (
            title
          ) : (
            <>
              {title.slice(0, idx)}
              <span className="accent-serif text-[27px]">{title.slice(idx, idx + accent!.length)}</span>
              {title.slice(idx + accent!.length)}
            </>
          )}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-8 py-12 text-center">
      <div className="mx-auto max-w-sm text-sm leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Ce qu'on montre quand une lecture échoue.
 *
 * Une page qui reste vide laisse croire qu'il n'y a rien à voir : on cherche le
 * post qu'on attendait, on ne le trouve pas, et on doute de la machine. Dire
 * « le moteur n'a pas répondu » et offrir un bouton, c'est deux secondes au lieu
 * d'un quart d'heure.
 */
export function EtatErreur({ error, onRetry, quoi }: { error: unknown; onRetry?: () => void; quoi?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.02] px-8 py-10 text-center">
      <p className="text-sm font-semibold text-txt">{quoi ? `${quoi} n’a pas pu être chargé` : 'Chargement impossible'}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{humanizeError(error)}</p>
      {onRetry && (
        <button className="btn-ghost mt-5" onClick={onRetry}>
          <RotateCw size={14} /> Réessayer
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}


/**
 * Les défauts d'un post, en phrases, avant de valider : un bloquant empêche de
 * programmer, une attention prévient. « Réaligner » corrige ce qui se corrige seul.
 */
export function Problemes({ liste, compact = false }: { liste?: { niveau: 'bloquant' | 'attention'; message: string }[]; compact?: boolean }) {
  if (!liste || liste.length === 0) return null;
  const bloquants = liste.filter((p) => p.niveau === 'bloquant');
  const attentions = liste.filter((p) => p.niveau === 'attention');
  return (
    <div className={`rounded-xl border ${bloquants.length ? 'border-accent/50 bg-accent-soft/30' : 'border-line bg-white/[0.03]'} ${compact ? 'mt-2 px-3 py-2 text-[11px]' : 'mt-3 px-3.5 py-2.5 text-xs'}`}>
      {bloquants.length > 0 && (
        <div className="font-semibold text-txt">
          {bloquants.length === 1 ? 'Ne partira pas en l’état' : `${bloquants.length} points empêchent l’envoi`}
        </div>
      )}
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {[...bloquants, ...attentions].map((p, i) => (
          <li key={i} className={p.niveau === 'bloquant' ? 'text-txt' : 'text-muted'}>
            {p.niveau === 'bloquant' ? '⛔' : '⚠'} {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
