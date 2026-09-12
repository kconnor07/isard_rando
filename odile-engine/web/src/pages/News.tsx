import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Flame, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { NewsDto } from '../api/types';
import { Empty, PageTitle } from '../components/shared';
import { toast } from '../components/Toaster';

interface Generating {
  newsId: number;
  startedAt: string;
}

export default function News() {
  const qc = useQueryClient();
  const { data: news } = useQuery({
    queryKey: ['news'],
    queryFn: () => api.get<NewsDto[]>('/api/news?status=shortlisted,scored'),
  });
  // Fabrications en cours (pipeline 2-4 min) : suivies côté serveur, la carte reste marquée jusqu'à la fin
  const { data: generating } = useQuery({
    queryKey: ['news', 'generating'],
    queryFn: () => api.get<Generating[]>('/api/news/generating'),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 5000 : 20_000),
  });
  const generatingIds = new Set((generating ?? []).map((g) => g.newsId));
  // Fin d'une fabrication : les listes se rafraîchissent et on prévient
  const previous = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!generating) return;
    const finished = [...previous.current].filter((id) => !generatingIds.has(id));
    if (finished.length > 0) {
      void qc.invalidateQueries({ queryKey: ['news'] });
      void qc.invalidateQueries({ queryKey: ['posts'] });
      void qc.invalidateQueries({ queryKey: ['summary'] });
      toast.success(`${finished.length > 1 ? 'Posts prêts' : 'Post prêt'} à valider`, {
        action: { label: 'Voir', onClick: () => (location.href = '/approvals') },
      });
    }
    previous.current = new Set(generatingIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  const refresh = useMutation({
    mutationFn: () => api.post<{ scrape?: unknown; shortlist?: unknown }>('/api/news/refresh'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['news'] });
      toast.success('Veille mise à jour');
    },
  });
  const discard = useMutation({
    mutationFn: (id: number) => api.post(`/api/news/${id}/discard`),
    onMutate: (id) => {
      qc.setQueryData<NewsDto[]>(['news'], (old) => old?.filter((n) => n.id !== id));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['news'] }),
  });
  const generate = useMutation({
    mutationFn: (id: number) => api.post(`/api/news/${id}/generate`, {}),
    onSuccess: (_data, id) => {
      qc.setQueryData<Generating[]>(['news', 'generating'], (old) => [...(old ?? []), { newsId: id, startedAt: new Date().toISOString() }]);
      void qc.invalidateQueries({ queryKey: ['news', 'generating'] });
      toast.info('Fabrication lancée : rédaction → visuels → rendu → critique → email (2 à 4 min).');
    },
  });

  return (
    <div>
      <PageTitle
        title="Veille IA"
        subtitle="Les meilleures actualités des dernières 24 h, notées pour leur pertinence PME/TPE et leur potentiel de clic."
        actions={
          <button className="btn-primary" disabled={refresh.isPending} onClick={() => refresh.mutate()} title="Scrape les sources, note et refait la shortlist (1 à 3 min)">
            <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} />
            {refresh.isPending ? 'Scan en cours (1-3 min)…' : 'Scanner maintenant'}
          </button>
        }
      />
      {generatingIds.size > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 border-accent/40 p-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {generatingIds.size > 1 ? `${generatingIds.size} posts en fabrication` : 'Un post en fabrication'} : rédaction → visuels → rendu → critique → email.
          <span className="text-muted">Vous serez prévenu ici ; le post arrive dans</span>
          <Link to="/approvals" className="text-accent hover:underline">À valider</Link>.
        </div>
      )}
      {news && news.length === 0 && <Empty>Aucune actu scorée pour l'instant — lance un scan ou attends le prochain cycle horaire.</Empty>}
      <div className="flex flex-col gap-3">
        {news?.map((item) => {
          const inProgress = generatingIds.has(item.id);
          return (
            <div key={item.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
              <div className="flex items-center gap-3 sm:block">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border border-line bg-white/[0.04]">
                  <span className="mono text-lg text-ice">{item.scoreFinal != null ? Math.round(item.scoreFinal) : (item.score ?? '–')}</span>
                  <span className="text-[9px] uppercase text-muted">score</span>
                </div>
                <span className="text-xs text-muted sm:hidden">
                  {item.source} · {item.lang.toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <a href={item.url} target="_blank" rel="noreferrer" className="font-bold hover:text-ice">
                  {item.title}
                </a>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="hidden sm:inline">
                    {item.source} · {item.lang.toUpperCase()}
                  </span>
                  {item.shortlistRank ? <span>· shortlist #{item.shortlistRank}</span> : null}
                  {item.scoreRelevance != null && (
                    <span>
                      · pertinence {item.scoreRelevance}/50 · clic {item.scoreClick}/50
                    </span>
                  )}
                  {item.engagement != null && item.engagement > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-semibold text-txt">
                      <Flame size={11} /> engagement {item.engagement}
                    </span>
                  )}
                  {item.contentExtracted && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-semibold text-txt">
                      <FileText size={11} /> texte extrait
                    </span>
                  )}
                </div>
                {item.topics.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.topics.map((t) => (
                      <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {item.reason && <p className="mt-1 text-sm text-muted">{item.reason}</p>}
                <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
                  <button className="btn-primary" disabled={inProgress || generate.isPending} onClick={() => generate.mutate(item.id)}>
                    <Sparkles size={14} /> {inProgress ? 'En fabrication…' : 'Générer un post'}
                  </button>
                  <button className="btn-ghost" disabled={inProgress} onClick={() => discard.mutate(item.id)}>
                    Écarter
                  </button>
                </div>
              </div>
              <div className="hidden shrink-0 flex-col gap-2 sm:flex">
                <button
                  className="btn-primary"
                  disabled={inProgress || (generate.isPending && generate.variables === item.id)}
                  onClick={() => generate.mutate(item.id)}
                  title="Rédaction, visuels, rendu, critique IA, email de validation (2 à 4 min)"
                >
                  <Sparkles size={14} className={inProgress ? 'animate-pulse' : ''} /> {inProgress ? 'En fabrication…' : 'Générer un post'}
                </button>
                <button className="btn-ghost" disabled={inProgress} onClick={() => discard.mutate(item.id)}>
                  Écarter
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
