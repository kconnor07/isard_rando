import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CommentDto } from '../api/types';
import { Empty, fmtDate, PageTitle } from '../components/shared';

const DM_LABELS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'DM envoyé', cls: 'text-emerald-300' },
  dry: { label: 'DM simulé', cls: 'text-sky-300' },
  pending: { label: 'En attente', cls: 'text-amber-300' },
  failed: { label: 'Échec DM', cls: 'text-red-300' },
  manual_suggested: { label: 'Réponse à coller', cls: 'text-amber-300' },
  handled: { label: 'Traité', cls: 'text-muted' },
  none: { label: '—', cls: 'text-muted' },
};

export default function Comments() {
  const qc = useQueryClient();
  const { data: comments } = useQuery({
    queryKey: ['comments'],
    queryFn: () => api.get<CommentDto[]>('/api/comments'),
    refetchInterval: 30_000,
  });
  const markHandled = useMutation({
    mutationFn: (id: number) => api.post(`/api/comments/${id}/mark-handled`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comments'] }),
  });

  return (
    <div>
      <PageTitle
        title="Commentaires & DM"
        subtitle="Instagram : DM automatique sur mot-clé. LinkedIn : l'API n'autorise pas les DM — copie la réponse pré-rédigée en un clic."
      />
      {comments && comments.length === 0 && <Empty>Aucun commentaire détecté pour l'instant.</Empty>}
      <div className="flex flex-col gap-3">
        {comments?.map((comment) => {
          const dm = DM_LABELS[comment.dmStatus] ?? DM_LABELS.none!;
          return (
            <div key={comment.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${comment.platform === 'instagram' ? 'bg-pink-600/30 text-pink-200' : 'bg-sky-700/40 text-sky-200'}`}
                >
                  {comment.platform === 'instagram' ? 'Instagram' : 'LinkedIn'}
                </span>
                <span className="font-semibold">{comment.authorName || 'Anonyme'}</span>
                {comment.matchedKeyword && (
                  <span className="rounded bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
                    🔑 {comment.matchedKeyword}
                  </span>
                )}
                <span className={`text-xs font-semibold ${dm.cls}`}>{dm.label}</span>
                <span className="ml-auto text-xs text-muted">{fmtDate(comment.createdTime)}</span>
              </div>
              <p className="mt-2 text-sm">{comment.text}</p>
              {comment.suggestedReply && comment.dmStatus === 'manual_suggested' && (
                <div className="mt-3 rounded-xl bg-panel2 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                    Réponse pré-rédigée (à envoyer en message privé LinkedIn)
                  </div>
                  <p className="text-sm">{comment.suggestedReply}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="btn-primary !py-1.5 text-xs"
                      onClick={() => void navigator.clipboard.writeText(comment.suggestedReply!)}
                    >
                      📋 Copier
                    </button>
                    {comment.externalPostUrl && (
                      <a href={comment.externalPostUrl} target="_blank" rel="noreferrer" className="btn-ghost !py-1.5 text-xs">
                        Ouvrir le post ↗
                      </a>
                    )}
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => markHandled.mutate(comment.id)}>
                      ✔ Marquer traité
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
