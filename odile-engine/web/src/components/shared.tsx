import type { ReactNode } from 'react';

export const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'bg-slate-600/40 text-slate-200' },
  reviewing: { label: 'Studio design', cls: 'bg-violet-600/30 text-violet-200' },
  awaiting_approval: { label: 'À valider', cls: 'bg-amber-500/25 text-amber-200' },
  approved: { label: 'Approuvé', cls: 'bg-emerald-600/25 text-emerald-200' },
  scheduled: { label: 'Programmé', cls: 'bg-sky-600/25 text-sky-200' },
  publishing: { label: 'Publication…', cls: 'bg-sky-600/40 text-sky-100' },
  published: { label: 'Publié', cls: 'bg-emerald-600/40 text-emerald-100' },
  rejected: { label: 'Rejeté', cls: 'bg-red-600/25 text-red-200' },
  failed: { label: 'Échec', cls: 'bg-red-600/45 text-red-100' },
};

export const CHANNEL_LABELS: Record<string, string> = {
  ig: 'Instagram',
  li_personal: 'LinkedIn perso',
  li_org: 'LinkedIn entreprise',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, cls: 'bg-slate-600/40 text-slate-200' };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-10 text-center text-sm text-muted">{children}</div>;
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
