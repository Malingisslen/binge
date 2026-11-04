'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';

/** Marks the control that opens the dialog, so focus has somewhere to go once the dialog replaces it. */
export const VETO_TRIGGER_ATTR = 'data-veto-trigger';

export function VetoConfirmDialog({
  onConfirm, onCancel, disabled,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });

  useEffect(() => {
    // When the opener was unmounted by opening the dialog, focus has already fallen back to body.
    const active = document.activeElement;
    const previous = active instanceof HTMLElement && active !== document.body ? active : null;
    // Avbryt first: the destructive choice is never the one a stray Enter lands on.
    ref.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      // The opener is usually unmounted by the time the dialog closes, so fall back to its marked twin.
      const target = previous?.isConnected
        ? previous
        : document.querySelector<HTMLElement>(`[${VETO_TRIGGER_ATTR}]`);
      target?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const buttons = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (!ref.current.contains(active)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby="veto-dialog-title"
      aria-describedby="veto-dialog-desc"
      className="px-3 py-3 border-t border-danger bg-danger-soft text-xs"
    >
      <div id="veto-dialog-title" className="font-semibold text-danger-ink mb-1">Lägg ett veto?</div>
      <div id="veto-dialog-desc" className="text-ink-2 mb-2">Veto dödar den här titeln definitivt. Du kan använda det bara en gång per session.</div>
      <div className="flex gap-2">
        <Button type="button" onClick={onConfirm} disabled={disabled} variant="danger" size="sm" className="min-h-11">
          Ja, veto
        </Button>
        <Button type="button" onClick={onCancel} data-initial-focus variant="ghost" size="sm" className="min-h-11">
          Avbryt
        </Button>
      </div>
    </div>
  );
}
