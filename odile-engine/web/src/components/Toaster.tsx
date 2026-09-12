import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

/**
 * Notifications légères (« toasts ») : un magasin minuscule, utilisable
 * hors des composants (gestion d'erreur globale des mutations) et affiché
 * par <ToastHost /> monté une fois dans l'application.
 */
export type ToastTone = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** action facultative (« Annuler », « Voir ») */
  action?: { label: string; onClick: () => void };
  duration: number;
}

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(items));

function push(tone: ToastTone, message: string, opts: { action?: ToastItem['action']; duration?: number } = {}): number {
  const id = ++seq;
  const duration = opts.duration ?? (tone === 'error' ? 7000 : opts.action ? 9000 : 3500);
  // Un même message n'est pas empilé
  items = [...items.filter((t) => t.message !== message), { id, tone, message, action: opts.action, duration }];
  emit();
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}
export function dismiss(id: number): void {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message: string, opts?: { action?: ToastItem['action']; duration?: number }) => push('success', message, opts),
  error: (message: string, opts?: { action?: ToastItem['action']; duration?: number }) => push('error', message, opts),
  info: (message: string, opts?: { action?: ToastItem['action']; duration?: number }) => push('info', message, opts),
  dismiss,
};

const ICONS: Record<ToastTone, typeof Info> = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
      {list.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-2xl backdrop-blur ${
              t.tone === 'error' ? 'border-red-500/40 bg-red-950/90 text-red-100' : t.tone === 'success' ? 'border-accent/40 bg-ink/95 text-txt' : 'border-line bg-ink/95 text-txt'
            }`}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${t.tone === 'error' ? 'text-red-300' : t.tone === 'success' ? 'text-accent' : 'text-muted'}`} />
            <span className="min-w-0 flex-1 break-words leading-snug">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold hover:bg-white/10"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="shrink-0 text-muted hover:text-txt" onClick={() => dismiss(t.id)} aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
