import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export interface ApercuTunnelDto {
  postId: number;
  platform: 'linkedin' | 'instagram';
  motcle: string | null;
  lien: { shortUrl: string; cible: string; clics: number } | null;
  lienDansLePost: boolean;
  ressource: { kind: string; titre: string | null; url: string | null; erreur: string | null; viaLien: boolean; libelle: string };
  document: { pages: number; url: string } | null;
  amorce: string | null;
  reponseLinkedIn: string | null;
  reponseVariantes: number;
  reponseManuelle: boolean;
  dmInstagram: { etape1: string; etape2: string | null } | null;
  reponsePublique: string | null;
  captionFacebook: string | null;
  mentions: { nom: string; statut: 'identifiee' | 'en-clair' | 'absente' }[];
  rdv: string | null;
  avertissements: string[];
}

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="shrink-0 text-muted sm:w-40">{label}</span>
      <span className="min-w-0 flex-1 break-words text-txt">{children}</span>
    </div>
  );
}

function Citation({ texte }: { texte: string }) {
  return <span className="whitespace-pre-wrap rounded-lg bg-white/[0.04] px-2 py-0.5">« {texte} »</span>;
}

/**
 * Ce que recevra la personne qui clique ou commente — calculé par le serveur avec les
 * mêmes fonctions que l'exécution, pour valider en connaissance de cause.
 */
export function CeQueRecevraLaPersonne({ postId, compact = false }: { postId: number; compact?: boolean }) {
  const q = useQuery({ queryKey: ['post', postId, 'tunnel'], queryFn: () => api.get<ApercuTunnelDto>(`/api/posts/${postId}/tunnel`) });
  if (q.isPending) return <p className="mt-3 text-xs text-muted">Aperçu du tunnel…</p>;
  if (q.isError || !q.data) return null;
  const t = q.data;
  const ouvrir = (url: string, label: string) => (
    <a href={url} target="_blank" rel="noreferrer" className="text-ice underline decoration-white/30 hover:decoration-ice">
      {label}
    </a>
  );
  return (
    <div className={`rounded-xl border border-line bg-white/[0.02] ${compact ? 'mt-2 px-3 py-2 text-[11px]' : 'mt-3 px-3.5 py-3 text-xs'}`}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Ce que recevra la personne</div>
      <div className="flex flex-col gap-1.5">
        {t.lien && (
          <Ligne label={t.lienDansLePost ? 'Lien dans le post' : t.platform === 'instagram' ? 'Lien (en privé seulement)' : 'Lien (absent du texte)'}>
            {ouvrir(t.lien.shortUrl, t.lien.shortUrl.replace(/^https?:\/\//, ''))} <span className="text-muted">→</span> {ouvrir(t.lien.cible, t.lien.cible.replace(/^https?:\/\//, '').slice(0, 70))}
            {t.lien.clics > 0 ? <span className="text-muted"> · {t.lien.clics} clic{t.lien.clics > 1 ? 's' : ''}</span> : null}
          </Ligne>
        )}
        <Ligne label={t.ressource.viaLien ? 'Donnée par le lien' : t.motcle ? `Après « ${t.motcle} »` : 'Ressource'}>
          {t.ressource.libelle.charAt(0).toUpperCase() + t.ressource.libelle.slice(1)}
          {t.ressource.url ? <> — {ouvrir(t.ressource.url, t.ressource.kind === 'guide' ? 'ouvrir le PDF' : 'voir la page')}</> : null}
          {t.ressource.erreur ? <span className="text-accent"> · fabrication en échec : {t.ressource.erreur}</span> : null}
        </Ligne>
        {t.document && (
          <Ligne label="Document LinkedIn">
            {t.document.pages} page{t.document.pages > 1 ? 's' : ''} — {ouvrir(t.document.url, 'ouvrir le PDF')}
          </Ligne>
        )}
        {t.motcle && t.platform === 'linkedin' && (
          <Ligne label={`Commente ${t.motcle}`}>
            {t.reponseLinkedIn ? (
              <>
                réponse sous le commentaire{t.reponseManuelle ? <span className="text-accent"> (à coller soi-même)</span> : null} : <Citation texte={t.reponseLinkedIn} />
                {t.reponseVariantes > 1 ? <span className="text-muted"> (l’une des {t.reponseVariantes} formulations réglées, tirée au sort à chaque commentaire)</span> : null}
              </>
            ) : (
              <span className="text-muted">aucune réponse automatique (réglage)</span>
            )}
          </Ligne>
        )}
        {t.dmInstagram && (
          <Ligne label={`Commente ${t.motcle}`}>
            message privé : <Citation texte={t.dmInstagram.etape1} />
            {t.dmInstagram.etape2 ? (
              <>
                {' '}
                <span className="text-muted">puis, après sa réponse :</span> <Citation texte={t.dmInstagram.etape2} />
              </>
            ) : null}
            {t.reponsePublique ? (
              <>
                {' '}
                <span className="text-muted">· en public :</span> <Citation texte={t.reponsePublique} />
                {t.reponseVariantes > 1 ? <span className="text-muted"> (l’une des {t.reponseVariantes} formulations réglées)</span> : null}
              </>
            ) : null}
          </Ligne>
        )}
        {!compact && t.amorce && (
          <Ligne label="Commentaire d’amorce">
            <Citation texte={t.amorce} />
          </Ligne>
        )}
        {!compact && t.captionFacebook && (
          <Ligne label="Sur Facebook">
            <details>
              <summary className="cursor-pointer text-muted">légende adaptée (sans mot-clé, renvoi vers Instagram)</summary>
              <p className="mt-1 whitespace-pre-wrap text-muted">{t.captionFacebook}</p>
            </details>
          </Ligne>
        )}
        {t.mentions.length > 0 && (
          <Ligne label="Identifiés (@)">
            {t.mentions.filter((m) => m.statut === 'identifiee').map((m) => `@${m.nom}`).join(' · ') || <span className="text-muted">aucun</span>}
            {t.mentions.some((m) => m.statut !== 'identifiee') ? (
              <span className="text-muted"> · en clair : {t.mentions.filter((m) => m.statut !== 'identifiee').map((m) => m.nom).join(', ')}</span>
            ) : null}
          </Ligne>
        )}
        {t.avertissements.map((a, i) => (
          <div key={i} className="text-muted">
            ⚠ {a}
          </div>
        ))}
      </div>
    </div>
  );
}
