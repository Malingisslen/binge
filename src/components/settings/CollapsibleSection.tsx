'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Delat sektion-wrapper för /settings som kan vikas ihop. Samma vilostil som
 * övriga settings-kort men med klickbar header.
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div
        className="flex items-center justify-between px-3 py-[6px] border-b border-border-light cursor-pointer hover:bg-surface-hover/50"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-bold text-text-secondary">{title}</span>
        {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </div>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}
