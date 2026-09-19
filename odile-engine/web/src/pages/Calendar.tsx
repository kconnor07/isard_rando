import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, FileText, Film, Images, Image as ImageIcon, RotateCw, X } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, humanizeError } from '../api/client';
import type { ActionOutcomeDto, PostDetailDto, PostSummaryDto, SlotDto, SurfaceDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, FORMAT_LABELS, PageTitle, Problemes, StatusBadge } from '../components/shared';
import { toast } from '../components/Toaster';
import { CeQueRecevraLaPersonne } from '../components/CeQueRecevraLaPersonne';
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
/** Ordre de la file : d'abord ce qui attend une validation, puis les échecs. */
const ORDRE_FILE = ['awaiting_approval', 'failed'];
/** Une couleur par compte, stable sur la période : on reconnaît Khaled, Alexis, la page, Instagram d'un coup d'œil. */
const COULEURS = ['bg-accent/80 text-white', 'bg-emerald-500/80 text-white', 'bg-violet-500/80 text-white', 'bg-pink-500/80 text-white', 'bg-amber-500/80 text-black', 'bg-sky-500/80 text-white'];
const CLE_SANS_COMPTE = 'sans-compte';

/** La clé de surface d'un post : « ig », la clé du compte, ou « sans-compte ». */
function cleDe(post: PostSummaryDto): string {
  if (post.platform === 'instagram') return 'ig';
  return post.surfaceKey ?? CLE_SANS_COMPTE;
}

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
  /** la surface choisie : « tous », « ig », « fb », la clé d'un compte LinkedIn, ou « sans-compte » */
  const [compte, setCompte] = useState('tous');
  /** post choisi dans la file, en attente d'un créneau (clic-clic, et doigt sur mobile) */
  const [enMain, setEnMain] = useState<number | null>(null);
  /** post en cours de glissement (souris) */
  const [glisse, setGlisse] = useState<number | null>(null);
  const [cible, setCible] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ at: string; postId: number | null } | null>(null);
  /** post ouvert dans le panneau d'aperçu (compte, texte, visuels) */
  const [apercu, setApercu] = useState<number | null>(null);

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
  const detailQ = useQuery({
    queryKey: ['post', apercu],
    queryFn: () => api.get<PostDetailDto>(`/api/posts/${apercu}`),
    enabled: apercu !== null,
  });
  const fileQ = useQuery({
    queryKey: ['posts', 'schedulable'],
    // Un post rejeté n'est pas « à programmer » : il reste dans l'éditeur si l'on veut le reprendre.
    queryFn: () => api.get<PostSummaryDto[]>('/api/posts?status=awaiting_approval,failed'),
    select: (list) => [...list].sort((a, b) => ORDRE_FILE.indexOf(a.status) - ORDRE_FILE.indexOf(b.status)),
  });
  // Les surfaces viennent des connexions, pas des posts : un compte fraîchement connecté est là tout de suite.
  const surfacesQ = useQuery({ queryKey: ['surfaces'], queryFn: () => api.get<SurfaceDto[]>('/api/surfaces') });

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

  /** Un post appartient-il à la surface choisie ? Facebook = les posts Instagram qui partent aussi sur la Page. */
  const surLaSurface = (p: PostSummaryDto) =>
    compte === 'tous' ? true : compte === 'fb' ? p.platform === 'instagram' && Boolean(p.facebook?.prevu) : cleDe(p) === compte;
  const posts = (postsQ.data ?? []).filter(surLaSurface);
  const file = (fileQ.data ?? []).filter(surLaSurface);
  const tousLesPosts = [...(postsQ.data ?? []), ...(fileQ.data ?? [])];
  /** Les puces de comptes : chaque surface connectée, puis Facebook, puis « sans compte » s'il en reste. */
  const puces: { key: string; label: string; initiales: string; n: number; enPanne?: boolean; panne?: string; platform: SurfaceDto['platform'] | null }[] = [
    { key: 'tous', label: 'Tous', initiales: '', n: tousLesPosts.length, platform: null },
    ...(surfacesQ.data ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      initiales: s.initiales,
      n: tousLesPosts.filter((p) => (s.key === 'fb' ? p.platform === 'instagram' && Boolean(p.facebook?.prevu) : cleDe(p) === s.key)).length,
      enPanne: s.enPanne,
      panne: s.panne,
      platform: s.platform,
    })),
  ];
  const sansCompte = tousLesPosts.filter((p) => cleDe(p) === CLE_SANS_COMPTE).length;
  if (sansCompte > 0) puces.push({ key: CLE_SANS_COMPTE, label: 'Sans compte', initiales: '?', n: sansCompte, platform: 'linkedin' });
  const couleurDe = (cle: string) => {
    const i = puces.findIndex((p) => p.key === cle && p.key !== 'tous');
    if (cle === CLE_SANS_COMPTE) return 'bg-white/20 text-txt';
    return COULEURS[(i < 0 ? 0 : i) % COULEURS.length]!;
  };
  const initialesDe = (p: PostSummaryDto) => puces.find((x) => x.key === cleDe(p))?.initiales ?? (p.platform === 'instagram' ? 'IG' : '?');
  const puceChoisie = puces.find((p) => p.key === compte) ?? puces[0]!;
  /** la plateforme des créneaux à montrer : celle de la surface choisie */
  const plateforme: 'tous' | 'linkedin' | 'instagram' = compte === 'tous' ? 'tous' : puceChoisie.platform === 'facebook' ? 'instagram' : (puceChoisie.platform ?? 'tous');

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
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="mono shrink-0 whitespace-nowrap text-[11px] text-ice">{parisHm(el.at)}</span>
            {/* La pastille du compte : on sait qui publie sans lire la ligne tronquée. */}
            <span className={`mono shrink-0 whitespace-nowrap rounded-md px-1 text-[9px] font-bold leading-4 ${couleurDe(cleDe(post))}`} title={post.surface ?? PLATEFORME_COURT[post.platform]}>
              {initialesDe(post)}
            </span>
            {post.facebook?.prevu && (
              <span className="mono shrink-0 whitespace-nowrap text-[9px] text-muted" title={post.facebook.error ? `Miroir Facebook en échec : ${post.facebook.error}` : 'Part aussi sur la Page Facebook (miroir)'}>
                +FB{post.facebook.error ? ' ⚠' : ''}
              </span>
            )}
            <Icone size={11} className="text-muted" />
            {!compact && <StatusBadge status={post.status} simulated={post.simulated} />}
            {post.broadcast && (
              <span className="mono text-[9px] text-muted" title={`Même sujet sur : ${post.broadcast.others.join(', ')}`}>
                ×{post.broadcast.others.length + 1}
              </span>
            )}
          </div>
          {/* Un clic ouvre l'aperçu : ce qui part, depuis quel compte, avec quel visuel. */}
          <button
            draggable={false}
            className={`mt-0.5 block w-full text-left font-semibold hover:text-ice ${compact ? 'line-clamp-2' : ''}`}
            title="Voir ce qui part : compte, texte, visuels"
            onClick={() => setApercu(post.id)}
          >
            {post.hook || '(sans titre)'}
          </button>
          {post.surface && <div className={`truncate text-[10px] ${cleDe(post) === CLE_SANS_COMPTE ? 'text-accent' : 'text-muted'}`}>{cleDe(post) === CLE_SANS_COMPTE ? 'compte non choisi' : post.surface}</div>}
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
        subtitle="Tout est à l’heure de Paris. Clique un post pour voir ce qui part et le déplacer ; un post de la file se pose sur un créneau libre."
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

      {/* Période + une puce par compte : chacun voit ses posts et ses heures */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-muted">{periode(debut, fin)}</span>
      </div>
      <div className="mb-3 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Comptes">
        {puces.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={compte === p.key}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              compte === p.key ? 'border-accent/60 bg-accent-soft/50 text-ice' : 'border-line text-muted hover:text-txt'
            }`}
            onClick={() => setCompte(p.key)}
            title={p.enPanne ? `${p.label} : ${p.panne}` : p.label}
          >
            {p.initiales && <span className={`mono rounded-md px-1 text-[9px] font-bold leading-4 ${couleurDe(p.key)}`}>{p.initiales}</span>}
            <span className="max-w-[9rem] truncate">{p.label}</span>
            <span className="mono text-[10px] opacity-70">{p.n}</span>
            {p.enPanne && <span title={p.panne}>⚠</span>}
          </button>
        ))}
      </div>
      {compte !== 'tous' && (
        <p className="mb-3 text-xs text-muted">
          <span className="font-semibold text-txt">{puceChoisie.label}</span> — {puceChoisie.n} post{puceChoisie.n > 1 ? 's' : ''} sur {SEMAINES} semaines
          {puceChoisie.enPanne ? <span className="text-accent"> · {puceChoisie.panne}</span> : null}
          {compte === CLE_SANS_COMPTE ? ' · ces posts partiront sur le premier profil actif : choisis leur compte dans l’éditeur' : ''}
          {compte === 'fb' ? ' · la Page reçoit une copie de chaque post Instagram, à la même heure' : ''}
          {(() => {
            const prochain = (slotsQ.data ?? []).find((s) => !s.past && !s.postId && (plateforme === 'tous' || s.platform === plateforme));
            return prochain ? ` · prochain créneau libre : ${fmtDate(prochain.at)}` : '';
          })()}
        </p>
      )}

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
            <span className="label !mb-0">À programmer ({file.length})</span>
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
                    <span className={`mono rounded-md px-1 text-[9px] font-bold leading-4 ${couleurDe(cleDe(post))}`}>{initialesDe(post)}</span>
                    <Icone size={11} className="text-muted" />
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

      {/* Aperçu : ce qui part, depuis quel compte, avec quel visuel et quel texte */}
      {apercu !== null && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setApercu(null)}>
          <aside
            className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-bg p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            {detailQ.isPending && <p className="text-sm text-muted">Chargement…</p>}
            {detailQ.isError && <p className="text-sm text-muted">{humanizeError(detailQ.error)}</p>}
            {detailQ.data && (
              <>
                <div className="mb-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <StatusBadge status={detailQ.data.status} simulated={detailQ.data.simulated} />
                      <span className="mono uppercase">{PLATEFORME_COURT[detailQ.data.platform] ?? detailQ.data.platform}</span>
                      <span>{FORMAT_LABELS[detailQ.data.format] ?? detailQ.data.format}</span>
                    </div>
                    <h2 className="mt-1 text-lg font-bold leading-snug">{detailQ.data.hook || `Post #${detailQ.data.id}`}</h2>
                  </div>
                  <button className="text-muted hover:text-txt" onClick={() => setApercu(null)} aria-label="Fermer">
                    <X size={16} />
                  </button>
                </div>

                {/* Qui publie, et quand */}
                <div className="card mb-3 p-3 text-sm">
                  <div className="label !mb-1">Compte</div>
                  <div className="font-semibold">{detailQ.data.surface ?? CHANNEL_LABELS[detailQ.data.channel] ?? detailQ.data.channel}</div>
                  <div className="mt-2 text-xs text-muted">
                    {detailQ.data.scheduledAt
                      ? `Part le ${fmtDate(detailQ.data.scheduledAt)}`
                      : detailQ.data.publishedAt
                        ? `Publié le ${fmtDate(detailQ.data.publishedAt)}`
                        : 'Pas encore programmé'}
                  </div>
                  {detailQ.data.platform === 'linkedin' && !detailQ.data.surfaceKey && (
                    <div className="mt-2 text-xs text-accent">
                      Compte non choisi : partira sur le premier profil actif. <Link to={`/posts/${detailQ.data.id}`} className="underline">Choisir le compte</Link>
                    </div>
                  )}
                  {detailQ.data.facebook?.prevu && (
                    <div className="mt-2 text-xs text-muted">
                      {detailQ.data.facebook.error
                        ? `Miroir Facebook en échec : ${detailQ.data.facebook.error}`
                        : detailQ.data.facebook.url
                          ? <>Aussi sur la Page Facebook — <a className="underline" href={detailQ.data.facebook.url} target="_blank" rel="noreferrer">voir</a></>
                          : 'Part aussi sur la Page Facebook (miroir), à la même heure, avec une légende adaptée.'}
                    </div>
                  )}
                  {detailQ.data.broadcast && (
                    <div className="mt-2 text-xs text-muted">
                      Même sujet sur :
                      {detailQ.data.broadcast.members && detailQ.data.broadcast.members.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {detailQ.data.broadcast.members.map((m) => (
                            <li key={m.id}>
                              <button className="text-txt underline decoration-white/30 hover:text-ice" onClick={() => setApercu(m.id)}>
                                {m.surface}
                              </button>
                              {m.scheduledAt ? ` — ${fmtDate(m.scheduledAt)}` : m.status === 'published' ? ' — publié' : ' — pas encore programmé'}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        ` ${detailQ.data.broadcast.others.join(' · ')}`
                      )}
                    </div>
                  )}
                </div>

                {/* Les visuels tels qu'ils partiront */}
                {detailQ.data.slides.length > 0 && (
                  <div className="mb-3">
                    <div className="label !mb-1.5">Visuels ({detailQ.data.slides.length})</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {detailQ.data.slides.map((slide) =>
                        slide.renderAssetId ? (
                          <img
                            key={slide.id}
                            src={`/public-assets/${slide.renderAssetId}.jpg`}
                            alt=""
                            className="h-40 w-32 shrink-0 rounded-lg border border-line object-cover"
                          />
                        ) : (
                          <div key={slide.id} className="flex h-40 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[11px] text-muted">
                            à rendre
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {/* Le texte exact */}
                <div className="mb-3">
                  <div className="label !mb-1.5">Description</div>
                  <p className="whitespace-pre-wrap rounded-2xl border border-line bg-white/[0.03] p-3 text-sm leading-relaxed">{detailQ.data.caption}</p>
                  {detailQ.data.hashtags.length > 0 && <p className="mt-1.5 text-xs text-muted">{detailQ.data.hashtags.join(' ')}</p>}
                </div>

                {/* Ce que le post promet, et ce que le moteur donnera vraiment */}
                {detailQ.data.problemes && detailQ.data.problemes.length > 0 && <Problemes liste={detailQ.data.problemes} compact />}
                <div className="mb-4">
                  <CeQueRecevraLaPersonne postId={detailQ.data.id} compact />
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Link className="btn-primary !py-1.5 text-xs" to={`/posts/${detailQ.data.id}`}>
                    Modifier ce post
                  </Link>
                  {detailQ.data.status === 'scheduled' && (
                    <button
                      className="btn-ghost !py-1.5 text-xs"
                      onClick={() => {
                        ouvrirPicker(detailQ.data!.scheduledAt ?? new Date().toISOString(), detailQ.data!.id);
                        setApercu(null);
                      }}
                    >
                      <CalendarClock size={12} /> Déplacer
                    </button>
                  )}
                  {detailQ.data.externalUrl && (
                    <a className="btn-ghost !py-1.5 text-xs" href={detailQ.data.externalUrl} target="_blank" rel="noreferrer">
                      Voir en ligne
                    </a>
                  )}
                </div>
              </>
            )}
          </aside>
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
