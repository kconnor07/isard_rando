import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Image as ImageIcon, Images as LibraryIcon, Mail, Pencil, RefreshCw, Trash2, Upload, X, Zap, CalendarClock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, humanizeError, upload } from '../api/client';
import type { LibraryImageDto, PostDetailDto, SlideDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import LibraryPicker from '../components/LibraryPicker';
import { toast } from '../components/Toaster';
import VisualAgentPanel from '../components/VisualAgentPanel';
import { CHANNEL_LABELS, fmtDate, FORMAT_LABELS, PageTitle, SLIDE_FIELD_LABELS, SLIDE_KIND_LABELS, StatusBadge } from '../components/shared';

const SLIDE_KINDS = ['hook', 'content', 'value_prop', 'screenshot', 'cta', 'notifications', 'echo'] as const;
/** Statuts pendant lesquels le post évolue tout seul (pipeline, studio, publication) : l'éditeur se rafraîchit */
const LIVE_STATUSES = ['draft', 'reviewing', 'publishing', 'scheduled'];

/** Catalogue des thèmes : intégrés + templates maison (onglet Templates) */
interface ThemeCatalogue {
  builtin: { id: string; label: string }[];
  custom: { themeId: string; name: string }[];
}
interface ActionOutcome {
  ok: boolean;
  message?: string;
  scheduledAt?: string | null;
}

const REVIEWER_LABELS: Record<string, string> = {
  art_director: 'Direction artistique',
  colorimetry: 'Colorimétrie',
  copy: 'Relecture',
  engagement: 'Engagement',
};

function SlideCard({
  slide,
  postId,
  locked,
  onChanged,
}: {
  slide: SlideDto;
  postId: number;
  /** une action de page (rendu complet, approbation…) est en cours */
  locked: boolean;
  onChanged: () => void;
}) {
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>(slide.content);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = locked || busy !== null;

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');

  /** Enchaîne une action puis le rendu de cette seule slide (3-6 s), avec retour visible sur la vignette. */
  const act = async (name: string, fn: () => Promise<unknown>, opts: { render?: boolean; done?: string } = {}) => {
    setBusy(name);
    try {
      await fn();
      if (opts.render !== false) {
        setBusy('render');
        await api.post(`/api/posts/${postId}/render?slide=${slide.idx}`);
      }
      onChanged();
      if (opts.done) toast.success(opts.done);
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusy(null);
    }
  };

  const useLibraryImage = (img: LibraryImageDto) => {
    setPickerOpen(false);
    void act('image', () => api.post(`/api/library/${img.id}/use-on-slide`, { postId, slideIdx: slide.idx }), { done: 'Image posée' });
  };

  const save = () =>
    act(
      'save',
      () => {
        const chosenKind = typeof form.kind === 'string' ? (form.kind as string) : slide.kind;
        const content: Record<string, unknown> = { ...form, kind: chosenKind };
        for (const key of Object.keys(content)) {
          if (content[key] === '' || (Array.isArray(content[key]) && (content[key] as unknown[]).length === 0)) delete content[key];
        }
        content.kind = chosenKind;
        content.title = str('title') || '—';
        return api.put(`/api/posts/${postId}/slides/${slide.idx}`, { content }).then(() => setEditing(false));
      },
      { done: 'Slide enregistrée' },
    );

  const regenerate = async () => {
    const instructions = await dialog.prompt({
      title: `Régénérer la slide ${slide.idx + 1} par l’IA`,
      message: 'Consigne facultative (angle, ton, longueur…). Le texte actuel sera remplacé.',
      placeholder: 'ex. plus concret, un chiffre, moins de jargon',
      confirmLabel: 'Régénérer',
      optional: true,
    });
    if (instructions === null) return;
    void act('regen', () => api.post(`/api/posts/${postId}/regenerate`, { scope: 'slide', slideIdx: slide.idx, instructions: instructions || undefined }), { done: 'Texte régénéré' });
  };

  const generateImage = async () => {
    const instructions = await dialog.prompt({
      title: slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA',
      message: 'Direction facultative pour l’image (« plus minimaliste », « objet chrome sur fond sombre »…). Génération : 20 à 90 s.',
      placeholder: 'ex. plus minimaliste',
      confirmLabel: 'Générer',
      optional: true,
    });
    if (instructions === null) return;
    void act('image', () => api.post(`/api/posts/${postId}/slides/${slide.idx}/generate-image`, { instructions: instructions || undefined }), { done: 'Illustration générée' });
  };

  /** Illustration maison : recadrée en 1080×1350 côté serveur. */
  const uploadImage = (file: File) =>
    act('upload', () => upload(`/api/posts/${postId}/slides/${slide.idx}/upload-image`, file), { done: 'Image importée' });

  const removeImage = () => act('remove', () => api.post(`/api/posts/${postId}/slides/${slide.idx}/remove-image`), { done: 'Illustration retirée' });

  const BUSY_LABELS: Record<string, string> = {
    save: 'Enregistrement…',
    regen: 'Rédaction par l’IA…',
    image: 'Génération de l’image…',
    upload: 'Envoi de l’image…',
    remove: 'Retrait…',
    render: 'Rendu de la slide…',
  };

  return (
    <div className="card overflow-hidden">
      <div className="relative">
        {slide.renderAssetId ? (
          <img src={`/api/assets/${slide.renderAssetId}`} alt="" className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div className="skeleton flex aspect-[4/5] w-full items-center justify-center text-xs text-muted">
            {busy ? '' : 'Rendu à venir'}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70 backdrop-blur-[2px]">
            <span className="mono flex items-center gap-2 rounded-full border border-line bg-ink/90 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ice">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {BUSY_LABELS[busy] ?? 'En cours…'}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
            {slide.idx + 1} · {SLIDE_KIND_LABELS[slide.kind] ?? slide.kind}
          </span>
          <div className="pill-bar max-w-full overflow-x-auto">
            <button
              className="pill-btn pill-btn--text"
              disabled={disabled}
              onClick={() => setEditing(!editing)}
              title={editing ? 'Fermer l’édition' : 'Modifier les textes'}
              aria-label={editing ? 'Fermer l’édition' : 'Modifier les textes'}
            >
              {editing ? 'Fermer' : <Pencil size={13} />}
            </button>
            <button className="pill-btn" disabled={disabled} onClick={() => void regenerate()} title="Régénérer le texte par l'IA" aria-label="Régénérer le texte par l'IA">
              <RefreshCw size={13} />
            </button>
            <button
              className={`pill-btn ${slide.heroAssetId ? 'pill-btn--on' : ''}`}
              disabled={disabled}
              onClick={() => void generateImage()}
              title={slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA'}
              aria-label={slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA'}
            >
              <ImageIcon size={13} />
            </button>
            <button className="pill-btn" disabled={disabled} onClick={() => setPickerOpen(true)} title="Choisir une image de la bibliothèque" aria-label="Choisir une image de la bibliothèque">
              <LibraryIcon size={13} />
            </button>
            <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={useLibraryImage} />
            <button className="pill-btn" disabled={disabled} onClick={() => fileInput.current?.click()} title="Téléverser ma propre image de fond" aria-label="Téléverser ma propre image de fond">
              <Upload size={13} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void uploadImage(f);
              }}
            />
            {slide.heroAssetId && (
              <button className="pill-btn" disabled={disabled} onClick={() => void removeImage()} title="Retirer l'illustration de fond" aria-label="Retirer l'illustration de fond">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
        {!editing && <p className="line-clamp-2 text-sm font-semibold">{String(slide.content.title ?? '')}</p>}
        {editing && (
          <div className="flex flex-col gap-2">
            {['annotation', 'badge', 'title', 'subtitle', 'accentWord', 'bigNumber', 'ctaLabel'].map((key) => (
              <div key={key}>
                <label className="label !mb-0.5">{SLIDE_FIELD_LABELS[key] ?? key}</label>
                <input className="input !py-1.5" value={str(key)} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.body}</label>
              <textarea className="input !py-1.5" rows={3} value={str('body')} onChange={(e) => set('body', e.target.value)} />
            </div>
            <div>
              <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.imageIdea}</label>
              <textarea className="input !py-1.5" rows={2} value={str('imageIdea')} onChange={(e) => set('imageIdea', e.target.value)} />
            </div>
            <div>
              <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.bullets}</label>
              <textarea
                className="input !py-1.5"
                rows={3}
                value={Array.isArray(form.bullets) ? (form.bullets as string[]).join('\n') : ''}
                onChange={(e) => set('bullets', e.target.value.split('\n').filter(Boolean))}
              />
            </div>
            <div>
              <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.notifications}</label>
              <textarea
                className="input !py-1.5"
                rows={3}
                placeholder={'Devis signé | Client Martin — 4 200 €'}
                value={
                  Array.isArray(form.notifications)
                    ? (form.notifications as { title?: string; body?: string }[]).map((n) => `${n.title ?? ''} | ${n.body ?? ''}`).join('\n')
                    : ''
                }
                onChange={(e) =>
                  set(
                    'notifications',
                    e.target.value
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((l) => {
                        const [title, ...rest] = l.split('|');
                        return { title: (title ?? '').trim(), body: rest.join('|').trim() };
                      }),
                  )
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.toolName}</label>
                <input className="input !py-1.5" value={str('toolName')} onChange={(e) => set('toolName', e.target.value)} />
              </div>
              <div>
                <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.toolUrl}</label>
                <input className="input !py-1.5" value={str('toolUrl')} onChange={(e) => set('toolUrl', e.target.value)} />
              </div>
              <div>
                <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.echoWord}</label>
                <input className="input !py-1.5" value={str('echoWord')} onChange={(e) => set('echoWord', e.target.value)} />
              </div>
              <div>
                <label className="label !mb-0.5">{SLIDE_FIELD_LABELS.kind}</label>
                <select className="input !py-1.5" value={typeof form.kind === 'string' ? (form.kind as string) : slide.kind} onChange={(e) => set('kind', e.target.value)}>
                  {SLIDE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SLIDE_KIND_LABELS[k] ?? k}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn-primary justify-center" disabled={disabled} onClick={() => void save()}>
              Enregistrer et re-rendre la slide
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
  const dialog = useDialog();
  const { data: post } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<PostDetailDto>(`/api/posts/${id}`),
    // Le post évolue tout seul pendant la fabrication et la publication : on suit
    refetchInterval: (q) => (q.state.data && LIVE_STATUSES.includes(q.state.data.status) ? 5000 : false),
  });
  const { data: catalogue } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<ThemeCatalogue>('/api/templates'),
  });
  // Brouillon de caption : null = identique au post (une régénération IA n'est jamais écrasée)
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => setCaptionDraft(null), [post?.id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['post', id] });
    void qc.invalidateQueries({ queryKey: ['posts'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  };
  const patchPost = useMutation({
    mutationFn: (patch: Partial<Pick<PostDetailDto, 'theme' | 'format' | 'channel'>> & { render?: boolean }) => {
      const { render, ...body } = patch;
      return api.patch(`/api/posts/${id}`, body).then(() => (render ? api.post(`/api/posts/${id}/render`) : undefined));
    },
    // Le sélecteur change tout de suite ; le rendu suit
    onMutate: (patch) => {
      const { render: _r, ...fields } = patch;
      qc.setQueryData<PostDetailDto>(['post', id], (old) => (old ? { ...old, ...fields, slides: patch.render ? old.slides.map((s) => ({ ...s, renderAssetId: null })) : old.slides } : old));
      setBusy(patch.render ? 'render' : 'patch');
    },
    onSettled: () => {
      setBusy('');
      refresh();
    },
  });

  if (!post) return <div className="text-muted">Chargement…</div>;
  const caption = captionDraft ?? post.caption;
  const run = (name: string, fn: () => Promise<unknown>, opts: { done?: string | ((r: unknown) => string | undefined) } = {}) => async () => {
    setBusy(name);
    try {
      const result = await fn();
      refresh();
      const msg = typeof opts.done === 'function' ? opts.done(result) : opts.done;
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusy('');
    }
  };
  const outcomeMessage = (fallback: string) => (r: unknown) => (r as ActionOutcome | undefined)?.message || fallback;
  const editable = ['draft', 'reviewing', 'awaiting_approval', 'rejected', 'failed'].includes(post.status);
  const inProgress = post.status === 'draft' || post.status === 'reviewing';

  const publishNow = async () => {
    const ok = await dialog.confirm({
      title: 'Publier maintenant ?',
      message: `Le post partira sur ${CHANNEL_LABELS[post.channel] ?? post.channel} dans une minute. Vous pourrez encore annuler la programmation pendant ce délai.`,
      confirmLabel: 'Publier dans 1 min',
    });
    if (!ok) return;
    await run('now', () => api.post(`/api/posts/${post.id}/approve`, { publishNow: true }), {
      done: 'Publication programmée dans une minute — « Annuler la programmation » reste disponible.',
    })();
  };
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const scheduleAt = async () => {
    const value = await dialog.prompt({
      title: post.status === 'scheduled' ? 'Déplacer la publication' : 'Programmer à une date',
      message: 'Date et heure de publication (heure de Paris). Le post est approuvé pour ce créneau.',
      type: 'datetime-local',
      initial: toLocalInput(post.scheduledAt ?? new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000).toISOString()),
      min: toLocalInput(new Date().toISOString()),
      confirmLabel: post.status === 'scheduled' ? 'Déplacer' : 'Programmer',
    });
    if (!value) return;
    await run('schedule', () => api.post(`/api/posts/${post.id}/schedule`, { at: new Date(value).toISOString() }), {
      done: outcomeMessage('Post programmé'),
    })();
  };
  const reject = async () => {
    const reason = await dialog.prompt({
      title: 'Rejeter ce post ?',
      message: 'Il quittera la file « À valider ». Une raison aide le rédacteur à s’améliorer (facultatif).',
      placeholder: 'ex. sujet déjà traité, ton trop commercial',
      confirmLabel: 'Rejeter',
      optional: true,
    });
    if (reason === null) return;
    await run('reject', async () => {
      await api.post(`/api/posts/${post.id}/reject`, { reason: reason || undefined });
      navigate('/approvals');
    }, { done: 'Post rejeté' })();
  };
  const regenCaption = async () => {
    const instructions = await dialog.prompt({
      title: 'Régénérer la caption par l’IA',
      message: 'Consigne facultative. La caption actuelle sera remplacée.',
      placeholder: 'ex. plus courte, un appel à commenter',
      confirmLabel: 'Régénérer',
      optional: true,
    });
    if (instructions === null) return;
    await run('regen-caption', async () => {
      await api.post(`/api/posts/${post.id}/regenerate`, { scope: 'caption', instructions: instructions || undefined });
      setCaptionDraft(null);
    }, { done: 'Caption régénérée' })();
  };

  return (
    <div>
      <PageTitle
        title={post.hook || `Post #${post.id}`}
        subtitle={`${CHANNEL_LABELS[post.channel] ?? post.channel} · ${FORMAT_LABELS[post.format] ?? post.format} · thème ${post.theme}${post.scheduledAt ? ` · prévu ${fmtDate(post.scheduledAt)}` : ''}${post.clicks ? ` · ${post.clicks} clic(s)` : ''}`}
        actions={<StatusBadge status={post.status} />}
      />

      {inProgress && (
        <div className="card mb-4 flex items-center gap-3 border-accent/40 p-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {post.status === 'draft' ? 'Fabrication en cours : rédaction, visuels, rendu…' : 'Studio de design en cours : relecture par les critiques IA…'}
          <span className="text-muted">— la page se met à jour toute seule.</span>
        </div>
      )}

      {editable && (
        <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
          <div className="min-w-[15rem] flex-1">
            <label className="label !mb-1">Thème visuel de ce post</label>
            <select className="input" value={post.theme} disabled={!!busy} onChange={(e) => patchPost.mutate({ theme: e.target.value, render: true })}>
              {!catalogue && <option value={post.theme}>{post.theme}</option>}
              {catalogue && catalogue.custom.length > 0 && (
                <optgroup label="Mes templates">
                  {catalogue.custom.map((t) => (
                    <option key={t.themeId} value={t.themeId}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {catalogue && (
                <optgroup label="Thèmes fournis">
                  {catalogue.builtin.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="min-w-[11rem]">
            <label className="label !mb-1">Format</label>
            <select className="input" value={post.format} disabled={!!busy} onChange={(e) => patchPost.mutate({ format: e.target.value, render: true })}>
              {Object.entries(FORMAT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[11rem]">
            <label className="label !mb-1">Canal</label>
            <select className="input" value={post.channel} disabled={!!busy} onChange={(e) => patchPost.mutate({ channel: e.target.value })}>
              {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {busy === 'render' && (
            <span className="mono flex items-center gap-2 pb-2 text-[11px] uppercase tracking-wider text-ice">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> rendu des {post.slides.length} slides…
            </span>
          )}
        </div>
      )}

      {editable && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            className="btn-success"
            disabled={!!busy}
            onClick={run('approve', () => api.post(`/api/posts/${post.id}/approve`, { publishNow: false }), { done: outcomeMessage('Post approuvé et programmé au prochain créneau') })}
          >
            <Check size={14} /> Approuver
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => void publishNow()}>
            <Zap size={14} /> Publier maintenant
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => void scheduleAt()} title="Choisir la date et l’heure de publication">
            <CalendarClock size={14} /> Programmer à…
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('render', () => api.post(`/api/posts/${post.id}/render`), { done: 'Slides rendues' })}>
            {busy === 'render' ? 'Rendu…' : 'Régénérer les images des slides'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('review', () => api.post(`/api/posts/${post.id}/review`), { done: 'Critique IA terminée — voir les notes à droite' })} title="Les critiques IA relisent le post et proposent des corrections (1 à 5 min)">
            {busy === 'review' ? 'Critique en cours (1-5 min)…' : 'Relancer la critique IA'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('email', () => api.post(`/api/posts/${post.id}/send-approval-email`), { done: 'Email de validation renvoyé' })}>
            <Mail size={14} /> Renvoyer l'email
          </button>
          <button className="btn-danger ml-auto" disabled={!!busy} onClick={() => void reject()}>
            <X size={14} /> Rejeter
          </button>
        </div>
      )}

      {post.status === 'scheduled' && (
        <div className="card mb-6 flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted">
            Programmé pour <b className="text-txt">{fmtDate(post.scheduledAt)}</b>.
          </span>
          <span className="flex-1" />
          <button className="btn-ghost" disabled={!!busy} onClick={() => void scheduleAt()}>
            <CalendarClock size={14} /> Déplacer
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => void publishNow()}>
            <Zap size={14} /> Publier maintenant
          </button>
          <button className="btn-danger" disabled={!!busy} onClick={run('unschedule', () => api.post(`/api/posts/${post.id}/unschedule`), { done: 'Programmation annulée — le post revient dans « À valider »' })}>
            <X size={14} /> Annuler la programmation
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-bold">Slides</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {post.slides.map((slide) => (
              <SlideCard key={slide.id} slide={slide} postId={post.id} locked={!!busy} onChanged={refresh} />
            ))}
          </div>

          {editable && <VisualAgentPanel post={post} locked={!!busy} onChanged={refresh} />}

          <h2 className="mb-3 mt-8 text-lg font-bold">
            Caption
            {captionDraft !== null && captionDraft !== post.caption && (
              <span className="mono ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ice">modifiée</span>
            )}
          </h2>
          <textarea
            className="input min-h-44 font-mono text-[13px] leading-relaxed"
            value={caption}
            onChange={(e) => setCaptionDraft(e.target.value)}
            disabled={!editable}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              disabled={!editable || !!busy || caption === post.caption}
              onClick={run('caption', async () => {
                await api.patch(`/api/posts/${post.id}`, { caption });
                setCaptionDraft(null);
              }, { done: 'Caption enregistrée' })}
            >
              Enregistrer la caption
            </button>
            {captionDraft !== null && captionDraft !== post.caption && (
              <button className="btn-ghost" onClick={() => setCaptionDraft(null)}>
                Annuler les modifications
              </button>
            )}
            <button className="btn-ghost" disabled={!editable || !!busy} onClick={() => void regenCaption()}>
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
          {post.reviews.length === 0 && <div className="card p-4 text-sm text-muted">Pas encore passé au studio de design.</div>}
          <div className="flex flex-col gap-3">
            {post.reviews.map((review) => (
              <div key={review.id} className="card p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-bold">
                    {REVIEWER_LABELS[review.reviewer] ?? review.reviewer}
                    <span className="ml-2 text-xs font-normal text-muted">itér. {review.iteration}</span>
                  </span>
                  <span className={`text-sm font-extrabold ${review.passed ? 'text-txt' : 'text-muted'}`}>{review.score}/100</span>
                </div>
                <p className="text-xs text-muted">{review.verdict}</p>
                {review.issues.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {review.issues.map((issue, i) => (
                      <li key={i} className="rounded-lg bg-panel2 p-2 text-xs">
                        <span
                          className={`mr-1 font-bold ${issue.severity === 'blocking' ? 'text-txt underline decoration-white/40' : issue.severity === 'major' ? 'text-txt' : 'text-muted'}`}
                        >
                          [{issue.severity}
                          {issue.slideIdx !== null ? ` · slide ${issue.slideIdx + 1}` : ''}]
                        </span>
                        {issue.problem} <span className="text-ice">→ {issue.fix}</span>
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
