import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { LibraryImageDto } from '../api/types';
import { LibraryThumb } from '../components/LibraryPicker';
import { Empty, PageTitle } from '../components/shared';

/** Paramètres d'un template — miroir du schéma serveur. */
interface Draft {
  name: string;
  accent: string;
  secondary: string | null;
  bg1: string;
  bg2: string;
  textColor: string;
  titleFont: 'inter' | 'playfair' | 'fragment';
  titleWeight: number;
  titleCase: 'normal' | 'upper';
  titleScale: number;
  accentStyle: 'serif' | 'plain' | 'underline' | 'highlight';
  align: 'auto' | 'left' | 'center';
  decor: 'orbes' | 'halo' | 'degrade' | 'aucun';
  decorIntensity: number;
  decorPosition: 'haut-droite' | 'haut-gauche' | 'bas-droite' | 'bas-gauche' | 'centre';
  gradientAngle: number;
  vignette: number;
  backgroundAssetId: string | null;
  backgroundOpacity: number;
  bgFit: 'cover' | 'contain';
  bgPosition: 'centre' | 'haut' | 'bas';
  bgBlur: number;
  bgBlend: 'normal' | 'multiply' | 'screen' | 'soft-light' | 'luminosity';
  radius: 'pill' | 'rounded' | 'sharp';
  glass: number;
  grain: boolean;
  grainLevel: number;
  frame: 'aucun' | 'texte' | 'accent';
  padding: 'serre' | 'normal' | 'aere';
  showLogo: boolean;
  showCounter: boolean;
}
interface CustomTemplate extends Draft {
  id: string;
  themeId: string;
}
interface Catalogue {
  builtin: { id: string; label: string }[];
  custom: CustomTemplate[];
}

const BLANK: Draft = {
  name: 'Mon template',
  accent: '#0099ff',
  secondary: null,
  bg1: '#050508',
  bg2: '#0a1024',
  textColor: '#fdfdfd',
  titleFont: 'inter',
  titleWeight: 800,
  titleCase: 'normal',
  titleScale: 100,
  accentStyle: 'serif',
  align: 'auto',
  decor: 'orbes',
  decorIntensity: 100,
  decorPosition: 'haut-droite',
  gradientAngle: 168,
  vignette: 0,
  backgroundAssetId: null,
  backgroundOpacity: 35,
  bgFit: 'cover',
  bgPosition: 'centre',
  bgBlur: 0,
  bgBlend: 'normal',
  radius: 'pill',
  glass: 50,
  grain: true,
  grainLevel: 30,
  frame: 'aucun',
  padding: 'normal',
  showLogo: true,
  showCounter: true,
};

/** Points de départ : un clic charge la recette, tout reste modifiable. */
const PRESETS: { label: string; swatch: string; draft: Partial<Draft> }[] = [
  { label: 'Nuit bleue', swatch: 'linear-gradient(150deg,#050508,#0a1024 60%,#0099ff)', draft: {} },
  {
    label: 'Ambre',
    swatch: 'linear-gradient(150deg,#0a0a0a,#2a1000 60%,#ff8a00)',
    draft: { accent: '#ff8a00', secondary: '#ffb35c', bg1: '#0a0a0a', bg2: '#2a1000', decor: 'halo' },
  },
  {
    label: 'Papier',
    swatch: 'linear-gradient(150deg,#f6f4ef,#e9e4d8 60%,#1d4ed8)',
    draft: {
      accent: '#1d4ed8',
      bg1: '#f6f4ef',
      bg2: '#e9e4d8',
      textColor: '#0b0b0e',
      decor: 'degrade',
      grainLevel: 40,
      frame: 'texte',
    },
  },
  {
    label: 'Encre',
    swatch: 'linear-gradient(150deg,#050506,#141418 60%,#ffffff)',
    draft: { accent: '#ffffff', secondary: '#d8d8dc', bg1: '#050506', bg2: '#101014', glass: 60 },
  },
  {
    label: 'Éditorial',
    swatch: 'linear-gradient(150deg,#101014,#17171c 60%,#e6c27a)',
    draft: {
      accent: '#e6c27a',
      bg1: '#101014',
      bg2: '#17171c',
      titleFont: 'playfair',
      titleWeight: 700,
      accentStyle: 'plain',
      align: 'left',
      radius: 'rounded',
      frame: 'accent',
      decor: 'aucun',
      vignette: 35,
    },
  },
];

const DECOR_LABELS: Record<Draft['decor'], string> = {
  orbes: 'Orbes de verre',
  halo: 'Halo diffus',
  degrade: 'Dégradé',
  aucun: 'Aucun décor',
};
const PREVIEW_KINDS: { id: string; label: string }[] = [
  { id: 'hook', label: 'Accroche' },
  { id: 'value_prop', label: 'Chiffre' },
  { id: 'content', label: 'Contenu' },
  { id: 'notifications', label: 'Notifs' },
  { id: 'cta', label: 'CTA' },
];

/** Aperçu live : re-rendu par le serveur 400 ms après la dernière modification. */
function Preview({ draft, kind }: { draft: Draft; kind: string }) {
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
          body: JSON.stringify({ ...draft, kind }),
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
  }, [JSON.stringify(draft), kind]);

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

// --- Petits contrôles ----------------------------------------------------------

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="section-toggle border-t border-line py-3" open={open}>
      <summary className="flex items-center gap-2 text-[13px] font-bold tracking-tight">
        <ChevronRight size={14} className="chev text-muted" />
        {title}
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="label !mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              value === o.v ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label !mb-1">
        {label} : <span className="mono normal-case text-txt">{value}{unit}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        className="w-full accent-[color:var(--color-accent)]"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  clearable,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  clearable?: boolean;
}) {
  return (
    <div>
      <label className="label !mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          value={value ?? '#888888'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="input mono !py-1.5"
          value={value ?? ''}
          placeholder={clearable ? '= accent' : ''}
          onChange={(e) => onChange(e.target.value || (clearable ? null : e.target.value))}
        />
        {clearable && value && (
          <button className="pill-btn" title="Reprendre l'accent" onClick={() => onChange(null)}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// --- Page ----------------------------------------------------------------------

export default function Templates() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState('value_prop');
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: catalogue } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Catalogue>('/api/templates'),
  });
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
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
      editingId ? api.put(`/api/templates/${editingId}`, draft) : api.post('/api/templates', draft),
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
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/api/templates/${id}/duplicate`),
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

  const pickBackground = (img: LibraryImageDto | null) => {
    setDraft((d) => ({
      ...d,
      backgroundAssetId: img?.id ?? null,
      // Un détourage se pose entier ; une photo remplit le cadre
      bgFit: img?.cutout ? 'contain' : 'cover',
      backgroundOpacity: img?.cutout && d.backgroundOpacity < 60 ? 85 : d.backgroundOpacity,
    }));
  };

  const loadTemplate = (t: CustomTemplate) => {
    const { id: _id, themeId: _t, ...rest } = t;
    setEditingId(t.id);
    setDraft({ ...BLANK, ...rest });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedBg = library?.find((i) => i.id === draft.backgroundAssetId) ?? null;

  return (
    <div>
      <PageTitle
        title="Templates"
        accent="Templates"
        subtitle="Composez vos modèles de slides : couleurs, typographie, décor, image de fond, matière. L'aperçu se met à jour en direct."
        actions={
          editingId ? (
            <button className="btn-ghost" onClick={reset}>
              Nouveau template
            </button>
          ) : undefined
        }
      />

      <div className="grid gap-6 md:grid-cols-[1fr_21rem]">
        {/* Éditeur */}
        <div className="card p-5">
          <div className="mb-4">
            <label className="label !mb-1">Nom du template</label>
            <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          {!editingId && (
            <div className="mb-2">
              <label className="label !mb-1.5">Partir de</label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-xs font-medium text-muted transition-colors hover:text-txt"
                    onClick={() => setDraft((d) => ({ ...BLANK, name: d.name, ...p.draft }))}
                  >
                    <span className="h-5 w-5 rounded-full border border-white/10" style={{ background: p.swatch }} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Section title="Couleurs" open>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Accent" value={draft.accent} onChange={(v) => set('accent', v ?? draft.accent)} />
              <ColorField label="Secondaire (gros chiffres)" value={draft.secondary} onChange={(v) => set('secondary', v)} clearable />
              <ColorField label="Texte" value={draft.textColor} onChange={(v) => set('textColor', v ?? draft.textColor)} />
              <div />
              <ColorField label="Fond — haut" value={draft.bg1} onChange={(v) => set('bg1', v ?? draft.bg1)} />
              <ColorField label="Fond — bas" value={draft.bg2} onChange={(v) => set('bg2', v ?? draft.bg2)} />
            </div>
            <Range label="Angle du dégradé" value={draft.gradientAngle} min={0} max={360} unit="°" onChange={(v) => set('gradientAngle', v)} />
          </Section>

          <Section title="Typographie">
            <Chips
              label="Police des titres"
              value={draft.titleFont}
              options={[
                { v: 'inter', l: 'Inter' },
                { v: 'playfair', l: 'Playfair (serif italique)' },
                { v: 'fragment', l: 'Fragment Mono' },
              ]}
              onChange={(v) => set('titleFont', v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Graisse" value={draft.titleWeight} min={400} max={900} onChange={(v) => set('titleWeight', Math.round(v / 100) * 100)} />
              <Range label="Taille des titres" value={draft.titleScale} min={60} max={140} unit=" %" onChange={(v) => set('titleScale', v)} />
            </div>
            <Chips
              label="Casse"
              value={draft.titleCase}
              options={[
                { v: 'normal', l: 'Normale' },
                { v: 'upper', l: 'CAPITALES' },
              ]}
              onChange={(v) => set('titleCase', v)}
            />
            <Chips
              label="Mot accentué"
              value={draft.accentStyle}
              options={[
                { v: 'serif', l: 'Serif italique' },
                { v: 'plain', l: 'Couleur seule' },
                { v: 'underline', l: 'Souligné' },
                { v: 'highlight', l: 'Surligné' },
              ]}
              onChange={(v) => set('accentStyle', v)}
            />
            <Chips
              label="Alignement"
              value={draft.align}
              options={[
                { v: 'auto', l: 'Auto (centré sur accroche & CTA)' },
                { v: 'left', l: 'Gauche' },
                { v: 'center', l: 'Centré' },
              ]}
              onChange={(v) => set('align', v)}
            />
          </Section>

          <Section title="Décor">
            <Chips
              label="Décor"
              value={draft.decor}
              options={(Object.keys(DECOR_LABELS) as Draft['decor'][]).map((d) => ({ v: d, l: DECOR_LABELS[d] }))}
              onChange={(v) => set('decor', v)}
            />
            {draft.decor !== 'aucun' && (
              <>
                <Chips
                  label="Position"
                  value={draft.decorPosition}
                  options={[
                    { v: 'haut-droite', l: 'Haut droite' },
                    { v: 'haut-gauche', l: 'Haut gauche' },
                    { v: 'bas-droite', l: 'Bas droite' },
                    { v: 'bas-gauche', l: 'Bas gauche' },
                    { v: 'centre', l: 'Centre' },
                  ]}
                  onChange={(v) => set('decorPosition', v)}
                />
                <Range label="Intensité du décor" value={draft.decorIntensity} min={0} max={100} unit=" %" onChange={(v) => set('decorIntensity', v)} />
              </>
            )}
            <Range label="Vignettage des bords" value={draft.vignette} min={0} max={100} unit=" %" onChange={(v) => set('vignette', v)} />
          </Section>

          <Section title="Image de fond">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label !mb-0">Bibliothèque</span>
                <div className="flex items-center gap-2">
                  <Link to="/images" className="text-xs text-accent hover:underline">
                    Studio d'images →
                  </Link>
                  <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => fileInput.current?.click()}>
                    <Upload size={12} /> Importer
                  </button>
                </div>
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
                  onClick={() => pickBackground(null)}
                  className={`h-16 w-[3.2rem] rounded-lg border text-[10px] text-muted ${
                    draft.backgroundAssetId === null ? 'border-accent/60 bg-accent-soft' : 'border-line'
                  }`}
                >
                  aucune
                </button>
                {library?.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => pickBackground(img)}
                    className={`h-16 w-[3.2rem] overflow-hidden rounded-lg border ${
                      draft.backgroundAssetId === img.id ? 'border-accent' : 'border-line'
                    }`}
                    title={img.prompt ?? ''}
                  >
                    <LibraryThumb img={img} className="h-full w-full" />
                  </button>
                ))}
              </div>
            </div>
            {draft.backgroundAssetId && (
              <>
                <Range label="Intensité de l'image" value={draft.backgroundOpacity} min={0} max={100} unit=" %" onChange={(v) => set('backgroundOpacity', v)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Chips
                    label="Cadrage"
                    value={draft.bgFit}
                    options={[
                      { v: 'cover', l: 'Remplir' },
                      { v: 'contain', l: selectedBg?.cutout ? 'Objet entier' : 'Entière' },
                    ]}
                    onChange={(v) => set('bgFit', v)}
                  />
                  <Chips
                    label="Position"
                    value={draft.bgPosition}
                    options={[
                      { v: 'centre', l: 'Centre' },
                      { v: 'haut', l: 'Haut' },
                      { v: 'bas', l: 'Bas' },
                    ]}
                    onChange={(v) => set('bgPosition', v)}
                  />
                </div>
                <Range label="Flou" value={draft.bgBlur} min={0} max={60} unit=" px" onChange={(v) => set('bgBlur', v)} />
                <Chips
                  label="Fusion avec le fond"
                  value={draft.bgBlend}
                  options={[
                    { v: 'normal', l: 'Normale' },
                    { v: 'multiply', l: 'Produit' },
                    { v: 'screen', l: 'Superposition' },
                    { v: 'soft-light', l: 'Lumière douce' },
                    { v: 'luminosity', l: 'Luminosité' },
                  ]}
                  onChange={(v) => set('bgBlend', v)}
                />
              </>
            )}
          </Section>

          <Section title="Matière">
            <Chips
              label="Angles des pilules et cartes"
              value={draft.radius}
              options={[
                { v: 'pill', l: 'Pilule' },
                { v: 'rounded', l: 'Arrondi' },
                { v: 'sharp', l: 'Net' },
              ]}
              onChange={(v) => set('radius', v)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Range label="Intensité du verre" value={draft.glass} min={0} max={100} unit=" %" onChange={(v) => set('glass', v)} />
              <Range label="Grain de film" value={draft.grain ? draft.grainLevel : 0} min={0} max={100} unit=" %" onChange={(v) => setDraft((d) => ({ ...d, grain: v > 0, grainLevel: v }))} />
            </div>
            <Chips
              label="Cadre fin"
              value={draft.frame}
              options={[
                { v: 'aucun', l: 'Aucun' },
                { v: 'texte', l: 'Couleur du texte' },
                { v: 'accent', l: 'Accent' },
              ]}
              onChange={(v) => set('frame', v)}
            />
            <Chips
              label="Marges"
              value={draft.padding}
              options={[
                { v: 'serre', l: 'Serrées' },
                { v: 'normal', l: 'Normales' },
                { v: 'aere', l: 'Aérées' },
              ]}
              onChange={(v) => set('padding', v)}
            />
          </Section>

          <Section title="Pied de page">
            <Toggle label="Afficher le logo" checked={draft.showLogo} onChange={(v) => set('showLogo', v)} />
            <Toggle label="Afficher le compteur « 03/06 → swipe »" checked={draft.showCounter} onChange={(v) => set('showCounter', v)} />
          </Section>

          <button
            className="btn-primary mt-5 w-full justify-center"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            <Check size={14} />
            {editingId ? 'Enregistrer les modifications' : 'Créer le template'}
          </button>
        </div>

        {/* Aperçu live */}
        <div className="md:sticky md:top-6 md:self-start">
          <div className="mb-2 flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted/70">Aperçu</span>
            <div className="pill-bar">
              {PREVIEW_KINDS.map((k) => (
                <button
                  key={k.id}
                  className={`pill-btn pill-btn--text ${previewKind === k.id ? 'pill-btn--on' : ''}`}
                  onClick={() => setPreviewKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <Preview draft={draft} kind={previewKind} />
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
              <div className="mono text-[11px] text-muted">
                {DECOR_LABELS[t.decor]} · {t.titleFont}
              </div>
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
            <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => loadTemplate(t)}>
              Modifier
            </button>
            <button className="pill-btn" title="Dupliquer" disabled={duplicate.isPending} onClick={() => duplicate.mutate(t.id)}>
              <Copy size={13} />
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
              isDefault(b.id) ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
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
