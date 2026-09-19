import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Image as ImageIcon, Images as LibraryIcon, Mail, Pencil, RefreshCw, Trash2, Upload, X, Zap, CalendarClock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, humanizeError, upload } from '../api/client';
import type { LibraryImageDto, PostDetailDto, SlideDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import LibraryPicker from '../components/LibraryPicker';
import { toast } from '../components/Toaster';
import { depuisChampLocal, pourChampLocal } from '../lib/paris';
import VisualAgentPanel from '../components/VisualAgentPanel';
import { CHANNEL_LABELS, EtatErreur, fmtDate, FORMAT_LABELS, PageTitle, SLIDE_FIELD_LABELS, SLIDE_KIND_LABELS, StatusBadge, Problemes } from '../components/shared';

const SLIDE_KINDS = ['hook', 'content', 'value_prop', 'screenshot', 'cta', 'notifications'] as const;
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
          <div className="pill-bar">
            <button
              className="pill-btn pill-btn--text"
              disabled={disabled}
              onClick={() => setEditing(!editing)}
              title={editing ? 'Fermer l’édition' : 'Modifier les textes'}
              aria-label={editing ? 'Fermer l’édition' : 'Modifier les textes'}
            >
              {editing ? 'Fermer' : <Pencil size={13} />}
            </button>
            <button className="pill-btn pill-btn--text" disabled={disabled} onClick={() => void regenerate()} title="Régénérer le texte par l'IA" aria-label="Régénérer le texte par l'IA">
              <RefreshCw size={13} /> <span className="pill-mot">Texte</span>
            </button>
          </div>
        </div>
        {/*
          L'image a sa propre rangée : les trois façons de la poser, et celle de la
          retirer, côte à côte. Mélangées aux actions de texte, elles débordaient de
          la pilule — on ne trouvait plus comment enlever une illustration.
        */}
        <div className="mb-2 flex items-center gap-2">
          <div className="pill-bar pill-bar--wrap">
            <button
              className={`pill-btn pill-btn--text ${slide.heroAssetId ? 'pill-btn--on' : ''}`}
              disabled={disabled}
              onClick={() => void generateImage()}
              title={slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA'}
              aria-label={slide.heroAssetId ? "Régénérer l'illustration IA" : 'Générer une illustration IA'}
            >
              <ImageIcon size={13} /> <span className="pill-mot">Illustrer</span>
            </button>
            <button className="pill-btn pill-btn--text" disabled={disabled} onClick={() => setPickerOpen(true)} title="Choisir une image de la bibliothèque" aria-label="Choisir une image de la bibliothèque">
              <LibraryIcon size={13} /> <span className="pill-mot">Bibliothèque</span>
            </button>
            <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={useLibraryImage} />
            <button className="pill-btn pill-btn--text" disabled={disabled} onClick={() => fileInput.current?.click()} title="Téléverser ma propre image de fond" aria-label="Téléverser ma propre image de fond">
              <Upload size={13} /> <span className="pill-mot">Importer</span>
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
            {(slide.heroAssetId || slide.screenshotAssetId) && (
              <button
                className="pill-btn pill-btn--text pill-btn--danger"
                disabled={disabled}
                onClick={() => void removeImage()}
                title={slide.screenshotAssetId && !slide.heroAssetId ? 'Retirer la capture d’écran' : 'Retirer l’illustration'}
                aria-label={slide.screenshotAssetId && !slide.heroAssetId ? 'Retirer la capture d’écran' : 'Retirer l’illustration'}
              >
                <Trash2 size={13} /> <span className="pill-mot">Retirer</span>
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
  const { data: post, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
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
  /** Relance la fabrication d'un post bloqué ou en échec (le texte rédigé est conservé). */
  const retryFabrication = useMutation({
    mutationFn: () => api.post<{ started: boolean }>(`/api/posts/${id}/retry-fabrication`),
    onSuccess: () => {
      toast.success('Fabrication relancée');
      void qc.invalidateQueries({ queryKey: ['post', id] });
    },
  });
  /** Recopie manuelle sur la Page Facebook (le miroir automatique ne vaut que pour les publications à venir). */
  const mirrorFacebook = useMutation({
    mutationFn: () => api.post<{ ok: boolean; url: string | null }>(`/api/posts/${id}/mirror-facebook`),
    onSuccess: (r) => {
      toast.success(r.url ? 'Recopié sur la Page Facebook' : 'Recopie effectuée');
      void qc.invalidateQueries({ queryKey: ['post', id] });
    },
  });
  const patchPost = useMutation({
    mutationFn: (patch: Partial<Pick<PostDetailDto, 'theme' | 'format' | 'channel' | 'liAccountKey'>> & { render?: boolean }) => {
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

  // Les comptes LinkedIn connectés : « LinkedIn perso » ne dit pas lequel des
  // profils publie, et avec deux profils dans l'équipe, ça compte.
  const { data: comptesLi } = useQuery({
    queryKey: ['oauth', 'linkedin', 'comptes'],
    queryFn: () => api.get<{ comptes: { key: string; subject: 'li_person' | 'li_org'; name: string; actif: boolean }[] }>('/api/oauth/linkedin/comptes'),
    enabled: post?.platform === 'linkedin',
  });

  if (enErreur) return <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="Ce post" />;
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
  /** Le post attend encore une décision : la barre approuver / rejeter a du sens. */
  const editable = ['draft', 'reviewing', 'awaiting_approval', 'rejected', 'failed'].includes(post.status);
  /**
   * Le contenu se modifie tant que rien n'est parti — programmé compris. Un post
   * approuvé il y a trois jours et qui part demain doit pouvoir être corrigé :
   * c'est justement le moment où on le relit. La publication prendra la dernière
   * version, et le worker refabrique les slides si un changement les a effacées.
   */
  const modifiable = editable || post.status === 'scheduled';
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
  const scheduleAt = async () => {
    const value = await dialog.prompt({
      title: post.status === 'scheduled' ? 'Déplacer la publication' : 'Programmer à une date',
      message: 'Date et heure de publication (heure de Paris). Le post est approuvé pour ce créneau.',
      type: 'datetime-local',
      initial: pourChampLocal(post.scheduledAt ?? new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000).toISOString()),
      min: pourChampLocal(new Date()),
      confirmLabel: post.status === 'scheduled' ? 'Déplacer' : 'Programmer',
    });
    if (!value) return;
    await run('schedule', () => api.post(`/api/posts/${post.id}/schedule`, { at: depuisChampLocal(value).toISOString() }), {
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
        subtitle={`${post.surface ?? CHANNEL_LABELS[post.channel] ?? post.channel} · ${FORMAT_LABELS[post.format] ?? post.format} · thème ${post.theme}${post.scheduledAt ? ` · prévu ${fmtDate(post.scheduledAt)}` : ''}${post.clicks ? ` · ${post.clicks} clic(s)` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {post.status === 'published' && post.channel === 'ig' && !post.simulated && (
              <button className="btn-ghost !py-1.5 text-xs" disabled={mirrorFacebook.isPending} onClick={() => mirrorFacebook.mutate()}>
                {mirrorFacebook.isPending ? 'Recopie…' : 'Recopier sur Facebook'}
              </button>
            )}
            <StatusBadge status={post.status} simulated={post.simulated} />
          </div>
        }
      />

      {post.error && post.status !== 'published' && (
        <div className="card mb-4 border-white/25 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Fabrication interrompue</div>
          <p className="mt-1 text-sm">{post.error}</p>
          <button className="btn-primary mt-3 !py-1.5 text-xs" disabled={retryFabrication.isPending} onClick={() => retryFabrication.mutate()}>
            {retryFabrication.isPending ? 'Relance…' : 'Relancer la fabrication'}
          </button>
        </div>
      )}

      {post.broadcast && (
        <p className="mb-4 text-xs text-muted">
          📣 Ce post part sur <span className="text-txt">{post.broadcast.surface}</span>
          {post.broadcast.others.length > 0 ? ` · le même sujet part aussi sur ${post.broadcast.others.join(', ')}` : ''} — approuver, programmer ou
          rejeter vaut pour toutes les copies ; un texte ou un visuel modifié ici ne change que celle-ci.
        </p>
      )}
      <Problemes liste={post.problemes} />
      {post.commentTriggerKeyword !== null && <BlocMotCle post={post} />}
      {post.format === 'reel' && <BlocVideo post={post} />}
      {post.format === 'li_doc' && !inProgress && post.slideCount > 0 && (
        <div className="card mb-4 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Document PDF LinkedIn</div>
          <p className="mt-1 text-sm">
            {post.slideCount} page{post.slideCount > 1 ? 's' : ''} — le fichier exact que LinkedIn recevra, assemblé à partir des slides ci-dessous.
            Une slide modifiée le refait à l’ouverture.
          </p>
          <a href={`/api/posts/${post.id}/document.pdf`} target="_blank" rel="noreferrer" className="btn-ghost mt-3 !py-1.5 text-xs">
            Ouvrir le PDF
          </a>
        </div>
      )}
      {post.resource && post.resource.kind !== 'article' && (
        <div className="card mb-4 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            {post.resource.viaLien
              ? post.resource.kind === 'guide' ? 'Guide donné par le lien du post' : 'Outil donné par le lien du post'
              : post.resource.kind === 'guide' ? 'Guide livré en message privé' : 'Outil envoyé en message privé'}
          </div>
          <p className="mt-1 text-sm font-semibold">{post.resource.title ?? '—'}</p>
          {post.resource.url && (
            <a href={post.resource.url} target="_blank" rel="noreferrer" className="btn-ghost mt-3 !py-1.5 text-xs">
              {post.resource.kind === 'guide' ? 'Ouvrir le PDF' : 'Ouvrir la page'}
            </a>
          )}
          {post.resource.error && (
            <p className="mt-2 text-xs text-muted">Fabrication en échec : {post.resource.error} — le lien retombe sur l’article source.</p>
          )}
        </div>
      )}

      {inProgress && (
        <div className="card mb-4 flex items-center gap-3 border-accent/40 p-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {/* L'étape courante évite de confondre « long » et « bloqué » : la chaîne prend 2 à 4 min. */}
          {post.pipelineStep
            ? post.pipelineStep
            : post.status === 'draft'
              ? 'Rédaction du post…'
              : 'Studio de design en cours : relecture par les critiques IA…'}
          <span className="text-muted">— mise à jour automatique, comptez 2 à 4 min en tout.</span>
        </div>
      )}

      {modifiable && (
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
              {(post.platform === 'linkedin' ? ['li_image', 'li_doc', 'reel'] : ['carousel', 'static', 'reel']).map((v) => (
                <option key={v} value={v}>{FORMAT_LABELS[v] ?? v}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[11rem]">
            <label className="label !mb-1">Canal</label>
            <select
              className="input"
              value={post.channel}
              disabled={!!busy || post.status === 'scheduled'}
              title={post.status === 'scheduled' ? 'Le créneau appartient à la plateforme : annule la programmation pour changer de canal' : undefined}
              onChange={(e) => patchPost.mutate({ channel: e.target.value })}
            >
              {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {post.platform === 'linkedin' && (
            <div className="min-w-[11rem]">
              <label className="label !mb-1">Compte</label>
              <select
                className="input"
                value={post.liAccountKey ?? ''}
                disabled={!!busy || post.status === 'scheduled'}
                title={post.status === 'scheduled' ? 'Annule la programmation pour changer de compte' : undefined}
                onChange={(e) => patchPost.mutate({ liAccountKey: e.target.value || null })}
              >
                {(comptesLi?.comptes ?? [])
                  .filter((c) => c.subject === (post.channel === 'li_org' ? 'li_org' : 'li_person'))
                  .map((c) => (
                    <option key={c.key} value={c.key}>{c.name}{c.actif ? '' : ' (en pause)'}</option>
                  ))}
                {post.liAccountKey && !(comptesLi?.comptes ?? []).some((c) => c.key === post.liAccountKey) && (
                  <option value={post.liAccountKey}>{post.surface ?? post.liAccountKey}</option>
                )}
              </select>
            </div>
          )}
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
            Part le <b className="text-txt">{fmtDate(post.scheduledAt)}</b>
            {post.surface ? (
              <>
                {' '}
                depuis <b className="text-txt">{post.surface}</b>
              </>
            ) : null}
            . Tu peux encore modifier le texte et les visuels : c'est la dernière version qui partira.
          </span>
          <span className="flex-1" />
          <button className="btn-ghost" disabled={!!busy} onClick={() => void scheduleAt()}>
            <CalendarClock size={14} /> Déplacer
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={run('render', () => api.post(`/api/posts/${post.id}/render`), { done: 'Slides refabriquées' })}>
            {busy === 'render' ? 'Rendu…' : 'Régénérer les images'}
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

          {modifiable && <VisualAgentPanel post={post} locked={!!busy} onChanged={refresh} />}

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
            disabled={!modifiable}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              disabled={!modifiable || !!busy || caption === post.caption}
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
            <button className="btn-ghost" disabled={!modifiable || !!busy} onClick={() => void regenCaption()}>
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

/**
 * Vidéo de l'avatar : on la regarde, on corrige le script s'il faut, on relance.
 * Tant qu'elle est en fabrication, l'état se rafraîchit tout seul.
 */
function BlocVideo({ post }: { post: PostDetailDto }) {
  const qc = useQueryClient();
  const [script, setScript] = useState(post.video?.script ?? '');
  const enCours = post.video?.status === 'pending';
  useQuery({
    queryKey: ['post', post.id, 'video'],
    queryFn: async () => {
      const etat = await api.get<{ statut: string }>(`/api/posts/${post.id}/video`);
      if (etat.statut !== 'pending') void qc.invalidateQueries({ queryKey: ['post', post.id] });
      return etat;
    },
    enabled: enCours,
    refetchInterval: 20_000,
  });
  const enregistrer = useMutation({
    mutationFn: () => api.patch(`/api/posts/${post.id}`, { videoScript: script }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['post', post.id] });
      toast.success('Script enregistré');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  const relancer = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/posts/${post.id}`, { videoScript: script });
      return api.post<{ ok: boolean }>(`/api/posts/${post.id}/video`, {});
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['post', post.id] });
      toast.success('Vidéo relancée — compte une à trois minutes');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  const secondes = post.video?.durationMs ? Math.round(post.video.durationMs / 1000) : null;
  const caracteres = script.trim().length;

  return (
    <div className="card mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-bold">Vidéo de l’avatar</h2>
        <span className="text-xs text-muted">
          {post.video?.status === 'ready'
            ? `prête${secondes ? ` · ${secondes} s` : ''}`
            : post.video?.status === 'pending'
              ? 'en fabrication chez HeyGen…'
              : post.video?.status === 'failed'
                ? 'en échec'
                : 'pas encore lancée'}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          {post.video?.url ? (
            <video src={post.video.url} controls playsInline className="w-full rounded-2xl border border-line" />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center rounded-2xl border border-dashed border-line text-center text-xs text-muted">
              {post.video?.status === 'pending' ? 'Fabrication en cours' : 'Aucune vidéo'}
            </div>
          )}
        </div>
        <div>
          <label className="label">Texte prononcé par l’avatar · {caracteres} caractères ≈ {Math.round(caracteres / 15)} s</label>
          <textarea className="input min-h-[180px]" value={script} onChange={(e) => setScript(e.target.value)} />
          {post.video?.error && <p className="mt-2 text-xs text-accent">{post.video.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost !py-1.5 text-xs" disabled={enregistrer.isPending || script === (post.video?.script ?? '')} onClick={() => enregistrer.mutate()}>
              Enregistrer le script
            </button>
            <button className="btn-primary !py-1.5 text-xs" disabled={relancer.isPending || enCours || caracteres < 40} onClick={() => relancer.mutate()}>
              {enCours ? 'Fabrication en cours…' : post.video?.url ? 'Refaire la vidéo' : 'Fabriquer la vidéo'}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Écrit pour l’oreille : la première phrase arrête le scroll en deux secondes, pas d’émoji, pas d’URL — l’avatar lit tout à voix haute.
            Les réglages (avatar, voix, sous-titres) sont dans Réglages → Vidéos avatar.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Mot-clé à commenter : il est imprimé sur la slide CTA, écrit dans la caption et
 * attendu par le détecteur de commentaires. Le changer ici met les trois d'accord.
 */
function BlocMotCle({ post }: { post: PostDetailDto }) {
  const qc = useQueryClient();
  const [motcle, setMotcle] = useState(post.commentTriggerKeyword ?? '');
  const valide = /^[A-Za-zÀ-ÿ]{3,14}$/.test(motcle.trim());
  const dansLaCaption = post.caption.toUpperCase().includes(motcle.trim().toUpperCase());
  const enregistrer = useMutation({
    mutationFn: () => api.patch(`/api/posts/${post.id}`, { commentTriggerKeyword: motcle.trim().toUpperCase() }),
    onSuccess: async () => {
      await api.post(`/api/posts/${post.id}/render`, {}).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['post', post.id] });
      toast.success('Mot-clé changé — caption et slide mises à jour');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });

  return (
    <div className="card mb-5 p-5">
      <h2 className="mb-1 text-base font-bold">Mot à commenter</h2>
      <p className="mb-3 text-xs text-muted">
        C’est le déclencheur de tout le tunnel : imprimé sur la slide finale, écrit dans la caption, attendu par le moteur sous chaque
        commentaire. Un seul mot, 3 à 14 lettres.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[220px] uppercase"
          value={motcle}
          onChange={(e) => setMotcle(e.target.value.replace(/[^A-Za-zÀ-ÿ]/g, ''))}
          placeholder="GUIDE"
        />
        <button
          className="btn-primary !py-1.5 text-xs"
          disabled={!valide || enregistrer.isPending || motcle.trim().toUpperCase() === (post.commentTriggerKeyword ?? '')}
          onClick={() => enregistrer.mutate()}
        >
          {enregistrer.isPending ? 'Mise à jour…' : 'Changer le mot-clé'}
        </button>
        {!valide && motcle.length > 0 && <span className="text-xs text-accent">Un seul mot, 3 à 14 lettres.</span>}
        {valide && !dansLaCaption && (
          <span className="text-xs text-accent">Ce mot n’apparaît pas dans la caption — les gens ne sauront pas quoi commenter.</span>
        )}
      </div>
    </div>
  );
}
