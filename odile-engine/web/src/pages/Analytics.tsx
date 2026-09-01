import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Empty, fmtDate, PageTitle } from '../components/shared';

interface ClicksDto {
  total: number;
  perDay: { day: string; count: number }[];
  perLink: { linkId: number; postId: number | null; label: string; target: string; count: number }[];
}
interface PostStatDto {
  id: number;
  hook: string;
  channel: string;
  publishedAt: string | null;
  externalUrl: string | null;
  clicks: number;
  comments: number;
}

export default function Analytics() {
  const { data: clicks } = useQuery({
    queryKey: ['analytics', 'clicks'],
    queryFn: () => api.get<ClicksDto>('/api/analytics/clicks?days=30'),
  });
  const { data: posts } = useQuery({
    queryKey: ['analytics', 'posts'],
    queryFn: () => api.get<PostStatDto[]>('/api/analytics/posts'),
  });

  const max = Math.max(1, ...(clicks?.perDay.map((d) => d.count) ?? [1]));

  return (
    <div>
      <PageTitle title="Analytics" subtitle="Clics trackés (liens courts /r/) sur 30 jours et performance des posts." />
      <div className="card mb-6 p-5">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-3xl font-extrabold">{clicks?.total ?? '…'}</span>
          <span className="text-sm text-muted">clics sur 30 jours</span>
        </div>
        <div className="flex h-32 items-end gap-1">
          {clicks?.perDay.map((d) => (
            <div key={d.day} className="group relative flex-1">
              <div
                className="rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${Math.max(4, (d.count / max) * 120)}px` }}
              />
              <div className="absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded bg-panel2 px-1.5 py-0.5 text-[10px] group-hover:block">
                {d.day.slice(5)} : {d.count}
              </div>
            </div>
          ))}
          {(clicks?.perDay.length ?? 0) === 0 && <div className="text-sm text-muted">Pas encore de clics.</div>}
        </div>
      </div>

      <h2 className="mb-3 text-lg font-bold">Posts publiés</h2>
      {posts && posts.length === 0 && <Empty>Aucun post publié pour l'instant.</Empty>}
      <div className="card divide-y divide-line">
        {posts?.map((post) => (
          <div key={post.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{post.hook}</div>
              <div className="text-xs text-muted">
                {post.channel} · {fmtDate(post.publishedAt)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-extrabold text-accent">{post.clicks}</div>
              <div className="text-[10px] uppercase text-muted">clics</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-extrabold">{post.comments}</div>
              <div className="text-[10px] uppercase text-muted">comm.</div>
            </div>
            {post.externalUrl && (
              <a href={post.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-accent">
                voir ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
