import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto, SummaryDto } from '../api/types';

/** Chaîne de publication, telle qu'elle est réellement en base. */
interface PublicationsDto {
  mode: 'live' | 'dry';
  dernierPassage: { a: string; ok: boolean } | null;
  aVenir: { postId: number; hook: string; channel: string; scheduledAt: string; tentative: number; tentativesMax: number }[];
  echecs: { postId: number; hook: string; channel: string; scheduledAt: string; erreur: string | null }[];
  publiees: {
    postId: number; hook: string; channel: string; publishedAt: string | null; url: string | null; simule: boolean;
    miroirFacebook: string | null; miroirErreur: string | null;
    portee: number | null; likes: number | null; commentaires: number | null; clics: number; releveLe: string | null;
  }[];
}
import { CHANNEL_LABELS, Empty, EtatErreur, fmtDate, Skeleton, StatusBadge } from '../components/shared';

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
      // personnes atteintes sur 7 j quand les plateformes l'ont fourni, sinon les clics trackés
      value: summary ? (summary.reach7d > 0 ? summary.reach7d : summary.clicks7d) : null,
      hint: summary
        ? summary.reach7d > 0
          ? `atteints sur 7 j · ${summary.clicks7d} clics · ${summary.pendingComments} DM en attente`
          : `clics sur 7 j · ${summary.pendingComments} DM en attente`
        : '',
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
  const { data: summary, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<SummaryDto>('/api/dashboard/summary'),
  });
  const { data: recent, isLoading } = useQuery({
    queryKey: ['posts', 'recent'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts'),
  });
  const { data: pub } = useQuery({
    queryKey: ['dashboard', 'publications'],
    queryFn: () => api.get<PublicationsDto>('/api/dashboard/publications'),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <div className="rise mb-8" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Tableau de bord</h1>
        {summary && <p className="mt-1.5 text-sm text-muted">{summary.cadence.reason}</p>}
      </div>
      {enErreur && <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="Le tableau de bord" />}

      {summary && summary.warnings.length > 0 && (
        <Link
          to="/setup"
          className="rise mb-8 flex flex-col gap-1 rounded-xl border border-white/25 bg-white/[0.03] px-4 py-3 text-sm hover:border-white/50"
          style={{ '--i': 0 } as React.CSSProperties}
        >
          {summary.warnings.map((w) => (
            <span key={`${w.provider}-${w.subject}`} className="flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" /> {w.message}
            </span>
          ))}
          <span className="text-xs text-muted">Ouvrir Connexions & santé →</span>
        </Link>
      )}

      <Thread summary={summary} />

      {pub && (
        <section className="rise mb-8" style={{ '--i': 2 } as React.CSSProperties}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-bold tracking-tight">Chaîne de publication</h2>
            <span className="text-xs text-muted">
              {pub.mode === 'live' ? 'publication réelle' : 'simulation — rien ne part sur les réseaux'}
              {pub.dernierPassage ? ` · dernier passage ${fmtDate(pub.dernierPassage.a)}` : ' · worker jamais passé'}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="card p-4">
              <div className="label !mb-2">À venir ({pub.aVenir.length})</div>
              {pub.aVenir.length === 0 && <p className="text-xs text-muted">Aucune publication en file.</p>}
              {pub.aVenir.slice(0, 5).map((j) => (
                <Link key={j.postId} to={`/posts/${j.postId}`} className="block border-t border-line py-2 first:border-0 first:pt-0 hover:text-ice">
                  <div className="truncate text-[13px] font-semibold">{j.hook || `Post ${j.postId}`}</div>
                  <div className="text-xs text-muted">{CHANNEL_LABELS[j.channel] ?? j.channel} · {fmtSlot(j.scheduledAt)}</div>
                </Link>
              ))}
            </div>
            <div className="card p-4">
              <div className="label !mb-2">Parties ({pub.publiees.length})</div>
              {pub.publiees.length === 0 && <p className="text-xs text-muted">Rien n'est encore parti.</p>}
              {pub.publiees.slice(0, 5).map((p) => (
                <div key={p.postId} className="border-t border-line py-2 first:border-0 first:pt-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/posts/${p.postId}`} className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:text-ice">
                      {p.hook || `Post ${p.postId}`}
                    </Link>
                    {p.simule && <span className="mono shrink-0 rounded-full bg-white/10 px-1.5 text-[9px] uppercase">simulation</span>}
                    {!p.simule && p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-accent hover:underline">voir ↗</a>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {p.publishedAt ? fmtDate(p.publishedAt) : ''}
                    {p.portee !== null ? ` · ${p.portee} atteints` : ''}
                    {p.likes !== null ? ` · ${p.likes} j'aime` : ''}
                    {p.clics > 0 ? ` · ${p.clics} clics` : ''}
                    {p.releveLe ? '' : p.simule ? '' : ' · chiffres pas encore relevés'}
                  </div>
                  {p.miroirErreur && <div className="mt-0.5 text-[11px] text-txt">Facebook : {p.miroirErreur}</div>}
                  {p.miroirFacebook && !p.miroirErreur && (
                    <a href={p.miroirFacebook} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">
                      recopié sur la Page Facebook ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
            <div className="card p-4">
              <div className="label !mb-2">Échecs ({pub.echecs.length})</div>
              {pub.echecs.length === 0 && <p className="text-xs text-muted">Aucun échec.</p>}
              {pub.echecs.slice(0, 5).map((j) => (
                <Link key={j.postId} to={`/posts/${j.postId}`} className="block border-t border-line py-2 first:border-0 first:pt-0">
                  <div className="truncate text-[13px] font-semibold">{j.hook || `Post ${j.postId}`}</div>
                  <div className="text-xs text-txt">{j.erreur ?? 'motif inconnu'}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

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
              <StatusBadge status={post.status} simulated={post.simulated} />
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
