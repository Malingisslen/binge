import { describe, it, expect } from 'vitest';
import {
  aggregateHousehold,
  buildHouseholdContribution,
  contributionContentEquals,
  HOUSEHOLD_STALE_DAYS,
  type HouseholdContribution,
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
