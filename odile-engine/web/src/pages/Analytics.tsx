import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Empty, fmtDate, PageTitle } from '../components/shared';

interface ClicksDto {
  total: number;
  perDay: { day: string; count: number }[];
  perLink: { linkId: number; postId: number | null; label: string; target: string; count: number }[];
}
interface LearningDto {
  sources: { name: string; weight: number; enabled: boolean }[];
  topics: { topic: string; factor: number }[];
  lastLearnAt: string | null;
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
  const { data: learning } = useQuery({
    queryKey: ['analytics', 'learning'],
    queryFn: () => api.get<LearningDto>('/api/analytics/learning'),
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

      {learning && (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h2 className="mb-1 text-base font-bold">Sources qui performent</h2>
            <p className="mb-3 text-xs text-muted">
              Poids ajustés chaque lundi par la boucle d'apprentissage
              {learning.lastLearnAt ? ` (dernier passage : ${fmtDate(learning.lastLearnAt)})` : ' (pas encore exécutée)'}.
            </p>
            <div className="flex flex-col gap-1 text-sm">
              {learning.sources.slice(0, 8).map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className={`flex-1 truncate ${s.enabled ? '' : 'line-through opacity-50'}`}>{s.name}</span>
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${((s.weight - 0.5) / 1.5) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-muted">{s.weight.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="mb-1 text-base font-bold">Sujets qui performent</h2>
            <p className="mb-3 text-xs text-muted">Affinités apprises des clics — elles boostent (ou pénalisent) le score des actus.</p>
            {learning.topics.length === 0 && (
              <p className="text-sm text-muted">Pas encore de données — les affinités apparaîtront après quelques posts publiés.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {learning.topics.slice(0, 16).map((t) => (
                <span
                  key={t.topic}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    t.factor >= 1.05 ? 'bg-emerald-500/20 text-emerald-200' : t.factor <= 0.95 ? 'bg-red-500/15 text-red-300' : 'bg-panel2 text-muted'
                  }`}
                >
                  {t.topic} ×{t.factor.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

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
