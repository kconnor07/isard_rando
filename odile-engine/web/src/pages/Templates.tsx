import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Empty, PageTitle } from '../components/shared';

interface CustomTemplate {
  id: string;
  themeId: string;
  name: string;
  accent: string;
  bg1: string;
  bg2: string;
  textColor: string;
  decor: 'orbes' | 'halo' | 'degrade' | 'aucun';
  backgroundAssetId: string | null;
  backgroundOpacity: number;
  grain: boolean;
}
type Draft = Omit<CustomTemplate, 'id' | 'themeId'>;
interface Catalogue {
  builtin: { id: string; label: string }[];
  custom: CustomTemplate[];
}
interface LibraryImage {
  id: string;
  width: number | null;
  height: number | null;
}

const BLANK: Draft = {
  name: 'Mon template',
  accent: '#0099ff',
  bg1: '#050508',
  bg2: '#0a1024',
  textColor: '#fdfdfd',
  decor: 'orbes',
  backgroundAssetId: null,
  backgroundOpacity: 35,
  grain: true,
};

const DECOR_LABELS: Record<Draft['decor'], string> = {
  orbes: 'Orbes de verre',
  halo: 'Halo diffus',
  degrade: 'Dégradé',
  aucun: 'Aucun décor',
};

/** Aperçu live : re-rendu par le serveur 400 ms après la dernière frappe. */
function Preview({ draft }: { draft: Draft }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/templates/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        objectUrl = URL.createObjectURL(await res.blob());
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return objectUrl;
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [JSON.stringify(draft)]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line">
      {url ? (
        <img src={url} alt="Aperçu du template" className="block w-full" />
      ) : (
        <div className="skeleton aspect-[4/5] w-full" />
      )}
      {loading && (
        <div className="absolute right-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] text-muted backdrop-blur">
          rendu…
        </div>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label !mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input className="input mono !py-1.5" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export default function Templates() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: catalogue } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Catalogue>('/api/templates'),
  });
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImage[]>('/api/library'),
  });
  const { data: defaultTheme } = useQuery({
    queryKey: ['settings', 'default_theme'],
    queryFn: () => api.get<{ value: string }>('/api/settings/default_theme'),
  });
  const setDefault = useMutation({
    mutationFn: (themeId: string) => api.put('/api/settings/default_theme', themeId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => alert(String(e)),
  });
  const isDefault = (themeId: string) => defaultTheme?.value === themeId;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const reset = () => {
    setDraft(BLANK);
    setEditingId(null);
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['templates'] });
    void qc.invalidateQueries({ queryKey: ['library'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  const save = useMutation({
    mutationFn: () =>
      editingId
        ? api.put(`/api/templates/${editingId}`, draft)
        : api.post('/api/templates', draft),
    onSuccess: () => {
      invalidate();
      reset();
    },
    onError: (e) => alert(String(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/templates/${id}`),
    onSuccess: invalidate,
    onError: (e) => alert(String(e)),
  });

  const uploadBackground = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/library', { method: 'POST', body, credentials: 'same-origin' });
    if (!res.ok) return alert('Téléversement impossible');
    const { id } = (await res.json()) as { id: string };
    set('backgroundAssetId', id);
    invalidate();
  };

  return (
    <div>
      <PageTitle
        title="Templates"
        accent="Templates"
        subtitle="Créez vos propres modèles de slides : couleurs, décor, image de fond. L'aperçu se met à jour en direct."
        actions={
          editingId ? (
            <button className="btn-ghost" onClick={reset}>
              Nouveau template
            </button>
          ) : undefined
        }
      />

      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        {/* Éditeur */}
        <div className="card p-5">
          <div className="mb-4">
            <label className="label !mb-1">Nom du template</label>
            <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Accent" value={draft.accent} onChange={(v) => set('accent', v)} />
            <ColorField label="Texte" value={draft.textColor} onChange={(v) => set('textColor', v)} />
            <ColorField label="Fond — haut" value={draft.bg1} onChange={(v) => set('bg1', v)} />
            <ColorField label="Fond — bas" value={draft.bg2} onChange={(v) => set('bg2', v)} />
          </div>

          <div className="mt-4">
            <label className="label !mb-1.5">Décor</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DECOR_LABELS) as Draft['decor'][]).map((d) => (
                <button
                  key={d}
                  onClick={() => set('decor', d)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    draft.decor === d
                      ? 'border-accent/50 bg-accent-soft text-ice'
                      : 'border-line text-muted hover:text-txt'
                  }`}
                >
                  {DECOR_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label !mb-0">Image de fond</span>
              <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => fileInput.current?.click()}>
                <Upload size={12} /> Ajouter
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void uploadBackground(f);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => set('backgroundAssetId', null)}
                className={`h-14 w-11 rounded-lg border text-[10px] text-muted ${
                  draft.backgroundAssetId === null ? 'border-accent/60 bg-accent-soft' : 'border-line'
                }`}
              >
                aucune
              </button>
              {library?.map((img) => (
                <button
                  key={img.id}
                  onClick={() => set('backgroundAssetId', img.id)}
                  className={`h-14 w-11 overflow-hidden rounded-lg border ${
                    draft.backgroundAssetId === img.id ? 'border-accent' : 'border-line'
                  }`}
                >
                  <img src={`/api/assets/${img.id}`} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            {draft.backgroundAssetId && (
              <div className="mt-3">
                <label className="label !mb-1">Intensité de l'image : {draft.backgroundOpacity} %</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  className="w-full accent-[color:var(--color-accent)]"
                  value={draft.backgroundOpacity}
                  onChange={(e) => set('backgroundOpacity', Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.grain} onChange={(e) => set('grain', e.target.checked)} />
            Grain de film
          </label>

          <button
            className="btn-primary mt-6 w-full justify-center"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            <Check size={14} />
            {editingId ? 'Enregistrer les modifications' : 'Créer le template'}
          </button>
        </div>

        {/* Aperçu live */}
        <div>
          <div className="mono mb-2 text-[10px] uppercase tracking-[0.18em] text-muted/70">Aperçu</div>
          <Preview draft={draft} />
        </div>
      </div>

      {/* Mes templates */}
      <h2 className="mb-3 mt-9 text-[15px] font-bold tracking-tight">Mes templates</h2>
      {catalogue && catalogue.custom.length === 0 && (
        <Empty>Aucun template maison pour l'instant — composez-en un ci-dessus.</Empty>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {catalogue?.custom.map((t) => (
          <div key={t.id} className="card flex items-center gap-3 p-3">
            <div
              className="h-12 w-12 shrink-0 rounded-xl border border-line"
              style={{ background: `linear-gradient(150deg, ${t.bg1}, ${t.bg2} 60%, ${t.accent})` }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t.name}</div>
              <div className="mono text-[11px] text-muted">{DECOR_LABELS[t.decor]}</div>
            </div>
            {isDefault(t.themeId) ? (
              <span className="mono rounded-full bg-accent-soft px-2.5 py-1 text-[10px] uppercase tracking-wider text-ice">
                par défaut
              </span>
            ) : (
              <button
                className="btn-ghost !px-3 !py-1 text-xs"
                title="Tous les nouveaux posts utiliseront ce template"
                disabled={setDefault.isPending}
                onClick={() => setDefault.mutate(t.themeId)}
              >
                <Star size={12} /> Par défaut
              </button>
            )}
            <button
              className="btn-ghost !px-3 !py-1 text-xs"
              onClick={() => {
                setEditingId(t.id);
                setDraft({
                  name: t.name,
                  accent: t.accent,
                  bg1: t.bg1,
                  bg2: t.bg2,
                  textColor: t.textColor,
                  decor: t.decor,
                  backgroundAssetId: t.backgroundAssetId,
                  backgroundOpacity: t.backgroundOpacity,
                  grain: t.grain,
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Modifier
            </button>
            <button
              className="pill-btn"
              title="Supprimer"
              onClick={() => {
                if (confirm(`Supprimer le template « ${t.name} » ?`)) remove.mutate(t.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-9 text-[15px] font-bold tracking-tight">Thèmes fournis</h2>
      <div className="flex flex-wrap gap-2">
        {catalogue?.builtin.map((b) => (
          <button
            key={b.id}
            title={isDefault(b.id) ? 'Thème par défaut' : 'Utiliser comme thème par défaut'}
            disabled={setDefault.isPending || isDefault(b.id)}
            onClick={() => setDefault.mutate(b.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              isDefault(b.id)
                ? 'border-accent/50 bg-accent-soft text-ice'
                : 'border-line text-muted hover:text-txt'
            }`}
          >
            {b.label}
            {isDefault(b.id) && <span className="mono ml-2 text-[10px] uppercase tracking-wider">· par défaut</span>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Le thème « par défaut » habille tous les nouveaux posts ; chaque post peut ensuite en changer dans
        son éditeur.
      </p>
    </div>
  );
}
