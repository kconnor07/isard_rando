import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto, SummaryDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, Skeleton, StatusBadge } from '../components/shared';

/** « jeu. 18:30 » — assez court pour tenir sur une ligne de station. */
function fmtSlot(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Le fil de fabrication : la chaîne réelle du moteur, avec ses compteurs
 * vivants à chaque station. La structure de la page EST celle du produit.
 */
function Thread({ summary }: { summary?: SummaryDto }) {
  const stations: {
    key: string;
    label: string;
    value: string | number | null;
    hint: string;
    to: string;
    live?: boolean;
  }[] = [
    {
      key: 'veille',
      label: 'Veille',
      value: '24/7',
      hint: 'scan horaire des sources',
      to: '/news',
    },
    {
      key: 'redaction',
      label: 'Rédaction',
      value: summary ? fmtSlot(summary.nextSlots.instagram) : null,
      hint: summary ? `prochain créneau ${fmtDate(summary.nextSlots.instagram)}` : '',
      to: '/calendar',
    },
    {
      key: 'validation',
      label: 'Validation',
      value: summary?.awaitingApproval ?? null,
      hint: 'posts qui attendent votre œil',
      to: '/approvals',
      live: (summary?.awaitingApproval ?? 0) > 0,
    },
    {
      key: 'publication',
      label: 'Publication',
      value: summary ? summary.scheduled + summary.published : null,
      hint: summary ? `${summary.scheduled} programmés · ${summary.published} publiés` : '',
      to: '/calendar',
    },
    {
      key: 'resonance',
      label: 'Résonance',
      value: summary?.clicks7d ?? null,
      hint: summary ? `clics sur 7 j · ${summary.pendingComments} DM en attente` : '',
      to: '/analytics',
    },
  ];

  return (
    <section className="rise mb-10" style={{ '--i': 0 } as React.CSSProperties}>
      <h2 className="mb-5 text-[15px] font-bold tracking-tight">
        Le fil de <span className="accent-serif text-[16px]">fabrication</span>
      </h2>
      <div className="relative">
        <div className="thread-line absolute left-0 right-0 top-[3px] max-md:hidden" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-5">
          {stations.map((s) => (
            <Link key={s.key} to={s.to} className="group relative block min-w-0">
              <span
                className={`station-dot mb-3 block max-md:hidden ${s.live ? 'station-dot--live' : ''}`}
              />
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
                {s.label}
              </div>
              {s.value === null ? (
                <Skeleton className="mt-1.5 h-8 w-16" />
              ) : (
                <div
                  className={`mono mt-0.5 whitespace-nowrap leading-tight transition-colors ${
                    typeof s.value === 'string' && s.value.length > 5
                      ? 'py-[5px] text-[19px]'
                      : 'text-[28px]'
                  } ${s.live ? 'text-accent' : 'text-ice group-hover:text-txt'}`}
                >
                  {s.value}
                </div>
              )}
              <div className="mt-0.5 truncate text-[11px] text-muted" title={s.hint}>
                {s.hint}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<SummaryDto>('/api/dashboard/summary'),
  });
  const { data: recent, isLoading } = useQuery({
    queryKey: ['posts', 'recent'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts'),
  });

  return (
    <div>
      <div className="rise mb-8" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Tableau de bord</h1>
        {summary && <p className="mt-1.5 text-sm text-muted">{summary.cadence.reason}</p>}
      </div>

      <Thread summary={summary} />

      <section className="rise" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold tracking-tight">Posts récents</h2>
          <Link to="/approvals" className="text-xs font-medium text-accent hover:underline">
            Tout voir
          </Link>
        </div>

        {isLoading && (
          <div className="flex flex-col gap-3 pt-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        )}

        {recent && recent.length === 0 && (
          <div className="pt-3">
            <Empty
              action={
                <Link to="/news" className="btn-primary">
                  Ouvrir la veille
                </Link>
              }
            >
              Aucun post pour l'instant. Choisissez une actualité dans la veille pour lancer la
              première fabrication, ou laissez le cycle automatique de 7 h s'en charger.
            </Empty>
          </div>
        )}

        <div className="divide-y divide-line">
          {recent?.slice(0, 10).map((post, i) => (
            <Link
              key={post.id}
              to={`/posts/${post.id}`}
              className="rise group flex items-center gap-4 py-3.5 transition-colors hover:bg-white/[0.025] md:px-2 md:-mx-2 rounded-lg"
              style={{ '--i': 3 + i } as React.CSSProperties}
            >
              <StatusBadge status={post.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold group-hover:text-ice">
                  {post.hook || '(sans titre)'}
                </div>
                <div className="mono mt-0.5 text-[11px] text-muted">
                  {CHANNEL_LABELS[post.channel] ?? post.channel} · {post.slideCount} slides
                  {post.scheduledAt ? ` · prévu ${fmtDate(post.scheduledAt)}` : ''}
                </div>
              </div>
              <div className="mono shrink-0 text-[11px] text-muted/80">{fmtDate(post.createdAt)}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
