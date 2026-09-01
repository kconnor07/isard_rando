import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtDate, PageTitle } from '../components/shared';

interface HealthDto {
  publicUrl: string;
  publishMode: string;
  llmMode: string;
  llm: { anthropic: boolean; gemini: boolean };
  smtp: { ok: boolean; detail: string };
  chromium: { ok: boolean; detail: string };
  oauth: {
    linkedinConfigured: boolean;
    metaConfigured: boolean;
    tokens: { provider: string; subject: string; externalId: string; expiresAt: string | null; meta: Record<string, unknown> | null }[];
  };
  lastWebhookCommentAt: string | null;
  lastJobRuns: { job: string; ok: boolean | null; finishedAt: string | null; summary: unknown }[];
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />;
}

export default function Setup() {
  const { data: health, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthDto>('/api/setup/health'),
  });
  const connectLinkedIn = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/oauth/linkedin/start'),
    onSuccess: (data) => { window.open(data.url, '_blank'); },
  });
  const connectMeta = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/oauth/meta/start'),
    onSuccess: (data) => { window.open(data.url, '_blank'); },
  });

  if (!health) return <div className="text-muted">Chargement…</div>;
  const liToken = health.oauth.tokens.find((t) => t.subject === 'li_person');
  const liOrg = health.oauth.tokens.find((t) => t.subject === 'li_org');
  const igToken = health.oauth.tokens.find((t) => t.subject === 'ig_user');

  return (
    <div className="max-w-3xl">
      <PageTitle title="Connexions & santé" subtitle="État des services et connexion des comptes sociaux."
        actions={<button className="btn-ghost" onClick={() => void refetch()}>🔄 Actualiser</button>} />

      <div className="card mb-5 p-5">
        <h2 className="mb-3 text-base font-bold">Comptes sociaux</h2>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Dot ok={Boolean(liToken)} />
            <div className="flex-1">
              <div className="text-sm font-semibold">LinkedIn — profil personnel</div>
              <div className="text-xs text-muted">
                {liToken ? `Connecté (${String(liToken.meta?.name ?? liToken.externalId)}) · expire ${fmtDate(liToken.expiresAt)}` : 'Non connecté'}
              </div>
            </div>
            <button className="btn-primary !py-1.5 text-xs" disabled={!health.oauth.linkedinConfigured || connectLinkedIn.isPending}
              onClick={() => connectLinkedIn.mutate()}>
              {liToken ? 'Reconnecter' : 'Connecter'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Dot ok={Boolean(liOrg)} />
            <div className="flex-1">
              <div className="text-sm font-semibold">LinkedIn — page entreprise</div>
              <div className="text-xs text-muted">
                {liOrg ? `Organisation ${liOrg.externalId}` : "Après connexion du profil, saisis l'ID d'organisation (nécessite l'accès Community Management)"}
              </div>
            </div>
            <button className="btn-ghost !py-1.5 text-xs" disabled={!liToken}
              onClick={async () => {
                const orgId = prompt("ID de l'organisation LinkedIn (ex: 115786063) :");
                if (orgId) { await api.post('/api/oauth/linkedin/org', { orgId }); void refetch(); }
              }}>
              Définir l'organisation
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Dot ok={Boolean(igToken)} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Instagram (via Meta)</div>
              <div className="text-xs text-muted">
                {igToken
                  ? `Connecté @${String(igToken.meta?.igUsername ?? igToken.externalId)} · expire ${fmtDate(igToken.expiresAt)}`
                  : 'Non connecté — compte Instagram professionnel lié à une Page Facebook requis (voir docs/setup-meta.md)'}
              </div>
            </div>
            <button className="btn-primary !py-1.5 text-xs" disabled={!health.oauth.metaConfigured || connectMeta.isPending}
              onClick={() => connectMeta.mutate()}>
              {igToken ? 'Reconnecter' : 'Connecter'}
            </button>
          </div>
        </div>
      </div>

      <div className="card mb-5 p-5">
        <h2 className="mb-3 text-base font-bold">Services</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2"><Dot ok={health.smtp.ok} /> SMTP <span className="text-xs text-muted">— {health.smtp.detail}</span></div>
          <div className="flex items-center gap-2"><Dot ok={health.chromium.ok} /> Chromium (rendu/captures)</div>
          <div className="flex items-center gap-2"><Dot ok={health.llm.anthropic} /> Claude API {health.llmMode === 'mock' && <span className="text-xs text-amber-300">(mode mock)</span>}</div>
          <div className="flex items-center gap-2"><Dot ok={health.llm.gemini} /> Gemini API</div>
          <div className="flex items-center gap-2"><Dot ok={health.publishMode === 'live'} /> Publication : <b>{health.publishMode === 'live' ? 'réelle' : 'dry-run (simulation)'}</b></div>
          <div className="flex items-center gap-2"><Dot ok={Boolean(health.lastWebhookCommentAt)} /> Webhook Meta
            <span className="text-xs text-muted">{health.lastWebhookCommentAt ? `dernier commentaire ${fmtDate(health.lastWebhookCommentAt)}` : 'aucun événement reçu'}</span></div>
        </div>
        <p className="mt-3 text-xs text-muted">URL publique : {health.publicUrl}</p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-base font-bold">Derniers jobs</h2>
        <div className="flex flex-col gap-1 font-mono text-xs">
          {health.lastJobRuns.map((run, i) => (
            <div key={i} className="flex items-center gap-2">
              <Dot ok={run.ok === true} />
              <span className="w-36">{run.job}</span>
              <span className="text-muted">{fmtDate(run.finishedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
