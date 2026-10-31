'use client';

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_SAVINGS_TAB, SAVINGS_TABS, tabFromHash, type SavingsTabId } from '@/lib/advisor/savingsTabs';

// The tab lives in the URL hash so a link to "Paket" opens on it. It is read after mount: a static export has no hash at
// build time, so reading it during render would mismatch the prerendered HTML.
export function useSavingsTab(): [SavingsTabId, (id: SavingsTabId) => void] {
  const [tab, setTab] = useState<SavingsTabId>(DEFAULT_SAVINGS_TAB);

  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const select = useCallback((id: SavingsTabId) => {
    setTab(id);
    // replaceState, not location.hash: switching tabs should not scroll the page to
    // the anchor.
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {
      // Hash is a convenience; the tab already changed in state.
    }
  }, []);

  return [tab, select];
}

const TAB_BASE = 'px-3 py-2 text-sm font-semibold cursor-pointer bg-transparent border-0 border-b-2 whitespace-nowrap';

export function SavingsTabList({ tab, onSelect }: { tab: SavingsTabId; onSelect: (id: SavingsTabId) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SAVINGS_TABS.findIndex(t => t.id === tab);
    const last = SAVINGS_TABS.length - 1;
    let target: number;
    if (e.key === 'ArrowRight') target = (i + 1) % SAVINGS_TABS.length;
    else if (e.key === 'ArrowLeft') target = (i + last) % SAVINGS_TABS.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = last;
    else return;
    e.preventDefault();
    const next = SAVINGS_TABS[target];
    onSelect(next.id);
    document.getElementById(`savings-tab-${next.id}`)?.focus();
  };

  return (
    <div role="tablist" aria-label="Rådgivaren" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-rule mb-3.5">
      {SAVINGS_TABS.map(t => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            id={`savings-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`savings-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={`${TAB_BASE} ${on ? 'text-ink border-ink' : 'text-ink-3 border-transparent hover:text-ink'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// Inactive panels stay mounted and are only hidden: the blocks inside own
// subscriptions and open/closed state that should not reset on a tab switch.
export function SavingsTabPanel({ id, active, children }: { id: SavingsTabId; active: SavingsTabId; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`savings-panel-${id}`} aria-labelledby={`savings-tab-${id}`} hidden={id !== active} tabIndex={0}>
      {children}
    </div>
  );
}
