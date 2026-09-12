import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Pencil, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PostSummaryDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import { CHANNEL_LABELS, Empty, fmtDate, FORMAT_LABELS, PageTitle, StatusBadge } from '../components/shared';
import { toast } from '../components/Toaster';

interface ActionOutcome {
  ok: boolean;
  message?: string;
  scheduledAt?: string | null;
}

export default function Approvals() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const { data: posts } = useQuery({
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
  const pendingId = approve.isPending ? approve.variables?.id : reject.isPending ? reject.variables?.id : schedule.isPending ? schedule.variables?.id : null;
  const toLocalInput = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const scheduleAt = async (post: PostSummaryDto) => {
    const value = await dialog.prompt({
      title: 'Programmer à une date',
      message: `« ${post.hook || `Post #${post.id}`} » — date et heure de publication (heure de Paris).`,
      type: 'datetime-local',
      initial: toLocalInput(new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000)),
      min: toLocalInput(new Date()),
      confirmLabel: 'Programmer',
    });
    if (!value) return;
    schedule.mutate({ id: post.id, at: new Date(value).toISOString() });
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
      <PageTitle title="Posts à valider" subtitle="Rien ne part sans votre accord — approuvez, modifiez ou rejetez." />
      {posts && posts.length === 0 && <Empty>Aucun post en attente — la machine prépare la suite au prochain cycle.</Empty>}
      <div className="flex flex-col gap-4">
        {posts?.map((post) => {
          const busy = pendingId === post.id;
          const inProgress = post.status === 'draft' || post.status === 'reviewing';
          return (
            <div key={post.id} className={`card p-5 ${busy ? 'opacity-70' : ''}`}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={post.status} />
                <span className="text-xs font-semibold text-muted">
                  {CHANNEL_LABELS[post.channel] ?? post.channel} · {FORMAT_LABELS[post.format] ?? post.format} · thème {post.theme}
                </span>
                {post.reviewSummary && (
                  <span className={`text-xs font-semibold ${post.reviewSummary.passed ? 'text-txt' : 'text-muted'}`}>
                    studio : {post.reviewSummary.iterations} itér. · {Object.values(post.reviewSummary.finalScores).join(' / ')}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted">{fmtDate(post.createdAt)}</span>
              </div>
              <Link to={`/posts/${post.id}`} className="text-lg font-bold hover:text-ice">
                {post.hook || '(sans titre)'}
              </Link>
              {post.newsTitle && <p className="mt-1 text-xs text-muted">Source : {post.newsTitle}</p>}
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{post.caption}</p>
              {inProgress ? (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {post.status === 'draft' ? 'Fabrication en cours (rédaction, visuels, rendu)…' : 'Studio de design en cours…'} — les actions s’ouvrent à la fin.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn-success" disabled={busy} onClick={() => approve.mutate({ id: post.id, publishNow: false })} title="Programme la publication au prochain créneau configuré">
                    <Check size={14} /> Approuver (prochain créneau)
                  </button>
                  <button className="btn-ghost" disabled={busy} onClick={() => void publishNow(post)}>
                    <Zap size={14} /> Publier maintenant
                  </button>
                  <button className="btn-ghost" disabled={busy} onClick={() => void scheduleAt(post)} title="Choisir la date et l’heure">
                    <CalendarClock size={14} /> Programmer à…
                  </button>
                  <Link to={`/posts/${post.id}`} className="btn-ghost">
                    <Pencil size={13} /> Modifier
                  </Link>
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
