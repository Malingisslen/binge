'use client';

import { useEffect, useRef } from 'react';
import { useGroupMemberNames } from '@/hooks/useGroupMemberNames';
import { MAX_SESSION_INVITEES, groupPrefill, toggleInvitee } from '@/lib/sessionInvites';
import type { Group } from '@/types';

export interface InvitePickerPerson {
  uid: string;
  name: string;
}

/**
 * "Bjud in" on /tillsammans/ny. Friends are listed unticked. Choosing a group binds
 * the session to it and lists its members ticked; the host can untick anyone, and
 * nothing is sent until the session is created. Nobody is invited by choosing a group
 * alone, and the list never grows past the cap.
 */
export function InvitePicker({
  myUid,
  friends,
  groups,
  groupId,
  onGroupChange,
  selected,
  onSelectedChange,
}: {
  myUid: string;
  friends: readonly InvitePickerPerson[];
  groups: readonly Pick<Group, 'id' | 'name'>[];
  groupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
}) {
  const memberNames = useGroupMemberNames(groupId);
  const members: InvitePickerPerson[] = Object.entries(memberNames)
    .filter(([uid]) => uid !== myUid)
    .map(([uid, name]) => ({ uid, name: name || 'Medlem' }));

  // The members arrive after the group is chosen. Tick them once per chosen group, so
  // a member the host unticked is not ticked again when the listener fires anew.
  const prefilledFor = useRef<string | null>(null);
  const memberKey = members.map(m => m.uid).sort().join(',');
  useEffect(() => {
    if (!groupId || prefilledFor.current === groupId || memberKey === '') return;
    prefilledFor.current = groupId;
    const friendPicks = selected.filter(uid => friends.some(f => f.uid === uid));
    onSelectedChange(groupPrefill([...friendPicks, ...memberKey.split(',')], myUid));
  }, [groupId, memberKey, myUid, friends, selected, onSelectedChange]);

  const memberUids = new Set(members.map(m => m.uid));
  const friendsOutsideGroup = friends.filter(f => !memberUids.has(f.uid));
  const full = selected.length >= MAX_SESSION_INVITEES;

  const chooseGroup = (next: string | null) => {
    if (next === groupId) return;
    prefilledFor.current = null;
    // Leaving a group unticks its members; ticked friends stay.
    onSelectedChange(selected.filter(uid => friends.some(f => f.uid === uid)));
    onGroupChange(next);
  };

  const row = (p: InvitePickerPerson) => {
    const checked = selected.includes(p.uid);
    return (
      <label key={p.uid} className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={!checked && full}
          onChange={() => onSelectedChange(toggleInvitee(selected, p.uid))}
          className="accent-acc-deep w-[12px] h-[12px]"
        />
        {p.name}
      </label>
    );
  };

  if (friends.length === 0 && groups.length === 0) {
    return (
      <p className="text-xs text-ink-3">
        Du har inga vänner eller grupper att bjuda in än. Dela länken när sessionen är skapad.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {groups.length > 0 && (
        <fieldset>
          <legend className="text-xs text-ink-3 mb-1">Starta för en grupp</legend>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
              <input
                type="radio" name="invite-group" checked={groupId === null}
                onChange={() => chooseGroup(null)} className="accent-acc-deep w-[12px] h-[12px]"
              />
              Ingen grupp
            </label>
            {groups.map(g => (
              <label key={g.id} className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
                <input
                  type="radio" name="invite-group" checked={groupId === g.id}
                  onChange={() => chooseGroup(g.id)} className="accent-acc-deep w-[12px] h-[12px]"
                />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {groupId && members.length > 0 && (
        <fieldset>
          <legend className="text-xs text-ink-3 mb-1">Gruppens medlemmar. Avmarkera den som inte ska bjudas in.</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">{members.map(row)}</div>
        </fieldset>
      )}

      {friendsOutsideGroup.length > 0 && (
        <fieldset>
          <legend className="text-xs text-ink-3 mb-1">Vänner</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">{friendsOutsideGroup.map(row)}</div>
        </fieldset>
      )}

      <p className="text-xxs text-ink-3" aria-live="polite">
        {selected.length} av {MAX_SESSION_INVITEES} valda.
        {full && ' Fler kan få länken när sessionen är skapad.'}
        {' '}De du väljer får en notis och kan gå med direkt.
      </p>
    </div>
  );
}
