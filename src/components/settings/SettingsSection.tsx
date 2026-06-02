'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Enhetligt sektion-kort för /settings. Ersätter de tidigare separata
 * SettingsCard (platt) + CollapsibleSection (hopfällbar) — samma chrome,
 * `collapsible`-prop styr om sektionen kan vikas ihop.
 *
 * Headern följer Direction-H-eyebrow-stilen (samma som `.crumb` och
 * Hem-rail-korten): versaler, letter-spacing, ingen avdelarlinje. Etiketten
 * bor i kortets padding, inte i ett separat header-band.
 *
 * `tone="danger"` ger danger-token-border + danger-etikett (för
 * DeleteAccountSection) — aldrig råa Tailwind-röda.
 * `action` lägger en valfri länk/knapp till höger i headern (som Hem-korten).
 */
export function SettingsSection({
  title,
  action,
  collapsible = false,
  defaultOpen = true,
  tone = 'default',
  children,
}: {
  title: string;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  const borderClass = tone === 'danger' ? 'border-danger' : 'border-rule';
  const eyebrowClass = tone === 'danger' ? 'text-danger-ink' : 'text-ink-3';
  const eyebrow = (
    <span className={`text-[11px] uppercase tracking-[0.14em] font-medium ${eyebrowClass}`}>
      {title}
    </span>
  );

  return (
    <div className={`bg-surface border ${borderClass} rounded-md mb-3`}>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 pt-[10px] pb-2 cursor-pointer text-left rounded-t-md hover:bg-bg-2"
        >
          {eyebrow}
          {open
            ? <ChevronUp size={14} className="text-ink-3" />
            : <ChevronDown size={14} className="text-ink-3" />}
        </button>
      ) : (
        <div className="flex items-center justify-between px-3 pt-[10px] pb-2">
          {eyebrow}
          {action}
        </div>
      )}
      {isOpen && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}
