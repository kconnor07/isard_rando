import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarClock, Check, Pencil, Wand2, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import { CHANNEL_LABELS, Empty, EtatErreur, FORMAT_LABELS, MotifErreur, PageTitle, Problemes, StatusBadge, fmtDate } from '../components/shared';
import { toast } from '../components/Toaster';
import { CeQueRecevraLaPersonne } from '../components/CeQueRecevraLaPersonne';
import { depuisChampLocal, pourChampLocal } from '../lib/paris';

interface ActionOutcome {
  ok: boolean;
  message?: string;
  scheduledAt?: string | null;
}

export default function Approvals() {
  /** visuel agrandi (on valide sur ce qu'on voit, pas sur une vignette de 3 cm) */
  const [zoom, setZoom] = useState<string | null>(null);
  const qc = useQueryClient();
  const dialog = useDialog();
  const { data: posts, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
    queryKey: ['posts', 'pending'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts?status=draft,reviewing,awaiting_approval'),
    refetchInterval: 15_000,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['posts'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  };

  const approve = useMutation({
    mutationFn: (vars: { id: number; publishNow: boolean }) =>
      api.post<ActionOutcome>(`/api/posts/${vars.id}/approve`, { publishNow: vars.publishNow }),
    onSuccess: (outcome, vars) => {
      invalidate();
      toast.success(
        outcome?.message ||
          (vars.publishNow
            ? 'Publication programmée dans une minute — annulable depuis l’éditeur du post.'
            : outcome?.scheduledAt
              ? `Approuvé — programmé ${fmtDate(outcome.scheduledAt)}`
              : 'Approuvé et programmé au prochain créneau'),
      );
    },
  });
  const reject = useMutation({
    mutationFn: (vars: { id: number; reason?: string }) => api.post(`/api/posts/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => {
      invalidate();
      toast.success('Post rejeté');
    },
  });
  const schedule = useMutation({
    mutationFn: (vars: { id: number; at: string }) => api.post<ActionOutcome>(`/api/posts/${vars.id}/schedule`, { at: vars.at }),
    onSuccess: (outcome) => {
      invalidate();
      toast.success(outcome?.scheduledAt ? `Programmé ${fmtDate(outcome.scheduledAt)}` : outcome?.message || 'Post programmé');
    },
  });
  const realigner = useMutation({
    mutationFn: (id: number) => api.post<{ ok: boolean; message: string }>(`/api/posts/${id}/realigner`, { modele: true }),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.message);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const realignerTout = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>('/api/posts/realigner', { modele: true }),
    onSuccess: (r) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['realigner', 'etat'] });
      toast.success(r.message);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  // Ce que « Réaligner » toucherait vraiment : tous les posts modifiables, y compris
  // ceux déjà programmés, qui ne sont pas dans cette liste.
  const { data: etatRealigner } = useQuery({
    queryKey: ['realigner', 'etat'],
    queryFn: () => api.get<{ total: number; programmes: number; reecritures: number; ids: number[] }>('/api/posts/realigner/etat'),
    refetchInterval: 30_000,
  });
  const confirmerRealignement = async () => {
    const e = etatRealigner;
    if (e && e.reecritures > 0) {
      const ok = await dialog.confirm({
        title: 'Réaligner avec la stratégie ?',
        message: `${e.total} post${e.total > 1 ? 's' : ''} à corriger${e.programmes ? `, dont ${e.programmes} déjà programmé${e.programmes > 1 ? 's' : ''}` : ''}. Les liens, adresses, mots-clés, hashtags et comptes sont corrigés sans rien réécrire. ${e.reecritures} post${e.reecritures > 1 ? 's' : ''} promet${e.reecritures > 1 ? 'tent' : ''} encore un message privé ou n’${e.reecritures > 1 ? 'ont' : 'a'} pas été adapté${e.reecritures > 1 ? 's' : ''} : le modèle ${e.reecritures > 1 ? 'les' : 'le'} réécrit, et ${e.reecritures > 1 ? 'ils reviennent' : 'il revient'} à valider (déprogrammé${e.reecritures > 1 ? 's' : ''} si besoin).`,
        confirmLabel: 'Réaligner',
      });
      if (!ok) return;
    }
    realignerTout.mutate();
  };
  const pendingId = approve.isPending ? approve.variables?.id : reject.isPending ? reject.variables?.id : schedule.isPending ? schedule.variables?.id : realigner.isPending ? realigner.variables : null;
  const aRealigner = etatRealigner?.total ?? (posts ?? []).filter((p) => (p.problemes ?? []).some((q) => q.corrigeable || q.reecriture)).length;
  const scheduleAt = async (post: PostSummaryDto) => {
    const value = await dialog.prompt({
      title: 'Programmer à une date',
      message: `« ${post.hook || `Post #${post.id}`} » — date et heure de publication (heure de Paris).`,
      type: 'datetime-local',
      initial: pourChampLocal(new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000)),
      min: pourChampLocal(new Date()),
      confirmLabel: 'Programmer',
    });
    if (!value) return;
    schedule.mutate({ id: post.id, at: depuisChampLocal(value).toISOString() });
  };

  const publishNow = async (post: PostSummaryDto) => {
    const ok = await dialog.confirm({
      title: 'Publier maintenant ?',
      message: `« ${post.hook || `Post #${post.id}`} » partira sur ${CHANNEL_LABELS[post.channel] ?? post.channel} dans une minute.`,
      confirmLabel: 'Publier dans 1 min',
    });
    if (ok) approve.mutate({ id: post.id, publishNow: true });
  };
  const rejectPost = async (post: PostSummaryDto) => {
    const reason = await dialog.prompt({
      title: 'Rejeter ce post ?',
      message: 'Il quittera la file. Une raison aide le rédacteur à s’améliorer (facultatif).',
      placeholder: 'ex. sujet déjà traité',
      confirmLabel: 'Rejeter',
      optional: true,
    });
    if (reason === null) return;
    reject.mutate({ id: post.id, reason: reason || undefined });
  };

  return (
    <div>
      {zoom && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6" onClick={() => setZoom(null)}>
          <img src={`/public-assets/${zoom}.jpg`} alt="" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
      <PageTitle
        title="Posts à valider"
        subtitle="Rien ne part sans votre accord — approuvez, modifiez ou rejetez."
        actions={
          aRealigner > 0 ? (
            <button
              className="btn-ghost"
              disabled={realignerTout.isPending}
              onClick={() => void confirmerRealignement()}
              title="Repose les liens, retire les adresses d’Instagram, remplace les mots-clés hors liste, borne les hashtags, attribue les comptes — et fait réécrire par le modèle ce qui promet encore un message privé sur LinkedIn (ces posts reviennent à valider). Traite aussi les posts déjà programmés."
            >
              <Wand2 size={14} /> {realignerTout.isPending ? 'Réalignement…' : `Réaligner ${aRealigner} post${aRealigner > 1 ? 's' : ''} avec la stratégie${etatRealigner?.programmes ? ` (dont ${etatRealigner.programmes} programmé${etatRealigner.programmes > 1 ? 's' : ''})` : ''}`}
            </button>
          ) : undefined
        }
      />
      {enErreur && <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="La file de validation" />}
      {posts && posts.length === 0 && (
        <Empty action={<Link to="/news" className="btn-primary">Choisir un sujet</Link>}>
          Aucun post en attente — la machine prépare la suite au prochain cycle.
        </Empty>
      )}
      <div className="flex flex-col gap-4">
        {posts
          // Diffusion simultanée : une seule carte par sujet — la décision vaut pour
          // toutes les copies. La carte est celle de l'ORIGINAL : les copies naissent
          // « au studio » et une carte de copie gardait ses actions fermées.
          ?.filter((post, i, liste) => {
            if (!post.broadcast) return true;
            const groupe = post.broadcast.group;
            const original = liste.find((p) => p.broadcast?.group === groupe && p.broadcast.original);
            return original ? post.id === original.id : liste.findIndex((p) => p.broadcast?.group === groupe) === i;
          })
          .map((post) => {
          const busy = pendingId === post.id;
          const inProgress = post.status === 'draft' || post.status === 'reviewing';
          return (
            <div key={post.id} className={`card p-5 ${busy ? 'opacity-70' : ''}`}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={post.status} simulated={post.simulated} />
                <span className="text-xs font-semibold text-muted">
                  {post.surface ?? CHANNEL_LABELS[post.channel] ?? post.channel} · {FORMAT_LABELS[post.format] ?? post.format}
                </span>
                {/* Le studio n'a pas besoin de montrer ses quatre notes : passé, ou à regarder. */}
                {post.reviewSummary && !post.reviewSummary.passed && (
                  <span className="text-xs font-semibold text-muted" title={`Notes du studio : ${Object.values(post.reviewSummary.finalScores).join(' / ')}`}>
                    studio : à regarder
                  </span>
                )}
                <span className="ml-auto text-xs text-muted">{fmtDate(post.createdAt)}</span>
              </div>
              <Link to={`/posts/${post.id}`} className="text-lg font-bold hover:text-ice">
                {post.hook || '(sans titre)'}
              </Link>
              {post.newsTitle && <p className="mt-1 text-xs text-muted">Source : {post.newsTitle}</p>}
              {post.broadcast && (
                <p className="mt-1 text-xs text-muted">
                  📣 {post.broadcast.surface}
                  {post.broadcast.members && post.broadcast.members.length > 0 ? (
                    <>
                      {' · partira aussi, avec la même validation, sur '}
                      {post.broadcast.members.map((m, i) => (
                        <span key={m.id}>
                          {i > 0 ? ', ' : ''}
                          <Link to={`/posts/${m.id}`} className="text-txt underline decoration-white/30 hover:text-ice" title="Voir cette copie : texte, lien, mot-clé">
                            {m.surface}
                          </Link>
                          {m.status === 'awaiting_approval' && (posts ?? []).find((p) => p.id === m.id)?.error ? <span className="text-accent"> (à corriger)</span> : null}
                        </span>
                      ))}
                    </>
                  ) : post.broadcast.others.length > 0 ? (
                    ` · partira aussi sur ${post.broadcast.others.join(', ')} avec la même validation`
                  ) : (
                    ''
                  )}
                </p>
              )}
              {/* Valider sans voir, c'est signer sans lire : les visuels d'abord. */}
              {post.vignettes && post.vignettes.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {post.vignettes.slice(0, 8).map((id) => (
                    <button
                      key={id}
                      className="shrink-0 rounded-lg border border-line transition-colors hover:border-accent/60"
                      onClick={() => setZoom(id)}
                      title="Agrandir"
                    >
                      <img src={`/public-assets/${id}.jpg`} alt="" className="h-36 w-28 rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{post.caption}</p>
              {post.hashtags.length > 0 && <p className="mt-1 text-xs text-muted">{post.hashtags.join(' ')}</p>}
              {post.commentTriggerKeyword && (
                <p className="mt-1.5 text-xs text-muted">
                  Mot à commenter : <span className="mono text-ice">{post.commentTriggerKeyword}</span>
                  {post.resource?.viaLien ? ' — il ouvre le diagnostic, pas la ressource (elle est dans le lien du post)' : ''}
                </p>
              )}
              {post.error && <MotifErreur error={post.error} className="mt-1.5 text-xs text-accent" />}
              <Problemes liste={post.problemes} />
              {!inProgress && <CeQueRecevraLaPersonne postId={post.id} />}
              {inProgress ? (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {post.pipelineStep ?? (post.status === 'draft' ? 'Rédaction du post…' : 'Studio de design en cours…')} — les actions s’ouvrent à la fin.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button className="btn-success" disabled={busy} onClick={() => approve.mutate({ id: post.id, publishNow: false })} title="Programme la publication au prochain créneau configuré">
                    <Check size={14} /> Approuver
                  </button>
                  <Link to={`/posts/${post.id}`} className="btn-ghost">
                    <Pencil size={13} /> Modifier
                  </Link>
                  {/* Les deux autres moments de départ, repliés : le cas courant est « au prochain créneau ». */}
                  <details className="relative">
                    <summary className="btn-ghost cursor-pointer list-none">
                      <CalendarClock size={14} /> Autre moment
                    </summary>
                    <div className="absolute left-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-2xl border border-line bg-panel p-2 shadow-2xl">
                      <button className="rounded-xl px-3 py-2 text-left text-sm text-muted hover:text-txt" disabled={busy} onClick={() => void scheduleAt(post)}>
                        Choisir la date et l’heure…
                      </button>
                      <button className="rounded-xl px-3 py-2 text-left text-sm text-muted hover:text-txt" disabled={busy} onClick={() => void publishNow(post)}>
                        <Zap size={13} className="mr-1 inline" /> Publier dans une minute
                      </button>
                    </div>
                  </details>
                  {(post.problemes ?? []).some((q) => q.corrigeable || q.code === 'dm-promis') && (
                    <button className="btn-ghost" disabled={busy} onClick={() => realigner.mutate(post.id)} title="Corrige ce qui se corrige seul (lien, adresse, mot-clé, hashtags, compte) ; si le post promet encore un message privé, le modèle le réécrit et il revient à valider">
                      <Wand2 size={13} /> Réaligner
                    </button>
                  )}
                  <button className="btn-danger ml-auto" disabled={busy} onClick={() => void rejectPost(post)}>
                    <X size={14} /> Rejeter
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
