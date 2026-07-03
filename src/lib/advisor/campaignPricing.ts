// BIN-396 — kampanjpris med auto-återgång. A user on a promo ("29 kr t.o.m.
// 2026-10-01, sedan 149 kr") can only enter the campaign price as a static "own
// cost" today — which ROTS: after the promo the app still shows 29 kr and the
// advisor says "billig, behåll" right as the price quintuples, undermining the
// wedge "Binge vet vad du betalar". This pure module fixes the math: the campaign
// price applies through its (inclusive) end date, then AUTO-REVERTS to the
// ordinary resolved price — no manual cleanup — plus a pre-expiry nudge.
//
// The advisor-wiring, user-data persistence, and UI are a DEFERRED follow-up. That
// follow-up MUST store the raw campaign input (cost + endDate), never a
// pre-resolved effectiveMonthlyCost snapshot — caching the resolved value at
// write time would reintroduce the exact staleness bug this module removes.
//
// Honesty rules (role #28, folded from the pre-build critique):
//  - Fail-safe to the ORDINARY price on ANY invalid campaign: null/undefined,
//    monthlyCost ≤ 0 / NaN / non-finite, or a malformed endDate. A bad campaign
//    must never read as free (0 kr) or stale-cheap — that's the worst failure
//    mode, worse than showing the ordinary price.
//  - isCampaignActive === false ALWAYS means effectiveMonthlyCost ===
//    ordinaryMonthlyCost. There is no third path.
//  - `now` is a required, injected parameter (never defaulted to new Date()) so
//    results are deterministic and callers can't silently reuse a stale one.
//
// This module does NOT validate campaign PLAUSIBILITY — a typo'd far-future year
// (2126-10-01) passes the date math. It only resolves cost vs the given `now`.
//
// Date handling mirrors the BIN-145 convention in streaming/offers.ts: a bare
// YYYY-MM-DD is a LOCAL calendar day (Stockholm for Swedish users), floored to
// day start on both sides so the last day counts as active for its whole duration.

const DAY_MS = 86_400_000;

export interface ProviderCampaign {
  /** Campaign monthly price (kr) in effect through endDate (inclusive). */
  monthlyCost: number;
  /** Last local day the campaign price applies, ISO 'YYYY-MM-DD' ("t.o.m."). */
  endDate: string;
}

export interface CampaignCost {
  /** Cost to use now: the campaign price while active, else the ordinary price. */
  effectiveMonthlyCost: number;
  /** True while the campaign price is in effect (now ≤ endDate, inclusive). */
  isCampaignActive: boolean;
  /** Whole local days until the campaign ends (0 on the last day); null when inactive. */
  daysUntilEnd: number | null;
}

export interface CampaignExpiryNudge {
  daysUntilEnd: number;
  campaignMonthlyCost: number;
  ordinaryMonthlyCost: number;
  /** round(ordinary − campaign) — the price jump the user is about to face (≥ 1). */
  increaseKr: number;
}

function localDayStart(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// Parse a bare YYYY-MM-DD as LOCAL midnight from its Y/M/D components — never hand
// a bare ISO string to new Date() (that parses as UTC, off by the tz offset).
// Returns null for a malformed string or a non-real date (→ fail-safe).
function parseLocalEndDate(endDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  // Reject overflow dates (e.g. 2026-13-40 → normalised to another month).
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

export function resolveCampaignCost(
  campaign: ProviderCampaign | null | undefined,
  ordinaryMonthlyCost: number,
  now: Date,
): CampaignCost {
  const reverted: CampaignCost = {
    effectiveMonthlyCost: ordinaryMonthlyCost,
    isCampaignActive: false,
    daysUntilEnd: null,
  };
  // Fail-safe on the whole campaign object, not just the date.
  if (campaign == null || !Number.isFinite(campaign.monthlyCost) || campaign.monthlyCost <= 0) {
    return reverted;
  }
  const endMs = parseLocalEndDate(campaign.endDate);
  if (endMs == null) return reverted;

  const days = Math.round((localDayStart(new Date(endMs)) - localDayStart(now)) / DAY_MS);
  if (days < 0) return reverted; // expired → auto-revert to ordinary

  return {
    effectiveMonthlyCost: campaign.monthlyCost,
    isCampaignActive: true,
    daysUntilEnd: days,
  };
}

/**
 * The "din kampanj löper ut snart" nudge. Non-null ONLY when the campaign is
 * active, ends within `warnWithinDays` (0 on the last day counts — it's the most
 * urgent), AND the ordinary price is at least 1 kr higher. The threshold is on
 * the RAW difference so a sub-krona increase (float noise, or a trivial öre
 * change) genuinely never nags; the displayed `increaseKr` is then rounded to
 * whole krona to match savingsLedger.
 */
export function campaignExpiryNudge(
  campaign: ProviderCampaign | null | undefined,
  ordinaryMonthlyCost: number,
  now: Date,
  warnWithinDays = 7,
): CampaignExpiryNudge | null {
  const resolved = resolveCampaignCost(campaign, ordinaryMonthlyCost, now);
  if (!resolved.isCampaignActive || resolved.daysUntilEnd == null || campaign == null) return null;
  if (resolved.daysUntilEnd > warnWithinDays) return null;

  const rawIncrease = ordinaryMonthlyCost - campaign.monthlyCost;
  if (rawIncrease < 1) return null; // need a genuine ≥1 kr rise; sub-krona noise stays silent

  return {
    daysUntilEnd: resolved.daysUntilEnd,
    campaignMonthlyCost: campaign.monthlyCost,
    ordinaryMonthlyCost,
    increaseKr: Math.round(rawIncrease), // whole kr for display (matches savingsLedger)
  };
}
