import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Scissors, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { LibraryImageDto } from '../api/types';
import { LibraryThumb } from '../components/LibraryPicker';
import { Empty, PageTitle } from '../components/shared';

const SOURCE_LABELS: Record<LibraryImageDto['source'], string> = {
  studio: 'Studio IA',
  upload: 'Importée',
  cutout: 'Détourage',
  monochrome: 'Version N&B',
};

export default function Images() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [composition, setComposition] = useState('');
  const [aspect, setAspect] = useState<'4:5' | '1:1'>('4:5');
  const [quality, setQuality] = useState<'pro' | 'fast'>('pro');
  const [cutout, setCutout] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
  });
  const { data: compositions } = useQuery({
    queryKey: ['compositions'],
    queryFn: () => api.get<{ id: string; label: string }[]>('/api/images/compositions'),
  });
  const { data: imageGen } = useQuery({
    queryKey: ['settings', 'image_gen'],
    queryFn: () => api.get<{ value: { monochrome: boolean; quality: 'pro' | 'fast' } }>('/api/settings/image_gen'),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['library'] });

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ id: string; model: string }>('/api/images/generate', {
        prompt,
        composition: composition || undefined,
        aspect,
        quality,
        cutout,
      }),
    onSuccess: invalidate,
    onError: (e) => alert(String(e)),
  });

  const act = async (id: string, path: string) => {
    setBusyId(id);
    try {
      await api.post(`/api/library/${id}/${path}`);
      invalidate();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (img: LibraryImageDto) => {
    if (!confirm('Supprimer cette image ?')) return;
    setBusyId(img.id);
    try {
      await api.delete(`/api/library/${img.id}`);
      invalidate();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  };
  const upload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/library', { method: 'POST', body, credentials: 'same-origin' });
    if (!res.ok) return alert('Téléversement impossible');
    invalidate();
  };

  const monochrome = imageGen?.value.monochrome ?? true;

  return (
    <div>
      <PageTitle
        title="Images"
        accent="Images"
        subtitle="Décrivez une image, l'IA la génère ; détourez-la, puis posez-la en fond de template ou sur une slide."
        actions={
          <>
            <button className="btn-ghost" onClick={() => fileInput.current?.click()}>
              <Upload size={14} /> Importer
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </>
        }
      />

      {/* Studio */}
      <div className="card p-5">
        <label className="label !mb-1">Décrivez l'image</label>
        <textarea
          className="input"
          rows={3}
          placeholder="ex : un chronomètre en verre suspendu dans une brume légère, vu de trois quarts"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto_auto]">
          <div>
            <label className="label !mb-1">Composition</label>
            <select className="input" value={composition} onChange={(e) => setComposition(e.target.value)}>
              <option value="">Libre</option>
              {compositions?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label !mb-1.5">Format</label>
            <div className="pill-bar">
              {(['4:5', '1:1'] as const).map((a) => (
                <button key={a} className={`pill-btn pill-btn--text ${aspect === a ? 'pill-btn--on' : ''}`} onClick={() => setAspect(a)}>
                  {a === '4:5' ? 'Portrait 4:5' : 'Carré'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label !mb-1.5">Qualité</label>
            <div className="pill-bar">
              {(['pro', 'fast'] as const).map((q) => (
                <button key={q} className={`pill-btn pill-btn--text ${quality === q ? 'pill-btn--on' : ''}`} onClick={() => setQuality(q)}>
                  {q === 'pro' ? 'Pro' : 'Rapide'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} />
            <Scissors size={14} className="text-muted" /> Supprimer l'arrière-plan (objet détouré, fond transparent)
          </label>
          <span className="mono text-[10px] uppercase tracking-wider text-muted">
            {monochrome ? 'Toujours en noir & blanc' : 'Couleur'} ·{' '}
            <Link to="/settings" className="text-accent hover:underline">
              réglages
            </Link>
          </span>
        </div>
        <button
          className="btn-primary mt-5 w-full justify-center"
          disabled={generate.isPending || prompt.trim().length < 3}
          onClick={() => generate.mutate()}
        >
          <Sparkles size={14} />
          {generate.isPending ? (cutout ? 'Génération + détourage… (30 à 90 s)' : 'Génération… (20 à 60 s)') : "Générer l'image"}
        </button>
      </div>

      {/* Bibliothèque */}
      <h2 className="mb-3 mt-9 text-[15px] font-bold tracking-tight">Bibliothèque</h2>
      {library && library.length === 0 && (
        <Empty>Aucune image pour l'instant — générez-en une ci-dessus ou importez la vôtre.</Empty>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {library?.map((img) => {
          const busy = busyId === img.id;
          return (
            <div key={img.id} className={`card overflow-hidden ${busy ? 'opacity-60' : ''}`}>
              <LibraryThumb img={img} className="aspect-[4/5] w-full" />
              <div className="p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="mono rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {SOURCE_LABELS[img.source]}
                  </span>
                  {img.monochrome && (
                    <span className="mono rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                      N&B
                    </span>
                  )}
                  {img.cutout && (
                    <span className="mono rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ice">
                      détouré
                    </span>
                  )}
                </div>
                {img.prompt && <p className="line-clamp-2 text-xs text-muted">{img.prompt}</p>}
                <div className="mt-2.5 flex items-center gap-1.5">
                  {!img.cutout && (
                    <button className="btn-ghost !px-3 !py-1 text-xs" disabled={busy} onClick={() => act(img.id, 'cutout')} title="Créer une version détourée (fond transparent)">
                      <Scissors size={12} /> {busy ? '…' : 'Détourer'}
                    </button>
                  )}
                  {!img.monochrome && (
                    <button className="btn-ghost !px-3 !py-1 text-xs" disabled={busy} onClick={() => act(img.id, 'monochrome')} title="Créer une version noir et blanc">
                      N&B
                    </button>
                  )}
                  <span className="flex-1" />
                  <a className="pill-btn" href={`/api/assets/${img.id}`} download title="Télécharger">
                    <Download size={13} />
                  </a>
                  <button className="pill-btn" disabled={busy} onClick={() => remove(img)} title="Supprimer">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">
        Ces images se choisissent ensuite comme fond dans <Link to="/templates" className="text-accent hover:underline">Templates</Link>, ou
        se posent sur une slide depuis l'éditeur d'un post (bouton bibliothèque).
      </p>
    </div>
  );
}
