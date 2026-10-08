'use client';

import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFriendStatus, useFriendActions } from '@/hooks/useFriends';
import { useFriendActionAlert } from '@/hooks/useFriendActionAlert';
import { FRIEND_FAILURE_TEXT, type FriendAction } from '@/lib/friendActionText';
import { Button } from '@/components/ui/Button';

// BIN-1192. Each mode's write can be refused, and each says so next to its own
// button. The texts differ by ACTION, never by cause: within one action every
// failure reads the same, so nothing about why the write failed is inferable.
//
// Why the send path is not simply reused for the other three: the blocked-list
// clause in `firestore.rules` gates `friendRequests` create and nothing else —
// cancel, accept and remove carry no block check on any branch. So there is no
// refusal on those three that a block could explain, and naming the wrong action
// in the message would cost clarity to buy a secrecy they do not need.
//
// BIN-1196 moved the texts and the failed-write guard out of this file: the same
// actions are offered by the friends page and the topbar popover, and a copy per
// file is a wording per file.

// Knapp med 4 olika lägen baserat på relation:
// - 'none'     → "Lägg till vän"      (skickar förfrågan)
// - 'sent'     → "Förfrågan skickad"  (klick → cancel)
// - 'received' → "Acceptera vän"      (de skickade till oss → accept)
// - 'friends'  → "Vän"                (klick → ta bort)
//
// Vänskap är mutuell — båda håll måste samtycka. Det är därför "received"
// renderar accept-knapp direkt (ingen omväg via Vänner-sidan behövs).
export default function FriendButton({ targetUid }: { targetUid: string }) {
  const { uid } = useAuth();
  const { data: status, isLoading } = useFriendStatus(targetUid);
  const { sendFriendRequest, cancelFriendRequest, acceptFriendRequest, removeFriend } = useFriendActions();

  // The message belongs to the button that produced it. When the relation changes
  // — the other person accepted in another tab, a request arrived — this button
  // becomes a DIFFERENT action, and an error about the previous one is no longer
  // about anything on screen. Passing `status` as the reset key is what clears it
  // rather than merely hiding it, which is what stops the alert reappearing if
  // that mode comes back later; hiding alone left exactly that stale banner
  // behind on the send path.
  const { failedAction, run } = useFriendActionAlert(status);

  if (!uid || uid === targetUid) return null;
  if (isLoading) return null;

  const alertFor = (action: FriendAction) =>
    failedAction === action ? (
      <span role="alert" className="text-xs text-danger-ink">{FRIEND_FAILURE_TEXT[action]}</span>
    ) : null;

  if (status === 'friends') {
    return (
      <span className="inline-flex items-center gap-2">
        <Button onClick={run('remove', () => removeFriend(targetUid))} variant="ghost" size="sm" title="Ta bort vänskap">
          <Check size={11} /> Vän
        </Button>
        {alertFor('remove')}
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-2">
        <Button onClick={run('cancel', () => cancelFriendRequest(targetUid))} variant="ghost" size="sm" title="Avbryt förfrågan">
          Förfrågan skickad
        </Button>
        {alertFor('cancel')}
      </span>
    );
  }

  if (status === 'received') {
    return (
      <span className="inline-flex items-center gap-2">
        <Button onClick={run('accept', () => acceptFriendRequest(targetUid))} variant="acc" size="sm" title="De skickade en vänskapsförfrågan">
          Acceptera vän
        </Button>
        {alertFor('accept')}
      </span>
    );
  }

  // status === 'none'
  //
  // BIN-1129: a send can be refused — among other reasons, because the recipient
  // has blocked this account. Every refusal of THIS action gets the same text on
  // purpose: a separate message for a block would tell the sender they were
  // blocked. That reason is specific to the send path; see the note at the top.
  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={run('send', () => sendFriendRequest(targetUid))} variant="acc" size="sm">
        Lägg till vän
      </Button>
      {alertFor('send')}
    </span>
  );
}
