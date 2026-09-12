import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, MoveRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ActionOutcomeDto, PostSummaryDto, SlotDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import { CHANNEL_LABELS, Empty, fmtDate, PageTitle, StatusBadge } from '../components/shared';
import { toast } from '../components/Toaster';

const WEEKS = 4;
const DAY = 86400000;
const DOW_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const PLATFORM_SHORT: Record<string, string> = { instagram: 'IG', linkedin: 'LI' };
const STATUS_ORDER = ['awaiting_approval', 'failed', 'rejected'];

/** Lundi 00:00 (heure locale) de la semaine qui contient `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}
/** clé « AAAA-MM-JJ » en heure locale (le calendrier suit l'heure de l'utilisateur, Paris). */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

interface DayItem {
  key: string;
  at: string;
  kind: 'post' | 'slot';
  post?: PostSummaryDto;
  slot?: SlotDto;
}

export default function Calendar() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const start = new Date(mondayOf(new Date()).getTime() + offsetWeeks * 7 * DAY);
  const end = new Date(start.getTime() + WEEKS * 7 * DAY - 1);
  const range = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;

  const { data: posts } = useQuery({
    queryKey: ['calendar', range],
    queryFn: () => api.get<PostSummaryDto[]>(`/api/calendar?${range}`),
  });
  const { data: slots } = useQuery({
    queryKey: ['schedule', 'slots', range],
    queryFn: () => api.get<SlotDto[]>(`/api/schedule/slots?${range}`),
  });
  const { data: candidates } = useQuery({
    queryKey: ['posts', 'schedulable'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts?status=awaiting_approval,rejected,failed'),
    // d'abord les posts à valider, puis les échecs, puis les rejetés
    select: (list) => [...list].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['calendar'] });
    void qc.invalidateQueries({ queryKey: ['schedule'] });
    void qc.invalidateQueries({ queryKey: ['posts'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  };
  const schedule = useMutation({
    mutationFn: (vars: { postId: number; at: string }) => api.post<ActionOutcomeDto>(`/api/posts/${vars.postId}/schedule`, { at: vars.at }),
    onSuccess: (outcome) => {
      invalidate();
      setPicker(null);
      toast.success(`${outcome.message} ${outcome.scheduledAt ? fmtDate(outcome.scheduledAt) : ''}`.trim());
    },
  });

  // Fenêtre « Programmer ici » : créneau (modifiable) + post à y placer
  const [picker, setPicker] = useState<{ at: string; postId: number | null } | null>(null);
  const openPicker = (at: string) => {
    if (!candidates || candidates.length === 0) {
      toast.info('Aucun post à programmer : les posts « À valider », rejetés ou en échec apparaîtront ici.');
      return;
    }
    setPicker({ at: toLocalInput(at), postId: candidates[0]?.id ?? null });
  };
  const move = async (post: PostSummaryDto) => {
    const value = await dialog.prompt({
      title: 'Déplacer la publication',
      message: `« ${post.hook || `Post #${post.id}`} » — choisis la nouvelle date et heure (heure de Paris).`,
      type: 'datetime-local',
      initial: toLocalInput(post.scheduledAt ?? new Date(Date.now() + 3600000).toISOString()),
      min: toLocalInput(new Date().toISOString()),
      confirmLabel: 'Déplacer',
    });
    if (!value) return;
    schedule.mutate({ postId: post.id, at: new Date(value).toISOString() });
  };

  // ---- Répartition par jour --------------------------------------------------
  const byDay = new Map<string, DayItem[]>();
  for (const post of posts ?? []) {
    const at = post.scheduledAt ?? post.publishedAt ?? post.createdAt;
    const key = dayKey(new Date(at));
    byDay.set(key, [...(byDay.get(key) ?? []), { key: `p${post.id}`, at, kind: 'post', post }]);
  }
  for (const slot of slots ?? []) {
    if (slot.postId || slot.past) continue; // les créneaux pris sont représentés par leur post
    const key = dayKey(new Date(slot.at));
    byDay.set(key, [...(byDay.get(key) ?? []), { key: `s${slot.at}${slot.platform}`, at: slot.at, kind: 'slot', slot }]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const days: Date[] = Array.from({ length: WEEKS * 7 }, (_, i) => new Date(start.getTime() + i * DAY));
  const todayKey = dayKey(new Date());
  const hasAnything = [...byDay.values()].some((l) => l.length > 0);

  const renderItem = (item: DayItem, compact: boolean) => {
    if (item.kind === 'post' && item.post) {
      const post = item.post;
      const movable = post.status === 'scheduled';
      return (
        <div key={item.key} className={`group rounded-lg border border-line bg-white/[0.03] ${compact ? 'p-1.5' : 'p-2.5'} text-xs`}>
          <div className="flex items-center gap-1.5">
            <span className="mono text-[11px] text-ice">{fmtTime(item.at)}</span>
            <span className="mono text-[10px] uppercase text-muted">{PLATFORM_SHORT[post.platform] ?? post.platform}</span>
            {!compact && <StatusBadge status={post.status} />}
            {movable && (
              <button className="ml-auto hidden text-muted hover:text-txt group-hover:inline-flex" title="Déplacer" onClick={() => void move(post)}>
                <MoveRight size={12} />
              </button>
            )}
          </div>
          <Link to={`/posts/${post.id}`} className={`mt-0.5 block font-semibold hover:text-ice ${compact ? 'line-clamp-2' : 'truncate'}`} title={post.hook}>
            {post.hook || '(sans titre)'}
          </Link>
          {!compact && <div className="text-[11px] text-muted">{CHANNEL_LABELS[post.channel] ?? post.channel}</div>}
          {compact && movable && (
            <button className="mt-1 text-[10px] text-muted underline decoration-white/30 md:hidden" onClick={() => void move(post)}>
              déplacer
            </button>
          )}
        </div>
      );
    }
    const slot = item.slot!;
    return (
      <button
        key={item.key}
        className={`w-full rounded-lg border border-dashed border-line/80 ${compact ? 'p-1.5' : 'p-2'} text-left text-xs text-muted transition-colors hover:border-accent/60 hover:text-txt`}
        onClick={() => openPicker(slot.at)}
        title="Programmer un post sur ce créneau"
      >
        <span className="mono text-[11px]">{fmtTime(slot.at)}</span> <span className="mono text-[10px] uppercase">{PLATFORM_SHORT[slot.platform]}</span>
        <span className="ml-1">libre</span>
      </button>
    );
  };

  return (
    <div>
      <PageTitle
        title="Calendrier de publication"
        subtitle="Créneaux configurés, posts programmés et publiés (heure de Paris). Un créneau libre se programme en un clic."
        actions={
          <>
            <button className="btn-ghost" onClick={() => openPicker(new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000).toISOString())}>
              <CalendarClock size={14} /> Programmer à une date
            </button>
            <div className="flex items-center gap-1">
              <button className="btn-ghost !px-2" onClick={() => setOffsetWeeks((w) => w - 1)} title="Semaines précédentes">
                <ChevronLeft size={14} />
              </button>
              <button className="btn-ghost !px-2 text-xs" onClick={() => setOffsetWeeks(0)} disabled={offsetWeeks === 0}>
                Aujourd'hui
              </button>
              <button className="btn-ghost !px-2" onClick={() => setOffsetWeeks((w) => w + 1)} title="Semaines suivantes">
                <ChevronRight size={14} />
              </button>
            </div>
          </>
        }
      />

      {candidates && candidates.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          {candidates.length} post{candidates.length > 1 ? 's' : ''} en attente de créneau — clique un créneau libre pour l'y placer.
        </p>
      )}

      {/* Grille (écran large) */}
      <div className="hidden md:block">
        <div className="mb-1 grid grid-cols-7 gap-1.5">
          {DOW_SHORT.map((d) => (
            <div key={d} className="mono px-1 text-[10px] uppercase tracking-[0.18em] text-muted/70">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => {
            const key = dayKey(d);
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const past = d.getTime() < Date.now() - DAY;
            return (
              <div key={key} className={`min-h-24 rounded-xl border p-1.5 ${isToday ? 'border-accent/60 bg-accent-soft/40' : 'border-line bg-white/[0.015]'} ${past ? 'opacity-60' : ''}`}>
                <div className={`mono mb-1 text-[11px] ${isToday ? 'text-ice' : 'text-muted'}`}>
                  {d.getDate()}
                  {d.getDate() === 1 || (key === dayKey(days[0]!)) ? ` ${new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(d)}` : ''}
                </div>
                <div className="flex flex-col gap-1">{items.map((item) => renderItem(item, true))}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Liste (mobile) */}
      <div className="flex flex-col gap-5 md:hidden">
        {days
          .filter((d) => (byDay.get(dayKey(d)) ?? []).length > 0)
          .map((d) => {
            const key = dayKey(d);
            return (
              <div key={key}>
                <h2 className={`mb-2 text-sm font-bold uppercase tracking-wider ${key === todayKey ? 'text-ice' : 'text-muted'}`}>
                  {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)}
                </h2>
                <div className="flex flex-col gap-2">{(byDay.get(key) ?? []).map((item) => renderItem(item, false))}</div>
              </div>
            );
          })}
      </div>

      {!hasAnything && posts && slots && (
        <div className="mt-4">
          <Empty>
            Rien sur ces {WEEKS} semaines. Les créneaux se règlent dans Réglages → Créneaux de publication ; approuve un post ou clique « Programmer à une date ».
          </Empty>
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={() => setPicker(null)}>
          <div role="dialog" aria-modal="true" className="card w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold">Programmer un post</h2>
            <p className="mt-1 text-sm text-muted">Le post est approuvé et partira à la date choisie (heure de Paris).</p>
            <label className="label mt-4">Date et heure</label>
            <input
              className="input"
              type="datetime-local"
              value={picker.at}
              min={toLocalInput(new Date().toISOString())}
              onChange={(e) => setPicker({ ...picker, at: e.target.value })}
            />
            <label className="label mt-3">Post</label>
            <select className="input" value={picker.postId ?? ''} onChange={(e) => setPicker({ ...picker, postId: Number(e.target.value) })}>
              {(candidates ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {CHANNEL_LABELS[p.channel] ?? p.channel} · {p.hook || `Post #${p.id}`}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPicker(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                disabled={!picker.postId || !picker.at || schedule.isPending}
                onClick={() => picker.postId && schedule.mutate({ postId: picker.postId, at: new Date(picker.at).toISOString() })}
              >
                {schedule.isPending ? 'Programmation…' : 'Programmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
