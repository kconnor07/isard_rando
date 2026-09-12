import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Infinity as InfinityIcon, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, humanizeError } from '../api/client';
import type { PostDetailDto, VisualCandidateDto } from '../api/types';
import { SLIDE_KIND_LABELS } from './shared';
import { toast } from './Toaster';

interface VisualsDto {
  running: boolean;
  startedAt: string | null;
  lastRun: { finishedAt: string; ok: boolean; error?: string; summary?: { screenshots?: number; images?: number; failed?: number } } | null;
  candidates: VisualCandidateDto[];
}

/** Curseur qui n'applique sa valeur qu'au relâchement (souris, tactile ou clavier), sans re-rendu à chaque pixel. */
function CommitSlider({ min, max, value, disabled, onCommit }: { min: number; max: number; value: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const timer = useRef<number | null>(null);
  const commit = (v: number) => {
    if (v === value) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(v), 350);
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="range"
        min={min}
        max={max}
        className="w-24 accent-sky-500"
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => commit(local)}
        onKeyUp={() => commit(local)}
        onBlur={() => commit(local)}
      />
      <span className="mono w-8 text-[10px] text-muted">{local}</span>
    </span>
  );
}

type FloatSlot = 'float1' | 'float2' | 'float3' | 'float4';
const FLOAT_SLOTS: FloatSlot[] = ['float1', 'float2', 'float3', 'float4'];
const STYLE_LABELS: Record<string, string> = { full: 'plein cadre', objets: 'objet détouré', chrome: 'chrome & verre' };

/**
 * Propositions de l'agent visuel pour un post : captures des pages liées au
 * sujet et à la source, images générées (dont des séries d'objets cohérents)
 * — chacune se pose sur une slide ou en objet flottant en un clic. « Encore »
 * relance une passe qui évite ce qui a déjà été proposé. La barre
 * « Disposition » règle les objets et le placement de l'illustration détourée.
 */
export default function VisualAgentPanel({ post, locked = false, onChanged }: { post: PostDetailDto; locked?: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);

  const { data } = useQuery({
    queryKey: ['visuals', post.id],
    queryFn: () => api.get<VisualsDto>(`/api/posts/${post.id}/visuals`),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['visuals', post.id] });
  const running = data?.running ?? false;
  const candidates = data?.candidates ?? [];

  // Chronomètre de la passe en cours + bilan à la fin (succès ou échec, une seule fois)
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current && data?.lastRun) {
      wasRunning.current = false;
      const r = data.lastRun;
      if (r.ok) {
        const s = r.summary ?? {};
        toast.success(`Agent visuel terminé : ${s.screenshots ?? 0} capture(s), ${s.images ?? 0} image(s)${s.failed ? `, ${s.failed} échec(s)` : ''}`);
      } else toast.error(`Agent visuel en échec : ${r.error ?? 'erreur inconnue'}`);
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, data?.lastRun?.finishedAt]);
  const elapsed = data?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)) : 0;
  const fmtElapsed = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const run = useMutation({
    mutationFn: (more: boolean) => api.post(`/api/posts/${post.id}/visuals/run`, { more }),
    onSuccess: () => {
      toast.info('Agent visuel lancé : captures et images arrivent au fil de l’eau (2 à 4 min).');
      invalidate();
    },
  });

  /** Réglages de disposition du post (objets, placement) puis re-rendu. */
  const layout = async (body: Record<string, unknown>) => {
    setBusyId('layout');
    try {
      await api.post(`/api/posts/${post.id}/visuals/floats`, body);
      await api.post(`/api/posts/${post.id}/render`);
      onChanged();
    } catch (e) {
      toast.error(humanizeError(e));
    } finally {
      setBusyId(null);
    }
  };

  const use = async (c: VisualCandidateDto, as: 'hero' | 'screenshot' | FloatSlot) => {
    const slideIdx = Math.min(targets[c.id] ?? c.slideIdx ?? 0, Math.max(0, post.slides.length - 1));
    setBusyId(c.id);
    try {
      await api.post(`/api/posts/${post.id}/visuals/${c.id}/use`, { slideIdx, as });
      // Illustration ou capture : seule la slide visée est re-rendue (objets flottants : toutes)
      await api.post(as === 'hero' || as === 'screenshot' ? `/api/posts/${post.id}/render?slide=${slideIdx}` : `/api/posts/${post.id}/render`);
      onChanged();
      toast.success(as === 'hero' ? `Illustration posée sur la slide ${slideIdx + 1}` : as === 'screenshot' ? `Slide ${slideIdx + 1} transformée en capture` : 'Objet flottant posé sur les slides');
    } catch (e) {
      toast.error(humanizeError(e));
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
      toast.error(humanizeError(e));
    } finally {
      setBusyId(null);
    }
  };
  const layoutBusy = busyId === 'layout' || locked;
  const ov = post.visualOverrides ?? {};
  const floatIds = FLOAT_SLOTS.map((k) => ov[k] ?? null);
  const hasFloats = floatIds.some(Boolean);
  const hasCutoutHero = post.slides.some((s) => s.heroCutout || candidates.find((x) => x.id === s.heroAssetId)?.cutout);
  const inUse = new Set([...post.slides.flatMap((s) => [s.heroAssetId, s.screenshotAssetId]), ...floatIds].filter(Boolean));
  const slotOf = (id: string) => FLOAT_SLOTS.findIndex((k) => ov[k] === id);

  return (
    <div>
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          Visuels proposés{' '}
          <span className="mono ml-1 text-[11px] font-normal uppercase tracking-wider text-muted">agent visuel</span>
        </h2>
        <div className="flex items-center gap-2">
          {running && (
            <span className="mono flex items-center gap-2 text-[11px] uppercase tracking-wider text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              passe en cours · {fmtElapsed} · {candidates.length} proposition(s)
            </span>
          )}
          {!running && data?.lastRun && !data.lastRun.ok && (
            <span className="text-xs text-red-300" title={data.lastRun.error}>
              dernière passe en échec
            </span>
          )}
          <button
            className="btn-ghost"
            disabled={running || run.isPending || locked}
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

      {(hasFloats || hasCutoutHero) && (
        <div className={`card mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-xs ${layoutBusy ? 'opacity-60' : ''}`}>
          <span className="mono text-[10px] uppercase tracking-wider text-muted">Disposition</span>
          {busyId === 'layout' && (
            <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ice">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> nouveau rendu…
            </span>
          )}
          {hasFloats && (
            <>
              <label className="flex items-center gap-1.5">
                Objets
                <select className="input !w-auto !py-1 text-xs" disabled={layoutBusy} value={ov.floatLayout ?? (floatIds.filter(Boolean).length > 2 ? '4-coins' : 'coins')} onChange={(e) => void layout({ floatLayout: e.target.value })}>
                  <option value="coins">coins opposés</option>
                  <option value="4-coins">quatre coins</option>
                  <option value="haut">en haut</option>
                  <option value="bas">en bas</option>
                  <option value="cotes">sur les côtés</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Taille
                <CommitSlider min={10} max={60} value={ov.floatSize ?? 30} disabled={layoutBusy} onCommit={(v) => void layout({ floatSize: v })} />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-sky-500" disabled={layoutBusy} checked={ov.floatBleed ?? true} onChange={(e) => void layout({ floatBleed: e.target.checked })} />
                débordent du cadre
              </label>
              <label className="flex items-center gap-1.5">
                Sur
                <select className="input !w-auto !py-1 text-xs" disabled={layoutBusy} value={ov.floatSlides ?? 'centrees'} onChange={(e) => void layout({ floatSlides: e.target.value })}>
                  <option value="centrees">slides centrées (accroche, chiffre, CTA)</option>
                  <option value="accroche">l'accroche seulement</option>
                  <option value="toutes">toutes les slides</option>
                </select>
              </label>
              <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={layoutBusy} onClick={() => void layout({ clear: true })} title="Retirer les objets flottants de ce post">
                <Trash2 size={12} /> Retirer les objets
              </button>
            </>
          )}
          {hasCutoutHero && (
            <>
              <label className="flex items-center gap-1.5">
                Illustration
                <select className="input !w-auto !py-1 text-xs" disabled={layoutBusy} value={ov.heroPlacement ?? ''} onChange={(e) => void layout({ heroPlacement: e.target.value || null })}>
                  <option value="">placement du template</option>
                  <option value="centre">au-dessus du titre</option>
                  <option value="haut">ancrée en haut</option>
                  <option value="droite">à droite</option>
                  <option value="gauche">à gauche</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Taille
                <CommitSlider min={60} max={140} value={ov.heroSize ?? 100} disabled={layoutBusy} onCommit={(v) => void layout({ heroSize: v })} />
              </label>
            </>
          )}
        </div>
      )}

      {candidates.length === 0 && !running && (
        <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted">
          L'agent capture les pages liées au sujet et à la source (site de l'outil, article), génère des
          concepts d'illustration et des séries d'objets pour ce post. Chaque proposition se pose sur une slide
          ou en objet flottant en un clic.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => {
          const busy = busyId === c.id || locked;
          const used = inUse.has(c.id);
          const slot = slotOf(c.id);
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
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="mono inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {c.origin === 'screenshot' ? <Camera size={10} /> : <Sparkles size={10} />}
                    {c.origin === 'screenshot' ? 'capture' : 'image'}
                  </span>
                  {c.style && <span className="mono text-[10px] text-muted">{STYLE_LABELS[c.style] ?? c.style}</span>}
                  {c.set && <span className="mono rounded-full border border-line px-2 py-0.5 text-[10px] text-muted" title="Série d'objets cohérents">série</span>}
                  {c.popColor && <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: c.popColor }} title={`Couleur signature ${c.popColor}`} />}
                  <span className="mono text-[10px] text-muted/70">lot {c.batch}</span>
                  {used && (
                    <span className="mono ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ice">
                      {slot >= 0 ? `objet ${slot + 1}` : 'posée'}
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
                      → slide {s.idx + 1} · {SLIDE_KIND_LABELS[s.kind] ?? s.kind}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'hero')} title="Poser en illustration de la slide choisie">
                    Illustration
                  </button>
                  {c.origin === 'screenshot' && (
                    <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => use(c, 'screenshot')} title="Transformer la slide en capture d'écran encadrée">
                      Capture
                    </button>
                  )}
                  {c.cutout && (
                    <select
                      className="input !w-auto !py-1 text-xs"
                      value=""
                      disabled={busy}
                      title="Objet flottant posé sur toutes les slides (jusqu'à 4)"
                      onChange={(e) => {
                        if (e.target.value) void use(c, e.target.value as FloatSlot);
                      }}
                    >
                      <option value="">Objet flottant…</option>
                      {FLOAT_SLOTS.map((k, i) => (
                        <option key={k} value={k}>
                          Objet {i + 1}{ov[k] ? (ov[k] === c.id ? ' (celui-ci)' : ' (remplacer)') : ''}
                        </option>
                      ))}
                    </select>
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
