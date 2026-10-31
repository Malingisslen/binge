import { describe, it, expect } from 'vitest';
import {
  aggregateHousehold,
  aggregateHouseholdSoon,
  HOUSEHOLD_SOON_FRESH_DAYS,
  aggregateHouseholdVotes,
  applyHouseholdVote,
  buildHouseholdContribution,
  buildSoonProviderIds,
  composeHouseholdContribution,
  contributionContentEquals,
  currentHouseholdVotes,
  householdContributionNeedsWrite,
  householdSoonNeedsRefresh,
  HOUSEHOLD_SOON_REFRESH_DAYS,
  householdVoteMonthKey,
  isHouseholdProviderId,
  isHouseholdVote,
  sanitizeSoonProviderIds,
  sanitizeVotes,
  sanitizeVotesMonth,
  HOUSEHOLD_SOON_MIN_REPORTERS,
  HOUSEHOLD_STALE_DAYS,
  type HouseholdContribution,
  type HouseholdContributionContent,
} from './householdAggregate';

// Catalog facts used (see providers.ts): Netflix 8 (default 169, premium 219),
// SkyShowtime 431 (default 109, alias 531 = defunct Paramount+), TV4 Play 489
// (alias 1944), SVT Play 520 (free, 0), TriArt 578 (rent — no monthly cost).
const NOW = new Date(2026, 6, 5); // 2026-07-05 local
const DAY = 86_400_000;
const FRESH = NOW.getTime() - 1 * DAY;
const STALE = NOW.getTime() - (HOUSEHOLD_STALE_DAYS + 10) * DAY;

function contrib(over: Partial<HouseholdContribution> & { uid: string }): HouseholdContribution {
  return {
    providerIds: [],
    providerCosts: {},
    providerCampaigns: {},
    activeProviderIds: [],
    updatedAt: FRESH,
    ...over,
  };
}

describe('aggregateHousehold (BIN-184)', () => {
  it('merges alias ids across members onto ONE canonical row (531 + 431 → SkyShowtime ×2)', () => {
    const a = contrib({ uid: 'a', providerIds: [531], providerCosts: { 531: 109 } }); // legacy Paramount+ key
    const b = contrib({ uid: 'b', providerIds: [431], providerCosts: { 431: 109 } });
    const out = aggregateHousehold([a, b], NOW);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].providerId).toBe(431);
    expect(out.rows[0].name).toBe('SkyShowtime');
    expect(out.rows[0].paidByCount).toBe(2); // "betalas av 2 av er"
    expect(out.rows[0].totalKr).toBe(218);   // duplicates deliberately add up
    expect(out.totalKr).toBe(218);
  });

  it('never coerces an unknown cost to 0 — excluded from totalKr, surfaced as unknown', () => {
    const a = contrib({ uid: 'a', providerIds: [8], providerCosts: { 8: 169 } });
    const b = contrib({ uid: 'b', providerIds: [8] }); // shares Netflix, cost unresolvable
    const out = aggregateHousehold([a, b], NOW);
    expect(out.rows[0].paidByCount).toBe(1);
    expect(out.rows[0].unknownCostCount).toBe(1);
    expect(out.rows[0].totalKr).toBe(169); // NOT 169 + 0-fabrication
    expect(out.unknownCostCount).toBe(1);
  });

  it('free services (0 kr) are not spend rows and never dead-weight', () => {
    const a = contrib({ uid: 'a', providerIds: [520, 8], providerCosts: { 520: 0, 8: 169 } });
    const out = aggregateHousehold([a], NOW);
    expect(out.rows.map(r => r.providerId)).toEqual([8]); // SVT filtered out entirely
    expect(out.deadWeight.every(r => r.providerId !== 520)).toBe(true);
  });

  it('surfaces free/zeroed members on a paid row via zeroCostCount (BIN-514)', () => {
    const a = contrib({ uid: 'a', providerIds: [8], providerCosts: { 8: 169 } }); // pays
    const b = contrib({ uid: 'b', providerIds: [8], providerCosts: { 8: 0 } });   // free/zeroed
    const out = aggregateHousehold([a, b], NOW);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].paidByCount).toBe(1);
    expect(out.rows[0].zeroCostCount).toBe(1);
    expect(out.rows[0].totalKr).toBe(169); // the 0-cost member adds no spend
  });

  it('resolves campaigns with the SINGLE injected now — a stale doc still auto-reverts a lapsed promo', () => {
    const a = contrib({
      uid: 'a',
      providerIds: [8],
      providerCosts: { 8: 169 },
      providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } },
      updatedAt: STALE, // doc is old — the PRICE must still track `now`, not updatedAt
    });
    expect(aggregateHousehold([a], NOW).totalKr).toBe(29); // promo active at NOW
    const afterLapse = new Date(2026, 9, 2); // 2026-10-02
    expect(aggregateHousehold([a], afterLapse).totalKr).toBe(169); // reverted
  });

  it('dead-weight requires ALL contributions fresh — stale evidence never convicts', () => {
    const payer = contrib({ uid: 'a', providerIds: [8], providerCosts: { 8: 169 }, activeProviderIds: [] });
    const staleMember = contrib({ uid: 'b', updatedAt: STALE });
    const withStale = aggregateHousehold([payer, staleMember], NOW);
    expect(withStale.rows[0].deadWeight).toBe(false);      // b could be the unseen watcher
    expect(withStale.rows[0].activityUnknown).toBe(true);
    expect(withStale.staleCount).toBe(1);

    const freshMember = contrib({ uid: 'b' });
    const allFresh = aggregateHousehold([payer, freshMember], NOW);
    expect(allFresh.rows[0].deadWeight).toBe(true);        // honest verdict now
    expect(allFresh.rows[0].activityUnknown).toBe(false);
    expect(allFresh.deadWeight.map(r => r.providerId)).toEqual([8]);
  });

  it("a fresh NON-payer's activity clears the payer's row (family viewing), aliases included", () => {
    const payer = contrib({ uid: 'a', providerIds: [489], providerCosts: { 489: 169 }, activeProviderIds: [] });
    const watcher = contrib({ uid: 'b', activeProviderIds: [1944] }); // TV4 via alias id
    const out = aggregateHousehold([payer, watcher], NOW);
    expect(out.rows[0].anyActive).toBe(true);
    expect(out.rows[0].deadWeight).toBe(false);
  });

  it("a STALE member's activity is not positive evidence", () => {
    const payer = contrib({ uid: 'a', providerIds: [8], providerCosts: { 8: 169 }, activeProviderIds: [] });
    const staleWatcher = contrib({ uid: 'b', activeProviderIds: [8], updatedAt: STALE });
    const out = aggregateHousehold([payer, staleWatcher], NOW);
    expect(out.rows[0].anyActive).toBe(false);       // stale activity doesn't count...
    expect(out.rows[0].deadWeight).toBe(false);      // ...but staleness also blocks the verdict
    expect(out.rows[0].activityUnknown).toBe(true);
  });

  it('handles empty input without crashing', () => {
    const out = aggregateHousehold([], NOW);
    expect(out).toMatchObject({ memberCount: 0, staleCount: 0, totalKr: 0, unknownCostCount: 0, oldestUpdatedAt: null });
    expect(out.rows).toEqual([]);
    expect(out.deadWeight).toEqual([]);
  });

  it('an uncatalogued provider id with a known custom cost gets a fallback name, no throw', () => {
    const a = contrib({ uid: 'a', providerIds: [999999], providerCosts: { 999999: 49 } });
    const out = aggregateHousehold([a], NOW);
    expect(out.rows[0].name).toBe('Tjänst 999999');
    expect(out.rows[0].totalKr).toBe(49);
  });

  it('pins the staleness boundary: exactly 30 days is FRESH, a moment older is STALE (<= vs <)', () => {
    const atBoundary = contrib({
      uid: 'a',
      providerIds: [8],
      providerCosts: { 8: 169 },
      updatedAt: NOW.getTime() - HOUSEHOLD_STALE_DAYS * DAY, // exakt på gränsen
    });
    const fresh = aggregateHousehold([atBoundary], NOW);
    expect(fresh.staleCount).toBe(0);
    expect(fresh.rows[0].deadWeight).toBe(true); // färskt underlag → ärlig dom tillåten

    const justPast = contrib({
      uid: 'a',
      providerIds: [8],
      providerCosts: { 8: 169 },
      updatedAt: NOW.getTime() - HOUSEHOLD_STALE_DAYS * DAY - 1, // 1 ms äldre
    });
    const stale = aggregateHousehold([justPast], NOW);
    expect(stale.staleCount).toBe(1);
    expect(stale.rows[0].deadWeight).toBe(false);
    expect(stale.rows[0].activityUnknown).toBe(true);
  });

  it('tracks the oldest updatedAt for the honesty stamp', () => {
    const out = aggregateHousehold(
      [contrib({ uid: 'a', updatedAt: FRESH }), contrib({ uid: 'b', updatedAt: STALE })],
      NOW,
    );
    expect(out.oldestUpdatedAt).toBe(STALE);
  });

  it('exposes no savings/sharing-suggestion field (ADR 0010 boundary)', () => {
    const out = aggregateHousehold([contrib({ uid: 'a', providerIds: [8], providerCosts: { 8: 169 } })], NOW);
    const keys = [...Object.keys(out), ...Object.keys(out.rows[0])].map(k => k.toLowerCase());
    expect(keys.some(k => k.includes('saving') || k.includes('shar'))).toBe(false);
  });
});

describe('buildHouseholdContribution (BIN-184 write side)', () => {
  it('resolves a chosen tier to a plain kr figure — the tier NAME never enters the payload', () => {
    const c = buildHouseholdContribution([8], {}, { 8: 'premium' }, {}, []);
    expect(c.providerCosts[8]).toBe(219); // Netflix Premium resolved at write
    expect(JSON.stringify(c)).not.toContain('premium'); // minimization: no tier names
  });

  it('omits providers whose ordinary cost is unresolvable (readers see unknown, not 0)', () => {
    const c = buildHouseholdContribution([578], {}, {}, {}, []); // TriArt = rent-type, no monthly cost
    expect(c.providerIds).toEqual([578]);
    expect(c.providerCosts[578]).toBeUndefined();
  });

  it('canonicalises ids and copies campaigns raw, only for shared providers', () => {
    const c = buildHouseholdContribution(
      [1944, 489], // alias + canonical → one id
      {},
      {},
      { 489: { monthlyCost: 49, endDate: '2026-09-01' }, 8: { monthlyCost: 29, endDate: '2026-09-01' } },
      [],
    );
    expect(c.providerIds).toEqual([489]);
    expect(c.providerCampaigns[489]).toEqual({ monthlyCost: 49, endDate: '2026-09-01' });
    expect(c.providerCampaigns[8]).toBeUndefined(); // Netflix not shared → campaign not copied
  });

  it('derives activeProviderIds from vill_se/mina backlog only, canonicalised', () => {
    const items = [
      { status: 'mina', providers: [1944] },       // TV4 via alias
      { status: 'sedd', providers: [8] },          // watched — not backlog
      { status: 'vill_se', providers: [431, 531] }, // canonical + alias of same service
    ] as const;
    const c = buildHouseholdContribution([], {}, {}, {}, items as never);
    expect(c.activeProviderIds).toEqual([431, 489]);
  });

  // BIN-814. The household dead-weight verdict says "nobody here has backlog on X".
  // A title someone could RENT on X is not backlog on X — and the broad `providers`
  // array cannot express that, because Viaplay (76) and TV4 Play (489) are returned
  // under rent/buy while both are typed flatrate.
  it('a rent-only title does NOT shield a service from the dead-weight verdict', () => {
    const items = [
      { status: 'vill_se', providers: [76], subscriptionProviders: [] },
    ] as const;
    const c = buildHouseholdContribution([], {}, {}, {}, items as never);
    expect(c.activeProviderIds).toEqual([]);
  });

  it('a title marked Privat never reaches activeProviderIds; an unmarked or friends title does', () => {
    const items = [
      { status: 'mina', providers: [8], visibility: 'private' },
      { status: 'mina', providers: [337], visibility: 'friends' },
      { status: 'mina', providers: [384], visibility: null },
    ];
    const c = buildHouseholdContribution([], {}, {}, {}, items as never);
    expect(c.activeProviderIds).toEqual([337, 384]);
  });

  it('the same title included in the subscription still counts as backlog', () => {
    const items = [
      { status: 'vill_se', providers: [76], subscriptionProviders: [76] },
    ] as const;
    const c = buildHouseholdContribution([], {}, {}, {}, items as never);
    expect(c.activeProviderIds).toEqual([76]);
  });

  it('a row written before the split (null) still counts, via the broad fallback', () => {
    const items = [
      { status: 'vill_se', providers: [1944], subscriptionProviders: null },
    ] as const;
    const c = buildHouseholdContribution([], {}, {}, {}, items as never);
    expect(c.activeProviderIds).toEqual([489]); // still canonicalised
  });
});

describe('contributionContentEquals (dirty-check)', () => {
  const base = buildHouseholdContribution([8], { 8: 169 }, {}, { 8: { monthlyCost: 29, endDate: '2026-10-01' } }, []);

  it('is order-insensitive and equal for identical content', () => {
    const same = { ...base, providerIds: [...base.providerIds].reverse() };
    expect(contributionContentEquals(base, same)).toBe(true);
  });

  it('detects a cost change, a campaign endDate change, and an activity change', () => {
    expect(contributionContentEquals(base, { ...base, providerCosts: { 8: 179 } })).toBe(false);
    expect(contributionContentEquals(base, { ...base, providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-11-01' } } })).toBe(false);
    expect(contributionContentEquals(base, { ...base, activeProviderIds: [8] })).toBe(false);
  });
});

// ── ADR 0026: röster, "nytt inom 30 dagar" och månadsnyckeln ─────────────────

describe('householdVoteMonthKey — månaden vänder vid midnatt i Stockholm, inte UTC', () => {
  it('vintertid: 31 jan 23:30 UTC är redan februari i Stockholm (UTC+1)', () => {
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 0, 31, 23, 30)))).toBe('2026-02');
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 0, 31, 22, 59)))).toBe('2026-01');
  });

  it('sommartid: 30 jun 22:00 UTC är juli i Stockholm (UTC+2), 21:59 UTC är fortfarande juni', () => {
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 5, 30, 22, 0)))).toBe('2026-07');
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 5, 30, 21, 59)))).toBe('2026-06');
  });

  it('nyår: 31 dec 23:00 UTC är januari nästa år', () => {
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 11, 31, 23, 0)))).toBe('2027-01');
  });

  it('ger alltid formen YYYY-MM som reglerna kräver', () => {
    expect(householdVoteMonthKey(new Date(Date.UTC(2026, 2, 5)))).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('validering av röstvärden och provider-id', () => {
  it('godtar exakt ok, keep och wait', () => {
    expect(['ok', 'keep', 'wait'].every(isHouseholdVote)).toBe(true);
    for (const bad of ['OK', 'nej', '', null, undefined, 1, {}]) expect(isHouseholdVote(bad)).toBe(false);
  });

  it('godtar bara positiva heltal som provider-id', () => {
    expect(isHouseholdProviderId(8)).toBe(true);
    for (const bad of [0, -8, 8.5, NaN, '8', null]) expect(isHouseholdProviderId(bad)).toBe(false);
  });
});

describe('läs-sidans sanering — okänt = ingen röst, saknat soon = okänt', () => {
  it('sanitizeVotes behåller giltiga poster och släpper okända värden och nycklar', () => {
    expect(sanitizeVotes({ 8: 'ok', 337: 'säg upp', abc: 'keep', '8.5': 'wait', '-1': 'ok', 384: 'wait' }))
      .toEqual({ 8: 'ok', 384: 'wait' });
  });

  it('sanitizeVotes ger undefined för ett gammalt dokument utan fältet och för fel typ', () => {
    expect(sanitizeVotes(undefined)).toBeUndefined();
    expect(sanitizeVotes(['ok'])).toBeUndefined();
    expect(sanitizeVotes('ok')).toBeUndefined();
  });

  it('sanitizeSoonProviderIds: saknat fält förblir undefined, en tom lista är ett svar', () => {
    expect(sanitizeSoonProviderIds(undefined)).toBeUndefined();
    expect(sanitizeSoonProviderIds([])).toEqual([]);
    expect(sanitizeSoonProviderIds([8, 'Netflix', 1.5, 337])).toEqual([8, 337]);
  });

  it('sanitizeVotesMonth kräver YYYY-MM', () => {
    expect(sanitizeVotesMonth('2026-10')).toBe('2026-10');
    expect(sanitizeVotesMonth('2026-1')).toBeUndefined();
    expect(sanitizeVotesMonth('oktober')).toBeUndefined();
    expect(sanitizeVotesMonth(202610)).toBeUndefined();
  });

  it('currentHouseholdVotes ignorerar röster från en tidigare månad', () => {
    const c = { votes: { 8: 'ok' as const }, votesMonth: '2026-09' };
    expect(currentHouseholdVotes(c, '2026-10').size).toBe(0);
    expect(currentHouseholdVotes(c, '2026-09').get(8)).toBe('ok');
  });

  it('currentHouseholdVotes tål ett okänt värde som ändå nått minnet', () => {
    const c = { votes: { 8: 'ok', 337: 'nej' } as never, votesMonth: '2026-10' };
    expect([...currentHouseholdVotes(c, '2026-10')]).toEqual([[8, 'ok']]);
  });

  it('currentHouseholdVotes kanoniserar alias-nycklar (531 → 431)', () => {
    const c = { votes: { 531: 'wait' as const }, votesMonth: '2026-10' };
    expect(currentHouseholdVotes(c, '2026-10').get(431)).toBe('wait');
  });
});

describe('buildSoonProviderIds — nytt inom 30 dagar ur lagrade nextAirDate', () => {
  const TODAY = new Date(2026, 9, 31, 15); // 2026-10-31 lokal tid

  it('tar med backlog-titlar med nästa avsnitt i dag till och med dag 30, inget utanför', () => {
    const items = [
      { status: 'mina', providers: [8], nextAirDate: '2026-10-31' },     // i dag
      { status: 'vill_se', providers: [337], nextAirDate: '2026-11-30' }, // dag 30
      { status: 'mina', providers: [384], nextAirDate: '2026-12-01' },    // dag 31
      { status: 'mina', providers: [9], nextAirDate: '2026-10-30' },      // i går
    ];
    expect(buildSoonProviderIds(items as never, TODAY)).toEqual([8, 337]);
  });

  it('räknar inte titlar som är markerade Privat', () => {
    const items = [
      { status: 'mina', providers: [8], nextAirDate: '2026-11-05', visibility: 'private' },
      { status: 'mina', providers: [337], nextAirDate: '2026-11-05', visibility: null },
    ];
    expect(buildSoonProviderIds(items as never, TODAY)).toEqual([337]);
  });

  it('räknar inte sedda, avbrutna eller titlar utan datum', () => {
    const items = [
      { status: 'sedd', providers: [8], nextAirDate: '2026-11-05' },
      { status: 'mina', providers: [337], nextAirDate: '2026-11-05', dropped: true },
      { status: 'mina', providers: [384], nextAirDate: null },
      { status: 'mina', providers: [9] },
    ];
    expect(buildSoonProviderIds(items as never, TODAY)).toEqual([]);
  });

  it('använder abonnemangsdelen och kanoniserar (hyrtitel räknas inte, alias slås ihop)', () => {
    const items = [
      { status: 'mina', providers: [76], subscriptionProviders: [], nextAirDate: '2026-11-02' },
      { status: 'mina', providers: [1944], subscriptionProviders: null, nextAirDate: '2026-11-02' },
    ];
    expect(buildSoonProviderIds(items as never, TODAY)).toEqual([489]);
  });

  it('bär bara provider-id, aldrig titel eller datum', () => {
    const items = [{ status: 'mina', providers: [8], nextAirDate: '2026-11-02', title: 'Hemlig serie' }];
    const out = buildSoonProviderIds(items as never, TODAY);
    expect(out).toEqual([8]);
    expect(JSON.stringify(out)).not.toContain('2026');
  });
});

describe('composeHouseholdContribution — soon bara efter aktiv omdelning, röster bara denna månad', () => {
  const base = buildHouseholdContribution([8], { 8: 169 }, {}, {}, []);
  const MONTH = '2026-10';

  it('ett gammalt bidrag utan soon-fältet får inget soon-fält vid en vanlig omskrivning', () => {
    const out = composeHouseholdContribution(base, { }, { monthKey: MONTH, soon: [8] });
    expect('soonProviderIds' in out).toBe(false);
  });

  it('Dela i samtyckesvyn (optInSoon) skriver soon-fältet, även för en helt ny delare', () => {
    expect(composeHouseholdContribution(base, undefined, { monthKey: MONTH, soon: [8], optInSoon: true }).soonProviderIds).toEqual([8]);
    expect(composeHouseholdContribution(base, undefined, { monthKey: MONTH, soon: [], optInSoon: true }).soonProviderIds).toEqual([]);
  });

  it('den som redan delat om får färskt soon-värde; utan färskt värde behålls det gamla', () => {
    expect(composeHouseholdContribution(base, { soonProviderIds: [337] }, { monthKey: MONTH, soon: [8] }).soonProviderIds).toEqual([8]);
    expect(composeHouseholdContribution(base, { soonProviderIds: [337] }, { monthKey: MONTH, soon: null }).soonProviderIds).toEqual([337]);
  });

  it('månadens röster följer med; röster från förra månaden släpps', () => {
    const kept = composeHouseholdContribution(base, { votes: { 8: 'keep' }, votesMonth: MONTH }, { monthKey: MONTH, soon: null });
    expect(kept.votes).toEqual({ 8: 'keep' });
    expect(kept.votesMonth).toBe(MONTH);
    const dropped = composeHouseholdContribution(base, { votes: { 8: 'keep' }, votesMonth: '2026-09' }, { monthKey: MONTH, soon: null });
    expect('votes' in dropped).toBe(false);
    expect('votesMonth' in dropped).toBe(false);
  });

  it('ett bidrag skrivs utan votes när ingen röstat', () => {
    const out = composeHouseholdContribution(base, undefined, { monthKey: MONTH, soon: [8], optInSoon: true });
    expect('votes' in out).toBe(false);
  });
});

describe('applyHouseholdVote — validerar före skrivning', () => {
  const base: HouseholdContributionContent = buildHouseholdContribution([8], { 8: 169 }, {}, {}, []);
  const MONTH = '2026-10';

  it('sätter en röst med innevarande månad', () => {
    expect(applyHouseholdVote(base, MONTH, 8, 'wait')).toMatchObject({ votes: { 8: 'wait' }, votesMonth: MONTH });
  });

  it('ett ogiltigt röstvärde eller provider-id ger null — inget skrivs', () => {
    expect(applyHouseholdVote(base, MONTH, 8, 'nej' as never)).toBeNull();
    expect(applyHouseholdVote(base, MONTH, 8.5, 'ok')).toBeNull();
    expect(applyHouseholdVote(base, MONTH, -1, 'ok')).toBeNull();
  });

  it('null tar bort rösten; den sista borttagna rösten tar bort både votes och votesMonth', () => {
    const one = applyHouseholdVote(base, MONTH, 8, 'ok')!;
    const two = applyHouseholdVote(one, MONTH, 337, 'keep')!;
    expect(applyHouseholdVote(two, MONTH, 8, null)!.votes).toEqual({ 337: 'keep' });
    const none = applyHouseholdVote(one, MONTH, 8, null)!;
    expect('votes' in none).toBe(false);
    expect('votesMonth' in none).toBe(false);
  });

  it('en röst i en ny månad börjar om från noll (förra månadens röster följer inte med)', () => {
    const sept = applyHouseholdVote(base, '2026-09', 8, 'ok')!;
    expect(applyHouseholdVote(sept, MONTH, 337, 'wait')!.votes).toEqual({ 337: 'wait' });
  });

  it('kanoniserar alias-id (531 → 431)', () => {
    expect(applyHouseholdVote(base, MONTH, 531, 'ok')!.votes).toEqual({ 431: 'ok' });
  });

  it('behåller de övriga fälten orörda', () => {
    const out = applyHouseholdVote({ ...base, soonProviderIds: [8] }, MONTH, 8, 'ok')!;
    expect(out.providerCosts).toEqual(base.providerCosts);
    expect(out.soonProviderIds).toEqual([8]);
  });
});

describe('dirty-check med soon och röster', () => {
  const base = buildHouseholdContribution([8], { 8: 169 }, {}, {}, []);
  const MONTH = '2026-10';
  const stored = (over: Partial<HouseholdContribution>): HouseholdContribution => ({ uid: 'me', updatedAt: FRESH, ...base, ...over });

  it('contributionContentEquals skiljer saknat soon från en tom lista, och upptäcker en ändrad lista', () => {
    expect(contributionContentEquals(base, { ...base, soonProviderIds: [] })).toBe(false);
    expect(contributionContentEquals({ ...base, soonProviderIds: [8, 337] }, { ...base, soonProviderIds: [337, 8] })).toBe(true);
    expect(contributionContentEquals({ ...base, soonProviderIds: [8] }, { ...base, soonProviderIds: [337] })).toBe(false);
  });

  it('contributionContentEquals upptäcker en ändrad röst och en ändrad månad', () => {
    const a = { ...base, votes: { 8: 'ok' as const }, votesMonth: MONTH };
    expect(contributionContentEquals(a, { ...a })).toBe(true);
    expect(contributionContentEquals(a, { ...a, votes: { 8: 'keep' as const } })).toBe(false);
    expect(contributionContentEquals(a, { ...a, votesMonth: '2026-09' })).toBe(false);
    expect(contributionContentEquals(a, base)).toBe(false);
  });

  it('oförändrat innehåll ger ingen skrivning, även med röster och soon', () => {
    const existing = stored({ soonProviderIds: [8], votes: { 8: 'ok' }, votesMonth: MONTH });
    const next = composeHouseholdContribution(base, existing, { monthKey: MONTH, soon: [8] });
    expect(householdContributionNeedsWrite(next, existing, MONTH)).toBe(false);
  });

  it('att förra månadens röster faller bort kostar ingen skrivning på egen hand', () => {
    const existing = stored({ votes: { 8: 'ok' }, votesMonth: '2026-09' });
    const next = composeHouseholdContribution(base, existing, { monthKey: MONTH, soon: null });
    expect(householdContributionNeedsWrite(next, existing, MONTH)).toBe(false);
  });

  it('ett ändrat soon-värde eller en ny röst ger en skrivning', () => {
    const existing = stored({ soonProviderIds: [8] });
    expect(householdContributionNeedsWrite(composeHouseholdContribution(base, existing, { monthKey: MONTH, soon: [] }), existing, MONTH)).toBe(true);
    const voted = applyHouseholdVote(composeHouseholdContribution(base, existing, { monthKey: MONTH, soon: [8] }), MONTH, 8, 'keep')!;
    expect(householdContributionNeedsWrite(voted, existing, MONTH)).toBe(true);
  });

  it('ett gammalt dokument utan nya fält ger ingen skrivning när inget ändrats', () => {
    const existing = stored({});
    const next = composeHouseholdContribution(base, existing, { monthKey: MONTH, soon: [8] });
    expect(householdContributionNeedsWrite(next, existing, MONTH)).toBe(false);
  });
});

describe('aggregateHouseholdSoon — "N av M", dolt under tre', () => {
  const withSoon = (uid: string, soon: number[] | undefined, updatedAt: number | null = FRESH) =>
    contrib({ uid, soonProviderIds: soon, updatedAt });

  it(`visar N av M när minst ${HOUSEHOLD_SOON_MIN_REPORTERS} färska medlemmar delat flaggan`, () => {
    const out = aggregateHouseholdSoon([withSoon('a', [8]), withSoon('b', [8, 337]), withSoon('c', [])], NOW);
    expect(out.visible).toBe(true);
    expect(out.reportedCount).toBe(3);
    expect(out.soonCountByProvider).toEqual({ 8: 2, 337: 1 });
  });

  it('döljer siffrorna när bara två delat flaggan (M=2 avslöjar den andra)', () => {
    const out = aggregateHouseholdSoon([withSoon('a', [8]), withSoon('b', [])], NOW);
    expect(out.visible).toBe(false);
    expect(out.reportedCount).toBe(2);
    expect(out.soonCountByProvider).toEqual({});
  });

  it('en flagga äldre än en vecka är okänd, en på gränsen räknas (30 dagars kostnadsfärskhet räcker inte)', () => {
    const DAY = 86_400_000;
    const edge = NOW.getTime() - HOUSEHOLD_SOON_FRESH_DAYS * DAY;
    const out = aggregateHouseholdSoon(
      [withSoon('a', [8], edge), withSoon('b', [], edge), withSoon('c', [], edge), withSoon('d', [], edge - 1)],
      NOW,
    );
    expect(out.reportedCount).toBe(3);
    expect(out.unknownCount).toBe(1);
  });

  it('en delare utan fältet (gammalt dokument) räknas som okänd, aldrig som "inget nytt"', () => {
    const out = aggregateHouseholdSoon([withSoon('a', [8]), withSoon('b', []), withSoon('c', undefined)], NOW);
    expect(out.reportedCount).toBe(2);
    expect(out.unknownCount).toBe(1);
    expect(out.visible).toBe(false);
  });

  it('ett för gammalt bidrag räknas som okänt', () => {
    const out = aggregateHouseholdSoon([withSoon('a', [8]), withSoon('b', [8]), withSoon('c', [], STALE)], NOW);
    expect(out.reportedCount).toBe(2);
    expect(out.unknownCount).toBe(1);
  });

  it('räknar en medlem en gång per tjänst även med alias och dubbletter, och släpper skräp', () => {
    const out = aggregateHouseholdSoon(
      [withSoon('a', [431, 531, 431]), withSoon('b', [1.5 as number]), withSoon('c', [])],
      NOW,
    );
    expect(out.soonCountByProvider).toEqual({ 431: 1 });
  });

  it('tom indata ger dolt aggregat', () => {
    expect(aggregateHouseholdSoon([], NOW)).toEqual({ reportedCount: 0, unknownCount: 0, visible: false, soonCountByProvider: {} });
  });
});

describe('aggregateHouseholdVotes — röster per tjänst med uid-plats för namnet', () => {
  const OCT = new Date(Date.UTC(2026, 9, 15, 12));

  it('grupperar månadens röster per tjänst, väljare sorterade på uid', () => {
    const rows = aggregateHouseholdVotes([
      contrib({ uid: 'b', votes: { 8: 'keep', 337: 'wait' }, votesMonth: '2026-10' }),
      contrib({ uid: 'a', votes: { 8: 'ok' }, votesMonth: '2026-10' }),
    ], OCT);
    expect(rows).toEqual([
      { providerId: 8, votes: [{ uid: 'a', vote: 'ok' }, { uid: 'b', vote: 'keep' }], counts: { ok: 1, keep: 1, wait: 0 } },
      { providerId: 337, votes: [{ uid: 'b', vote: 'wait' }], counts: { ok: 0, keep: 0, wait: 1 } },
    ]);
  });

  it('ignorerar röster från förra månaden', () => {
    const rows = aggregateHouseholdVotes([contrib({ uid: 'a', votes: { 8: 'ok' }, votesMonth: '2026-09' })], OCT);
    expect(rows).toEqual([]);
  });

  it('månadsskiftet följer Stockholm: en oktoberröst gäller inte 31 okt 23:30 UTC (redan november)', () => {
    const c = contrib({ uid: 'a', votes: { 8: 'ok' }, votesMonth: '2026-10' });
    expect(aggregateHouseholdVotes([c], new Date(Date.UTC(2026, 9, 31, 22, 59)))).toHaveLength(1);
    expect(aggregateHouseholdVotes([c], new Date(Date.UTC(2026, 9, 31, 23, 30)))).toEqual([]);
  });

  it('okända värden och nycklar är ingen röst', () => {
    const rows = aggregateHouseholdVotes([
      contrib({ uid: 'a', votes: { 8: 'säg upp', abc: 'ok' } as never, votesMonth: '2026-10' }),
    ], OCT);
    expect(rows).toEqual([]);
  });

  it('gamla dokument utan röstfält ger inga rader och kraschar inte', () => {
    expect(aggregateHouseholdVotes([contrib({ uid: 'a' }), contrib({ uid: 'b' })], OCT)).toEqual([]);
  });

  it('bär inget namn — bara uid', () => {
    const rows = aggregateHouseholdVotes([contrib({ uid: 'a', votes: { 8: 'ok' }, votesMonth: '2026-10' })], OCT);
    expect(Object.keys(rows[0].votes[0]).sort()).toEqual(['uid', 'vote']);
  });
});

describe('householdSoonNeedsRefresh — en delad soon-flagga äldre än gränsen skrivs om vid besök', () => {
  const limitMs = HOUSEHOLD_SOON_REFRESH_DAYS * DAY;
  const now = NOW.getTime();

  it('exakt på gränsen är den fortfarande färsk', () => {
    expect(householdSoonNeedsRefresh({ soonProviderIds: [8], updatedAt: now - limitMs }, now)).toBe(false);
  });

  it('1 ms över gränsen behöver omskrivning', () => {
    expect(householdSoonNeedsRefresh({ soonProviderIds: [8], updatedAt: now - limitMs - 1 }, now)).toBe(true);
  });

  it('en delare från före fältet (soonProviderIds undefined) är aldrig kandidat, hur gammal raden än är', () => {
    expect(householdSoonNeedsRefresh({ soonProviderIds: undefined, updatedAt: now - 100 * DAY }, now)).toBe(false);
  });

  it('en tom lista är ett svar, inte "okänt": gammal tom flagga behöver omskrivning', () => {
    expect(householdSoonNeedsRefresh({ soonProviderIds: [], updatedAt: now - limitMs - 1 }, now)).toBe(true);
  });

  it('updatedAt null med fältet satt räknas som ofärskt', () => {
    expect(householdSoonNeedsRefresh({ soonProviderIds: [8], updatedAt: null }, now)).toBe(true);
  });
});
