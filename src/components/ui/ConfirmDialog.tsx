'use client';

import { useEffect, useRef } from 'react';

/**
 * Designad bekräftelsedialog som ersätter native window.confirm() (G1).
 * Surface-kort på mörk backdrop, .btn-danger för destruktiva handlingar,
 * stängs på Escape och backdrop-klick. Stoppar Escape-propagering så en
 * eventuell underliggande modal (t.ex. GroupSettingsModal) inte stängs
 * samtidigt.
 *
 * Focus restoration: fokus återlämnas till det element som hade fokus när
 * dialogen monterades — förhindrar focus-trap i omslutande vyer.
 *
 * Drag-safe backdrop: backdrop-dismiss triggas bara när både mousedown OCH
 * click sker direkt på backdrop:en (target === currentTarget). Drag från
 * dialog → backdrop stänger inte dialogen.
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
  const dialogRef = useRef<HTMLDivElement>(null);
  // Tracks whether the mousedown that preceded a backdrop click started on the backdrop.
  const mouseDownOnBackdrop = useRef(false);
  // BIN-278: keep onCancel in a ref so the keydown/focus effect can run ONCE
  // ([] deps) — re-running it on every onCancel identity change re-stole focus
  // (visible flicker) and re-captured previousFocus.
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    // Capture the element that currently has focus before we steal it.
    const previousFocus = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancelRef.current();
        return;
      }
      // BIN-278: trap Tab within the dialog. Compute focusables LIVE (not at
      // mount) so it tracks `busy` flipping both buttons to disabled — in that
      // case there are zero focusables and we park focus on the dialog itself
      // (tabIndex=-1) instead of letting Tab escape to the page behind.
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(el => el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !dialog.contains(active)) { e.preventDefault(); last.focus(); }
        } else {
          if (active === last || !dialog.contains(active)) { e.preventDefault(); first.focus(); }
        }
      }
    };
    // capture: true så vi hinner före andra document-lyssnare (modal-stacking).
    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      // Restore focus to whichever element had it before the dialog opened.
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      // Drag-safe dismiss: only cancel when both mousedown AND click land on
      // the backdrop itself (not a drag from inside the dialog outward).
      onMouseDown={e => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => {
        e.stopPropagation();
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) {
          mouseDownOnBackdrop.current = false;
          onCancel();
        } else {
          mouseDownOnBackdrop.current = false;
        }
      }}
      role="presentation"
      data-testid="confirm-backdrop"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-surface border border-rule rounded-sm max-w-[380px] w-full outline-none"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? 'confirm-dialog-desc' : undefined}
      >
        <div className="px-3 py-3">
          <h2 id="confirm-dialog-title" className="text-sm font-bold text-ink">
            {title}
          </h2>
          {body && <p id="confirm-dialog-desc" className="text-xs text-ink-3 mt-1 leading-relaxed">{body}</p>}
        </div>
        <div className="px-3 py-2 border-t border-rule-2 flex items-center justify-end gap-2">
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
