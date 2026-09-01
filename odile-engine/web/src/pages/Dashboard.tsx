import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto, SummaryDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, PageTitle, StatusBadge } from '../components/shared';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card flex-1 p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-3xl font-extrabold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<SummaryDto>('/api/dashboard/summary'),
  });
  const { data: recent } = useQuery({
    queryKey: ['posts', 'recent'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts'),
  });

  return (
    <div>
      <PageTitle
        title="Tableau de bord"
        subtitle={summary ? `Cadence : ${summary.cadence.reason}` : undefined}
      />
      <div className="mb-6 flex gap-4">
        <Stat label="À valider" value={summary?.awaitingApproval ?? '…'} />
        <Stat label="Programmés" value={summary?.scheduled ?? '…'} />
        <Stat label="Publiés" value={summary?.published ?? '…'} />
        <Stat label="Clics (7 j)" value={summary?.clicks7d ?? '…'} />
        <Stat
          label="Prochain créneau IG"
          value={summary ? fmtDate(summary.nextSlots.instagram).split(' ').slice(0, 3).join(' ') : '…'}
          hint={summary ? fmtDate(summary.nextSlots.instagram) : undefined}
        />
      </div>

      <h2 className="mb-3 text-lg font-bold">Posts récents</h2>
      {recent && recent.length === 0 && (
        <Empty>
          Aucun post pour l'instant. Va dans <Link className="text-accent" to="/news">Veille IA</Link> pour
          générer ton premier post, ou attends le prochain cycle automatique (7 h).
        </Empty>
      )}
      <div className="flex flex-col gap-2">
        {recent?.slice(0, 10).map((post) => (
          <Link key={post.id} to={`/posts/${post.id}`} className="card flex items-center gap-4 p-4 hover:border-accent/50">
            <StatusBadge status={post.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{post.hook || '(sans titre)'}</div>
              <div className="text-xs text-muted">
                {CHANNEL_LABELS[post.channel] ?? post.channel} · {post.format} · {post.slideCount} slide(s)
                {post.scheduledAt ? ` · prévu ${fmtDate(post.scheduledAt)}` : ''}
              </div>
            </div>
            <div className="text-xs text-muted">{fmtDate(post.createdAt)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
