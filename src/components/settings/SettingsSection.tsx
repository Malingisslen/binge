'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { eyebrowClass } from '@/components/ui/Eyebrow';

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
  summary,
  children,
}: {
  title: string;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: 'default' | 'danger';
  /** Visas bredvid rubriken när en hopfällbar sektion är stängd, så man ser vad som är valt utan att öppna. */
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  const borderClass = tone === 'danger' ? 'border-danger' : 'border-rule';
  const eyebrow = (
    <span className={eyebrowClass({ size: 'xs', tone: tone === 'danger' ? 'danger' : 'muted' })}>
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
          className="w-full flex items-center justify-between px-3 pt-2.5 pb-2 cursor-pointer text-left rounded-t-md hover:bg-bg-2"
        >
          <span className="min-w-0 flex items-baseline gap-2">
            {eyebrow}
            {!open && summary && <span className="text-xs text-ink-2 truncate">{summary}</span>}
          </span>
          {open
            ? <ChevronUp size={14} className="text-ink-3" />
            : <ChevronDown size={14} className="text-ink-3" />}
        </button>
      ) : (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
          {eyebrow}
          {action}
        </div>
      )}
      {isOpen && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}
