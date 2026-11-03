'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useFriendStatus } from '@/hooks/useFriends';
import { useMyHousehold } from '@/hooks/useMyHousehold';
import { inviteMemberByUid } from '@/lib/firebase/groups';
import { householdInviteState } from '@/lib/household/household';
import { Button, buttonClass } from '@/components/ui/Button';

// ADR 0029: on a confirmed friend's page the household owner can invite them. The friend
// still answers the invitation themselves, under the household consent text.
export default function InviteToHouseholdButton({ targetUid, targetName }: { targetUid: string; targetName: string }) {
  const { uid, user } = useAuth();
  const { data: friendStatus } = useFriendStatus(targetUid);
  const { household, loading } = useMyHousehold();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (loading) return null;
  const state = householdInviteState({ household, myUid: uid, targetUid, isFriend: friendStatus === 'friends' });

  if (state === 'hidden') return null;
  if (state === 'create-first') {
    return (
      <Link href="/my/friends/" className={buttonClass({ variant: 'ghost', className: 'no-underline' })}>
        Skapa hushåll först
      </Link>
    );
  }
  if (state === 'member') return <span className="text-xs text-ink-3 self-center">Med i ditt hushåll</span>;
  if (state === 'full') return <span className="text-xs text-ink-3 self-center">Hushållet är fullt</span>;
  if (sent) return <span className="text-xs text-ink-2 self-center">Inbjudan skickad. {targetName} tackar själv ja.</span>;

  const onInvite = async () => {
    if (!household || !uid || !user) return;
    setBusy(true);
    setFailed(false);
    try {
      await inviteMemberByUid({
        groupId: household.id,
        groupName: household.name,
        fromUid: uid,
        fromDisplayName: user.displayName || null,
        targetUid,
        kind: 'household',
      });
      setSent(true);
    } catch {
      // Same neutral wording whatever the reason, so a refusal never reveals a block.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="acc" disabled={busy} onClick={() => { void onInvite(); }}>
        Bjud in till hushållet
      </Button>
      {failed && <span className="text-xs text-danger-ink self-center" role="alert">Det gick inte att skicka inbjudan.</span>}
    </>
  );
}
