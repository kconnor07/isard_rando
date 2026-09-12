import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Dialogues de confirmation et de saisie, promisifiés : remplacent
 * confirm() / prompt() natifs (stylés, Échap = annuler, focus géré).
 *   const dialog = useDialog();
 *   if (!(await dialog.confirm({ title: 'Publier maintenant ?' }))) return;
 *   const reason = await dialog.prompt({ title: 'Raison du rejet', optional: true }); // null = annulé
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PromptOptions {
  title: string;
  message?: ReactNode;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  /** vide autorisé (renvoie '') */
  optional?: boolean;
  multiline?: boolean;
  /** champ date + heure (valeur « AAAA-MM-JJTHH:MM », heure locale du navigateur) */
  type?: 'text' | 'datetime-local';
  /** borne basse d'une saisie de date */
  min?: string;
}
interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setValue(opts.initial ?? '');
          setPending({ kind: 'prompt', opts, resolve });
        }),
    }),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      if (!pending) return;
      if (pending.kind === 'confirm') pending.resolve(result);
      else pending.resolve(result ? value : null);
      setPending(null);
    },
    [pending, value],
  );

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => (pending.kind === 'prompt' ? inputRef.current : confirmRef.current)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, close]);

  const canSubmit = !pending || pending.kind === 'confirm' || pending.opts.optional || value.trim().length > 0;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={() => close(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="card w-full max-w-md p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="dialog-title" className="text-base font-bold">
              {pending.opts.title}
            </h2>
            {pending.opts.message && <div className="mt-1.5 text-sm text-muted">{pending.opts.message}</div>}
            {pending.kind === 'prompt' && (
              <form
                className="mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) close(true);
                }}
              >
                {pending.opts.multiline ? (
                  <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    className="input"
                    rows={3}
                    placeholder={pending.opts.placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    className="input"
                    type={pending.opts.type ?? 'text'}
                    min={pending.opts.min}
                    placeholder={pending.opts.placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
              </form>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => close(false)}>
                {(pending.kind === 'confirm' && pending.opts.cancelLabel) || 'Annuler'}
              </button>
              <button
                ref={confirmRef}
                className={pending.kind === 'confirm' && pending.opts.danger ? 'btn-danger' : 'btn-primary'}
                disabled={!canSubmit}
                onClick={() => close(true)}
              >
                {pending.opts.confirmLabel ?? (pending.kind === 'confirm' ? 'Confirmer' : 'Valider')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog() hors de <DialogProvider>');
  return ctx;
}
