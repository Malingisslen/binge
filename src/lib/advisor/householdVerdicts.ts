// Household verdicts for /savings (ADR 0026): what the household as a whole should do
// with each service this month. Presentation only: every figure comes from the rows
// aggregateHousehold and aggregateHouseholdSoon already produced.

import type {
  HouseholdProviderRow,
  HouseholdSoonOverview,
  HouseholdVoteRow,
} from '@/lib/advisor/householdAggregate';

export type HouseholdServiceVerdict =
  | { kind: 'pause'; savingKr: number; reportedCount: number }
  | { kind: 'double'; savingKr: number; payers: number }
  | { kind: 'keep' };

/**
 * "Inget nytt på väg" is only provable when the count is visible (three
 * reporters or more, so with two nobody reads the other's answer) and every member
 * answered: a member who has not re-shared is unknown, and unknown is never "nothing".
 */
function nobodyHasSomethingNew(row: HouseholdProviderRow, soon: HouseholdSoonOverview | null): boolean {
  if (!soon || !soon.visible || soon.unknownCount > 0) return false;
  return (soon.soonCountByProvider[row.providerId] ?? 0) === 0;
}

/**
 * Pause outranks double: a service nobody will use is worth more to drop than to
 * deduplicate. The saving is the row's own total, so pausing a doubly paid service
 * counts both payers.
 *
 * Keeping one of n subscriptions saves (n-1)/n of the row total. The rows carry no
 * per-payer price, so that is exact when the payers pay the same and an estimate
 * when they do not.
 */
export function householdServiceVerdict(
  row: HouseholdProviderRow,
  soon: HouseholdSoonOverview | null,
): HouseholdServiceVerdict {
  if (row.paidByCount > 0 && nobodyHasSomethingNew(row, soon)) {
    return { kind: 'pause', savingKr: row.totalKr, reportedCount: soon!.reportedCount };
  }
  if (row.paidByCount >= 2) {
    return {
      kind: 'double',
      savingKr: Math.round((row.totalKr * (row.paidByCount - 1)) / row.paidByCount),
      payers: row.paidByCount,
    };
  }
  return { kind: 'keep' };
}

export type HouseholdMonthVerdict =
  | { kind: 'pause'; row: HouseholdProviderRow; savingKr: number; reportedCount: number }
  | { kind: 'double'; row: HouseholdProviderRow; savingKr: number; payers: number }
  | { kind: 'fine' };

/** The one answer for the month: the first pause (rows are sorted by cost), else the first double. */
export function householdMonthVerdict(
  rows: readonly HouseholdProviderRow[],
  soon: HouseholdSoonOverview | null,
): HouseholdMonthVerdict {
  const verdicts = rows.map(row => ({ row, verdict: householdServiceVerdict(row, soon) }));
  const pause = verdicts.find(v => v.verdict.kind === 'pause');
  if (pause && pause.verdict.kind === 'pause') {
    return { kind: 'pause', row: pause.row, savingKr: pause.verdict.savingKr, reportedCount: pause.verdict.reportedCount };
  }
  const double = verdicts.find(v => v.verdict.kind === 'double');
  if (double && double.verdict.kind === 'double') {
    return { kind: 'double', row: double.row, savingKr: double.verdict.savingKr, payers: double.verdict.payers };
  }
  return { kind: 'fine' };
}

/** "N av M har något nytt": null while the aggregate hides itself (fewer than three reporters). */
export function soonLine(
  providerId: number,
  soon: HouseholdSoonOverview | null,
): { n: number; m: number; unknownCount: number } | null {
  if (!soon || !soon.visible) return null;
  return { n: soon.soonCountByProvider[providerId] ?? 0, m: soon.reportedCount, unknownCount: soon.unknownCount };
}

export interface HouseholdVoteSummary {
  ok: number;
  keep: number;
  wait: number;
  voted: number;
  /** Members who share: everyone whose answer is asked for. */
  sharers: number;
  /** Every sharer answered ok. One sharer alone is not "överens". */
  allOk: boolean;
}

export function summarizeVotes(row: HouseholdVoteRow | undefined, sharers: number): HouseholdVoteSummary {
  const ok = row?.counts.ok ?? 0;
  const keep = row?.counts.keep ?? 0;
  const wait = row?.counts.wait ?? 0;
  return { ok, keep, wait, voted: ok + keep + wait, sharers, allOk: sharers >= 2 && ok === sharers };
}

/** One-line vote tally for a service; null when nobody has voted. */
export function voteSummaryLine(s: HouseholdVoteSummary): string | null {
  const parts: string[] = [];
  if (s.ok > 0) parts.push(`${s.ok} av ${s.sharers} är ok med paus`);
  if (s.keep > 0) parts.push(`${s.keep} vill behålla`);
  if (s.wait > 0) parts.push(`${s.wait} vill vänta`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
