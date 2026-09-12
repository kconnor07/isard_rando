import type { ReactNode } from 'react';

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
};

/** Types de slide et champs, en français (les clés restent celles du schéma). */
export const SLIDE_KIND_LABELS: Record<string, string> = {
  hook: 'Accroche',
  content: 'Contenu',
  value_prop: 'Chiffre clé',
  screenshot: 'Capture',
  notifications: 'Notifications',
  echo: 'Écho',
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
  echoWord: 'Mot répété en fond',
  icon: 'Icône',
  kind: 'Type de slide',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, dot: 'bg-white/30', text: 'text-muted' };
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] uppercase tracking-wide ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
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
    <div className="mb-7 flex items-start justify-between gap-4">
      <div>
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
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
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
