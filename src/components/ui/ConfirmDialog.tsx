'use client';

import { useRef } from 'react';
import { DialogShell } from './DialogShell';

/**
 * Designad bekräftelsedialog som ersätter native window.confirm() (G1).
 * Surface-kort på mörk backdrop, .btn-danger för destruktiva handlingar,
 * stängs på Escape och backdrop-klick. Skalet — fokus, Tab, Escape och
 * bakgrund — är `DialogShell` (BIN-1261).
 *
 * `busy` stänger av knapparna, inte Escape och bakgrundsklick — med flit, se
 * posten `## BIN-1261` i `.claude/rules/accepted-deviations.md`.
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

  return (
    <DialogShell
      labelledBy="confirm-dialog-title"
      describedBy={body ? 'confirm-dialog-desc' : undefined}
      onDismiss={onCancel}
      initialFocusRef={confirmRef}
      className="bg-surface border border-rule rounded-sm max-w-[380px] w-full"
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
    </DialogShell>
  );
}
