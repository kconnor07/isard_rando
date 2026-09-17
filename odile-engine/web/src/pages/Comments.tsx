import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Copy, ExternalLink, Stethoscope } from 'lucide-react';
import { api, humanizeError } from '../api/client';
import { toast } from '../components/Toaster';
import type { CommentDto, MessagerieDiagDto } from '../api/types';
import { Empty, EtatErreur, PageTitle, fmtDate } from '../components/shared';

const DM_LABELS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'DM envoyé', cls: 'text-txt' },
  dry: { label: 'DM simulé', cls: 'text-muted' },
  pending: { label: 'En attente', cls: 'text-txt' },
  failed: { label: 'Échec DM', cls: 'text-txt underline decoration-white/30' },
  manual_suggested: { label: 'Réponse à coller', cls: 'text-txt' },
  handled: { label: 'Traité', cls: 'text-muted' },
  none: { label: '—', cls: 'text-muted' },
};

const FONCTION_LABELS: Record<string, string> = {
  reponsePublique: 'Réponse publique sous le commentaire',
  messagePrive: 'Message privé (DM)',
  messagesEntrants: 'Réception des messages entrants',
};

export default function Comments() {
  const qc = useQueryClient();
  const [diagOuvert, setDiagOuvert] = useState(false);
  const { data: diag, isFetching: diagEnCours } = useQuery({
    queryKey: ['messagerie-diag'],
    queryFn: () => api.get<MessagerieDiagDto>('/api/diagnostic/messagerie'),
    enabled: diagOuvert,
  });
  const { data: comments, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
    queryKey: ['comments'],
    queryFn: () => api.get<CommentDto[]>('/api/comments'),
    refetchInterval: 30_000,
  });
  const retryDm = useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; dmStatus: string; error: string | null; cause: string | null; remede: string | null }>(
        `/api/comments/${id}/retry-dm`,
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['comments'] });
      if (r.ok) toast.success('Message privé envoyé');
      else toast.error(r.cause ?? r.error ?? 'Envoi toujours refusé par Meta');
    },
  });
  /**
   * Rejoue l'abonnement de la Page. Le résultat est lui-même un test : si Meta
   * accepte le champ « messages », l'app a bien la capacité messagerie ; si le
   * moteur retombe sur « feed », c'est qu'elle ne l'a pas.
   */
  const reinstallerWebhook = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string }>('/api/oauth/meta/subscribe'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['messagerie-diag'] });
      toast.success(r.detail);
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  /** Envoie la réponse préparée sous le commentaire : la sortie de la boîte « à traiter ». */
  const repondre = useMutation({
    mutationFn: (args: { id: number; texte: string }) => api.post(`/api/comments/${args.id}/repondre`, { texte: args.texte }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comments'] });
      toast.success('Réponse postée sous le commentaire');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  const markHandled = useMutation({
    mutationFn: (id: number) => api.post(`/api/comments/${id}/mark-handled`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['comments'] }),
  });

  /** Sans mot-clé, mais une réponse a été préparée : un humain doit trancher. */
  const estATraiter = (c: CommentDto) =>
    !c.matchedKeyword && Boolean(c.suggestedReply) && c.publicReplyStatus === 'none' && c.dmStatus === 'none';
  const aTraiter = (comments ?? []).filter(estATraiter);
  // La boîte à traiter passe devant : c'est ce qui coûte un prospect si on l'oublie.
  const ordonnes = comments && [...comments].sort((a, b) => Number(estATraiter(b)) - Number(estATraiter(a)));

  return (
    <div>
      <PageTitle
        title="Commentaires & DM"
        subtitle="Instagram : DM automatique sur mot-clé. LinkedIn : la réponse part sous le commentaire, sur chaque profil et sur la page (LinkedIn n'ouvre sa messagerie à aucune app) — un DM prêt à coller est proposé en plus."
      />
      {enErreur && <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="Les commentaires" />}
      <div className="mb-4">
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setDiagOuvert((v) => !v)}>
          <Stethoscope size={13} /> {diagOuvert ? 'Masquer le bilan messagerie' : 'Pourquoi ça ne part pas ?'}
        </button>
        {diagOuvert && (
          <div className="card mt-3 p-4 text-sm">
            {diagEnCours && !diag && <p className="text-muted">Lecture des jetons chez Meta…</p>}
            {diag && (
              <>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Bilan lu sur le jeton qui sert aux envois
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {Object.entries(diag.fonctions).map(([nom, f]) => (
                    <li key={nom} className="flex flex-wrap items-baseline gap-2">
                      <span className={`text-xs font-bold ${f.pret ? 'text-txt' : 'text-accent'}`}>{f.pret ? '✓' : '✗'}</span>
                      <span className="font-semibold">{FONCTION_LABELS[nom] ?? nom}</span>
                      {f.manque.length > 0 && <span className="text-muted">— {f.manque.join(' ; ')}</span>}
                    </li>
                  ))}
                </ul>
                {diag.dernierRefus?.cause && (
                  <div className="mt-3 rounded-2xl border border-line bg-white/[0.03] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted">Dernier refus de Meta</div>
                    <p className="mt-1">{diag.dernierRefus.cause}</p>
                    {diag.dernierRefus.remede && <p className="mt-2 text-muted">À faire : {diag.dernierRefus.remede}</p>}
                  </div>
                )}
                <p className="mt-3 text-xs text-muted">
                  Permissions du jeton de Page : {diag.jetonDePage.permissions.join(', ') || '—'}
                  {diag.jetonDePage.erreur ? ` (${diag.jetonDePage.erreur})` : ''}
                  <br />
                  Webhooks abonnés sur la Page : {diag.abonnementPage.champs.join(', ') || '—'}
                </p>
                {!diag.abonnementPage.champs.includes('messages') && (
                  <button
                    className="btn-ghost mt-2 !py-1.5 text-xs"
                    disabled={reinstallerWebhook.isPending}
                    onClick={() => reinstallerWebhook.mutate()}
                  >
                    {reinstallerWebhook.isPending ? 'Abonnement…' : 'Abonner la Page aux messages'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {comments && comments.length === 0 && <Empty>Aucun commentaire détecté pour l'instant.</Empty>}
      {comments && comments.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          {aTraiter.length > 0 && (
            <span className="rounded-full border border-accent/60 bg-accent-soft/50 px-3 py-1 font-semibold text-ice">
              {aTraiter.length} à traiter
            </span>
          )}
          <span className="text-muted">
            {comments.filter((c) => c.matchedKeyword).length} avec mot-clé · {comments.filter((c) => c.publicReplyStatus === 'sent').length} répondu(s) ·{' '}
            {comments.length} au total
          </span>
        </div>
      )}
      {aTraiter.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          Ces personnes demandent la ressource sans avoir écrit le mot-clé. Sans toi, elles ne reçoivent rien — la réponse est prête, il suffit de l'envoyer.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {ordonnes?.map((comment) => {
          const dm = DM_LABELS[comment.dmStatus] ?? DM_LABELS.none!;
          return (
            <div key={comment.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${comment.platform === 'instagram' ? 'border border-line text-txt' : 'bg-white/10 text-txt'}`}
                >
                  {comment.platform === 'instagram' ? 'Instagram' : 'LinkedIn'}
                </span>
                <span className="font-semibold">{comment.authorName || 'Anonyme'}</span>
                {comment.matchedKeyword && (
                  <span className="rounded bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
                    mot-clé « {comment.matchedKeyword} »
                  </span>
                )}
                <span className={`text-xs font-semibold ${dm.cls}`}>{dm.label}</span>
                {comment.publicReplyStatus === 'sent' && <span className="text-xs font-semibold text-muted">Réponse publique postée</span>}
                {comment.publicReplyStatus === 'failed' && (
                  <span className="text-xs font-semibold text-accent" title={comment.publicReplyError ?? ''}>
                    Réponse publique refusée
                  </span>
                )}
                <span className="ml-auto text-xs text-muted">{fmtDate(comment.createdTime)}</span>
              </div>
              <p className="mt-2 text-sm">{comment.text}</p>
              {estATraiter(comment) && (
                <div className="mt-3 rounded-2xl border border-accent/40 bg-accent-soft/30 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ice">Demande sans le mot-clé — réponse prête</div>
                  <p className="text-sm">{comment.suggestedReply}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="btn-primary !py-1.5 text-xs"
                      disabled={repondre.isPending}
                      onClick={() => repondre.mutate({ id: comment.id, texte: comment.suggestedReply! })}
                    >
                      <Check size={13} /> Répondre sous le commentaire
                    </button>
                    <button
                      className="btn-ghost !py-1.5 text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(comment.suggestedReply!).then(
                          () => toast.success('Réponse copiée'),
                          () => toast.error('Copie impossible — sélectionnez le texte à la main'),
                        );
                      }}
                    >
                      <Copy size={13} /> Copier
                    </button>
                    {comment.externalPostUrl && (
                      <a href={comment.externalPostUrl} target="_blank" rel="noreferrer" className="btn-ghost !py-1.5 text-xs">
                        Ouvrir le post <ExternalLink size={12} />
                      </a>
                    )}
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => markHandled.mutate(comment.id)}>
                      Sans suite
                    </button>
                  </div>
                </div>
              )}
              {comment.dmStatus === 'failed' && (
                <div className="mt-3 rounded-2xl border border-line bg-white/[0.03] p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Pourquoi le message privé n'est pas parti</div>
                  <p className="text-sm">{comment.dmCause ?? comment.dmError ?? 'Motif non enregistré (échec antérieur à cette version).'}</p>
                  {comment.dmRemede && <p className="mt-2 text-sm text-muted">À faire : {comment.dmRemede}</p>}
                  {comment.dmCause && comment.dmError && (
                    <p className="mt-2 text-xs text-muted">Réponse brute de Meta : {comment.dmError}</p>
                  )}
                  <button className="btn-ghost mt-2 !py-1.5 text-xs" disabled={retryDm.isPending} onClick={() => retryDm.mutate(comment.id)}>
                    {retryDm.isPending ? 'Nouvel essai…' : 'Réessayer l’envoi'}
                  </button>
                </div>
              )}
              {comment.suggestedReply && comment.dmStatus === 'manual_suggested' && (
                <div className="mt-3 rounded-2xl border border-line bg-white/[0.03] p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                    {comment.publicReplyStatus === 'sent'
                      ? 'Lien envoyé sous le commentaire · message privé prêt à coller, pour la touche personnelle'
                      : 'Réponse pré-rédigée (à envoyer en message privé LinkedIn)'}
                  </div>
                  <p className="text-sm">{comment.suggestedReply}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="btn-primary !py-1.5 text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(comment.suggestedReply!).then(
                          () => toast.success('Réponse copiée'),
                          () => toast.error('Copie impossible — sélectionnez le texte à la main'),
                        );
                      }}
                    >
                      <Copy size={13} /> Copier
                    </button>
                    {comment.externalPostUrl && (
                      <a href={comment.externalPostUrl} target="_blank" rel="noreferrer" className="btn-ghost !py-1.5 text-xs">
                        Ouvrir le post <ExternalLink size={12} />
                      </a>
                    )}
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => markHandled.mutate(comment.id)}>
                      <Check size={13} /> Marquer traité
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
