'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/**
 * BIN-1261: det gemensamma skalet för appens modala dialoger — bakgrund, fokus,
 * Tab-fälla, Escape och bakgrundsklick. `ConfirmDialog` och `HandOverGroupDialog`
 * renderas båda genom det, så det finns en implementation av beteendet, inte två.
 *
 * Fokus: flyttas in vid montering (till `initialFocusRef`, annars den första
 * fokuserbara kontrollen, annars dialogen själv) och återlämnas till det element
 * som hade fokus när dialogen öppnades.
 *
 * Escape: lyssnaren ligger på `document` i infångningsfasen med
 * `stopImmediatePropagation`, så en underliggande modal (t.ex. GroupSettingsModal)
 * inte stängs samtidigt — och så tangenten når hit även om fokus står utanför.
 *
 * Bakgrundsklick: stoppar ALLTID vidarebefordran, också när dialogen inte får
 * stängas, annars stänger ett klick den modal dialogen ligger i. Dragsäkert: bara
 * när både mousedown och click landar på själva bakgrunden.
 *
 * `dismissable`: när den är falsk stänger varken Escape eller bakgrundsklick.
 * Den läses levande vid varje händelse, inte fångad vid montering — ett anrop
 * som pågår måste vara spärrat hela vägen ut.
 */
export function DialogShell({
  labelledBy,
  describedBy,
  dismissable = true,
  onDismiss,
  initialFocusRef,
  className,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  dismissable?: boolean;
  onDismiss: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  // BIN-278: effekten nedan kör EN gång ([] deps) — att köra om den stjäl fokus
  // igen och fångar om föregående fokus. Det levande läget går därför via refs,
  // som skrivs i en effekt och inte under renderingen.
  const onDismissRef = useRef(onDismiss);
  const dismissableRef = useRef(dismissable);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    dismissableRef.current = dismissable;
  }, [onDismiss, dismissable]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const target = initialFocusRef?.current ?? (dialog ? focusablesIn(dialog)[0] : null) ?? dialog;
    target?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (dismissableRef.current) onDismissRef.current();
        return;
      }
      // BIN-278: fokuserbara räknas LEVANDE, så att avstängda knappar under ett
      // pågående anrop följer med. Finns ingen parkeras fokus på dialogen.
      if (e.key === 'Tab') {
        const current = dialogRef.current;
        if (!current) return;
        const focusables = focusablesIn(current);
        if (focusables.length === 0) {
          e.preventDefault();
          current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !current.contains(active)) { e.preventDefault(); last.focus(); }
        } else {
          if (active === last || !current.contains(active)) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    // Medvetet tom: se refs ovan. `initialFocusRef` läses bara vid montering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onMouseDown={e => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => {
        e.stopPropagation();
        const onBackdrop = mouseDownOnBackdrop.current && e.target === e.currentTarget;
        mouseDownOnBackdrop.current = false;
        if (onBackdrop && dismissableRef.current) onDismissRef.current();
      }}
      role="presentation"
      data-testid="confirm-backdrop"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`${className} outline-none`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </div>
    </div>
  );
}

function focusablesIn(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(el => el.offsetParent !== null);
}
