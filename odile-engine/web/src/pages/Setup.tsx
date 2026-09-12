import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import { api, humanizeError } from '../api/client';
import type { ConnectionCheckDto, OauthTokenDto } from '../api/types';
import { useDialog } from '../components/Dialog';
import { toast } from '../components/Toaster';
import { fmtDate, PageTitle } from '../components/shared';

interface HealthDto {
  publicUrl: string;
  publishMode: string;
  version?: string;
  llmMode: string;
  llm: { anthropic: boolean; gemini: boolean };
  smtp: { ok: boolean; detail: string };
  chromium: { ok: boolean; detail: string };
  oauth: { linkedinConfigured: boolean; metaConfigured: boolean; tokens: OauthTokenDto[] };
  lastWebhookCommentAt: string | null;
  lastJobRuns: { job: string; ok: boolean | null; finishedAt: string | null; summary: unknown }[];
}
interface OrgsDto {
  orgScopes: boolean;
  orgs: { id: string; name: string }[];
  error: string | null;
  linkedOrgId: string | null;
}
interface PagesDto {
  candidates: { pageId: string; pageName: string; igId: string; igUsername: string }[];
  selectedPageId: string | null;
  userToken: boolean;
  error?: string | null;
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        !ok ? 'bg-transparent ring-1 ring-white/35' : warn ? 'bg-white/70' : 'bg-accent'
      }`}
    />
  );
}

/** Jours avant expiration (null : jeton sans expiration). */
function daysLeft(token: OauthTokenDto | undefined): number | null {
  if (!token?.expiresAt) return null;
  return (new Date(token.expiresAt).getTime() - Date.now()) / 86400000;
}

/** « renouvelé automatiquement · expire dans 42 j » / « sans expiration » / « EXPIRÉ » */
function expiryLabel(token: OauthTokenDto): string {
  const left = daysLeft(token);
  if (left === null) return 'jeton sans expiration';
  if (left <= 0) return 'jeton EXPIRÉ — reconnecter';
  const refreshError = typeof token.meta?.refreshError === 'string' ? token.meta.refreshError : null;
  const base = `expire dans ${Math.ceil(left)} j`;
  if (token.refreshable && !refreshError) return `${base} · renouvelé automatiquement`;
  if (refreshError) return `${base} · renouvellement automatique en échec (${refreshError})`;
  return left <= 10 ? `${base} — reconnecter bientôt` : base;
}

function lastCheckOf(token: OauthTokenDto | undefined): { ok: boolean; detail: string; at: string } | null {
  const lc = token?.meta?.lastCheck as { ok?: boolean; detail?: string; at?: string } | undefined;
  if (!lc || typeof lc.ok !== 'boolean') return null;
  return { ok: lc.ok, detail: lc.detail ?? '', at: lc.at ?? '' };
}

function tokenWarn(token: OauthTokenDto | undefined): boolean {
  if (!token) return false;
  const left = daysLeft(token);
  const check = lastCheckOf(token);
  const refreshError = typeof token.meta?.refreshError === 'string';
  return (check !== null && !check.ok) || (left !== null && (left <= 0 || (left <= 10 && (!token.refreshable || refreshError))));
}

export default function Setup() {
  const dialog = useDialog();
  const qc = useQueryClient();
  const [withOrg, setWithOrg] = useState(false);
  const { data: health, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthDto>('/api/setup/health'),
  });
  const liToken = health?.oauth.tokens.find((t) => t.subject === 'li_person');
  const liOrg = health?.oauth.tokens.find((t) => t.subject === 'li_org');
  const fbUser = health?.oauth.tokens.find((t) => t.subject === 'fb_user');
  const fbPage = health?.oauth.tokens.find((t) => t.subject === 'fb_page');
  const igToken = health?.oauth.tokens.find((t) => t.subject === 'ig_user');

  const { data: orgs } = useQuery({
    queryKey: ['oauth', 'linkedin', 'orgs'],
    queryFn: () => api.get<OrgsDto>('/api/oauth/linkedin/orgs'),
    enabled: Boolean(liToken),
  });
  const { data: pages } = useQuery({
    queryKey: ['oauth', 'meta', 'pages'],
    queryFn: () => api.get<PagesDto>('/api/oauth/meta/pages'),
    enabled: Boolean(igToken),
  });
  const refreshAll = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['oauth'] });
    void qc.invalidateQueries({ queryKey: ['summary'] });
  };

  // La connexion se fait dans cet onglet : la page de retour propose le lien vers le dashboard
  const connectLinkedIn = useMutation({
    mutationFn: () => api.get<{ url: string }>(`/api/oauth/linkedin/start${withOrg ? '?org=1' : ''}`),
    onSuccess: (data) => location.assign(data.url),
  });
  const connectMeta = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/oauth/meta/start'),
    onSuccess: (data) => location.assign(data.url),
  });
  const checkConnections = useMutation({
    mutationFn: () => api.post<{ checks: ConnectionCheckDto[] }>('/api/setup/check-connections'),
    onSuccess: (data) => {
      refreshAll();
      if (data.checks.length === 0) {
        toast.info('Aucun compte connecté à tester.');
        return;
      }
      for (const c of data.checks) (c.ok ? toast.success : toast.error)(`${c.label} : ${c.detail}`);
    },
  });
  const linkOrg = useMutation({
    mutationFn: (orgId: string) => api.post<{ ok: boolean; org: { id: string; name: string } }>('/api/oauth/linkedin/org', { orgId }),
    onSuccess: (data) => {
      refreshAll();
      toast.success(`Page entreprise « ${data.org.name} » liée`);
    },
  });
  const unlinkOrg = useMutation({
    mutationFn: () => api.delete('/api/oauth/linkedin/org'),
    onSuccess: () => {
      refreshAll();
      toast.success('Page entreprise retirée');
    },
  });
  const selectPage = useMutation({
    mutationFn: (pageId: string) => api.post<{ igUsername: string; pageName: string }>('/api/oauth/meta/select', { pageId }),
    onSuccess: (data) => {
      refreshAll();
      toast.success(`Instagram @${data.igUsername} sélectionné (Page « ${data.pageName} »)`);
    },
  });
  const subscribe = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string }>('/api/oauth/meta/subscribe'),
    onSuccess: (data) => {
      refreshAll();
      toast.success(`Webhook : ${data.detail}`);
    },
  });
  const disconnect = useMutation({
    mutationFn: (provider: 'linkedin' | 'meta') => api.delete(`/api/oauth/${provider}`),
    onSuccess: () => {
      refreshAll();
      toast.success('Compte déconnecté');
    },
  });
  const disconnectAsk = async (provider: 'linkedin' | 'meta') => {
    const ok = await dialog.confirm({
      title: provider === 'linkedin' ? 'Déconnecter LinkedIn ?' : 'Déconnecter Instagram / Meta ?',
      message: 'Les jetons sont supprimés du serveur : les publications programmées sur ce canal échoueront tant que le compte n’est pas reconnecté.',
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (ok) disconnect.mutate(provider);
  };
  const askOrgId = async () => {
    const orgId = await dialog.prompt({
      title: 'Organisation LinkedIn',
      message: 'ID numérique de la page entreprise (dans l’URL admin de la page, ex. 115786063).',
      placeholder: '115786063',
      confirmLabel: 'Lier',
    });
    if (!orgId) return;
    try {
      await linkOrg.mutateAsync(orgId.trim());
    } catch (err) {
      toast.error(humanizeError(err));
    }
  };

  if (!health) return <div className="text-muted">Chargement…</div>;
  const liCheck = lastCheckOf(liToken);
  const igCheck = lastCheckOf(igToken);
  const webhookInstalled = fbPage?.meta?.webhookInstalled;
  const orgChoices = orgs?.orgs ?? [];

  return (
    <div className="max-w-3xl">
      <PageTitle
        title="Connexions & santé"
        subtitle="Comptes sociaux, renouvellement des jetons et état des services."
        actions={
          <>
            <button className="btn-ghost" disabled={checkConnections.isPending} onClick={() => checkConnections.mutate()} title="Appelle LinkedIn et Meta avec les jetons stockés">
              <Activity size={14} className={checkConnections.isPending ? 'animate-pulse' : ''} /> {checkConnections.isPending ? 'Test en cours…' : 'Tester les connexions'}
            </button>
            <button className="btn-ghost" onClick={refreshAll}>
              <RefreshCw size={14} /> Actualiser
            </button>
          </>
        }
      />

      <div className="card mb-5 p-5">
        <h2 className="mb-3 text-base font-bold">Comptes sociaux</h2>
        <div className="flex flex-col gap-4">
          {/* ---- LinkedIn profil ---- */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="pt-1.5"><Dot ok={Boolean(liToken)} warn={tokenWarn(liToken)} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">LinkedIn — profil personnel</div>
              <div className="text-xs text-muted">
                {liToken ? (
                  <>
                    Connecté ({String(liToken.meta?.name ?? liToken.externalId)}) · {expiryLabel(liToken)}
                    {liCheck && (
                      <span className={liCheck.ok ? '' : 'text-txt'}> · test {liCheck.ok ? 'ok' : 'en échec'} {fmtDate(liCheck.at)} : {liCheck.detail}</span>
                    )}
                  </>
                ) : (
                  'Non connecté'
                )}
              </div>
              {!liToken?.refreshable && liToken && (
                <div className="mt-1 text-xs text-muted">
                  LinkedIn ne fournit pas de renouvellement automatique à cette app : un email prévient 7 jours avant l’expiration, un clic « Reconnecter » suffit.
                </div>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={withOrg} onChange={(e) => setWithOrg(e.target.checked)} />
                Demander aussi les droits « page entreprise » (exige le produit Community Management API sur l’app LinkedIn — sinon la connexion est refusée)
              </label>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-primary !py-1.5 text-xs"
                disabled={!health.oauth.linkedinConfigured || connectLinkedIn.isPending}
                onClick={() => connectLinkedIn.mutate()}
                title={health.oauth.linkedinConfigured ? '' : 'LINKEDIN_CLIENT_ID manquant dans .env'}
              >
                {liToken ? 'Reconnecter' : 'Connecter'}
              </button>
              {liToken && (
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => void disconnectAsk('linkedin')} title="Supprimer les jetons LinkedIn">
                  <Unplug size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ---- LinkedIn page entreprise ---- */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="pt-1.5"><Dot ok={Boolean(liOrg)} warn={Boolean(liOrg) && !liOrg?.scopes.includes('w_organization_social')} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">LinkedIn — page entreprise</div>
              <div className="text-xs text-muted">
                {liOrg
                  ? `« ${String(liOrg.meta?.name ?? `Organisation ${liOrg.externalId}`)} » (${liOrg.externalId})${
                      liOrg.scopes.includes('w_organization_social') ? ' · droits de publication accordés' : ' · droits de publication NON accordés : reconnecte LinkedIn avec l’option « page entreprise »'
                    }`
                  : liToken
                    ? orgs?.orgScopes
                      ? orgChoices.length > 0
                        ? 'Choisis la page à lier :'
                        : orgs.error
                          ? `Liste des pages indisponible (${orgs.error})`
                          : 'Aucune page administrée trouvée — saisis l’ID manuellement'
                      : 'Reconnecte LinkedIn avec l’option « page entreprise » pour publier au nom de la page (ou saisis l’ID pour préparer le canal)'
                    : 'Connecte d’abord le profil personnel'}
              </div>
              {liToken && !liOrg && orgChoices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {orgChoices.map((o) => (
                    <button key={o.id} className="btn-ghost !py-1 text-xs" disabled={linkOrg.isPending} onClick={() => linkOrg.mutate(o.id)}>
                      {o.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {liOrg ? (
                <button className="btn-ghost !py-1.5 text-xs" disabled={unlinkOrg.isPending} onClick={() => unlinkOrg.mutate()}>
                  Retirer
                </button>
              ) : (
                <button className="btn-ghost !py-1.5 text-xs" disabled={!liToken || linkOrg.isPending} onClick={() => void askOrgId()}>
                  Saisir l’ID
                </button>
              )}
            </div>
          </div>

          {/* ---- Instagram ---- */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="pt-1.5"><Dot ok={Boolean(igToken)} warn={tokenWarn(igToken) || tokenWarn(fbUser) || (Boolean(igToken) && !fbUser)} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Instagram (via Meta)</div>
              <div className="text-xs text-muted">
                {igToken ? (
                  <>
                    Connecté @{String(igToken.meta?.igUsername ?? igToken.externalId)}
                    {igToken.meta?.pageName ? ` via la Page « ${String(igToken.meta.pageName)} »` : ''} · {expiryLabel(igToken)}
                    {typeof igToken.meta?.followers === 'number' ? ` · ${igToken.meta.followers} abonnés` : ''}
                    {igCheck && (
                      <span className={igCheck.ok ? '' : 'text-txt'}> · test {igCheck.ok ? 'ok' : 'en échec'} {fmtDate(igCheck.at)} : {igCheck.detail}</span>
                    )}
                  </>
                ) : (
                  'Non connecté — compte Instagram professionnel lié à une Page Facebook requis (voir docs/setup-meta.md)'
                )}
              </div>
              {igToken && (
                <div className="mt-1 text-xs text-muted">
                  {fbUser
                    ? `Jeton utilisateur Meta : ${expiryLabel(fbUser)} (les jetons de Page n’expirent pas).`
                    : 'Reconnecte une fois pour activer le renouvellement automatique (ancienne connexion sans jeton utilisateur).'}
                </div>
              )}
              {igToken && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Dot ok={webhookInstalled === true} warn={webhookInstalled === false} />
                  Webhook commentaires :{' '}
                  {webhookInstalled === true ? 'app installée sur la Page' : webhookInstalled === false ? `non installé (${String(fbPage?.meta?.webhookDetail ?? '')})` : 'état inconnu'}
                  {health.lastWebhookCommentAt ? ` · dernier commentaire reçu ${fmtDate(health.lastWebhookCommentAt)}` : ' · aucun commentaire reçu pour l’instant'}
                  <button className="btn-ghost !py-0.5 text-[11px]" disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>
                    {webhookInstalled === true ? 'Réinstaller' : 'Installer'}
                  </button>
                </div>
              )}
              {pages && pages.candidates.length > 1 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">Compte publié :</span>
                  <select
                    className="input !w-auto !py-1 text-xs"
                    value={pages.selectedPageId ?? ''}
                    disabled={selectPage.isPending}
                    onChange={(e) => e.target.value && selectPage.mutate(e.target.value)}
                  >
                    {pages.candidates.map((c) => (
                      <option key={c.pageId} value={c.pageId}>
                        @{c.igUsername || c.igId} — Page « {c.pageName} »
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-primary !py-1.5 text-xs"
                disabled={!health.oauth.metaConfigured || connectMeta.isPending}
                onClick={() => connectMeta.mutate()}
                title={health.oauth.metaConfigured ? '' : 'META_APP_ID manquant dans .env'}
              >
                {igToken ? 'Reconnecter' : 'Connecter'}
              </button>
              {igToken && (
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => void disconnectAsk('meta')} title="Supprimer les jetons Meta">
                  <Unplug size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          Les jetons sont vérifiés chaque nuit (renouvellement à 4 h 30) et les statistiques des posts relevées à 9 h 10. « Tester les connexions » appelle
          les plateformes maintenant.
        </p>
      </div>

      <div className="card mb-5 p-5">
        <h2 className="mb-3 text-base font-bold">Services</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2"><Dot ok={health.smtp.ok} /> SMTP <span className="text-xs text-muted">— {health.smtp.detail}</span></div>
          <div className="flex items-center gap-2"><Dot ok={health.chromium.ok} /> Chromium (rendu/captures)</div>
          <div className="flex items-center gap-2"><Dot ok={health.llm.anthropic} /> Claude API {health.llmMode === 'mock' && <span className="text-xs text-muted">(mode mock)</span>}</div>
          <div className="flex items-center gap-2"><Dot ok={health.llm.gemini} /> Gemini API</div>
          <div className="flex items-center gap-2"><Dot ok={health.publishMode === 'live'} /> Publication : <b>{health.publishMode === 'live' ? 'réelle' : 'dry-run (simulation)'}</b></div>
          <div className="flex items-center gap-2"><Dot ok={health.oauth.linkedinConfigured} /> App LinkedIn <span className="text-xs text-muted">{health.oauth.linkedinConfigured ? 'configurée' : 'LINKEDIN_CLIENT_ID absent'}</span></div>
          <div className="flex items-center gap-2"><Dot ok={health.oauth.metaConfigured} /> App Meta <span className="text-xs text-muted">{health.oauth.metaConfigured ? 'configurée' : 'META_APP_ID absent'}</span></div>
        </div>
        <p className="mt-3 text-xs text-muted">URL publique : {health.publicUrl} · version déployée : <b className="mono">{health.version ?? 'dev'}</b></p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-base font-bold">Derniers jobs</h2>
        <div className="flex flex-col gap-1 font-mono text-xs">
          {health.lastJobRuns.map((run, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Dot ok={run.ok === true} />
              <span className="w-36">{run.job}</span>
              <span className="text-muted">{fmtDate(run.finishedAt)}</span>
              {run.summary != null && typeof run.summary === 'object' && (
                <span className="truncate text-muted/70" title={JSON.stringify(run.summary)}>
                  {Object.entries(run.summary as Record<string, unknown>)
                    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                    .slice(0, 4)
                    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
                    .join(' ')}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
