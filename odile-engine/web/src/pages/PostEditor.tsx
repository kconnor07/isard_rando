import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Image as ImageIcon, Mail, Pencil, RefreshCw, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { PostDetailDto, SlideDto } from '../api/types';
import { CHANNEL_LABELS, fmtDate, PageTitle, StatusBadge } from '../components/shared';

const REVIEWER_LABELS: Record<string, string> = {
  art_director: 'Direction artistique',
  colorimetry: 'Colorimétrie',
  copy: 'Relecture',
  engagement: 'Engagement',
};

function SlideCard({
  slide,
  postId,
  onChanged,
}: {
  slide: SlideDto;
  postId: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>(slide.content);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');

  const save = async () => {
    setBusy(true);
    try {
      const content: Record<string, unknown> = { ...form, kind: slide.kind };
      for (const key of Object.keys(content)) {
        if (content[key] === '' || (Array.isArray(content[key]) && (content[key] as unknown[]).length === 0))
          delete content[key];
      }
      content.kind = slide.kind;
      content.title = str('title') || '—';
      await api.put(`/api/posts/${postId}/slides/${slide.idx}`, { content });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const instructions = prompt('Instructions pour l’IA (facultatif) :') ?? undefined;
    setBusy(true);
    try {
      await api.post(`/api/posts/${postId}/regenerate`, { scope: 'slide', slideIdx: slide.idx, instructions });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const generateImage = async () => {
    const instructions = prompt('Direction pour l’illustration (facultatif, ex: « plus minimaliste ») :') ?? undefined;
    setBusy(true);
    try {
      await api.post(`/api/posts/${postId}/slides/${slide.idx}/generate-image`, {
        instructions: instructions || undefined,
      });
      onChanged();
    } catch (err) {
      alert(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      {slide.renderAssetId ? (
        <img src={`/api/assets/${slide.renderAssetId}`} alt="" className="aspect-[4/5] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-panel2 text-xs text-muted">
          Rendu à régénérer
        </div>
      )}
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
            {slide.idx + 1} · {slide.kind}
          </span>
          <div className="flex gap-1">
            <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={() => setEditing(!editing)}>
              {editing ? 'Fermer' : <Pencil size={13} />}
            </button>
            <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={regenerate} title="Régénérer le texte par l'IA">
              <RefreshCw size={13} />
            </button>
            <button
              className={`btn-ghost !px-2 !py-1 text-xs ${slide.heroAssetId ? '!border-sky-500/60' : ''}`}
              disabled={busy}
              onClick={generateImage}
              title={slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA'}
            >
              <ImageIcon size={13} />
            </button>
          </div>
        </div>
        {!editing && <p className="line-clamp-2 text-sm font-semibold">{String(slide.content.title ?? '')}</p>}
        {editing && (
          <div className="flex flex-col gap-2">
            {['annotation', 'badge', 'title', 'accentWord', 'bigNumber', 'ctaLabel'].map((key) => (
              <div key={key}>
                <label className="label !mb-0.5">{key}</label>
                <input className="input !py-1.5" value={str(key)} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label !mb-0.5">body</label>
              <textarea className="input !py-1.5" rows={3} value={str('body')} onChange={(e) => set('body', e.target.value)} />
            </div>
            <div>
              <label className="label !mb-0.5">imageIdea (concept d'illustration IA)</label>
              <textarea className="input !py-1.5" rows={2} value={str('imageIdea')} onChange={(e) => set('imageIdea', e.target.value)} />
            </div>
            <div>
              <label className="label !mb-0.5">bullets (1 par ligne)</label>
              <textarea
                className="input !py-1.5"
                rows={3}
                value={Array.isArray(form.bullets) ? (form.bullets as string[]).join('\n') : ''}
                onChange={(e) => set('bullets', e.target.value.split('\n').filter(Boolean))}
              />
            </div>
            <button className="btn-primary justify-center" disabled={busy} onClick={save}>
              Enregistrer la slide
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PostEditor() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: post } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<PostDetailDto>(`/api/posts/${id}`),
  });
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (post) setCaption(post.caption);
  }, [post?.id]);

  if (!post) return <div className="text-muted">Chargement…</div>;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['post', id] });
  const run = (name: string, fn: () => Promise<unknown>) => async () => {
    setBusy(name);
    try {
      await fn();
      refresh();
      void qc.invalidateQueries({ queryKey: ['posts'] });
    } catch (err) {
      alert(String(err));
    } finally {
      setBusy('');
    }
  };
  const editable = ['draft', 'reviewing', 'awaiting_approval', 'rejected', 'failed'].includes(post.status);

  return (
    <div>
      <PageTitle
        title={post.hook || `Post #${post.id}`}
        subtitle={`${CHANNEL_LABELS[post.channel] ?? post.channel} · ${post.format} · thème ${post.theme}${post.scheduledAt ? ` · prévu ${fmtDate(post.scheduledAt)}` : ''}${post.clicks ? ` · ${post.clicks} clic(s)` : ''}`}
        actions={<StatusBadge status={post.status} />}
      />

      {editable && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button className="btn-success" disabled={!!busy} onClick={run('approve', () => api.post(`/api/posts/${post.id}/approve`, { publishNow: false }))}>
            <Check size={14} /> Approuver
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('now', () => api.post(`/api/posts/${post.id}/approve`, { publishNow: true }))}>
            <Zap size={14} /> Publier maintenant
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('render', () => api.post(`/api/posts/${post.id}/render`))}>
            {busy === 'render' ? 'Rendu…' : 'Re-rendre les slides'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('review', () => api.post(`/api/posts/${post.id}/review`))}>
            {busy === 'review' ? 'Studio en cours…' : 'Repasser au studio de design'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('email', () => api.post(`/api/posts/${post.id}/send-approval-email`))}>
            <Mail size={14} /> Renvoyer l'email
          </button>
          <button
            className="btn-danger ml-auto"
            disabled={!!busy}
            onClick={run('reject', async () => {
              const reason = prompt('Raison du rejet (facultatif) :') ?? undefined;
              await api.post(`/api/posts/${post.id}/reject`, { reason });
              navigate('/approvals');
            })}
          >
            <X size={14} /> Rejeter
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <h2 className="mb-3 text-lg font-bold">Slides</h2>
          <div className="grid grid-cols-3 gap-3">
            {post.slides.map((slide) => (
              <SlideCard key={slide.id} slide={slide} postId={post.id} onChanged={refresh} />
            ))}
          </div>

          <h2 className="mb-3 mt-8 text-lg font-bold">Caption</h2>
          <textarea
            className="input min-h-44 font-mono text-[13px] leading-relaxed"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={!editable}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn-primary"
              disabled={!editable || !!busy || caption === post.caption}
              onClick={run('caption', () => api.patch(`/api/posts/${post.id}`, { caption }))}
            >
              Enregistrer la caption
            </button>
            <button
              className="btn-ghost"
              disabled={!editable || !!busy}
              onClick={run('regen-caption', async () => {
                const instructions = prompt('Instructions pour l’IA (facultatif) :') ?? undefined;
                await api.post(`/api/posts/${post.id}/regenerate`, { scope: 'caption', instructions });
              })}
            >
              <RefreshCw size={12} /> Régénérer par l'IA
            </button>
            <span className="text-xs text-muted">{post.hashtags.join(' ')}</span>
          </div>
          {post.commentTriggerKeyword && (
            <p className="mt-2 text-sm text-muted">
              Déclencheur DM : commenter « <b className="text-accent">{post.commentTriggerKeyword}</b> »
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">Critiques du studio</h2>
          {post.reviews.length === 0 && (
            <div className="card p-4 text-sm text-muted">Pas encore passé au studio de design.</div>
          )}
          <div className="flex flex-col gap-3">
            {post.reviews.map((review) => (
              <div key={review.id} className="card p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-bold">
                    {REVIEWER_LABELS[review.reviewer] ?? review.reviewer}
                    <span className="ml-2 text-xs font-normal text-muted">itér. {review.iteration}</span>
                  </span>
                  <span className={`text-sm font-extrabold ${review.passed ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {review.score}/100
                  </span>
                </div>
                <p className="text-xs text-muted">{review.verdict}</p>
                {review.issues.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {review.issues.map((issue, i) => (
                      <li key={i} className="rounded-lg bg-panel2 p-2 text-xs">
                        <span
                          className={`mr-1 font-bold ${issue.severity === 'blocking' ? 'text-red-300' : issue.severity === 'major' ? 'text-amber-300' : 'text-muted'}`}
                        >
                          [{issue.severity}
                          {issue.slideIdx !== null ? ` · slide ${issue.slideIdx + 1}` : ''}]
                        </span>
                        {issue.problem} <span className="text-emerald-300">→ {issue.fix}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
