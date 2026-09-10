import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Infinity as InfinityIcon, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { PostDetailDto, VisualCandidateDto } from '../api/types';

/**
 * Propositions de l'agent visuel pour un post : captures des pages liées au
 * sujet et à la source, images générées — chacune se pose sur une slide en un
 * clic. « Encore » relance une passe qui évite ce qui a déjà été proposé.
 */
export default function VisualAgentPanel({ post, onChanged }: { post: PostDetailDto; onChanged: () => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});

  const { data } = useQuery({
    queryKey: ['visuals', post.id],
    queryFn: () => api.get<{ running: boolean; candidates: VisualCandidateDto[] }>(`/api/posts/${post.id}/visuals`),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['visuals', post.id] });

  const run = useMutation({
    mutationFn: (more: boolean) => api.post(`/api/posts/${post.id}/visuals/run`, { more }),
    onSuccess: invalidate,
    onError: (e) => alert(String(e)),
  });

  const clearFloats = async () => {
    setBusyId('floats');
    try {
      await api.post(`/api/posts/${post.id}/visuals/floats`, { clear: true });
      await api.post(`/api/posts/${post.id}/render`);
      onChanged();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const use = async (c: VisualCandidateDto, as: 'hero' | 'screenshot' | 'float1' | 'float2') => {
    const slideIdx = targets[c.id] ?? c.slideIdx ?? 0;
    setBusyId(c.id);
    try {
      await api.post(`/api/posts/${post.id}/visuals/${c.id}/use`, { slideIdx, as });
      await api.post(`/api/posts/${post.id}/render`);
      onChanged();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (c: VisualCandidateDto) => {
    setBusyId(c.id);
    try {
      await api.delete(`/api/posts/${post.id}/visuals/${c.id}`);
      invalidate();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const running = data?.running ?? false;
  const candidates = data?.candidates ?? [];
  const floats = post.visualOverrides ?? {};
  const inUse = new Set([
    ...post.slides.flatMap((s) => [s.heroAssetId, s.screenshotAssetId]),
    floats.float1,
    floats.float2,
  ].filter(Boolean));
  const STYLE_LABELS: Record<string, string> = { full: 'plein cadre', objets: 'objet détouré', chrome: 'chrome & verre' };

  return (
    <div>
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          Visuels proposés{' '}
          <span className="mono ml-1 text-[11px] font-normal uppercase tracking-wider text-muted">agent visuel</span>
        </h2>
        <div className="flex items-center gap-2">
          {(floats.float1 || floats.float2) && (
            <button className="btn-ghost !px-3 !py-1 text-xs" disabled={busyId === 'floats'} onClick={() => void clearFloats()} title="Retirer les objets flottants de ce post">
              <Trash2 size={12} /> Objets flottants
            </button>
          )}
          {running && (
            <span className="mono flex items-center gap-2 text-[11px] uppercase tracking-wider text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              captures et images en cours…
            </span>
          )}
          <button
            className="btn-ghost"
            disabled={running || run.isPending}
            title={candidates.length ? 'Nouvelle passe : autres pages, autres concepts (sans limite)' : "Lancer l'agent visuel"}
            onClick={() => run.mutate(candidates.length > 0)}
          >
            {candidates.length > 0 ? (
              <>
                <InfinityIcon size={14} /> Encore des propositions
              </>
            ) : (
              <>
                <Wand2 size={14} /> Lancer l'agent visuel
              </>
            )}
          </button>
        </div>
      </div>

      {candidates.length === 0 && !running && (
        <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted">
          L'agent capture les pages liées au sujet et à la source (site de l'outil, article) et génère des
          concepts d'illustration pour ce post. Chaque proposition se pose sur une slide en un clic.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => {
          const busy = busyId === c.id;
          const used = inUse.has(c.id);
          return (
            <div key={c.id} className={`card overflow-hidden ${busy ? 'opacity-60' : ''}`}>
              <div className={`${c.origin === 'screenshot' ? 'aspect-[16/10]' : 'aspect-[4/5]'} overflow-hidden ${c.cutout ? 'checker' : 'bg-panel2'}`}>
                <img
                  src={`/api/assets/${c.id}`}
                  alt=""
                  className={`h-full w-full ${c.cutout ? 'object-contain' : 'object-cover'} ${c.origin === 'screenshot' ? 'object-top' : ''}`}
                  loading="lazy"
                />
              </div>
              <div className="p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="mono inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {c.origin === 'screenshot' ? <Camera size={10} /> : <Sparkles size={10} />}
                    {c.origin === 'screenshot' ? 'capture' : 'image'}
                  </span>
                  {c.style && <span className="mono text-[10px] text-muted">{STYLE_LABELS[c.style] ?? c.style}</span>}
                  <span className="mono text-[10px] text-muted/70">lot {c.batch}</span>
                  {used && (
                    <span className="mono ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ice">
                      posée
                    </span>
                  )}
                </div>
                <div className="truncate text-sm font-semibold" title={c.label}>
                  {c.label || '—'}
                </div>
                <p className="line-clamp-2 text-xs text-muted" title={c.prompt ?? c.url}>
                  {c.origin === 'screenshot' ? c.why ?? c.url : c.prompt}
                </p>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer" className="mono block truncate text-[10px] text-accent hover:underline">
                    {c.url.replace(/^https?:\/\//, '')}
                  </a>
                )}
                <select
                  className="input mt-2.5 !py-1 text-xs"
                  value={targets[c.id] ?? c.slideIdx ?? 0}
                  onChange={(e) => setTargets((t) => ({ ...t, [c.id]: Number(e.target.value) }))}
                >
                  {post.slides.map((s) => (
                    <option key={s.id} value={s.idx}>
                      → slide {s.idx + 1} · {s.kind}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex items-center gap-1.5">
                  <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'hero')} title="Poser en illustration plein cadre">
                    Illustration
                  </button>
                  {c.origin === 'screenshot' && (
                    <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'screenshot')} title="Transformer la slide en capture d'écran encadrée">
                      Capture
                    </button>
                  )}
                  {c.cutout && (
                    <>
                      <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'float1')} title="Objet flottant n°1 (toutes les slides)">
                        Objet 1
                      </button>
                      <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'float2')} title="Objet flottant n°2 (toutes les slides)">
                        Objet 2
                      </button>
                    </>
                  )}
                  <span className="flex-1" />
                  <button className="pill-btn" disabled={busy || used} onClick={() => remove(c)} title="Retirer cette proposition">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
