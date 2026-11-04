'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useFriends } from '@/hooks/useFriends';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useGroup } from '@/hooks/useGroups';
import { useMyHousehold } from '@/hooks/useMyHousehold';
import { usePageMeta } from '@/hooks/usePageMeta';
import { inviteMemberByUid } from '@/lib/firebase/groups';
import { HOUSEHOLD_MAX_MEMBERS } from '@/lib/household/household';
import HouseholdMode from '@/components/savings/HouseholdMode';
import { LeaveGroupDialog } from '@/components/groups/GroupSidePanels';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button, buttonClass } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { Group, GroupMember } from '@/types';

// ADR 0029: one page for the household — members, invitations, what it costs, the month's
// votes and what everyone is watching. Reached from Vänner, the advisor and the group page.
export default function HouseholdPageClient() {
  usePageMeta({ title: 'Hushåll' });
  const { household, loading, creating, create } = useMyHousehold();
  const [failed, setFailed] = useState(false);

  if (loading) return <LoadingView label="Laddar hushållet…" />;

  if (!household) {
    return (
      <div>
        <PageHeader crumb="Vänner" title="Hushåll" standfirst="Dem du bor med. Ni delar vad ni tittar på och vad ni betalar för streaming." />
        <EmptyState
          title="Du har inget hushåll än"
          body="Skapa ett och bjud sedan in dem du bor med från deras sida under Vänner."
          action={(
            <div className="flex flex-col items-center gap-2">
              <Button
                type="button"
                variant="acc"
                size="sm"
                disabled={creating}
                onClick={() => {
                  setFailed(false);
                  // The live group list picks the new household up and this page re-renders on its own.
                  create().catch(() => setFailed(true));
                }}
              >
                {creating ? 'Skapar…' : 'Skapa hushåll'}
              </Button>
              {failed && <p className="text-xs text-danger-ink" role="alert">Kunde inte skapa hushållet. Försök igen.</p>}
            </div>
          )}
        />
      </div>
    );
  }

  return <HouseholdView household={household} />;
}

function HouseholdView({ household }: { household: Group }) {
  const { uid } = useAuth();
  const { members } = useGroup(household.id);
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const isOwner = household.ownerUid === uid;

  return (
    <div className="max-w-[880px]">
      <PageHeader
        crumb="Vänner · Hushåll"
        title={household.name}
        standfirst="Dem du bor med. Ni delar vad ni tittar på och vad ni betalar för streaming."
        actions={isOwner && (
          <Link href={`/grupper/${household.id}/`} className={buttonClass({ variant: 'ghost', className: 'no-underline' })}>
            Inställningar
          </Link>
        )}
      />

      <MembersCard household={household} members={members} isOwner={isOwner} />

      <HouseholdMode groupId={household.id} groupName={household.name} isHousehold />

      <section className={cardClass('px-3 py-2 space-y-2')} aria-labelledby="household-leave">
        <Eyebrow as="h2" size="xs" id="household-leave">Lämna</Eyebrow>
        {isOwner ? (
          <p className="text-xs text-ink-2">
            Du äger hushållet. Lämna över det till någon annan, eller radera det, på{' '}
            <Link href={`/grupper/${household.id}/`}>inställningssidan</Link>.
          </p>
        ) : (
          <Button type="button" variant="danger-ghost" size="sm" onClick={() => setLeaving(true)}>
            Lämna hushållet
          </Button>
        )}
      </section>

      {leaving && uid && (
        <LeaveGroupDialog
          groupId={household.id}
          myUid={uid}
          onLeft={() => router.push('/my/friends/')}
          onCancel={() => setLeaving(false)}
        />
      )}
    </div>
  );
}

function MembersCard({ household, members, isOwner }: { household: Group; members: GroupMember[]; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const full = household.memberUids.length >= HOUSEHOLD_MAX_MEMBERS;
  const owner = members.find(m => m.uid === household.ownerUid);

  return (
    <section className={cardClass('mb-3.5')} aria-labelledby="household-members">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-rule-2">
        <Eyebrow as="h2" size="xs" id="household-members">
          Medlemmar · {household.memberUids.length} av {HOUSEHOLD_MAX_MEMBERS}
        </Eyebrow>
        {isOwner && !full && (
          <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(v => !v)}>
            {open ? 'Stäng' : '+ Bjud in från vänner'}
          </Button>
        )}
      </div>
      <ul className="list-none p-0 m-0 divide-y divide-rule-2">
        {members.map(m => (
          <li key={m.uid} className="px-3 py-2 text-sm text-ink flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate">{m.displayName || 'Medlem'}</span>
            {m.uid === household.ownerUid && <span className="text-xxs text-ink-3">Ägare</span>}
          </li>
        ))}
      </ul>
      {open && isOwner && <InviteFriends household={household} />}
      {full && <p className="px-3 py-2 text-xxs text-ink-3 border-t border-rule-2">Hushållet är fullt, högst {HOUSEHOLD_MAX_MEMBERS} personer.</p>}
      {!isOwner && (
        <p className="px-3 py-2 text-xxs text-ink-3 border-t border-rule-2">
          Bara {owner?.displayName || 'ägaren'} kan bjuda in fler.
        </p>
      )}
    </section>
  );
}

function InviteFriends({ household }: { household: Group }) {
  const { uid, user } = useAuth();
  const { data: friends = [], isLoading } = useFriends();
  const { isBlocked } = useBlockedUsers();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const candidates = friends.filter(f => !isBlocked(f.uid) && !household.memberUids.includes(f.uid));

  const invite = async (targetUid: string) => {
    if (!uid || !user) return;
    setBusy(targetUid);
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
      setSent(prev => new Set(prev).add(targetUid));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <p className="px-3 py-2 text-xs text-ink-3 border-t border-rule-2">Laddar vänner…</p>;
  if (candidates.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-ink-2 border-t border-rule-2">
        Bara vänner kan bjudas in. Lägg till personen som vän under <Link href="/my/friends/">Vänner</Link> först.
      </p>
    );
  }
  return (
    <div className="border-t border-rule-2">
      <ul className="list-none p-0 m-0 divide-y divide-rule-2">
        {candidates.map(f => (
          <li key={f.uid} className="px-3 py-2 flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 truncate">{f.displayName || f.username || 'Vän'}</span>
            {sent.has(f.uid) ? (
              <span className="text-xxs text-ink-3">Inbjudan skickad</span>
            ) : (
              <Button type="button" variant="ghost" size="xs" disabled={busy === f.uid} onClick={() => { void invite(f.uid); }}>
                Bjud in
              </Button>
            )}
          </li>
        ))}
      </ul>
      {failed && <p className="px-3 py-2 text-xs text-danger-ink" role="alert">Det gick inte att skicka inbjudan.</p>}
    </div>
  );
}
