'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { useSessionInviteActions } from '@/hooks/useSessionInvites';
import { useSenderProfile } from '@/hooks/useSenderProfile';
import { shownSenderName } from '@/lib/friendName';
import type { SessionInvite } from '@/lib/sessionInvites';
import { Button } from '@/components/ui/Button';

export const SESSION_GONE_TEXT = 'Sessionen finns inte längre';

type RowState = 'idle' | 'busy' | 'gone' | 'failed';

// The sender's public card wins over the stored name, like a friend request: the
// stored name is bound to the sender's profile by the rules, but it can be older.
function useInviteRow(invite: SessionInvite, onNavigate?: () => void) {
  const router = useRouter();
  const { join, decline, dismissGone } = useSessionInviteActions();
  const { data: sender } = useSenderProfile(invite.fromUid);
  const [state, setState] = useState<RowState>('idle');
  const name = shownSenderName(sender, invite.fromName ?? 'En vän');

  const onJoin = async () => {
    setState('busy');
    try {
      const result = await join(invite);
      if (result.status === 'gone') { setState('gone'); return; }
      onNavigate?.();
      router.push(`/tillsammans/${result.sessionId}`);
    } catch {
      setState('failed');
    }
  };
  const onDecline = async () => {
    setState('busy');
    try { await decline(invite.id); } catch { setState('failed'); }
  };
  return { name, state, onJoin, onDecline, onDismiss: () => dismissGone(invite.id) };
}

/** One invite in the Väntar på dig box on Vänner. */
export function SessionInviteRow({ invite }: { invite: SessionInvite }) {
  const { name, state, onJoin, onDecline, onDismiss } = useInviteRow(invite);
  return (
    <li className="py-2 flex items-center gap-2">
      <Users size={14} className="text-acc-deep shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 text-xs">
        {state === 'gone' ? (
          <span className="text-ink-2">{SESSION_GONE_TEXT}</span>
        ) : (
          <>
            <span className="font-semibold text-ink">{name}</span>
            <span className="text-ink-3"> bjuder in dig till Tillsammans</span>
          </>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-1">
          {state === 'gone' ? (
            <Button onClick={onDismiss} variant="ghost" size="xs">OK</Button>
          ) : (
            <>
              <Button onClick={onJoin} disabled={state === 'busy'} variant="acc" size="xs">Gå med</Button>
              <Button onClick={onDecline} disabled={state === 'busy'} variant="ghost" size="xs">Avböj</Button>
            </>
          )}
        </div>
        {state === 'failed' && <span role="alert" className="text-xs text-danger-ink">Det gick inte. Försök igen.</span>}
      </div>
    </li>
  );
}

/** One invite in the bell's popover. `onNavigate` closes the popover before leaving. */
export function SessionInvitePopoverRow({ invite, onNavigate }: { invite: SessionInvite; onNavigate: () => void }) {
  const { name, state, onJoin, onDecline, onDismiss } = useInviteRow(invite, onNavigate);
  return (
    <div className="popover-row friend-req">
      <div className="popover-row-title flex items-center gap-1">
        <Users size={12} className="text-acc-deep shrink-0" aria-hidden="true" />
        {state === 'gone' ? SESSION_GONE_TEXT : name}
      </div>
      {state !== 'gone' && <div className="popover-row-meta">bjuder in dig till Tillsammans</div>}
      <div className="popover-actions">
        {state === 'gone' ? (
          <Button onClick={onDismiss} variant="ghost" size="sm">OK</Button>
        ) : (
          <>
            <Button onClick={onJoin} disabled={state === 'busy'} variant="acc" size="sm">Gå med</Button>
            <Button onClick={onDecline} disabled={state === 'busy'} variant="ghost" size="sm">Avböj</Button>
          </>
        )}
      </div>
      {state === 'failed' && <div role="alert" className="text-xs text-danger-ink">Det gick inte. Försök igen.</div>}
    </div>
  );
}
