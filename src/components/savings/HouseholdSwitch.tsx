'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Group } from '@/types';
import type { SavingsTabId } from '@/lib/advisor/savingsTabs';
import { Segmented } from '@/components/ui/Segmented';

export type SavingsMode = 'jag' | 'hushallet';

// The household mode owns one hash value. The tab hashes from the tab bar stay as they
// were: the tabs only exist in "Jag", and going back to "Jag" writes the open tab's hash.
const HOUSEHOLD_HASH = 'hushallet';
const MODE_KEY = 'binge.savings.mode';
const GROUP_KEY = 'binge.savings.group';

function readSession(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function writeSession(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); } catch { /* A convenience; the state already changed. */ }
}

/**
 * Which mode the page is in, and for which group. Read after mount like the tab hash: a
 * static export has no hash at build time. Household mode only counts while the user is
 * in at least one group, so a stale hash or session value cannot open an empty mode.
 */
export function useHouseholdMode(groups: readonly Group[], tab: SavingsTabId) {
  const [wantsHousehold, setWantsHousehold] = useState(false);
  const [chosenGroupId, setChosenGroupId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) setWantsHousehold(hash === HOUSEHOLD_HASH);
      else setWantsHousehold(readSession(MODE_KEY) === HOUSEHOLD_HASH);
    };
    sync();
    setChosenGroupId(readSession(GROUP_KEY));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const groupId = groups.find(g => g.id === chosenGroupId)?.id ?? groups[0]?.id ?? null;
  const mode: SavingsMode = wantsHousehold && groupId != null ? 'hushallet' : 'jag';

  const setMode = useCallback((next: SavingsMode) => {
    setWantsHousehold(next === 'hushallet');
    writeSession(MODE_KEY, next === 'hushallet' ? HOUSEHOLD_HASH : 'jag');
    try {
      // replaceState, not location.hash: switching should not scroll to the anchor.
      window.history.replaceState(null, '', `#${next === 'hushallet' ? HOUSEHOLD_HASH : tab}`);
    } catch { /* Hash is a convenience. */ }
  }, [tab]);

  const setGroupId = useCallback((id: string) => {
    setChosenGroupId(id);
    writeSession(GROUP_KEY, id);
  }, []);

  return { mode, setMode, groupId, setGroupId };
}

/** Jag/Hushållet in the page head. Renders nothing unless the user is in a group. */
export default function HouseholdSwitch({
  groups, mode, onMode, groupId, onGroup,
}: {
  groups: readonly Group[];
  mode: SavingsMode;
  onMode: (m: SavingsMode) => void;
  groupId: string | null;
  onGroup: (id: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<SavingsMode>
        ariaLabel="Visa för"
        value={mode}
        onChange={onMode}
        options={[{ value: 'jag', label: 'Jag' }, { value: 'hushallet', label: 'Hushållet' }]}
      />
      {mode === 'hushallet' && groups.length > 1 && (
        <select
          className="select"
          aria-label="Grupp"
          value={groupId ?? ''}
          onChange={e => onGroup(e.target.value)}
        >
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
    </div>
  );
}
