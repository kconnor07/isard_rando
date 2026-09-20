import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Flame, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { NewsDto, SujetDto } from '../api/types';
import { Empty, EtatErreur, PageTitle } from '../components/shared';
import { toast } from '../components/Toaster';

/** D'où vient le sujet : l'actualité, une douleur de dirigeant, le territoire, ou le calendrier. */
const ETIQUETTE_SUJET: Record<SujetDto['kind'], { libelle: string; classe: string }> = {
  actu: { libelle: 'actualité', classe: 'bg-white/10 text-txt' },
  douleur: { libelle: 'douleur terrain', classe: 'bg-accent-soft/60 text-ice' },
  local: { libelle: 'Toulouse', classe: 'bg-accent-soft/60 text-ice' },
  saison: { libelle: 'calendrier PME', classe: 'bg-white/10 text-muted' },
};

interface Generating {
  newsId: number;
  startedAt: string;
}

export default function News() {
  const qc = useQueryClient();
  const { data: news, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
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

  // ----- Sujets du moment -----------------------------------------------------
  const { data: sujets } = useQuery({
    queryKey: ['news', 'sujets'],
    queryFn: () => api.get<SujetDto[]>('/api/news/sujets'),
  });
  const { data: sujetsEnCours } = useQuery({
    queryKey: ['news', 'sujets', 'en-cours'],
    queryFn: () => api.get<{ id: number; startedAt: string }[]>('/api/news/sujets/en-cours'),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 5000 : 30_000),
  });
  const sujetsOccupes = new Set((sujetsEnCours ?? []).map((s) => s.id));
  const rafraichirSujets = useMutation({
    mutationFn: () => api.post<{ crees: number; groupes: number; saison: number }>('/api/news/sujets/refresh'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['news', 'sujets'] });
      toast.success(r.crees > 0 ? `${r.crees} nouveau${r.crees > 1 ? 'x' : ''} sujet${r.crees > 1 ? 's' : ''}` : 'Aucun nouveau sujet : rien de neuf cette semaine');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const ecrireSujet = useMutation({
    mutationFn: (v: { id: number; angle?: string }) => api.post(`/api/news/sujets/${v.id}/ecrire`, v.angle ? { angle: v.angle } : {}),
    onSuccess: (_d, v) => {
      qc.setQueryData<{ id: number; startedAt: string }[]>(['news', 'sujets', 'en-cours'], (old) => [...(old ?? []), { id: v.id, startedAt: new Date().toISOString() }]);
      void qc.invalidateQueries({ queryKey: ['news', 'sujets'] });
      toast.info('Fabrication lancée sur ce sujet : rédaction → visuels → rendu → critique (2 à 4 min).');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const ecarterSujet = useMutation({
    mutationFn: (id: number) => api.post(`/api/news/sujets/${id}/ecarter`),
    onMutate: (id) => qc.setQueryData<SujetDto[]>(['news', 'sujets'], (old) => old?.filter((s) => s.id !== id)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['news', 'sujets'] }),
  });

  return (
    <div>
      <PageTitle
        title="Veille IA"
        subtitle="Les sujets dont plusieurs sources parlent cette semaine, puis les articles notés un par un pour leur pertinence PME/TPE."
        actions={
          <button className="btn-primary" disabled={refresh.isPending} onClick={() => refresh.mutate()} title="Scrape les sources, note et refait la shortlist (1 à 3 min)">
            <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} />
            {refresh.isPending ? 'Scan en cours (1-3 min)…' : 'Scanner maintenant'}
          </button>
        }
      />
      {enErreur && <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="La veille" />}
      {generatingIds.size > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 border-accent/40 p-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {generatingIds.size > 1 ? `${generatingIds.size} posts en fabrication` : 'Un post en fabrication'} : rédaction → visuels → rendu → critique → email.
          <span className="text-muted">Vous serez prévenu ici ; le post arrive dans</span>
          <Link to="/approvals" className="text-accent hover:underline">À valider</Link>.
        </div>
      )}
      {sujets && sujets.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Sujets du moment</h2>
              <p className="text-xs text-muted">
                Ce dont plusieurs sources parlent cette semaine, et les rendez-vous du calendrier des PME. Choisissez un angle, le post s’écrit
                dessus. Survolez un angle pour lire ce qu’il raconterait.
              </p>
            </div>
            <button className="btn-ghost !py-1.5 text-xs" disabled={rafraichirSujets.isPending} onClick={() => rafraichirSujets.mutate()}>
              <RefreshCw size={13} className={rafraichirSujets.isPending ? 'animate-spin' : ''} />
              {rafraichirSujets.isPending ? 'Recherche…' : 'Chercher de nouveaux sujets'}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {sujets.map((s) => {
              const occupe = sujetsOccupes.has(s.id);
              return (
                <div key={s.id} className="card p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className={`mono rounded-md px-1.5 py-0.5 ${ETIQUETTE_SUJET[s.kind].classe}`}>{ETIQUETTE_SUJET[s.kind].libelle}</span>
                    {s.sourcesCount > 1 && <span>{s.sourcesCount} sources en parlent</span>}
                    {s.items.length > 0 && <span>· {s.items.length} article{s.items.length > 1 ? 's' : ''}</span>}
                    {s.topics.length > 0 && <span>· {s.topics.slice(0, 4).join(' · ')}</span>}
                  </div>
                  <h3 className="mt-1 text-lg font-bold">{s.label}</h3>
                  {s.reason && <p className="mt-1 text-sm text-muted">{s.reason}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.angles.map((a) => (
                      <button
                        key={a.titre}
                        className="btn-ghost !py-1.5 text-left text-xs"
                        disabled={occupe || ecrireSujet.isPending}
                        title={a.angle}
                        onClick={() => ecrireSujet.mutate({ id: s.id, angle: a.angle })}
                      >
                        <Sparkles size={13} /> {a.titre}
                      </button>
                    ))}
                    <button className="btn-ghost !py-1.5 text-xs text-muted" disabled={occupe} onClick={() => ecarterSujet.mutate(s.id)}>
                      Pas ce sujet
                    </button>
                  </div>
                  {occupe && <p className="mt-2 text-xs text-accent">Fabrication en cours…</p>}
                  {s.items.length > 0 && (
                    <details className="mt-2 text-xs text-muted">
                      <summary className="cursor-pointer">Les articles derrière ce sujet</summary>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {s.items.map((it) => (
                          <li key={it.id}>
                            <a href={it.url} target="_blank" rel="noreferrer" className="hover:text-ice">{it.title}</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>
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
