import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, PageTitle, StatusBadge } from '../components/shared';

export default function Approvals() {
  const qc = useQueryClient();
  const { data: posts } = useQuery({
    queryKey: ['posts', 'pending'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts?status=draft,reviewing,awaiting_approval'),
    refetchInterval: 15_000,
  });

  const approve = useMutation({
    mutationFn: (vars: { id: number; publishNow: boolean }) =>
      api.post(`/api/posts/${vars.id}/approve`, { publishNow: vars.publishNow }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['posts'] }),
  });
  const reject = useMutation({
    mutationFn: (vars: { id: number; reason?: string }) =>
      api.post(`/api/posts/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['posts'] }),
  });

  return (
    <div>
      <PageTitle
        title="Posts à valider"
        subtitle="Rien ne part sans ton accord — approuve, modifie ou rejette."
      />
      {posts && posts.length === 0 && <Empty>Aucun post en attente de validation. 🎉</Empty>}
      <div className="flex flex-col gap-4">
        {posts?.map((post) => (
          <div key={post.id} className="card p-5">
            <div className="mb-2 flex items-center gap-3">
              <StatusBadge status={post.status} />
              <span className="text-xs font-semibold text-muted">
                {CHANNEL_LABELS[post.channel] ?? post.channel} · {post.format} · thème {post.theme}
              </span>
              {post.reviewSummary && (
                <span
                  className={`text-xs font-semibold ${post.reviewSummary.passed ? 'text-emerald-300' : 'text-amber-300'}`}
                >
                  🎨 studio : {post.reviewSummary.iterations} itér. ·{' '}
                  {Object.values(post.reviewSummary.finalScores).join(' / ')}
                </span>
              )}
              <span className="ml-auto text-xs text-muted">{fmtDate(post.createdAt)}</span>
            </div>
            <Link to={`/posts/${post.id}`} className="text-lg font-bold hover:text-accent">
              {post.hook || '(sans titre)'}
            </Link>
            {post.newsTitle && (
              <p className="mt-1 text-xs text-muted">
                📰 Source : {post.newsTitle}
              </p>
            )}
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{post.caption}</p>
            <div className="mt-4 flex gap-2">
              <button
                className="btn-success"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ id: post.id, publishNow: false })}
              >
                ✅ Approuver (créneau optimal)
              </button>
              <button
                className="btn-ghost"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ id: post.id, publishNow: true })}
              >
                ⚡ Publier maintenant
              </button>
              <Link to={`/posts/${post.id}`} className="btn-ghost">
                ✏️ Modifier
              </Link>
              <button
                className="btn-danger ml-auto"
                disabled={reject.isPending}
                onClick={() => {
                  const reason = prompt('Raison du rejet (facultatif) :') ?? undefined;
                  reject.mutate({ id: post.id, reason });
                }}
              >
                ❌ Rejeter
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
