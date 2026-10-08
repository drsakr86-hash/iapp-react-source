/**
 * Shared confirmation / reason dialog.
 *
 * Replaces window.confirm and window.prompt, which render with the browser's
 * own chrome (English buttons, no RTL, often suppressed inside a Median APK
 * WebView). Call sites stay linear: `if (!(await confirm({...}))) return;`.
 * Only one dialog is open at a time; a second request while one is open
 * resolves the first as "cancelled".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ConfirmContext,
  type ConfirmContextValue,
  type ConfirmOptions,
  type PromptOptions,
} from './confirm-context';
import { Button } from '../components/ui/Button';

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const open = useCallback((next: Pending) => {
    const prev = pendingRef.current;
    if (prev) {
      if (prev.kind === 'confirm') prev.resolve(false);
      else prev.resolve(null);
    }
    pendingRef.current = next;
    setPending(next);
  }, []);

  const close = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => open({ kind: 'confirm', opts, resolve })),
    [open],
  );

  const promptText = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => open({ kind: 'prompt', opts, resolve })),
    [open],
  );

  const value = useMemo<ConfirmContextValue>(() => ({ confirm, promptText }), [confirm, promptText]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? <Dialog key={pending.opts.message} pending={pending} onDone={close} /> : null}
    </ConfirmContext.Provider>
  );
}

function Dialog({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const [text, setText] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isPrompt = pending.kind === 'prompt';
  const minLength = pending.kind === 'prompt' ? (pending.opts.minLength ?? 1) : 0;
  const canConfirm = !isPrompt || text.trim().length >= minLength;

  function cancel() {
    if (pending.kind === 'confirm') pending.resolve(false);
    else pending.resolve(null);
    onDone();
  }

  function accept() {
    if (!canConfirm) return;
    if (pending.kind === 'confirm') pending.resolve(true);
    else pending.resolve(text.trim());
    onDone();
  }

  /* Focus: the text box for a reason prompt; otherwise the SAFE button
     (cancel), so a stray Enter never confirms a destructive action. */
  useEffect(() => {
    if (isPrompt) inputRef.current?.focus();
    else cancelRef.current?.focus();
  }, [isPrompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  });

  const opts = pending.opts;
  const title = opts.title ?? (isPrompt ? 'أدخل السبب' : 'تأكيد');
  const confirmLabel = opts.confirmLabel ?? (isPrompt ? 'تأكيد' : 'نعم');
  const cancelLabel = pending.kind === 'confirm' ? (pending.opts.cancelLabel ?? 'إلغاء') : 'إلغاء';

  return (
    <div className="modal confirm" onClick={cancel}>
      <div
        className="modal__box confirm__box"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
        </div>
        <p className="confirm__msg">{opts.message}</p>
        {pending.kind === 'prompt' ? (
          <textarea
            ref={inputRef}
            rows={3}
            value={text}
            placeholder={pending.opts.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        ) : null}
        {pending.kind === 'prompt' && minLength > 1 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {minLength} أحرف على الأقل
          </p>
        ) : null}
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="btn btn--outline" onClick={cancel}>
            {cancelLabel}
          </button>
          <Button variant={opts.danger ? 'danger' : 'primary'} onClick={accept} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
