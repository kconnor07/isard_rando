import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, FileText, Film, Images, Image as ImageIcon, RotateCw, X } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, humanizeError } from '../api/client';
import type { ActionOutcomeDto, PostSummaryDto, SlotDto } from '../api/types';
import { Empty, PageTitle, StatusBadge } from '../components/shared';
import { toast } from '../components/Toaster';
import {
  aujourdhuiYmd,
  depuisChampLocal,
  jourLong,
  lundiDe,
  moisCourt,
  numeroDuJour,
  parisHm,
  parisToUtc,
  parisYmd,
  periode,
  pourChampLocal,
  ymdPlus,
} from '../lib/paris';

const SEMAINES = 4;
const DOW_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const PLATEFORME_COURT: Record<string, string> = { instagram: 'IG', linkedin: 'LI' };
/** Ordre de la file : d'abord ce qui attend une validation, puis les échecs, puis les rejetés. */
const ORDRE_FILE = ['awaiting_approval', 'failed', 'rejected'];

const ICONE_FORMAT: Record<string, typeof FileText> = {
  li_doc: FileText,
  reel: Film,
  carousel: Images,
  static: ImageIcon,
  li_image: ImageIcon,
};

/** Couleur du liseré d'un post, selon son état. */
function liseré(statut: string): string {
  if (statut === 'published') return 'border-l-white/35';
  if (statut === 'failed') return 'border-l-white';
  if (statut === 'publishing') return 'border-l-accent';
  return 'border-l-accent/70';
}

interface Element {
  cle: string;
  at: string;
  kind: 'post' | 'slot';
  post?: PostSummaryDto;
  slot?: SlotDto;
}

export default function Calendar() {
  const qc = useQueryClient();
  const [offsetSemaines, setOffsetSemaines] = useState(0);
  const [plateforme, setPlateforme] = useState<'tous' | 'linkedin' | 'instagram'>('tous');
  const [compte, setCompte] = useState('tous');
  /** post choisi dans la file, en attente d'un créneau (clic-clic, et doigt sur mobile) */
  const [enMain, setEnMain] = useState<number | null>(null);
  /** post en cours de glissement (souris) */
  const [glisse, setGlisse] = useState<number | null>(null);
  const [cible, setCible] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ at: string; postId: number | null } | null>(null);

  const debut = ymdPlus(lundiDe(aujourdhuiYmd()), offsetSemaines * 7);
  const fin = ymdPlus(debut, SEMAINES * 7 - 1);
  const jours = Array.from({ length: SEMAINES * 7 }, (_, i) => ymdPlus(debut, i));
  const aujourdhui = aujourdhuiYmd();
  const range = `from=${encodeURIComponent(parisToUtc(debut, 0, 0).toISOString())}&to=${encodeURIComponent(parisToUtc(fin, 23, 59).toISOString())}`;

  const postsQ = useQuery({
    queryKey: ['calendar', range],
    queryFn: () => api.get<PostSummaryDto[]>(`/api/calendar?${range}`),
  });
  const slotsQ = useQuery({
    queryKey: ['schedule', 'slots', range],
    queryFn: () => api.get<SlotDto[]>(`/api/schedule/slots?${range}`),
  });
  const fileQ = useQuery({
    queryKey: ['posts', 'schedulable'],
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts?status=awaiting_approval,rejected,failed'),
    select: (list) => [...list].sort((a, b) => ORDRE_FILE.indexOf(a.status) - ORDRE_FILE.indexOf(b.status)),
  });

  const invalider = () => {
    for (const k of ['calendar', 'schedule', 'posts', 'summary']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const programmer = useMutation({
    mutationFn: (vars: { postId: number; at: string }) => api.post<ActionOutcomeDto>(`/api/posts/${vars.postId}/schedule`, { at: vars.at }),
    onSuccess: (outcome) => {
      invalider();
      setPicker(null);
      setEnMain(null);
      toast.success(outcome.message);
    },
    onError: (err) => toast.error(humanizeError(err)),
  });

  const posts = (postsQ.data ?? []).filter(
    (p) => (plateforme === 'tous' || p.platform === plateforme) && (compte === 'tous' || (p.surface ?? '') === compte),
  );
  const file = (fileQ.data ?? []).filter(
    (p) => (plateforme === 'tous' || p.platform === plateforme) && (compte === 'tous' || (p.surface ?? '') === compte),
  );
  /** Les comptes qui apparaissent sur la période ou dans la file : de quoi filtrer sans réglage. */
  const comptes = [...new Set([...(postsQ.data ?? []), ...(fileQ.data ?? [])].map((p) => p.surface).filter((s): s is string => Boolean(s)))];

  // ---- Répartition par jour (heure de Paris) --------------------------------
  const parJour = new Map<string, Element[]>();
  const ajoute = (ymd: string, el: Element) => parJour.set(ymd, [...(parJour.get(ymd) ?? []), el]);
  for (const post of posts) {
    const at = post.scheduledAt ?? post.publishedAt ?? post.createdAt;
    ajoute(parisYmd(at), { cle: `p${post.id}`, at, kind: 'post', post });
  }
  for (const slot of slotsQ.data ?? []) {
    if (slot.postId) continue; // le créneau pris est représenté par son post
    if (plateforme !== 'tous' && slot.platform !== plateforme) continue;
    const ymd = parisYmd(slot.at);
    if (slot.past && ymd < aujourdhui) continue; // les créneaux des jours passés n'apprennent rien
    ajoute(ymd, { cle: `s${slot.at}${slot.platform}`, at: slot.at, kind: 'slot', slot });
  }
  for (const liste of parJour.values()) liste.sort((a, b) => a.at.localeCompare(b.at));
  const quelqueChose = [...parJour.values()].some((l) => l.length > 0);

  // ---- Placement ------------------------------------------------------------
  const placer = (postId: number, at: string) => programmer.mutate({ postId, at });
  const postEnMain = enMain ?? glisse;

  const deposer = (e: DragEvent, at: string | null, ymd: string) => {
    e.preventDefault();
    setCible(null);
    const id = Number(e.dataTransfer.getData('text/plain')) || glisse;
    setGlisse(null);
    if (!id) return;
    if (at) placer(id, at);
    else ouvrirPicker(premierCreneauLibre(ymd) ?? parisToUtc(ymd, 9, 0).toISOString(), id);
  };
  const premierCreneauLibre = (ymd: string): string | null =>
    (parJour.get(ymd) ?? []).find((el) => el.kind === 'slot' && !el.slot!.past)?.at ?? null;

  const ouvrirPicker = (at: string, postId?: number) => {
    const choix = postId ?? enMain ?? file[0]?.id ?? null;
    if (!choix) {
      toast.info('Rien à programmer pour l’instant. Un post fabriqué arrive ici tout seul ; pour en lancer un maintenant, va dans Veille IA et clique « Générer un post ».');
      return;
    }
    setPicker({ at: pourChampLocal(at), postId: choix });
  };

  /** Un clic sur un créneau : place le post « en main », sinon ouvre le choix. */
  const cliquerCreneau = (slot: SlotDto) => {
    if (slot.past) {
      toast.info('Ce créneau est dépassé : il faut deux heures d’avance pour fabriquer et vérifier le post.');
      return;
    }
    if (enMain) placer(enMain, slot.at);
    else ouvrirPicker(slot.at);
  };

  // ---- Rendu d'un élément ---------------------------------------------------
  const rendreElement = (el: Element, compact: boolean) => {
    if (el.kind === 'post' && el.post) {
      const post = el.post;
      const deplacable = post.status === 'scheduled';
      const Icone = ICONE_FORMAT[post.format] ?? ImageIcon;
      return (
        <div
          key={el.cle}
          draggable={deplacable}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', String(post.id));
            setGlisse(post.id);
          }}
          onDragEnd={() => setGlisse(null)}
          className={`group rounded-lg border border-l-2 border-line bg-white/[0.03] ${liseré(post.status)} ${
            compact ? 'p-1.5' : 'p-2.5'
          } text-xs ${deplacable ? 'cursor-grab active:cursor-grabbing' : ''} ${glisse === post.id ? 'opacity-40' : ''}`}
          title={deplacable ? 'Glisse-le sur un autre créneau pour le déplacer' : undefined}
        >
          <div className="flex items-center gap-1.5">
            <span className="mono text-[11px] text-ice">{parisHm(el.at)}</span>
            <Icone size={11} className="text-muted" />
            <span className="mono text-[10px] uppercase text-muted">{PLATEFORME_COURT[post.platform] ?? post.platform}</span>
            {!compact && <StatusBadge status={post.status} simulated={post.simulated} />}
            {post.broadcast && (
              <span className="mono text-[9px] text-muted" title={`Même sujet sur : ${post.broadcast.others.join(', ')}`}>
                ×{post.broadcast.others.length + 1}
              </span>
            )}
          </div>
          {/* draggable={false} : sans cela le navigateur glisserait le LIEN (son URL) au lieu du post. */}
          <Link
            to={`/posts/${post.id}`}
            draggable={false}
            className={`mt-0.5 block font-semibold hover:text-ice ${compact ? 'line-clamp-2' : ''}`}
            title={post.hook}
          >
            {post.hook || '(sans titre)'}
          </Link>
          {post.surface && <div className="truncate text-[10px] text-muted">{post.surface}</div>}
          {deplacable && (
            <button
              className={`mt-1 text-[10px] text-muted underline decoration-white/30 hover:text-txt ${compact ? '' : ''}`}
              onClick={() => ouvrirPicker(post.scheduledAt ?? new Date().toISOString(), post.id)}
            >
              déplacer
            </button>
          )}
        </div>
      );
    }
    const slot = el.slot!;
    const accueille = Boolean(postEnMain) && !slot.past;
    return (
      <button
        key={el.cle}
        onDragOver={(e) => {
          if (slot.past) return;
          e.preventDefault();
          setCible(el.cle);
        }}
        onDragLeave={() => setCible((c) => (c === el.cle ? null : c))}
        onDrop={(e) => deposer(e, slot.at, parisYmd(slot.at))}
        className={`w-full rounded-lg border border-dashed ${compact ? 'p-1.5' : 'p-2'} text-left text-xs transition-colors ${
          slot.past
            ? 'border-line/50 text-muted/50'
            : cible === el.cle
              ? 'border-accent bg-accent-soft/50 text-txt'
              : `border-line/80 text-muted hover:border-accent/60 hover:text-txt ${accueille ? 'border-accent/40' : ''}`
        }`}
        onClick={() => cliquerCreneau(slot)}
        title={slot.past ? 'Créneau dépassé (2 h d’avance nécessaires)' : 'Programmer un post sur ce créneau'}
      >
        <span className="mono text-[11px]">{parisHm(slot.at)}</span>{' '}
        <span className="mono text-[10px] uppercase">{PLATEFORME_COURT[slot.platform]}</span>
        <span className="ml-1">{slot.past ? 'dépassé' : 'libre'}</span>
      </button>
    );
  };

  const enErreur = postsQ.isError || slotsQ.isError;

  return (
    <div>
      <PageTitle
        title="Calendrier de publication"
        subtitle="Tout est à l’heure de Paris. Glisse un post de la file sur un créneau libre — ou clique le post puis le créneau."
        actions={
          <>
            <button className="btn-ghost" onClick={() => ouvrirPicker(new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000).toISOString())}>
              <CalendarClock size={14} /> Programmer à une date
            </button>
            <div className="flex items-center gap-1">
              <button className="btn-ghost !px-2" onClick={() => setOffsetSemaines((w) => w - 1)} aria-label="Semaine précédente" title="Semaine précédente">
                <ChevronLeft size={14} />
              </button>
              <button className="btn-ghost !px-2 text-xs" onClick={() => setOffsetSemaines(0)} disabled={offsetSemaines === 0}>
                Aujourd'hui
              </button>
              <button className="btn-ghost !px-2" onClick={() => setOffsetSemaines((w) => w + 1)} aria-label="Semaine suivante" title="Semaine suivante">
                <ChevronRight size={14} />
              </button>
            </div>
          </>
        }
      />

      {/* Période + filtres */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-muted">{periode(debut, fin)}</span>
        <span className="hidden text-muted/40 sm:inline">·</span>
        {(['tous', 'linkedin', 'instagram'] as const).map((p) => (
          <button
            key={p}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              plateforme === p ? 'border-accent/60 bg-accent-soft/50 text-ice' : 'border-line text-muted hover:text-txt'
            }`}
            onClick={() => setPlateforme(p)}
          >
            {p === 'tous' ? 'Toutes plateformes' : p === 'linkedin' ? 'LinkedIn' : 'Instagram'}
          </button>
        ))}
        {comptes.length > 1 && (
          <select className="input !w-auto !py-1 text-[11px]" value={compte} onChange={(e) => setCompte(e.target.value)} aria-label="Filtrer par compte">
            <option value="tous">Tous les comptes</option>
            {comptes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {enErreur && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-3 text-sm">
          <span className="text-muted">{humanizeError(postsQ.error ?? slotsQ.error)}</span>
          <button
            className="btn-ghost !py-1 text-xs"
            onClick={() => {
              void postsQ.refetch();
              void slotsQ.refetch();
            }}
          >
            <RotateCw size={12} /> Réessayer
          </button>
        </div>
      )}

      {/* File d'attente */}
      {file.length > 0 && (
        <div className="mb-4 rounded-2xl border border-line bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="label !mb-0">File d'attente ({file.length})</span>
            {enMain ? (
              <span className="flex items-center gap-2 text-[11px] text-ice">
                Post choisi — clique maintenant un créneau libre
                <button className="text-muted hover:text-txt" onClick={() => setEnMain(null)} aria-label="Annuler la sélection">
                  <X size={12} />
                </button>
              </span>
            ) : (
              <span className="text-[11px] text-muted">glisse-les sur un créneau, ou clique l'un puis l'autre</span>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {file.map((post) => {
              const Icone = ICONE_FORMAT[post.format] ?? ImageIcon;
              return (
                <button
                  key={post.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(post.id));
                    setGlisse(post.id);
                  }}
                  onDragEnd={() => setGlisse(null)}
                  onClick={() => setEnMain((v) => (v === post.id ? null : post.id))}
                  className={`w-52 shrink-0 cursor-grab rounded-xl border p-2 text-left text-xs transition-colors active:cursor-grabbing ${
                    enMain === post.id ? 'border-accent bg-accent-soft/50' : 'border-line bg-white/[0.03] hover:border-accent/50'
                  } ${glisse === post.id ? 'opacity-40' : ''}`}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Icone size={11} className="text-muted" />
                    <span className="mono text-[10px] uppercase text-muted">{PLATEFORME_COURT[post.platform] ?? post.platform}</span>
                    <StatusBadge status={post.status} simulated={post.simulated} />
                  </div>
                  <div className="line-clamp-2 font-semibold">{post.hook || `Post #${post.id}`}</div>
                  {post.surface && <div className="truncate text-[10px] text-muted">{post.surface}</div>}
                </button>
              );
            })}
          </div>
        </div>
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
          {jours.map((ymd) => {
            const elements = parJour.get(ymd) ?? [];
            const estAujourdhui = ymd === aujourdhui;
            const passe = ymd < aujourdhui;
            return (
              <div
                key={ymd}
                onDragOver={(e) => {
                  if (passe) return;
                  e.preventDefault();
                  setCible(ymd);
                }}
                onDragLeave={() => setCible((c) => (c === ymd ? null : c))}
                onDrop={(e) => deposer(e, null, ymd)}
                className={`min-h-24 rounded-xl border p-1.5 transition-colors ${
                  cible === ymd
                    ? 'border-accent bg-accent-soft/40'
                    : estAujourdhui
                      ? 'border-accent/60 bg-accent-soft/40'
                      : 'border-line bg-white/[0.015]'
                } ${passe ? 'opacity-60' : ''}`}
              >
                <div className={`mono mb-1 text-[11px] ${estAujourdhui ? 'text-ice' : 'text-muted'}`}>
                  {numeroDuJour(ymd)}
                  {numeroDuJour(ymd) === 1 || ymd === jours[0] ? ` ${moisCourt(ymd)}` : ''}
                </div>
                <div className="flex flex-col gap-1">{elements.map((el) => rendreElement(el, true))}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Liste (mobile) */}
      <div className="flex flex-col gap-5 md:hidden">
        {jours
          .filter((ymd) => (parJour.get(ymd) ?? []).length > 0)
          .map((ymd) => (
            <div key={ymd}>
              <h2 className={`mb-2 text-sm font-bold uppercase tracking-wider ${ymd === aujourdhui ? 'text-ice' : 'text-muted'}`}>{jourLong(ymd)}</h2>
              <div className="flex flex-col gap-2">{(parJour.get(ymd) ?? []).map((el) => rendreElement(el, false))}</div>
            </div>
          ))}
      </div>

      {!quelqueChose && !enErreur && postsQ.data && slotsQ.data && (
        <div className="mt-4">
          <Empty>
            Rien sur ces {SEMAINES} semaines. Les créneaux se règlent dans Réglages → Cadence &amp; créneaux ; approuve un post ou clique « Programmer à une
            date ».
          </Empty>
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={() => setPicker(null)}>
          <div role="dialog" aria-modal="true" className="card w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold">Programmer un post</h2>
            <p className="mt-1 text-sm text-muted">Le post est approuvé et partira à la date choisie, heure de Paris.</p>
            <label className="label mt-4">Date et heure (Paris)</label>
            <input
              className="input"
              type="datetime-local"
              value={picker.at}
              min={pourChampLocal(new Date())}
              onChange={(e) => setPicker({ ...picker, at: e.target.value })}
            />
            <label className="label mt-3">Post</label>
            <select className="input" value={picker.postId ?? ''} onChange={(e) => setPicker({ ...picker, postId: Number(e.target.value) })}>
              {[...file, ...posts.filter((p) => p.status === 'scheduled')].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.surface ?? p.platform} · {p.hook || `Post #${p.id}`}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPicker(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                disabled={!picker.postId || !picker.at || programmer.isPending}
                onClick={() => picker.postId && placer(picker.postId, depuisChampLocal(picker.at).toISOString())}
              >
                {programmer.isPending ? 'Programmation…' : 'Programmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
