'use client';

import { useEffect, useRef } from 'react';

/**
 * Designad bekräftelsedialog som ersätter native window.confirm() (G1).
 * Surface-kort på mörk backdrop, .btn-danger för destruktiva handlingar,
 * stängs på Escape och backdrop-klick. Stoppar Escape-propagering så en
 * eventuell underliggande modal (t.ex. GroupSettingsModal) inte stängs
 * samtidigt.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Avbryt',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    // capture: true så vi hinner före andra document-lyssnare (modal-stacking).
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      // stopPropagation: dialogen kan vara monterad inuti en annan modals
      // backdrop — klicket ska bara stänga bekräftelsen, inte modalen under.
      onClick={e => { e.stopPropagation(); onCancel(); }}
      role="presentation"
      data-testid="confirm-backdrop"
    >
      <div
        className="bg-surface border border-border-main rounded-sm max-w-[380px] w-full"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="px-3 py-3">
          <h2 id="confirm-dialog-title" className="text-sm font-bold text-text-primary">
            {title}
          </h2>
          {body && <p className="text-xs text-text-muted mt-1 leading-relaxed">{body}</p>}
        </div>
        <div className="px-3 py-2 border-t border-border-light flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn btn-danger btn-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
