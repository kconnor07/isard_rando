import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { LibraryImageDto } from '../api/types';

/** Vignette d'une image de bibliothèque (damier sous les détourages). */
export function LibraryThumb({ img, className = '' }: { img: LibraryImageDto; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${img.cutout ? 'checker' : 'bg-panel2'} ${className}`}>
      <img src={`/api/assets/${img.id}`} alt="" className="h-full w-full object-contain" loading="lazy" />
      {img.cutout && (
        <span className="mono absolute left-1.5 top-1.5 rounded-full bg-ink/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-txt">
          détouré
        </span>
      )}
    </div>
  );
}

/** Fenêtre de choix d'une image de la bibliothèque. */
export default function LibraryPicker({
  open,
  title = 'Choisir une image',
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onPick: (img: LibraryImageDto) => void;
}) {
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
    enabled: open,
  });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="card max-h-[85vh] w-full max-w-3xl overflow-y-auto bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
          <button className="pill-btn" onClick={onClose} title="Fermer">
            <X size={14} />
          </button>
        </div>
        {library && library.length === 0 && (
          <p className="text-sm text-muted">
            Bibliothèque vide — générez ou importez des images dans{' '}
            <Link to="/images" className="text-accent underline">
              Images
            </Link>
            .
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {library?.map((img) => (
            <button
              key={img.id}
              className="overflow-hidden rounded-xl border border-line transition-colors hover:border-accent"
              onClick={() => onPick(img)}
              title={img.prompt ?? ''}
            >
              <LibraryThumb img={img} className="aspect-[4/5]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
