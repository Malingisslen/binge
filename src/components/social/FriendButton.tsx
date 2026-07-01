'use client';

import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFriendStatus, useFriendActions } from '@/hooks/useFriends';

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

  if (!uid || uid === targetUid) return null;
  if (isLoading) return null;

  const baseClass = 'px-3 py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer';

  if (status === 'friends') {
    return (
      <button
        onClick={() => removeFriend(targetUid)}
        className={`${baseClass} bg-surface text-ink-2 border-rule hover:bg-bg-2 inline-flex items-center gap-1`}
        title="Ta bort vänskap"
      >
        <Check size={11} /> Vän
      </button>
    );
  }

  if (status === 'sent') {
    return (
      <button
        onClick={() => cancelFriendRequest(targetUid)}
        className={`${baseClass} bg-surface text-ink-3 border-rule-2 hover:text-ink-2`}
        title="Avbryt förfrågan"
      >
        Förfrågan skickad
      </button>
    );
  }

  if (status === 'received') {
    return (
      <button
        onClick={() => acceptFriendRequest(targetUid)}
        className={`${baseClass} bg-acc-deep text-white border-acc-deep`}
        title="De skickade en vänskapsförfrågan"
      >
        Acceptera vän
      </button>
    );
  }

  // status === 'none'
  return (
    <button
      onClick={() => sendFriendRequest(targetUid)}
      className={`${baseClass} bg-surface text-acc-deep border-acc-deep hover:bg-acc-deep hover:text-white`}
    >
      Lägg till vän
    </button>
  );
}
