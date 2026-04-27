'use client';

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
        className={`${baseClass} bg-surface text-text-secondary border-border-main hover:bg-surface-hover`}
        title="Ta bort vänskap"
      >
        ✓ Vän
      </button>
    );
  }

  if (status === 'sent') {
    return (
      <button
        onClick={() => cancelFriendRequest(targetUid)}
        className={`${baseClass} bg-surface text-text-muted border-border-light hover:text-text-secondary`}
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
        className={`${baseClass} bg-accent text-white border-accent`}
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
      className={`${baseClass} bg-surface text-accent border-accent hover:bg-accent hover:text-white`}
    >
      Lägg till vän
    </button>
  );
}
