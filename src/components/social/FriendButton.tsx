'use client';

import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFriendStatus, useFriendActions } from '@/hooks/useFriends';
import { useFriendActionAlert } from '@/hooks/useFriendActionAlert';
import { FRIEND_FAILURE_TEXT, type FriendAction } from '@/lib/friendActionText';

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

  const baseClass = 'px-3 py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer';

  const alertFor = (action: FriendAction) =>
    failedAction === action ? (
      <span role="alert" className="text-xs text-danger-ink">{FRIEND_FAILURE_TEXT[action]}</span>
    ) : null;

  if (status === 'friends') {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={run('remove', () => removeFriend(targetUid))}
          className={`${baseClass} bg-surface text-ink-2 border-rule hover:bg-bg-2 inline-flex items-center gap-1`}
          title="Ta bort vänskap"
        >
          <Check size={11} /> Vän
        </button>
        {alertFor('remove')}
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={run('cancel', () => cancelFriendRequest(targetUid))}
          className={`${baseClass} bg-surface text-ink-3 border-rule-2 hover:text-ink-2`}
          title="Avbryt förfrågan"
        >
          Förfrågan skickad
        </button>
        {alertFor('cancel')}
      </span>
    );
  }

  if (status === 'received') {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          onClick={run('accept', () => acceptFriendRequest(targetUid))}
          className={`${baseClass} bg-acc-deep text-white border-acc-deep`}
          title="De skickade en vänskapsförfrågan"
        >
          Acceptera vän
        </button>
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
      <button
        onClick={run('send', () => sendFriendRequest(targetUid))}
        className={`${baseClass} bg-surface text-acc-deep border-acc-deep hover:bg-acc-deep hover:text-white`}
      >
        Lägg till vän
      </button>
      {alertFor('send')}
    </span>
  );
}
