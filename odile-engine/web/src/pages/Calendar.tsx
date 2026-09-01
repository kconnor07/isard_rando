import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, PageTitle, StatusBadge } from '../components/shared';

export default function Calendar() {
  const { data: posts } = useQuery({
    queryKey: ['calendar'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/calendar'),
  });

  const byDay = new Map<string, PostSummaryDto[]>();
  for (const post of posts ?? []) {
    const day = (post.scheduledAt ?? post.publishedAt ?? post.createdAt).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), post]);
  }
  const days = [...byDay.keys()].sort();

  return (
    <div>
      <PageTitle title="Calendrier de publication" subtitle="Posts programmés et publiés (heure de Paris)." />
      {days.length === 0 && <Empty>Rien de programmé. Approuve un post pour réserver un créneau.</Empty>}
      <div className="flex flex-col gap-6">
        {days.map((day) => (
          <div key={day}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">
              {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                new Date(`${day}T12:00:00`),
              )}
            </h2>
            <div className="flex flex-col gap-2">
              {byDay.get(day)!.map((post) => (
                <Link key={post.id} to={`/posts/${post.id}`} className="card flex items-center gap-4 p-4 hover:border-accent/50">
                  <span className="w-14 font-mono text-sm text-accent">
                    {fmtDate(post.scheduledAt ?? post.publishedAt).split(' ').pop()}
                  </span>
                  <StatusBadge status={post.status} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{post.hook}</span>
                  <span className="text-xs text-muted">{CHANNEL_LABELS[post.channel] ?? post.channel}</span>
                  {post.externalUrl && post.status === 'published' && (
                    <a
                      href={post.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      voir ↗
                    </a>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
