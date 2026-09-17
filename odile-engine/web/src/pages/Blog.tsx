import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Image as ImageIcon, PenSquare, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, humanizeError } from '../api/client';
import { useDialog } from '../components/Dialog';
import { toast } from '../components/Toaster';
import { depuisChampLocal, pourChampLocal } from '../lib/paris';
import { Empty, EtatErreur, PageTitle, fmtDate } from '../components/shared';

interface ArticleDto {
  id: number;
  status: string;
  title: string;
  slug: string;
  brief: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  coverUrl: string | null;
  publishedUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
  simulated: boolean;
}
interface ArticleDetailDto extends ArticleDto {
  bodyHtml: string;
  jsonLd: string;
  content: {
    keyTakeaways: string[];
    faq: { question: string; answer: string }[];
    sources: { title: string; url: string }[];
    localAngle: string;
  } | null;
}
interface BlogSettingsDto {
  enabled: boolean;
  everyDays: number;
  ville: string;
  zones: string[];
  cibles: string[];
  authorName: string;
  sitePages: { label: string; path: string }[];
  collectionId: string;
  fields: Record<string, string>;
  publishAsDraft: boolean;
  coverRatio: '16:9' | '1.91:1' | '3:2' | '4:3' | '1:1';
  coverText: 'titre' | 'mention' | 'aucun';
  coverSafeZone: boolean;
}
interface InventaireDto {
  collection: string;
  champImage: string;
  items: { id: string; slug: string; titre: string; aImage: boolean; brouillon: boolean; connu: boolean }[];
}
interface CollectionsDto {
  collections: { id: string; name: string; fields: { id: string; name: string; type: string }[] }[];
}

const STATUT: Record<string, string> = {
  drafting: 'en rédaction',
  awaiting_approval: 'à valider',
  scheduled: 'programmé',
  publishing: 'publication…',
  published: 'publié',
  rejected: 'rejeté',
  failed: 'en échec',
};

const CHAMPS: { key: string; label: string; types: string[] }[] = [
  { key: 'title', label: 'Titre', types: ['string'] },
  { key: 'body', label: 'Corps (texte formaté)', types: ['formattedText'] },
  { key: 'excerpt', label: 'Extrait', types: ['string'] },
  { key: 'cover', label: 'Couverture (image)', types: ['image'] },
  { key: 'date', label: 'Date', types: ['date'] },
  { key: 'metaTitle', label: 'Balise title (SEO)', types: ['string'] },
  { key: 'metaDescription', label: 'Méta-description (SEO)', types: ['string'] },
  { key: 'keywords', label: 'Mots-clés', types: ['string'] },
  { key: 'jsonLd', label: 'JSON-LD (données structurées)', types: ['string', 'formattedText'] },
  { key: 'author', label: 'Auteur', types: ['string'] },
];

export default function Blog() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const { data: articles, isError: listeKo, error: erreurListe, refetch: rechargerListe } = useQuery({ queryKey: ['blog', 'articles'], queryFn: () => api.get<ArticleDto[]>('/api/blog/articles'), refetchInterval: 15_000 });
  const { data: detail } = useQuery({
    queryKey: ['blog', 'article', ouvert],
    queryFn: () => api.get<ArticleDetailDto>(`/api/blog/articles/${ouvert}`),
    enabled: ouvert !== null,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['blog'] });
  const erreur = (err: unknown) => toast.error(humanizeError(err));

  const rediger = useMutation({
    mutationFn: () => api.post<{ articleId: number; title: string }>('/api/blog/draft', {}),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Article rédigé : ${r.title}`);
    },
    onError: erreur,
  });
  const approuver = useMutation({
    mutationFn: (args: { id: number; at?: string }) => api.post<{ scheduledAt: string }>(`/api/blog/articles/${args.id}/approve`, { at: args.at }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Publication programmée : ${fmtDate(r.scheduledAt)}`);
    },
    onError: erreur,
  });
  const rejeter = useMutation({
    mutationFn: (id: number) => api.post(`/api/blog/articles/${id}/reject`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Article rejeté');
    },
    onError: erreur,
  });
  const regenerer = useMutation({
    mutationFn: (id: number) => api.post(`/api/blog/articles/${id}/regenerate`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Article réécrit');
    },
    onError: erreur,
  });
  const publierMaintenant = useMutation({
    mutationFn: (id: number) => api.post<{ url: string | null; draft: boolean }>(`/api/blog/articles/${id}/publish-now`, {}),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.draft ? 'Déposé en brouillon dans Framer' : `Publié${r.url ? ` : ${r.url}` : ''}`);
    },
    onError: erreur,
  });

  /**
   * Refaire toutes les couvertures, y compris celles des articles déjà en ligne.
   * Geste rare et visible sur le site : il se confirme, en annonçant ce qu'il touche.
   */
  const refaireToutes = useMutation({
    mutationFn: (itemsHorsMoteur: boolean) =>
      api.post<{ refaites: number; misAJour: number; horsMoteur: number; deploye: boolean; ignores: { quoi: string; raison: string }[] }>(
        '/api/blog/couvertures',
        { itemsHorsMoteur },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['blog'] });
      const bouts = [`${r.refaites} couverture(s) refaite(s)`, `${r.misAJour} remplacée(s) en ligne`];
      if (r.horsMoteur) bouts.push(`${r.horsMoteur} article(s) hors moteur`);
      if (r.deploye) bouts.push('site déployé');
      toast.success(bouts.join(' · '));
      for (const i of r.ignores.slice(0, 3)) toast.info(`${i.quoi} : ${i.raison}`);
    },
    onError: erreur,
  });

  /**
   * On regarde d'abord ce que le site contient vraiment, puis on annonce des
   * chiffres exacts. « Les anciens articles n'ont pas changé » vient presque
   * toujours de là : ils sont écrits à la main, donc inconnus du moteur.
   */
  const refaireToutesAsk = async () => {
    let inventaire: InventaireDto;
    try {
      inventaire = await api.get<InventaireDto>('/api/blog/framer/items');
    } catch (err) {
      toast.error(humanizeError(err));
      return;
    }
    const connus = inventaire.items.filter((i) => i.connu).length;
    const inconnus = inventaire.items.length - connus;
    if (inventaire.items.length === 0) {
      toast.info(`La collection « ${inventaire.collection} » ne contient aucun article. Tes anciens articles sont sans doute dans une autre collection — ou ce sont des pages, que l’API Framer ne touche pas.`);
      return;
    }
    const ok = await dialog.confirm({
      title: 'Refaire les couvertures',
      message: `Collection « ${inventaire.collection} », champ image « ${inventaire.champImage} » : ${connus} article(s) écrit(s) par le moteur, ${inconnus} écrit(s) à la main. Les images sont refabriquées au format réglé et remplacées en ligne ; le texte, le titre, la date et l’adresse ne bougent pas. Le site est déployé à la fin.`,
      confirmLabel: `Refaire les ${connus} du moteur`,
    });
    if (!ok) return;
    let tous = false;
    if (inconnus > 0) {
      tous = await dialog.confirm({
        title: `Et les ${inconnus} articles écrits à la main ?`,
        message: 'Leur titre servira de titre de couverture, au template Odile. Une illustration choisie exprès pour l’un d’eux sera remplacée — c’est sans retour.',
        confirmLabel: 'Oui, refaire les leurs aussi',
      });
    }
    refaireToutes.mutate(tous);
  };

  const refaireCouverture = useMutation({
    mutationFn: (id: number) => api.post<{ coverUrl: string; ratio: string }>(`/api/blog/articles/${id}/cover`, {}),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['blog'] });
      toast.success(`Couverture refaite au format ${r.ratio}`);
    },
    onError: erreur,
  });

  const programmerAsk = async (id: number) => {
    const at = await dialog.prompt({
      title: 'Publier le…',
      message: 'Date et heure, à l’heure de Paris.',
      type: 'datetime-local',
      initial: pourChampLocal(new Date(Math.ceil(Date.now() / 3600000) * 3600000 + 3600000)),
      min: pourChampLocal(new Date()),
      confirmLabel: 'Programmer',
    });
    if (at) approuver.mutate({ id, at: depuisChampLocal(at).toISOString() });
  };

  return (
    <div>
      <PageTitle
        title="Blog du site"
        subtitle="Articles rédigés pour le référencement local et les moteurs génératifs, couverture au template Odile, publiés dans Framer après ta validation."
      />
      {listeKo && <EtatErreur error={erreurListe} onRetry={() => void rechargerListe()} quoi="Les articles" />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={rediger.isPending} onClick={() => rediger.mutate()}>
          <PenSquare size={14} /> {rediger.isPending ? 'Rédaction (1 à 2 min)…' : 'Rédiger un article maintenant'}
        </button>
        <button className="btn-ghost" onClick={() => setReglagesOuverts((v) => !v)}>
          {reglagesOuverts ? 'Masquer les réglages' : 'Réglages du blog'}
        </button>
        <button
          className="btn-ghost"
          disabled={refaireToutes.isPending || !(articles ?? []).length}
          onClick={() => void refaireToutesAsk()}
          title="Refabrique toutes les couvertures au format réglé et remplace celles des articles déjà publiés"
        >
          <ImageIcon size={14} /> {refaireToutes.isPending ? 'Remplacement en cours…' : 'Refaire toutes les couvertures'}
        </button>
      </div>
      {reglagesOuverts && <ReglagesBlog />}
      {articles && articles.length === 0 && <Empty>Aucun article pour l’instant — clique « Rédiger un article maintenant » ou active la cadence dans les réglages.</Empty>}
      <div className="flex flex-col gap-3">
        {articles?.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex flex-wrap items-start gap-4">
              {a.coverUrl && <img src={a.coverUrl} alt="" className="h-24 w-44 shrink-0 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-txt">{STATUT[a.status] ?? a.status}</span>
                  {a.simulated && <span>(simulé)</span>}
                  <span>{fmtDate(a.createdAt)}</span>
                  {a.scheduledAt && a.status === 'scheduled' && <span>· publication {fmtDate(a.scheduledAt)}</span>}
                  {a.publishedUrl && (
                    <a href={a.publishedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ice">
                      voir en ligne <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <button className="mt-1 text-left text-lg font-bold hover:text-ice" onClick={() => setOuvert(ouvert === a.id ? null : a.id)}>
                  {a.title || a.brief || `Article #${a.id}`}
                </button>
                {a.metaDescription && <p className="mt-1 text-sm text-muted">{a.metaDescription}</p>}
                {a.error && <p className="mt-1 text-xs text-accent">{a.error}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {['awaiting_approval', 'rejected', 'failed', 'scheduled'].includes(a.status) && a.title && (
                  <>
                    <button className="btn-primary !py-1.5 text-xs" disabled={approuver.isPending} onClick={() => approuver.mutate({ id: a.id })}>
                      Approuver et publier
                    </button>
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => void programmerAsk(a.id)}>
                      Programmer
                    </button>
                  </>
                )}
                {!['published', 'publishing', 'drafting'].includes(a.status) && (
                  <button className="btn-ghost !py-1.5 text-xs" disabled={regenerer.isPending} onClick={() => regenerer.mutate(a.id)} title="Même sujet, texte neuf">
                    <RefreshCw size={12} /> Réécrire
                  </button>
                )}
                {a.coverUrl && (
                  <button
                    className="btn-ghost !py-1.5 text-xs"
                    disabled={refaireCouverture.isPending}
                    onClick={() => refaireCouverture.mutate(a.id)}
                    title="Refabrique la seule image, au format réglé ci-dessus — le texte de l'article ne bouge pas"
                  >
                    <ImageIcon size={12} /> Refaire la couverture
                  </button>
                )}
                {!['published', 'publishing'].includes(a.status) && (
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => rejeter.mutate(a.id)}>
                    Rejeter
                  </button>
                )}
                {a.status === 'scheduled' && (
                  <button className="btn-ghost !py-1.5 text-xs" disabled={publierMaintenant.isPending} onClick={() => publierMaintenant.mutate(a.id)}>
                    Publier tout de suite
                  </button>
                )}
              </div>
            </div>
            {ouvert === a.id && detail && detail.id === a.id && (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-[1fr_320px]">
                <div>
                  <h1 className="text-2xl font-extrabold">{detail.title}</h1>
                  <p className="mt-1 text-xs text-muted">/{detail.slug} · title : {detail.metaTitle}</p>
                  <div className="prose-blog mt-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: detail.bodyHtml }} />
                </div>
                <aside className="flex flex-col gap-3 text-xs text-muted">
                  {detail.coverUrl && <img src={detail.coverUrl} alt="" className="w-full rounded-xl" />}
                  <div>
                    <div className="font-semibold uppercase tracking-wider">Mots-clés</div>
                    <div className="mt-1">{detail.keywords.join(' · ')}</div>
                  </div>
                  {detail.content?.localAngle && (
                    <div>
                      <div className="font-semibold uppercase tracking-wider">Ancrage local</div>
                      <div className="mt-1">{detail.content.localAngle}</div>
                    </div>
                  )}
                  <div>
                    <div className="font-semibold uppercase tracking-wider">Données structurées</div>
                    <div className="mt-1">JSON-LD Article + FAQPage + Organisation, prêt à injecter sur la page ({Math.round(detail.jsonLd.length / 1024)} Ko).</div>
                  </div>
                </aside>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReglagesBlog() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ blog: BlogSettingsDto }>('/api/settings') });
  const [form, setForm] = useState<BlogSettingsDto | null>(null);
  useEffect(() => {
    if (data?.blog && !form) setForm(data.blog);
  }, [data, form]);
  const { data: framer, refetch: chargerCollections, isFetching, error: erreurFramer } = useQuery({
    queryKey: ['blog', 'framer', 'collections'],
    queryFn: () => api.get<CollectionsDto>('/api/blog/framer/collections'),
    enabled: false,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (value: BlogSettingsDto) => api.put(`/api/settings/blog`, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Réglages du blog enregistrés');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  if (!form) return null;
  const set = <K extends keyof BlogSettingsDto>(k: K, v: BlogSettingsDto[K]) => setForm({ ...form, [k]: v });
  const collection = framer?.collections.find((c) => c.id === form.collectionId);

  return (
    <div className="card mb-5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">Réglages du blog</h2>
        <button className="btn-primary !py-1.5" disabled={save.isPending} onClick={() => save.mutate(form)}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Rédiger un article automatiquement tous les {form.everyDays} jour(s)
        </label>
        <input type="range" min={1} max={30} className="w-full accent-sky-500" value={form.everyDays} onChange={(e) => set('everyDays', Number(e.target.value))} />
        <div>
          <label className="label">Ville</label>
          <input className="input" value={form.ville} onChange={(e) => set('ville', e.target.value)} />
        </div>
        <div>
          <label className="label">Auteur affiché</label>
          <input className="input" value={form.authorName} onChange={(e) => set('authorName', e.target.value)} />
        </div>
        <div>
          <label className="label">Zones (séparées par des virgules)</label>
          <input className="input" value={form.zones.join(', ')} onChange={(e) => set('zones', e.target.value.split(',').map((z) => z.trim()).filter(Boolean))} />
        </div>
        <div>
          <label className="label">Cibles (séparées par des virgules)</label>
          <input className="input" value={form.cibles.join(', ')} onChange={(e) => set('cibles', e.target.value.split(',').map((z) => z.trim()).filter(Boolean))} />
        </div>
        <div>
          <label className="label">Format de l'image de couverture</label>
          <select className="input" value={form.coverRatio ?? '16:9'} onChange={(e) => set('coverRatio', e.target.value as BlogSettingsDto['coverRatio'])}>
            <option value="16:9">16:9 — le plus courant sur les sites</option>
            <option value="1.91:1">1,91:1 — format des aperçus de partage</option>
            <option value="3:2">3:2 — photo classique</option>
            <option value="4:3">4:3 — plus haut, bon sur mobile</option>
            <option value="1:1">1:1 — carré, jamais rogné sur les côtés</option>
          </select>
          <p className="mt-1.5 text-xs text-muted">À accorder à ce que la collection Framer affiche. En cas de doute, 16:9.</p>
        </div>
        <div>
          <label className="label">Ce que porte l'image</label>
          <select className="input" value={form.coverText ?? 'titre'} onChange={(e) => set('coverText', e.target.value as BlogSettingsDto['coverText'])}>
            <option value="titre">Le titre de l'article</option>
            <option value="mention">Seulement la mention (la ville)</option>
            <option value="aucun">Rien — juste le décor et le logo</option>
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Si le site affiche déjà le titre en gros à côté de l'image, « rien » évite de le lire deux fois — et plus aucun texte ne peut être coupé.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-sky-500" checked={form.coverSafeZone ?? true} onChange={(e) => set('coverSafeZone', e.target.checked)} />
            Garder le texte dans une zone sûre (recommandé)
          </label>
          <p className="mt-1.5 text-xs text-muted">
            Un site recadre l'image selon la largeur de l'écran : ce qui touchait les bords se retrouve amputé sur mobile. La zone sûre garde titre et logo au
            centre, là où aucun recadrage ne va les chercher. Le décor, lui, occupe toute l'image — qu'il déborde est justement ce qu'on lui demande.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Pages du site pour le maillage interne — une par ligne : « Libellé | /chemin »</label>
          <textarea
            className="input min-h-[90px]"
            value={form.sitePages.map((p) => `${p.label} | ${p.path}`).join('\n')}
            onChange={(e) =>
              set(
                'sitePages',
                e.target.value
                  .split('\n')
                  .map((l) => l.split('|').map((x) => x.trim()))
                  .filter((x) => x.length === 2 && x[0] && x[1])
                  .map(([label, path]) => ({ label: label!, path: path! })),
              )
            }
            placeholder={'Nos services | /services\nPrendre rendez-vous | /contact'}
          />
        </div>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">Collection Framer</h3>
          <button className="btn-ghost !py-1 text-xs" disabled={isFetching} onClick={() => void chargerCollections()}>
            {isFetching ? 'Lecture du projet Framer…' : 'Charger les collections'}
          </button>
          {erreurFramer && <span className="text-xs text-accent">{humanizeError(erreurFramer)}</span>}
        </div>
        <p className="mb-3 text-xs text-muted">
          L’adresse du projet et la clé d’API se renseignent dans Connexions & santé (clés d’applications). La correspondance des champs est devinée par
          nom et par type ; corrige-la ici si besoin.
        </p>
        {framer && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Collection du blog</label>
              <select className="input" value={form.collectionId} onChange={(e) => set('collectionId', e.target.value)}>
                <option value="">— choisir —</option>
                {framer.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.fields.length} champs)
                  </option>
                ))}
              </select>
            </div>
            {collection &&
              CHAMPS.map((ch) => (
                <div key={ch.key}>
                  <label className="label">{ch.label}</label>
                  <select className="input" value={form.fields[ch.key] ?? ''} onChange={(e) => set('fields', { ...form.fields, [ch.key]: e.target.value })}>
                    <option value="">— automatique —</option>
                    {collection.fields
                      .filter((f) => ch.types.includes(f.type))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({f.type})
                        </option>
                      ))}
                  </select>
                </div>
              ))}
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.publishAsDraft} onChange={(e) => set('publishAsDraft', e.target.checked)} />
          Déposer en brouillon dans Framer (publier depuis Framer) plutôt que publier et déployer le site
        </label>
      </div>
    </div>
  );
}
