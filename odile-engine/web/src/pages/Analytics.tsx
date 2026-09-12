import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AnalyticsOverviewDto, PostStatDto } from '../api/types';
import { CHANNEL_LABELS, Empty, fmtDate, PageTitle } from '../components/shared';
import { toast } from '../components/Toaster';

interface LearningDto {
  sources: { name: string; weight: number; enabled: boolean }[];
  topics: { topic: string; factor: number }[];
  lastLearnAt: string | null;
}
interface MetricsJobSummary {
  candidates: number;
  fetched: number;
  skipped: number;
  errors: number;
  partial: number;
}

const fmtNum = (n: number | null | undefined): string => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n));

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="mono text-[10px] uppercase tracking-[0.18em] text-muted/70">{label}</div>
      <div className="mono mt-1 text-[26px] leading-tight text-ice">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted" title={hint}>{hint}</div>}
    </div>
  );
}

export default function Analytics() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const { data: overview } = useQuery({
    queryKey: ['analytics', 'overview', days],
    queryFn: () => api.get<AnalyticsOverviewDto>(`/api/analytics/overview?days=${days}`),
  });
  const { data: posts } = useQuery({
    queryKey: ['analytics', 'posts'],
    queryFn: () => api.get<PostStatDto[]>('/api/analytics/posts'),
  });
  const { data: learning } = useQuery({
    queryKey: ['analytics', 'learning'],
    queryFn: () => api.get<LearningDto>('/api/analytics/learning'),
  });
  const refresh = useMutation({
    mutationFn: () => api.post<MetricsJobSummary>('/api/analytics/refresh', { force: true }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: ['summary'] });
      if (s.candidates === 0) toast.info('Aucun post publié à relever.');
      else if (s.fetched === 0) toast.info(`Rien relevé : ${s.skipped} post(s) ignoré(s) (publication simulée ou compte non connecté)${s.errors ? `, ${s.errors} erreur(s)` : ''}.`);
      else toast.success(`${s.fetched} post(s) relevé(s)${s.partial ? ` (${s.partial} partiel(s))` : ''}${s.errors ? `, ${s.errors} erreur(s)` : ''}.`);
    },
  });

  const maxReach = Math.max(1, ...(overview?.perDay.map((d) => d.reach) ?? [1]));
  const maxClicks = Math.max(1, ...(overview?.perDay.map((d) => d.clicks) ?? [1]));
  const noMetrics = overview ? overview.totals.withMetrics === 0 : false;

  return (
    <div>
      <PageTitle
        title="Analytics"
        subtitle="Portée, interactions et clics des posts publiés ; les statistiques sont relevées chaque matin sur LinkedIn et Instagram."
        actions={
          <>
            <select className="input !w-auto !py-1.5 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 jours</option>
              <option value={30}>30 jours</option>
              <option value={90}>90 jours</option>
            </select>
            <button className="btn-ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()} title="Interroge LinkedIn et Instagram maintenant">
              <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} /> {refresh.isPending ? 'Relevé…' : 'Relever maintenant'}
            </button>
          </>
        }
      />

      {overview && overview.warnings.length > 0 && (
        <div className="card mb-5 flex flex-col gap-1 border-white/25 p-4 text-sm">
          {overview.warnings.map((w) => (
            <div key={`${w.provider}-${w.subject}`} className="flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" /> {w.message}
            </div>
          ))}
          <Link to="/setup" className="mt-1 text-xs text-accent hover:underline">
            Ouvrir Connexions & santé
          </Link>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Posts publiés" value={fmtNum(overview?.totals.posts)} hint={`sur ${days} jours`} />
        <Kpi label="Personnes atteintes" value={fmtNum(overview?.totals.reach)} hint={noMetrics ? 'pas encore de relevé' : `${overview?.totals.withMetrics ?? 0} post(s) relevé(s)`} />
        <Kpi label="Interactions" value={fmtNum(overview?.totals.engagement)} hint="j'aime, commentaires, partages, enregistrements" />
        <Kpi label="Clics humains" value={fmtNum(overview?.totals.clicks)} hint="liens courts /r/, robots exclus" />
        <Kpi label="Abonnés Instagram" value={fmtNum(overview?.totals.followers)} hint={overview?.connected.instagram ? 'au dernier test de connexion' : 'Instagram non connecté'} />
      </div>

      {overview && (
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {overview.channels.map((c) => (
            <div key={c.channel} className={`card p-4 ${c.posts === 0 ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-bold">{CHANNEL_LABELS[c.channel] ?? c.channel}</h3>
                <span className="mono text-[11px] text-muted">{c.posts} post{c.posts > 1 ? 's' : ''}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                <div><div className="mono text-base text-ice">{fmtNum(c.reach)}</div><div className="text-[10px] uppercase text-muted">atteints</div></div>
                <div><div className="mono text-base text-ice">{fmtNum(c.likes)}</div><div className="text-[10px] uppercase text-muted">j'aime</div></div>
                <div><div className="mono text-base text-ice">{fmtNum(c.comments)}</div><div className="text-[10px] uppercase text-muted">comm.</div></div>
                <div><div className="mono text-base text-txt">{fmtNum(c.channel === 'ig' ? c.saves : c.shares)}</div><div className="text-[10px] uppercase text-muted">{c.channel === 'ig' ? 'enregistr.' : 'partages'}</div></div>
                <div><div className="mono text-base text-txt">{fmtNum(c.clicks)}</div><div className="text-[10px] uppercase text-muted">clics</div></div>
                <div><div className="mono text-base text-txt">{c.posts ? fmtNum(Math.round(c.engagement / c.posts)) : '—'}</div><div className="text-[10px] uppercase text-muted">inter./post</div></div>
              </div>
              {c.posts > 0 && c.withMetrics < c.posts && (
                <div className="mt-2 text-[11px] text-muted">{c.posts - c.withMetrics} post(s) sans relevé{c.channel === 'li_personal' ? ' (LinkedIn n’expose pas la portée d’un profil)' : ''}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold">Portée et clics par jour</h2>
            <div className="flex items-center gap-3 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent/70" /> personnes atteintes (jour de publication)</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-ice/80" /> clics</span>
            </div>
          </div>
          <div className="flex h-36 items-end gap-[3px]">
            {overview?.perDay.map((d) => (
              <div key={d.day} className="group relative flex flex-1 items-end gap-px">
                <div className="flex-1 rounded-t bg-accent/60 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(d.reach > 0 ? 4 : 1, (d.reach / maxReach) * 130)}px` }} />
                <div className="flex-1 rounded-t bg-ice/70 transition-colors group-hover:bg-ice" style={{ height: `${Math.max(d.clicks > 0 ? 4 : 1, (d.clicks / maxClicks) * 130)}px` }} />
                <div className="absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10px] group-hover:block">
                  {d.day.slice(5)} · {d.reach} atteints · {d.clicks} clic{d.clicks > 1 ? 's' : ''}{d.posts ? ` · ${d.posts} post` : ''}
                </div>
              </div>
            ))}
          </div>
          {overview && overview.totals.posts === 0 && <div className="mt-2 text-sm text-muted">Aucun post publié sur la période.</div>}
        </div>
        <div className="card p-5">
          <h2 className="mb-1 text-base font-bold">Meilleurs créneaux</h2>
          <p className="mb-3 text-xs text-muted">Score moyen (clics + interactions pondérées) par jour et heure de publication, tous posts confondus.</p>
          {(!overview || overview.bestSlots.length === 0) && <p className="text-sm text-muted">Pas encore assez de données : les créneaux apparaîtront après les premières publications relevées.</p>}
          <div className="flex flex-col gap-1.5">
            {overview?.bestSlots.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2 text-sm">
                <span className="mono w-5 text-[11px] text-muted">{i + 1}.</span>
                <span className="mono w-20 whitespace-nowrap text-ice">{s.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (s.avg / (overview.bestSlots[0]?.avg || 1)) * 100)}%` }} />
                </div>
                <span className="mono w-14 text-right text-xs text-muted">{s.avg}</span>
                <span className="mono w-12 text-right text-[10px] text-muted/70">{s.posts} post{s.posts > 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted">Dernier relevé : {overview?.lastFetchAt ? fmtDate(overview.lastFetchAt) : 'jamais'}. Les créneaux se règlent dans Réglages.</p>
        </div>
      </div>

      {learning && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card p-5">
            <h2 className="mb-1 text-base font-bold">Sources qui performent</h2>
            <p className="mb-3 text-xs text-muted">
              Poids ajustés chaque lundi par la boucle d'apprentissage
              {learning.lastLearnAt ? ` (dernier passage : ${fmtDate(learning.lastLearnAt)})` : ' (pas encore exécutée)'}.
            </p>
            <div className="flex flex-col gap-1 text-sm">
              {learning.sources.slice(0, 8).map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className={`flex-1 truncate ${s.enabled ? '' : 'line-through opacity-50'}`}>{s.name}</span>
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${((s.weight - 0.5) / 1.5) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-muted">{s.weight.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="mb-1 text-base font-bold">Sujets qui performent</h2>
            <p className="mb-3 text-xs text-muted">Affinités apprises des clics et des interactions — elles boostent (ou pénalisent) le score des actus.</p>
            {learning.topics.length === 0 && (
              <p className="text-sm text-muted">Pas encore de données — les affinités apparaîtront après quelques posts publiés.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {learning.topics.slice(0, 16).map((t) => (
                <span
                  key={t.topic}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    t.factor >= 1.05 ? 'bg-white/15 text-txt' : t.factor <= 0.95 ? 'border border-line text-muted' : 'bg-white/[0.05] text-muted'
                  }`}
                >
                  {t.topic} ×{t.factor.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold">Posts publiés</h2>
      {posts && posts.length === 0 && <Empty>Aucun post publié pour l'instant.</Empty>}
      {posts && posts.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="mono text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5 text-left font-normal">Post</th>
                <th className="px-2 py-2.5 text-right font-normal">Atteints</th>
                <th className="px-2 py-2.5 text-right font-normal">J'aime</th>
                <th className="px-2 py-2.5 text-right font-normal">Comm.</th>
                <th className="px-2 py-2.5 text-right font-normal">Enreg.</th>
                <th className="px-2 py-2.5 text-right font-normal">Partages</th>
                <th className="px-2 py-2.5 text-right font-normal">Clics</th>
                <th className="px-4 py-2.5 text-right font-normal">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-white/[0.025]">
                  <td className="max-w-[22rem] px-4 py-2.5">
                    <Link to={`/posts/${post.id}`} className="block truncate font-semibold hover:text-ice" title={post.hook}>
                      {post.hook || '(sans titre)'}
                    </Link>
                    <div className="text-[11px] text-muted">
                      {CHANNEL_LABELS[post.channel] ?? post.channel} · {fmtDate(post.publishedAt)}
                      {post.simulated && <span className="ml-1 rounded-full border border-line px-1.5 text-[10px] uppercase">simulé</span>}
                      {post.metrics?.partial && (
                        <span className="ml-1 cursor-help underline decoration-dotted" title={post.metrics.partial}>partiel</span>
                      )}
                      {post.externalUrl && !post.simulated && (
                        <a href={post.externalUrl} target="_blank" rel="noreferrer" className="ml-1 text-ice underline decoration-white/30">voir ↗</a>
                      )}
                    </div>
                  </td>
                  <td className="mono px-2 py-2.5 text-right text-ice">{fmtNum(post.metrics?.reach)}</td>
                  <td className="mono px-2 py-2.5 text-right">{fmtNum(post.metrics?.likes)}</td>
                  <td className="mono px-2 py-2.5 text-right">{fmtNum(post.metrics?.comments ?? (post.comments || null))}</td>
                  <td className="mono px-2 py-2.5 text-right">{fmtNum(post.metrics?.saves)}</td>
                  <td className="mono px-2 py-2.5 text-right">{fmtNum(post.metrics?.shares)}</td>
                  <td className="mono px-2 py-2.5 text-right">{fmtNum(post.clicks)}</td>
                  <td className="mono px-4 py-2.5 text-right text-txt">{post.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
