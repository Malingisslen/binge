'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMyHousehold } from '@/hooks/useMyHousehold';
import { useMyGroupInvites } from '@/hooks/useGroups';
import { inviteAcceptToast } from '@/lib/groupDenialCopy';
import { HOUSEHOLD_MAX_MEMBERS } from '@/lib/household/household';
import { HouseholdCopy } from '@/components/groups/HouseholdConsent';
import { Button, buttonClass } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { GroupInvite } from '@/lib/firebase/groups';

// ADR 0029: the household starts on the Vänner page, the place people already go to find
// the ones they watch with. An invitation into a household shows its consent text before
// "Gå med"; ordinary group invitations stay on the groups page.
export default function HouseholdCallout() {
  const { household, loading, creating, create } = useMyHousehold();
  const { invites, accept, decline } = useMyGroupInvites();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const householdInvites = invites.filter(i => i.kind === 'household');

  if (loading) return null;

  const onCreate = async () => {
    setFailed(false);
    try {
      const id = await create();
      if (id) router.push('/hushall/');
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-3 mb-4">
      {householdInvites.map(inv => (
        <InviteCard
          key={inv.groupId}
          invite={inv}
          alreadyInHousehold={household != null}
          onAccept={async () => {
            const res = await accept(inv.groupId);
            if (res.ok) router.push('/hushall/');
            return inviteAcceptToast(res);
          }}
          onDecline={() => decline(inv.groupId)}
        />
      ))}

      {household ? (
        <section className={cardClass('px-3 py-2 flex flex-wrap items-center gap-3')} aria-label="Ditt hushåll">
          <div className="flex-1 min-w-0">
            <Eyebrow as="h2" size="xs">Hushåll</Eyebrow>
            <p className="text-sm text-ink">
              {household.name}
              <span className="text-ink-3"> · {household.memberUids.length} av {HOUSEHOLD_MAX_MEMBERS}</span>
            </p>
          </div>
          <Link href="/hushall/" className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
            Öppna hushållet
          </Link>
        </section>
      ) : householdInvites.length === 0 && (
        <section className={cardClass('px-3 py-2 space-y-2')} aria-labelledby="household-start">
          <h2 id="household-start" className="text-sm font-semibold text-ink">Bor du med någon?</h2>
          <p className="text-xs text-ink-2">Skapa ett hushåll och dela vad ni tittar på och vad ni betalar för streaming.</p>
          <Button type="button" variant="acc" size="sm" disabled={creating} onClick={() => { void onCreate(); }}>
            {creating ? 'Skapar…' : 'Skapa hushåll'}
          </Button>
          {failed && <p className="text-xs text-danger-ink" role="alert">Kunde inte skapa hushållet. Försök igen.</p>}
        </section>
      )}
    </div>
  );
}

function InviteCard({
  invite, alreadyInHousehold, onAccept, onDecline,
}: {
  invite: GroupInvite;
  alreadyInHousehold: boolean;
  onAccept: () => Promise<string | null>;
  onDecline: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const msg = await fn();
      if (typeof msg === 'string') setMessage(msg);
    } catch {
      setMessage('Något gick fel. Försök igen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-acc-soft border border-acc rounded-md px-3 py-2 space-y-2" aria-labelledby={`hh-invite-${invite.groupId}`}>
      <h2 id={`hh-invite-${invite.groupId}`} className="text-sm font-semibold text-ink">
        {invite.fromDisplayName} har bjudit in dig till hushållet {invite.groupName}
      </h2>
      {alreadyInHousehold ? (
        <p className="text-xs text-ink-2">Du är redan med i ett hushåll. Lämna det först om du vill gå med i det här.</p>
      ) : (
        <>
          <p className="text-xs text-ink-2">
            När du gått med väljer du själv att dela. Det här delas då:
          </p>
          <HouseholdCopy />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!alreadyInHousehold && (
          <Button type="button" variant="acc" size="sm" disabled={busy} onClick={() => { void run(onAccept); }}>
            Gå med
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void run(onDecline); }}>
          Nej tack
        </Button>
      </div>
      {message && <p className="text-xs text-danger-ink" role="alert">{message}</p>}
    </section>
  );
}
