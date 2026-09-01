import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { NewsDto } from '../api/types';
import { Empty, PageTitle } from '../components/shared';

export default function News() {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState<number | null>(null);
  const { data: news } = useQuery({
    queryKey: ['news'],
    queryFn: () => api.get<NewsDto[]>('/api/news?status=shortlisted,scored'),
  });

  const refresh = useMutation({
    mutationFn: () => api.post('/api/news/refresh'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['news'] }),
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.post(`/api/news/${id}/discard`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['news'] }),
  });
  const generate = useMutation({
    mutationFn: (id: number) => api.post(`/api/news/${id}/generate`, {}),
    onSuccess: (_data, id) => {
      setGenerating(id);
      setTimeout(() => setGenerating(null), 8000);
    },
  });

  return (
    <div>
      <PageTitle
        title="Veille IA"
        subtitle="Les meilleures actualités des dernières 24 h, notées pour leur pertinence PME/TPE et leur potentiel de clic."
        actions={
          <button className="btn-primary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? 'Scan en cours…' : '🔄 Scanner maintenant'}
          </button>
        }
      />
      {generating && (
        <div className="card mb-4 border-accent/50 p-4 text-sm">
          🚀 Pipeline lancé pour l'actu #{generating} : rédaction → captures → rendu → studio de design → email.
          Le post apparaîtra dans « À valider » dans quelques minutes.
        </div>
      )}
      {news && news.length === 0 && (
        <Empty>Aucune actu scorée pour l'instant — lance un scan ou attends le prochain cycle horaire.</Empty>
      )}
      <div className="flex flex-col gap-3">
        {news?.map((item) => (
          <div key={item.id} className="card flex items-start gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft">
              <span className="text-lg font-extrabold text-accent">{item.score ?? '–'}</span>
              <span className="text-[9px] uppercase text-muted">score</span>
            </div>
            <div className="min-w-0 flex-1">
              <a href={item.url} target="_blank" rel="noreferrer" className="font-bold hover:text-accent">
                {item.title}
              </a>
              <div className="mt-0.5 text-xs text-muted">
                {item.source} · {item.lang.toUpperCase()}
                {item.shortlistRank ? ` · shortlist #${item.shortlistRank}` : ''}
                {item.scoreRelevance != null ? ` · pertinence ${item.scoreRelevance}/50 · clic ${item.scoreClick}/50` : ''}
              </div>
              {item.reason && <p className="mt-1 text-sm text-muted">{item.reason}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                className="btn-primary"
                disabled={generate.isPending}
                onClick={() => generate.mutate(item.id)}
              >
                ✨ Générer un post
              </button>
              <button className="btn-ghost" onClick={() => discard.mutate(item.id)}>
                Écarter
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
