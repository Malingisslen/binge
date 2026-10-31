'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useGroupHousehold } from '@/hooks/useGroupHousehold';
import { useGroupMemberNames } from '@/hooks/useGroupMemberNames';
import { useMountTime } from '@/hooks/useMountTime';
import {
  aggregateHousehold,
  aggregateHouseholdVotes,
  type HouseholdProviderRow,
  type HouseholdVote,
} from '@/lib/advisor/householdAggregate';
import {
  householdMonthVerdict,
  householdServiceVerdict,
  soonLine,
  summarizeVotes,
  voteSummaryLine,
  type HouseholdMonthVerdict,
  type HouseholdServiceVerdict,
} from '@/lib/advisor/householdVerdicts';
import { formatKr } from '@/lib/formatKr';
import HouseholdConsent from '@/components/groups/HouseholdConsent';
import { Button, buttonClass } from '@/components/ui/Button';
import { badgeClass } from '@/components/ui/Badge';
import { cardClass } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { LoadingView } from '@/components/ui/LoadingView';

// Rådgivarens hushållsläge (ADR 0026). All data kommer ur useGroupHousehold, som läser
// samma share-to-see-samling som gruppsidans panel; domarna och kronorna kommer ur
// aggregateHousehold-raderna via householdVerdicts, aldrig ur egna summeringar här.

const VOTE_OPTIONS: { vote: HouseholdVote; label: string }[] = [
  { vote: 'ok', label: 'Ok med paus' },
  { vote: 'keep', label: 'Behåll' },
  { vote: 'wait', label: 'Vänta, jag ska se något' },
];

const VOTE_LABEL: Record<HouseholdVote, string> = {
  ok: 'Ok med paus',
  keep: 'Behåll',
  wait: 'Väntar, ska se något',
};

const COUNT_WORD: Record<number, string> = { 2: 'två', 3: 'tre', 4: 'fyra' };

function monthSentence(v: Exclude<HouseholdMonthVerdict, { kind: 'fine' }>): string {
  if (v.kind === 'pause') {
    return `Inget nytt på väg på ${v.row.name} enligt era bevakningar i appen. Pausa och spara ${formatKr(v.savingKr)} kr/mån.`;
  }
  return `Ni betalar ${v.row.name} ${COUNT_WORD[v.payers] ?? v.payers} gånger. Behåll ett abonnemang och spara ${formatKr(v.savingKr)} kr/mån.`;
}

function VerdictPill({ verdict }: { verdict: HouseholdServiceVerdict }) {
  switch (verdict.kind) {
    case 'pause':
      return <span className={badgeClass('acc')}>Pausa</span>;
    case 'double':
      return <span className={badgeClass('acc')}>Betalas dubbelt</span>;
    case 'keep':
      return <span className={badgeClass('success')}>Behåll</span>;
  }
}

function MonthCard({ verdict }: { verdict: HouseholdMonthVerdict }) {
  return (
    <section className={cardClass('px-4 py-4 mb-3.5')} aria-labelledby="household-month-q">
      <Eyebrow as="h2" size="xs" id="household-month-q">Hushållet den här månaden</Eyebrow>
      <p className="text-xl font-semibold text-ink mt-1.5">
        {verdict.kind === 'fine' ? 'Allt ser rimligt ut.' : monthSentence(verdict)}
      </p>
    </section>
  );
}

interface ServiceRowProps {
  row: HouseholdProviderRow;
  verdict: HouseholdServiceVerdict;
  soon: ReturnType<typeof soonLine>;
  voters: { uid: string; vote: HouseholdVote }[];
  summaryLine: string | null;
  allOk: boolean;
  myVote: HouseholdVote | undefined;
  myUid: string | null;
  names: Record<string, string>;
  pending: boolean;
  needsReshare: boolean;
  onVote: (providerId: number, vote: HouseholdVote | null) => void;
}

function ServiceRow({ row, verdict, soon, voters, summaryLine, allOk, myVote, myUid, names, pending, needsReshare, onVote }: ServiceRowProps) {
  return (
    <li className="px-3 py-2.5 border-b border-rule-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="text-base font-semibold text-ink">{row.name}</span>
          <span className="text-xs text-ink-3">
            {' '}· betalas av {row.paidByCount} · {formatKr(row.totalKr)} kr/mån
          </span>
        </div>
        <VerdictPill verdict={verdict} />
      </div>
      {soon && (
        <p className="text-xs text-ink-2 mt-1">
          {soon.n} av {soon.m} har något nytt
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Din röst om ${row.name}`}>
        {VOTE_OPTIONS.map(o => (
          <Button
            key={o.vote}
            type="button"
            size="xs"
            variant={myVote === o.vote ? 'acc' : 'ghost'}
            aria-pressed={myVote === o.vote}
            disabled={pending || needsReshare}
            onClick={() => onVote(row.providerId, myVote === o.vote ? null : o.vote)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {needsReshare && (
        <p className="text-xs text-ink-3 mt-1">Dela igen under den nya texten (se ovan) för att kunna rösta.</p>
      )}

      {voters.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-2 list-none p-0">
          {voters.map(v => (
            <li key={v.uid}>
              <span className="font-semibold text-ink">
                {names[v.uid] ?? 'Medlem'}{v.uid === myUid ? ' (du)' : ''}
              </span>
              {': '}{VOTE_LABEL[v.vote]}
            </li>
          ))}
        </ul>
      )}
      {summaryLine && <p className="text-xs text-ink-3 mt-1">{summaryLine}</p>}
      {allOk && <p className="text-xs font-semibold text-ink mt-1">Alla är överens: pausa {row.name}</p>}
    </li>
  );
}

export default function HouseholdMode({ groupId, groupName }: { groupId: string; groupName: string }) {
  const { uid } = useAuth();
  const { status, contributions, optIn, optOut, busy, ready, needsReshare, myVotes, soon, setVote } =
    useGroupHousehold(groupId);
  const names = useGroupMemberNames(groupId);
  const nowMs = useMountTime();
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [voteFailed, setVoteFailed] = useState(false);
  const showConsent = consentOpen && (status === 'gated' || (status === 'active' && needsReshare));

  const data = useMemo(() => {
    if (nowMs == null || status !== 'active') return null;
    const now = new Date(nowMs);
    const overview = aggregateHousehold(contributions, now);
    return {
      overview,
      verdict: householdMonthVerdict(overview.rows, soon),
      votes: new Map(aggregateHouseholdVotes(contributions, now).map(v => [v.providerId, v])),
    };
  }, [contributions, nowMs, soon, status]);

  const onVote = (providerId: number, vote: HouseholdVote | null) => {
    setVoteFailed(false);
    setPendingId(providerId);
    setVote(providerId, vote)
      .catch(() => setVoteFailed(true))
      .finally(() => setPendingId(null));
  };

  const sharerNames = contributions.map(c => names[c.uid] ?? 'Medlem');
  const share = () => { void optIn().then(() => setConsentOpen(false)).catch(() => {}); };

  if (status === 'loading' || (status === 'active' && !data)) {
    return (
      <div className={cardClass('px-4 py-3')}>
        <LoadingView variant="detail" label="Läser hushållet…" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={cardClass('px-4 py-3 text-xs text-danger-ink')} role="alert">
        Kunde inte läsa hushållsdatan just nu. Ladda om sidan för att försöka igen.
      </div>
    );
  }

  if (status === 'gated') {
    return (
      <section className={cardClass()} aria-labelledby="household-gated">
        <Eyebrow as="h2" size="xs" id="household-gated" className="px-3 py-1.5 border-b border-rule-2">
          Se vad hushållet sparar
        </Eyebrow>
        {showConsent ? (
          <HouseholdConsent reshare={false} busy={busy} ready={ready} onShare={share} onCancel={() => setConsentOpen(false)} />
        ) : (
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs text-ink-2 leading-relaxed">
              Dela dina kostnader med gruppen så ser ni tillsammans vilka tjänster som kan pausas
              och vilka som betalas dubbelt.
            </p>
            <p className="text-xxs text-ink-3">Bara medlemmar som själva delar ser hushållsvyn.</p>
            <Button type="button" variant="acc" size="sm" onClick={() => setConsentOpen(true)}>
              Dela mina kostnader…
            </Button>
          </div>
        )}
      </section>
    );
  }

  // status === 'active' and data is ready from here on.
  const { overview, verdict, votes } = data!;
  const sharerCount = contributions.length;

  return (
    <>
      {needsReshare && !showConsent && (
        // ADR 0026: en delare från före "nytt inom 30 dagar" räknas som okänd tills hen delar om.
        <div className={cardClass('px-3 py-2 mb-3.5 space-y-2')}>
          <p className="text-xs text-ink-2 leading-relaxed">
            Hushållet kan nu se vem som har något nytt inom 30 dagar. Du har inte delat det ännu.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConsentOpen(true)}>
            Läs och dela igen…
          </Button>
        </div>
      )}
      {showConsent && (
        <div className={cardClass('mb-3.5')}>
          <HouseholdConsent reshare busy={busy} ready={ready} onShare={share} onCancel={() => setConsentOpen(false)} />
        </div>
      )}

      <MonthCard verdict={verdict} />

      <section className={cardClass('mb-3.5')} aria-labelledby="household-services">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 border-b border-rule-2">
          <Eyebrow as="h2" size="xs" id="household-services">Tjänster</Eyebrow>
          <span className="text-xs text-ink-2">
            <span className="font-semibold text-ink">{formatKr(overview.totalKr)} kr/mån</span> tillsammans
          </span>
        </div>
        {overview.rows.length > 0 ? (
          <ul className="list-none p-0 m-0">
            {overview.rows.map(row => {
              const vr = votes.get(row.providerId);
              const summary = summarizeVotes(vr, sharerCount);
              return (
                <ServiceRow
                  key={row.providerId}
                  row={row}
                  verdict={householdServiceVerdict(row, soon)}
                  soon={soonLine(row.providerId, soon)}
                  voters={vr?.votes ?? []}
                  summaryLine={voteSummaryLine(summary)}
                  allOk={summary.allOk}
                  myVote={myVotes[row.providerId]}
                  myUid={uid}
                  names={names}
                  pending={pendingId === row.providerId}
                  needsReshare={needsReshare}
                  onVote={onVote}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-ink-3">Inga betalda tjänster delade ännu.</p>
        )}
        {voteFailed && (
          <p className="px-3 py-2 text-xs text-danger-ink border-t border-rule-2" role="alert">
            Kunde inte spara din röst. Försök igen.
          </p>
        )}
        {soon && !soon.visible && (
          <p className="px-3 py-2 text-xxs text-ink-3 border-t border-rule-2">
            Vem som har något nytt visas när minst tre i gruppen har delat det.
          </p>
        )}
        {soon?.visible && soon.unknownCount > 0 && (
          <p className="px-3 py-2 text-xxs text-ink-3 border-t border-rule-2">
            {soon.unknownCount} har inte delat det nya ännu och räknas inte som att de saknar något nytt.
          </p>
        )}
      </section>

      <section className={cardClass('px-3 py-2 mb-3.5 space-y-2')} aria-labelledby="household-sharers">
        <Eyebrow as="h2" size="xs" id="household-sharers">Vilka delar</Eyebrow>
        <p className="text-xs text-ink-2">
          {sharerNames.join(', ')}
          {Object.keys(names).length > 0 && ` · ${sharerCount} av ${Object.keys(names).length} i ${groupName}`}
        </p>
        {overview.oldestUpdatedAt != null && overview.staleCount > 0 && (
          <p className="text-xxs text-ink-3">
            {overview.staleCount} {overview.staleCount > 1 ? 'uppgifter kan vara inaktuella' : 'uppgift kan vara inaktuell'}.
          </p>
        )}
      </section>

      <section className={cardClass('px-3 py-2 mb-3.5 space-y-2')} aria-labelledby="household-own">
        <Eyebrow as="h2" size="xs" id="household-own">Din delning</Eyebrow>
        <p className="text-xs text-ink-2">Du delar dina kostnader med {groupName}. Bara medlemmar som delar ser detta.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void optOut(); }}>
            Sluta dela
          </Button>
          <Link href="/integritet/#grupper" className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
            Vad delas?
          </Link>
        </div>
      </section>
    </>
  );
}
