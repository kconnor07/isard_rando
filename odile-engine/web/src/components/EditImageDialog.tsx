import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { ImageModelsDto, LibraryImageDto } from '../api/types';
import { LibraryThumb } from './LibraryPicker';

/**
 * Outils d'édition Magnific sur une image de la bibliothèque : upscale,
 * retouche par instruction, rééclairage, transfert de style, extension,
 * détourage. Le résultat devient une nouvelle image.
 */
export default function EditImageDialog({
  image,
  edits,
  onClose,
  onDone,
}: {
  image: LibraryImageDto;
  edits: ImageModelsDto['edits'];
  onClose: () => void;
  onDone: () => void;
}) {
  const [op, setOp] = useState(edits[0]?.id ?? 'upscale-creative');
  const [prompt, setPrompt] = useState('');
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = edits.find((e) => e.id === op);

  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
    enabled: Boolean(current?.needsReference),
  });

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/library/${image.id}/edit`, {
        op,
        prompt: prompt || undefined,
        referenceId: referenceId ?? undefined,
      });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-2xl bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-bold tracking-tight">
            Éditer avec Magnific <span className="mono ml-1 text-[10px] font-normal uppercase tracking-wider text-muted">nouvelle image</span>
          </h3>
          <button className="pill-btn" onClick={onClose} title="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <LibraryThumb img={image} className="aspect-[4/5] w-full rounded-xl border border-line" />
          <div>
            <div className="flex flex-wrap gap-2">
              {edits.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setOp(e.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    op === e.id ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            {current && <p className="mt-2 text-xs text-muted">{current.hint}</p>}
            {current?.needsPrompt && (
              <textarea
                className="input mt-3"
                rows={2}
                placeholder={op === 'relight' ? 'ex : lumière rasante dorée venant de la droite' : 'ex : remplace le fond par un studio sombre, garde le sujet'}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            )}
            {current?.needsReference && (
              <div className="mt-3">
                <div className="label !mb-1.5">Image dont on prend le style</div>
                <div className="flex flex-wrap gap-2">
                  {library
                    ?.filter((i) => i.id !== image.id)
                    .map((i) => (
                      <button
                        key={i.id}
                        onClick={() => setReferenceId(i.id)}
                        className={`h-16 w-[3.2rem] overflow-hidden rounded-lg border ${referenceId === i.id ? 'border-accent' : 'border-line'}`}
                      >
                        <LibraryThumb img={i} className="h-full w-full" />
                      </button>
                    ))}
                </div>
              </div>
            )}
            {error && <p className="mt-3 text-xs text-txt">{error}</p>}
            <button
              className="btn-primary mt-4"
              disabled={busy || (current?.needsPrompt && prompt.trim().length < 3) || (current?.needsReference && !referenceId)}
              onClick={() => void run()}
            >
              {busy ? 'Traitement… (20 s à 3 min)' : 'Appliquer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
