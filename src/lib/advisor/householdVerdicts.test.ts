import { describe, it, expect } from 'vitest';
import {
  householdMonthVerdict,
  householdServiceVerdict,
  soonLine,
  summarizeVotes,
  voteSummaryLine,
} from './householdVerdicts';
import type { HouseholdProviderRow, HouseholdSoonOverview, HouseholdVoteRow } from './householdAggregate';

function row(over: Partial<HouseholdProviderRow> = {}): HouseholdProviderRow {
  return {
    providerId: 8, name: 'Netflix', paidByCount: 1, unknownCostCount: 0, zeroCostCount: 0,
    totalKr: 169, anyActive: true, deadWeight: false, activityUnknown: false, ...over,
  };
}

function soon(over: Partial<HouseholdSoonOverview> = {}): HouseholdSoonOverview {
  return { reportedCount: 3, unknownCount: 0, visible: true, soonCountByProvider: { 8: 1 }, ...over };
}

describe('householdServiceVerdict', () => {
  it('pauses a service where 0 of N have something new, with the row total as saving', () => {
    const v = householdServiceVerdict(row({ totalKr: 169 }), soon({ soonCountByProvider: {} }));
    expect(v).toEqual({ kind: 'pause', savingKr: 169, reportedCount: 3 });
  });

  it('never pauses on a hidden aggregate (fewer than three reporters)', () => {
    const hidden = soon({ reportedCount: 2, visible: false, soonCountByProvider: {} });
    expect(householdServiceVerdict(row(), hidden)).toEqual({ kind: 'keep' });
  });

  it('never pauses while a member has not answered: unknown is not "nothing new"', () => {
    const v = householdServiceVerdict(row(), soon({ unknownCount: 1, soonCountByProvider: {} }));
    expect(v).toEqual({ kind: 'keep' });
  });

  it('keeps a service where someone has something new', () => {
    expect(householdServiceVerdict(row(), soon({ soonCountByProvider: { 8: 2 } }))).toEqual({ kind: 'keep' });
  });

  it('does not pause a service nobody pays for', () => {
    const v = householdServiceVerdict(row({ paidByCount: 0, unknownCostCount: 1, totalKr: 0 }), soon({ soonCountByProvider: {} }));
    expect(v).toEqual({ kind: 'keep' });
  });

  it('flags a service paid by two as double and saves all but one subscription', () => {
    const v = householdServiceVerdict(row({ paidByCount: 2, totalKr: 338 }), null);
    expect(v).toEqual({ kind: 'double', savingKr: 169, payers: 2 });
  });

  it('pause outranks double and counts every payer in the saving', () => {
    const v = householdServiceVerdict(row({ paidByCount: 2, totalKr: 338 }), soon({ soonCountByProvider: {} }));
    expect(v).toEqual({ kind: 'pause', savingKr: 338, reportedCount: 3 });
  });

  it('keeps a normal service while the soon aggregate has not loaded', () => {
    expect(householdServiceVerdict(row(), null)).toEqual({ kind: 'keep' });
  });
});

describe('householdMonthVerdict', () => {
  const netflix = row({ providerId: 8, name: 'Netflix', totalKr: 169 });
  const max = row({ providerId: 384, name: 'Max', paidByCount: 2, totalKr: 258 });

  it('answers with the pause when one exists', () => {
    const v = householdMonthVerdict([max, netflix], soon({ soonCountByProvider: { 384: 1 } }));
    expect(v).toMatchObject({ kind: 'pause', savingKr: 169 });
    expect(v.kind === 'pause' && v.row.name).toBe('Netflix');
  });

  it('falls back to the double when no pause is provable', () => {
    const v = householdMonthVerdict([netflix, max], null);
    expect(v).toMatchObject({ kind: 'double', savingKr: 129, payers: 2 });
    expect(v.kind === 'double' && v.row.name).toBe('Max');
  });

  it('says it all looks reasonable otherwise', () => {
    expect(householdMonthVerdict([netflix], soon({ soonCountByProvider: { 8: 1 } }))).toEqual({ kind: 'fine' });
    expect(householdMonthVerdict([], null)).toEqual({ kind: 'fine' });
  });
});

describe('soonLine', () => {
  it('gives N of M when visible, 0 for a service nobody reported', () => {
    expect(soonLine(8, soon())).toEqual({ n: 1, m: 3, unknownCount: 0 });
    expect(soonLine(99, soon())).toEqual({ n: 0, m: 3, unknownCount: 0 });
  });

  it('is null when the aggregate is hidden or missing', () => {
    expect(soonLine(8, soon({ visible: false, soonCountByProvider: {} }))).toBeNull();
    expect(soonLine(8, null)).toBeNull();
  });
});

describe('votes', () => {
  const voteRow = (ok: number, keep: number, wait: number): HouseholdVoteRow => ({
    providerId: 8, votes: [], counts: { ok, keep, wait },
  });

  it('summarises "2 av 3 är ok med paus"', () => {
    const s = summarizeVotes(voteRow(2, 0, 0), 3);
    expect(s.allOk).toBe(false);
    expect(voteSummaryLine(s)).toBe('2 av 3 är ok med paus');
  });

  it('joins the other answers', () => {
    expect(voteSummaryLine(summarizeVotes(voteRow(1, 1, 1), 3))).toBe('1 av 3 är ok med paus · 1 vill behålla · 1 vill vänta');
  });

  it('is unanimous only when every sharer said ok, and never for one sharer alone', () => {
    expect(summarizeVotes(voteRow(3, 0, 0), 3).allOk).toBe(true);
    expect(summarizeVotes(voteRow(2, 0, 0), 3).allOk).toBe(false);
    expect(summarizeVotes(voteRow(1, 0, 0), 1).allOk).toBe(false);
  });

  it('has no line when nobody voted', () => {
    expect(voteSummaryLine(summarizeVotes(undefined, 3))).toBeNull();
  });
});
