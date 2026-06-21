# Streaming Offers Bundle (Leaving-Soon + Deep Links + Prices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Swedish "lämnar snart" (leaving-soon) warnings, one-tap deep links, and rent/buy prices to title pages, sourced from the Movie of the Night (MOTN) Streaming Availability API, hard-capped to its free tier by a self-throttling daily cron.

**Architecture:** A daily Cloud Function scans the deduplicated set of "intent" titles (films in `vill_se` + TV in `mina`) that are currently on an SE service, spends a fixed daily API budget (≤95 calls) refreshing the *stalest* titles first, and writes the resulting offers (provider, deeplink, price, leaving-date) to a shared `streamingOffers/{tmdbId}` doc. Clients read that doc and render it onto the existing TMDB provider chips. A `streamingHealth/current` doc tracks the refresh interval and pushes the admin a flag when growth stretches it past a freshness threshold. The cost driver is **unique intent titles**, never users × titles, so it stays on the free tier far longer than a naive design.

**Tech Stack:** Firebase Cloud Functions v2 (`onSchedule`, `defineSecret`), firebase-admin Firestore, Next.js/React 19 client with React Query + the lazy `fsdb()` Firestore helper, Vitest for pure-logic units.

## Global Constraints

- Region for all functions: `europe-west1` (copied from existing crons).
- Function config shape: `{ schedule, region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' }`.
- `getFirestore()` is called at usage time, never at module level (must run after `initializeApp()`).
- Pure logic (no `firebase-admin`/`firebase-functions` imports) lives in a sibling `logic.ts`/`*.ts` and is unit-tested; anything touching admin SDK stays in the entrypoint and is verified manually.
- Per-title data must NEVER be added to `PERSISTED_QUERY_PREFIXES` in `src/lib/queryClient.ts` (localStorage 5 MB cap). The new client query key `'streaming-offers'` must stay out of that set.
- No hex colors in components — use design tokens (`acc`, `danger`, `ink-2`, etc.). No `text-red-*`. Use the `danger` token family for the leaving-soon warning.
- All UI copy in Swedish.
- MOTN requires attribution; render a credit line wherever its data appears (alongside the existing `<JustWatchCredit />`).
- Daily API budget constant: `DAILY_BUDGET = 95` (safety margin under the free 100/day).
- Freshness thresholds: WARN when refresh interval > 14 days, CRITICAL when > 21 days.
- Vitest include globs already cover `functions/src/**/*.{test,spec}.ts` — no separate runner.

---

## File Structure

**New — pure logic (unit-tested):**
- `functions/src/streamingOffers/logic.ts` — intent predicate, batch selection (governor), health computation.
- `functions/src/streamingOffers/logic.test.ts`
- `functions/src/streamingOffers/parse.ts` — MOTN response → `Offer[]` parser + MOTN-service→TMDB-provider map.
- `functions/src/streamingOffers/parse.test.ts`
- `functions/src/streamingOffers/types.ts` — shared types (`Offer`, `StreamingOffersDoc`, `HealthDoc`).

**New — admin-SDK / IO (manually verified):**
- `functions/src/streamingOffers/motn.ts` — MOTN fetch wrapper (reads secret, returns parsed show or null).
- `functions/src/streamingOffers/index.ts` — the `onSchedule` cron entrypoint.

**Modified:**
- `functions/src/index.ts` — re-export the new cron.
- `firestore.rules` — rules for `streamingOffers` + `streamingHealth`.
- `src/hooks/useStreamingOffers.ts` — **new** client hook (React Query + `fsdb()`).
- `src/lib/streaming/offers.ts` — **new** shared client types + helpers (`offerForProvider`, `isLeavingSoon`).
- `src/lib/streaming/offers.test.ts` — **new**.
- `src/components/pages/MoviePageClient.tsx` — render badge/deeplink/price on provider row.
- `src/components/pages/TVShowPageClient.tsx` — same.
- `src/components/title/ProviderTag.tsx` — accept optional `offer` prop (deeplink wrap + leaving badge).
- `docs/analysis/EXTERNAL_ACTIONS.md` — record the `MOTN_API_KEY` secret + admin-uid config the deployer must set.

---

## Task 1: Shared types

**Files:**
- Create: `functions/src/streamingOffers/types.ts`

**Interfaces:**
- Produces: `OfferType`, `Offer`, `StreamingOffersDoc`, `HealthStatus`, `HealthDoc`, `IntentItem`, `ExistingOffer`.

- [ ] **Step 1: Write the types file**

```ts
// functions/src/streamingOffers/types.ts

/** Offer category as normalized from MOTN's `type`. */
export type OfferType = 'subscription' | 'rent' | 'buy' | 'free';

/** One way to watch a title on one SE service. */
export interface Offer {
  /** Canonical TMDB watch-provider id (so the client can match it to a chip). */
  providerId: number;
  type: OfferType;
  /** Deep link straight to the title/player on the service. */
  link: string;
  /** Price in minor-unit-free decimal (e.g. 49). Only for rent/buy. */
  priceAmount: number | null;
  /** ISO 4217 currency, e.g. "SEK". */
  priceCurrency: string | null;
  /** ISO date (YYYY-MM-DD) the title leaves this service, or null if unknown. */
  leaving: string | null;
}

/** The shared per-title document at streamingOffers/{tmdbId}. */
export interface StreamingOffersDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: Offer[];
  /** Epoch millis of the last successful MOTN fetch. */
  checkedAt: number;
  source: 'motn';
}

export type HealthStatus = 'ok' | 'warn' | 'critical';

/** The singleton document at streamingHealth/current. */
export interface HealthDoc {
  computedAt: string;
  workSetSize: number;
  dailyBudget: number;
  refreshIntervalDays: number;
  status: HealthStatus;
}

/** A watchlist row narrowed to what the governor needs. */
export interface IntentItem {
  tmdbId: number;
  mediaType: string;
  status: string;
  /** Denormalized SE provider ids on the watchlist doc (non-empty => streaming now). */
  providers: number[];
}

/** Existing streamingOffers doc state the governor reads to prioritize. */
export interface ExistingOffer {
  tmdbId: number;
  checkedAt: number;
  /** Earliest leaving date across offers, or null. */
  nextLeaving: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/src/streamingOffers/types.ts
git commit -m "feat(streaming): shared types for streaming-offers bundle"
```

---

## Task 2: Intent filter + governor (pure logic)

**Files:**
- Create: `functions/src/streamingOffers/logic.ts`
- Test: `functions/src/streamingOffers/logic.test.ts`

**Interfaces:**
- Consumes: `IntentItem`, `ExistingOffer`, `HealthStatus`, `HealthDoc` from Task 1.
- Produces:
  - `isIntentTitle(item: IntentItem): boolean`
  - `dedupeIntent(items: IntentItem[]): { tmdbId: number; mediaType: 'movie' | 'tv' }[]`
  - `selectRefreshBatch(workSet, existing, nowMs, budget): number[]`
  - `computeHealth(workSetSize, budget, nowIso): HealthDoc`

- [ ] **Step 1: Write the failing tests**

```ts
// functions/src/streamingOffers/logic.test.ts
import { describe, it, expect } from 'vitest';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth } from './logic';
import type { IntentItem, ExistingOffer } from './types';

const item = (o: Partial<IntentItem>): IntentItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', providers: [8], ...o,
});

describe('isIntentTitle', () => {
  it('includes films in vill_se that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'movie', status: 'vill_se', providers: [8] }))).toBe(true);
  });
  it('includes TV in mina that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'mina', providers: [337] }))).toBe(true);
  });
  it('excludes titles not currently on any provider', () => {
    expect(isIntentTitle(item({ providers: [] }))).toBe(false);
  });
  it('excludes watched films and dropped titles', () => {
    expect(isIntentTitle(item({ status: 'sedd' }))).toBe(false);
    expect(isIntentTitle(item({ status: 'avbruten' }))).toBe(false);
  });
  it('excludes TV in vill_se (legacy/unmigrated) — only mina counts for TV', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'vill_se', providers: [8] }))).toBe(false);
  });
});

describe('dedupeIntent', () => {
  it('collapses the same tmdbId tracked by multiple users to one entry', () => {
    const out = dedupeIntent([item({ tmdbId: 5 }), item({ tmdbId: 5 }), item({ tmdbId: 6 })]);
    expect(out.map((x) => x.tmdbId).sort()).toEqual([5, 6]);
  });
  it('normalizes mediaType to movie|tv', () => {
    expect(dedupeIntent([item({ tmdbId: 9, mediaType: 'tv' })])[0].mediaType).toBe('tv');
  });
});

describe('selectRefreshBatch', () => {
  const work = [{ tmdbId: 1, mediaType: 'movie' as const }, { tmdbId: 2, mediaType: 'movie' as const }, { tmdbId: 3, mediaType: 'movie' as const }];
  const now = Date.parse('2026-06-20T00:00:00Z');

  it('prioritizes never-checked titles first', () => {
    const existing: ExistingOffer[] = [{ tmdbId: 1, checkedAt: now - 1000, nextLeaving: null }];
    // 2 and 3 have no existing doc -> they come before 1
    const out = selectRefreshBatch(work, existing, now, 2);
    expect(out).toContain(2);
    expect(out).toContain(3);
    expect(out).not.toContain(1);
  });

  it('then prioritizes titles leaving within 5 days (re-confirm)', () => {
    const existing: ExistingOffer[] = [
      { tmdbId: 1, checkedAt: now, nextLeaving: '2026-06-22' }, // leaves in 2 days
      { tmdbId: 2, checkedAt: now - 10_000, nextLeaving: null },
      { tmdbId: 3, checkedAt: now - 5_000, nextLeaving: null },
    ];
    const out = selectRefreshBatch(work, existing, now, 1);
    expect(out).toEqual([1]); // near-expiry beats merely-stale
  });

  it('then falls back to stalest checkedAt', () => {
    const existing: ExistingOffer[] = [
      { tmdbId: 1, checkedAt: now - 1_000, nextLeaving: null },
      { tmdbId: 2, checkedAt: now - 9_000, nextLeaving: null },
      { tmdbId: 3, checkedAt: now - 5_000, nextLeaving: null },
    ];
    const out = selectRefreshBatch(work, existing, now, 2);
    expect(out).toEqual([2, 3]); // oldest first
  });

  it('never returns more than the budget', () => {
    const out = selectRefreshBatch(work, [], now, 2);
    expect(out).toHaveLength(2);
  });
});

describe('computeHealth', () => {
  it('ok when interval is short', () => {
    const h = computeHealth(700, 95, '2026-06-20T00:00:00Z');
    expect(h.refreshIntervalDays).toBe(8); // ceil(700/95)
    expect(h.status).toBe('ok');
  });
  it('warns past 14 days', () => {
    expect(computeHealth(1400, 95, '2026-06-20T00:00:00Z').status).toBe('warn');
  });
  it('critical past 21 days', () => {
    expect(computeHealth(2100, 95, '2026-06-20T00:00:00Z').status).toBe('critical');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run functions/src/streamingOffers/logic.test.ts`
Expected: FAIL — `logic.ts` does not exist / functions not defined.

- [ ] **Step 3: Implement the logic**

```ts
// functions/src/streamingOffers/logic.ts
import type { IntentItem, ExistingOffer, HealthDoc, HealthStatus } from './types';

const NEAR_EXPIRY_DAYS = 5;
const WARN_DAYS = 14;
const CRITICAL_DAYS = 21;
const DAY_MS = 86_400_000;

/** A title is "intent" iff: film in vill_se OR tv in mina, AND currently on a provider. */
export function isIntentTitle(item: IntentItem): boolean {
  if (!Array.isArray(item.providers) || item.providers.length === 0) return false;
  if (item.mediaType === 'movie') return item.status === 'vill_se';
  if (item.mediaType === 'tv') return item.status === 'mina';
  return false;
}

export function dedupeIntent(
  items: IntentItem[],
): { tmdbId: number; mediaType: 'movie' | 'tv' }[] {
  const seen = new Map<number, 'movie' | 'tv'>();
  for (const it of items) {
    if (!seen.has(it.tmdbId)) {
      seen.set(it.tmdbId, it.mediaType === 'tv' ? 'tv' : 'movie');
    }
  }
  return [...seen.entries()].map(([tmdbId, mediaType]) => ({ tmdbId, mediaType }));
}

/**
 * Order the work set into a refresh priority and take the top `budget`:
 *   1. never-checked (no existing doc)
 *   2. leaving within NEAR_EXPIRY_DAYS (re-confirm before it goes)
 *   3. stalest checkedAt
 */
export function selectRefreshBatch(
  workSet: { tmdbId: number; mediaType: 'movie' | 'tv' }[],
  existing: ExistingOffer[],
  nowMs: number,
  budget: number,
): number[] {
  const byId = new Map(existing.map((e) => [e.tmdbId, e]));
  const tier = (tmdbId: number): number => {
    const e = byId.get(tmdbId);
    if (!e) return 0; // never checked
    if (e.nextLeaving && Date.parse(e.nextLeaving) - nowMs <= NEAR_EXPIRY_DAYS * DAY_MS) return 1;
    return 2;
  };
  const sortKey = (tmdbId: number): number => byId.get(tmdbId)?.checkedAt ?? 0;

  return [...workSet]
    .sort((a, b) => {
      const ta = tier(a.tmdbId);
      const tb = tier(b.tmdbId);
      if (ta !== tb) return ta - tb;            // lower tier first
      return sortKey(a.tmdbId) - sortKey(b.tmdbId); // older checkedAt first
    })
    .slice(0, budget)
    .map((x) => x.tmdbId);
}

export function computeHealth(workSetSize: number, budget: number, nowIso: string): HealthDoc {
  const refreshIntervalDays = budget > 0 ? Math.ceil(workSetSize / budget) : Infinity;
  let status: HealthStatus = 'ok';
  if (refreshIntervalDays > CRITICAL_DAYS) status = 'critical';
  else if (refreshIntervalDays > WARN_DAYS) status = 'warn';
  return { computedAt: nowIso, workSetSize, dailyBudget: budget, refreshIntervalDays, status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run functions/src/streamingOffers/logic.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add functions/src/streamingOffers/logic.ts functions/src/streamingOffers/logic.test.ts
git commit -m "feat(streaming): intent filter + free-tier governor logic"
```

---

## Task 3: MOTN parser + service map (pure logic)

**Files:**
- Create: `functions/src/streamingOffers/parse.ts`
- Test: `functions/src/streamingOffers/parse.test.ts`

**Interfaces:**
- Consumes: `Offer`, `OfferType` from Task 1.
- Produces:
  - `MOTN_TO_TMDB_PROVIDER: Record<string, number>`
  - `parseStreamingOptions(seOptions: unknown): Offer[]`

**Background — MOTN v4 shape (confirm against https://docs.movieofthenight.com/resource/shows before coding):**
A show response has `streamingOptions: { se: StreamingOption[] }`. Each option:
`{ service: { id: string }, type: 'subscription'|'rent'|'buy'|'addon'|'free', link: string, price?: { amount: string, currency: string }, expiresSoon: boolean, expiresOn?: number /* unix seconds */ }`.
MOTN service ids are strings (`"netflix"`, `"disney"`, `"prime"`, `"max"`, `"viaplay"`, `"appletv"`, `"svtplay"`, `"tv4play"`, `"skyshowtime"`); map them to the numeric TMDB provider ids used in `src/lib/tmdb/providers.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// functions/src/streamingOffers/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseStreamingOptions, MOTN_TO_TMDB_PROVIDER } from './parse';

describe('MOTN_TO_TMDB_PROVIDER', () => {
  it('maps the major SE services to TMDB provider ids', () => {
    expect(MOTN_TO_TMDB_PROVIDER.netflix).toBe(8);
    expect(MOTN_TO_TMDB_PROVIDER.disney).toBe(337);
    expect(MOTN_TO_TMDB_PROVIDER.prime).toBe(119);
  });
});

describe('parseStreamingOptions', () => {
  it('returns [] for non-array input', () => {
    expect(parseStreamingOptions(undefined)).toEqual([]);
    expect(parseStreamingOptions(null)).toEqual([]);
  });

  it('parses a subscription offer with a leaving date', () => {
    const out = parseStreamingOptions([
      { service: { id: 'netflix' }, type: 'subscription', link: 'https://nf/x', expiresSoon: true, expiresOn: 1781913600 },
    ]);
    expect(out).toEqual([
      { providerId: 8, type: 'subscription', link: 'https://nf/x', priceAmount: null, priceCurrency: null, leaving: '2026-06-19' },
    ]);
  });

  it('parses a rent offer with a price', () => {
    const out = parseStreamingOptions([
      { service: { id: 'appletv' }, type: 'rent', link: 'https://a/x', price: { amount: '49', currency: 'SEK' }, expiresSoon: false },
    ]);
    expect(out[0].type).toBe('rent');
    expect(out[0].priceAmount).toBe(49);
    expect(out[0].priceCurrency).toBe('SEK');
    expect(out[0].leaving).toBeNull();
  });

  it('normalizes addon -> subscription', () => {
    const out = parseStreamingOptions([{ service: { id: 'max' }, type: 'addon', link: 'https://m/x', expiresSoon: false }]);
    expect(out[0].type).toBe('subscription');
  });

  it('skips options for unmapped services', () => {
    const out = parseStreamingOptions([{ service: { id: 'unknown-service' }, type: 'subscription', link: 'x', expiresSoon: false }]);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run functions/src/streamingOffers/parse.test.ts`
Expected: FAIL — `parse.ts` does not exist.

- [ ] **Step 3: Implement the parser**

```ts
// functions/src/streamingOffers/parse.ts
import type { Offer, OfferType } from './types';

/** MOTN service id -> TMDB watch-provider id (see src/lib/tmdb/providers.ts). */
export const MOTN_TO_TMDB_PROVIDER: Record<string, number> = {
  netflix: 8,
  disney: 337,
  prime: 119,
  max: 384,
  viaplay: 76,
  appletv: 2,         // Apple TV (rent/buy)
  appletvplus: 350,   // Apple TV+
  svtplay: 1773,
  tv4play: 497,
  skyshowtime: 1773,  // verify against providers.ts; adjust if a distinct id exists
  google: 3,
};

function normalizeType(raw: unknown): OfferType {
  if (raw === 'rent') return 'rent';
  if (raw === 'buy') return 'buy';
  if (raw === 'free') return 'free';
  return 'subscription'; // 'subscription' | 'addon' | anything else
}

/** YYYY-MM-DD (UTC) from a unix-seconds timestamp, or null. */
function isoDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function parseStreamingOptions(seOptions: unknown): Offer[] {
  if (!Array.isArray(seOptions)) return [];
  const out: Offer[] = [];
  for (const opt of seOptions) {
    const serviceId = opt?.service?.id;
    const providerId = typeof serviceId === 'string' ? MOTN_TO_TMDB_PROVIDER[serviceId] : undefined;
    if (providerId == null) continue;
    const amount = opt?.price?.amount;
    out.push({
      providerId,
      type: normalizeType(opt?.type),
      link: typeof opt?.link === 'string' ? opt.link : '',
      priceAmount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
      priceCurrency: typeof opt?.price?.currency === 'string' ? opt.price.currency : null,
      leaving: opt?.expiresOn != null ? isoDate(opt.expiresOn) : null,
    });
  }
  return out;
}
```

> Note on the test's `expiresOn: 1781913600` → expected `'2026-06-19'`: confirm the exact epoch→date in the test matches your implementation's UTC slice; adjust the literal if MOTN documents `expiresOn` as millis rather than seconds (the verify step in Task 5 covers this).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run functions/src/streamingOffers/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/streamingOffers/parse.ts functions/src/streamingOffers/parse.test.ts
git commit -m "feat(streaming): MOTN response parser + SE service map"
```

---

## Task 4: MOTN fetch wrapper (IO — manually verified)

**Files:**
- Create: `functions/src/streamingOffers/motn.ts`
- Modify: `docs/analysis/EXTERNAL_ACTIONS.md`

**Interfaces:**
- Consumes: `parseStreamingOptions` (Task 3), `Offer` (Task 1).
- Produces: `fetchOffers(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<Offer[] | null>` — returns `null` on any failure (so the cron skips and retries next run), `[]` when the title genuinely has no SE offers.

- [ ] **Step 1: Verify the MOTN endpoint + field names**

Open https://docs.movieofthenight.com/resource/shows and confirm:
- The get-by-TMDB-id request path (v4 supports looking up by TMDB id; e.g. `GET /shows/{id}` where id is `movie/{tmdbId}` or `tv/{tmdbId}`, plus a `country=se` query). Write the exact path you confirm into the code below.
- That `streamingOptions.se[].expiresOn` is unix **seconds** (adjust `isoDate` + the Task 3 test literal if it is millis).
- The auth header: RapidAPI (`X-RapidAPI-Key` + `X-RapidAPI-Host`) vs MOTN direct portal (`X-Api-Key`). This plan assumes the **RapidAPI free tier** (100/day). Use `X-RapidAPI-Key`.

- [ ] **Step 2: Implement the wrapper**

```ts
// functions/src/streamingOffers/motn.ts
import { logger } from 'firebase-functions/v2';
import { parseStreamingOptions } from './parse';
import type { Offer } from './types';

const HOST = 'streaming-availability.p.rapidapi.com';

/**
 * Fetch SE offers for one title from MOTN. Returns null on failure (caller
 * skips + retries next run), [] when the title has no SE offers.
 * Reads process.env.MOTN_API_KEY (bound via defineSecret in index.ts).
 */
export async function fetchOffers(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): Promise<Offer[] | null> {
  const key = process.env.MOTN_API_KEY;
  if (!key) { logger.error('streamingOffers: MOTN_API_KEY not set'); return null; }

  // Path confirmed in Step 1. Example v4 form:
  const url = `https://${HOST}/shows/${mediaType}/${tmdbId}?country=se&output_language=sv`;
  try {
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
    });
    if (res.status === 404) return []; // not in MOTN catalogue == no offers
    if (!res.ok) { logger.warn(`streamingOffers: MOTN ${mediaType}/${tmdbId} -> ${res.status}`); return null; }
    const json = await res.json();
    return parseStreamingOptions(json?.streamingOptions?.se);
  } catch (err) {
    logger.warn(`streamingOffers: MOTN fetch failed for ${mediaType}/${tmdbId}`, err);
    return null;
  }
}
```

- [ ] **Step 3: Record the external action**

Append to `docs/analysis/EXTERNAL_ACTIONS.md`:

```markdown
## Streaming Offers (MOTN) — secrets the deployer must set

- `firebase functions:secrets:set MOTN_API_KEY` — RapidAPI key for the Movie of
  the Night "Streaming Availability" API (free tier = 100 req/day). Required by
  the `streamingOffersRefresh` cron.
- Admin uid for the freshness flag: set `ADMIN_UID` the same way
  (`firebase functions:secrets:set ADMIN_UID`) — the cron writes the warn/critical
  notification to `users/{ADMIN_UID}/notifications` and pushes via FCM.
- The cron is in `functions/` — remember `firebase deploy --only functions`
  (deploy.yml only deploys hosting).
```

- [ ] **Step 4: Typecheck**

Run: `cd functions && npm run build` (or root `npm run typecheck`)
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/streamingOffers/motn.ts docs/analysis/EXTERNAL_ACTIONS.md
git commit -m "feat(streaming): MOTN fetch wrapper + external-actions note"
```

---

## Task 5: The governed daily cron (entrypoint — manually verified)

**Files:**
- Create: `functions/src/streamingOffers/index.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `export const streamingOffersRefresh` (an `onSchedule` function), re-exported from `functions/src/index.ts`.

- [ ] **Step 1: Implement the cron**

```ts
// functions/src/streamingOffers/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth } from './logic';
import { fetchOffers } from './motn';
import type { IntentItem, ExistingOffer, Offer } from './types';

const MOTN_API_KEY = defineSecret('MOTN_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

const DAILY_BUDGET = 95;
const PAGE_SIZE = 2000;

/** Scan all watchlist docs, narrowed, and keep only intent titles, deduped. */
async function readWorkSet(): Promise<{ tmdbId: number; mediaType: 'movie' | 'tv' }[]> {
  const db = getFirestore();
  const items: IntentItem[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collectionGroup('watchlist')
      .select('mediaType', 'status', 'tmdbId', 'providers')
      .orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      const it: IntentItem = {
        tmdbId: Number(x.tmdbId ?? Number(d.id)),
        mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''),
        providers: Array.isArray(x.providers) ? (x.providers as number[]) : [],
      };
      if (isIntentTitle(it)) items.push(it);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return dedupeIntent(items);
}

/** Read current streamingOffers state for prioritization (acceptable full read at this scale). */
async function readExisting(): Promise<ExistingOffer[]> {
  const db = getFirestore();
  const snap = await db.collection('streamingOffers').select('checkedAt', 'offers').get();
  return snap.docs.map((d) => {
    const offers = (d.get('offers') as Offer[] | undefined) ?? [];
    const leavings = offers.map((o) => o.leaving).filter((l): l is string => !!l).sort();
    return {
      tmdbId: Number(d.id),
      checkedAt: Number(d.get('checkedAt') ?? 0),
      nextLeaving: leavings[0] ?? null,
    };
  });
}

async function notifyAdmin(status: 'warn' | 'critical', intervalDays: number, users: number): Promise<void> {
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) return;
  const db = getFirestore();
  await db.collection('users').doc(adminUid).collection('notifications').add({
    kind: 'system',
    title: status === 'critical' ? 'Streaming-data: gratistaket nått' : 'Streaming-data närmar sig gratistaket',
    body: `Uppdateringstakt ~${intervalDays} dagar (≈${users} användare). Överväg MOTN Pro ($39/mån) för veckovis uppdatering.`,
    actionUrl: '/insikter',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  // FCM push reuses the existing sendPushToUser helper if desired (see episodeNotify).
}

export const streamingOffersRefresh = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [MOTN_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    const workSet = await readWorkSet();
    const existing = await readExisting();
    const batch = selectRefreshBatch(workSet, existing, nowMs, DAILY_BUDGET);

    const mediaById = new Map(workSet.map((w) => [w.tmdbId, w.mediaType]));
    let written = 0;
    for (const tmdbId of batch) {
      const mediaType = mediaById.get(tmdbId)!;
      const offers = await fetchOffers(tmdbId, mediaType);
      if (offers === null) continue; // failure -> retry next run
      await db.collection('streamingOffers').doc(String(tmdbId)).set({
        tmdbId, mediaType, offers, checkedAt: nowMs, source: 'motn',
      });
      written += 1;
    }

    const health = computeHealth(workSet.length, DAILY_BUDGET, new Date(nowMs).toISOString());
    const prev = (await db.collection('streamingHealth').doc('current').get()).data();
    await db.collection('streamingHealth').doc('current').set(health);
    if ((health.status === 'warn' || health.status === 'critical') && prev?.status !== health.status) {
      const users = (await db.collection('users').count().get()).data().count;
      await notifyAdmin(health.status, health.refreshIntervalDays, users);
    }

    logger.info('streamingOffersRefresh done', {
      workSet: workSet.length, attempted: batch.length, written, status: health.status, intervalDays: health.refreshIntervalDays,
    });
  },
);
```

- [ ] **Step 2: Re-export the cron**

In `functions/src/index.ts`, add alongside the other re-exports:

```ts
export { streamingOffersRefresh } from './streamingOffers';
```

- [ ] **Step 3: Build + typecheck**

Run: `cd functions && npm run build`
Expected: compiles clean.

- [ ] **Step 4: Manual verification (emulator or staged deploy)**

- Set the secret locally / in the project: `firebase functions:secrets:set MOTN_API_KEY`.
- Trigger the function (Cloud Scheduler "Run now" after deploy, or invoke via the emulator) and confirm in logs: `workSet` > 0, `written` ≤ 95, no unhandled errors.
- Inspect Firestore: `streamingOffers/{someIntentTmdbId}` has an `offers` array; `streamingHealth/current` has `status` + `refreshIntervalDays`.

- [ ] **Step 5: Commit**

```bash
git add functions/src/streamingOffers/index.ts functions/src/index.ts
git commit -m "feat(streaming): governed daily MOTN refresh cron + health flag"
```

---

## Task 6: Firestore rules

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Produces: read access to `streamingOffers/{tmdbId}` for clients; both new collections write-blocked on the client (functions use Admin SDK, which bypasses rules).

- [ ] **Step 1: Add the rules**

Inside the top-level `match /databases/{database}/documents { ... }` block, add:

```
// Streaming offers (deeplinks, prices, leaving dates) — written by the
// streamingOffersRefresh cron (Admin SDK bypasses rules), public read.
match /streamingOffers/{tmdbId} {
  allow read: if true;
  allow write: if false;
}

// Internal freshness/health for the streaming-offers governor — never client-readable.
match /streamingHealth/{doc} {
  allow read, write: if false;
}
```

- [ ] **Step 2: Validate rules locally**

Run: `firebase deploy --only firestore:rules --dry-run` (or validate via the emulator rules test if present).
Expected: rules compile, no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(streaming): firestore rules for streamingOffers (public read) + streamingHealth (internal)"
```

> Deploy note: rules require a manual `firebase deploy --only firestore:rules` — the push-to-main deploy only ships hosting.

---

## Task 7: Client offer helpers (pure logic)

**Files:**
- Create: `src/lib/streaming/offers.ts`
- Test: `src/lib/streaming/offers.test.ts`

**Interfaces:**
- Produces:
  - client types `Offer`, `StreamingOffersDoc` (mirror of the function types, client-shaped),
  - `offerForProvider(offers: Offer[], providerId: number): Offer | undefined`
  - `isLeavingSoon(offer: Offer | undefined, nowMs: number, withinDays?: number): boolean`
  - `daysUntilLeaving(offer: Offer | undefined, nowMs: number): number | null`
  - `formatLeaving(offer: Offer): string` (Swedish, e.g. "lämnar 30 jun")

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/streaming/offers.test.ts
import { describe, it, expect } from 'vitest';
import { offerForProvider, isLeavingSoon, daysUntilLeaving, formatLeaving } from './offers';
import type { Offer } from './offers';

const sub = (o: Partial<Offer>): Offer => ({
  providerId: 8, type: 'subscription', link: 'x', priceAmount: null, priceCurrency: null, leaving: null, ...o,
});
const now = Date.parse('2026-06-20T00:00:00Z');

describe('offerForProvider', () => {
  it('matches by providerId', () => {
    const offers = [sub({ providerId: 8 }), sub({ providerId: 337 })];
    expect(offerForProvider(offers, 337)?.providerId).toBe(337);
  });
  it('returns undefined when no match', () => {
    expect(offerForProvider([sub({ providerId: 8 })], 999)).toBeUndefined();
  });
});

describe('isLeavingSoon', () => {
  it('true when leaving within the window', () => {
    expect(isLeavingSoon(sub({ leaving: '2026-06-28' }), now, 14)).toBe(true);
  });
  it('false when no leaving date', () => {
    expect(isLeavingSoon(sub({ leaving: null }), now, 14)).toBe(false);
  });
  it('false when leaving is far away', () => {
    expect(isLeavingSoon(sub({ leaving: '2026-09-01' }), now, 14)).toBe(false);
  });
  it('false for undefined offer', () => {
    expect(isLeavingSoon(undefined, now, 14)).toBe(false);
  });
});

describe('daysUntilLeaving', () => {
  it('counts whole days', () => {
    expect(daysUntilLeaving(sub({ leaving: '2026-06-25' }), now)).toBe(5);
  });
  it('null when no date', () => {
    expect(daysUntilLeaving(sub({ leaving: null }), now)).toBeNull();
  });
});

describe('formatLeaving', () => {
  it('formats a Swedish short date', () => {
    expect(formatLeaving(sub({ leaving: '2026-06-30' }))).toMatch(/lämnar/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/streaming/offers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/streaming/offers.ts
export type OfferType = 'subscription' | 'rent' | 'buy' | 'free';

export interface Offer {
  providerId: number;
  type: OfferType;
  link: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  leaving: string | null;
}

export interface StreamingOffersDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: Offer[];
  checkedAt: number;
  source: 'motn';
}

const DAY_MS = 86_400_000;

export function offerForProvider(offers: Offer[], providerId: number): Offer | undefined {
  return offers.find((o) => o.providerId === providerId);
}

export function daysUntilLeaving(offer: Offer | undefined, nowMs: number): number | null {
  if (!offer?.leaving) return null;
  return Math.round((Date.parse(offer.leaving) - nowMs) / DAY_MS);
}

export function isLeavingSoon(offer: Offer | undefined, nowMs: number, withinDays = 14): boolean {
  const d = daysUntilLeaving(offer, nowMs);
  return d != null && d >= 0 && d <= withinDays;
}

export function formatLeaving(offer: Offer): string {
  if (!offer.leaving) return '';
  const d = new Date(offer.leaving);
  const date = d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `lämnar ${date}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/streaming/offers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/streaming/offers.ts src/lib/streaming/offers.test.ts
git commit -m "feat(streaming): client-side offer helpers (leaving-soon, price, deeplink)"
```

---

## Task 8: Client hook — `useStreamingOffers`

**Files:**
- Create: `src/hooks/useStreamingOffers.ts`

**Interfaces:**
- Consumes: `fsdb` from `@/lib/firebase/db`, `StreamingOffersDoc` from `@/lib/streaming/offers`.
- Produces: `useStreamingOffers(tmdbId: number | undefined): { offers: Offer[]; checkedAt: number | null }`

- [ ] **Step 1: Implement the hook (React Query one-shot read via fsdb)**

```ts
// src/hooks/useStreamingOffers.ts
import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import type { Offer, StreamingOffersDoc } from '@/lib/streaming/offers';

/**
 * Read the shared streamingOffers/{tmdbId} doc. Query key 'streaming-offers'
 * is intentionally NOT in PERSISTED_QUERY_PREFIXES (per-title data must never
 * be persisted to localStorage).
 */
export function useStreamingOffers(tmdbId: number | undefined): { offers: Offer[]; checkedAt: number | null } {
  const { data } = useQuery({
    queryKey: ['streaming-offers', tmdbId],
    enabled: tmdbId != null,
    staleTime: 1000 * 60 * 60, // 1h client cache; source refreshes daily server-side
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'streamingOffers', String(tmdbId)));
      return snap.exists() ? (snap.data() as StreamingOffersDoc) : null;
    },
  });
  return { offers: data?.offers ?? [], checkedAt: data?.checkedAt ?? null };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the query key is not persisted**

Confirm `'streaming-offers'` is absent from `PERSISTED_QUERY_PREFIXES` in `src/lib/queryClient.ts` (it must be — do not add it).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useStreamingOffers.ts
git commit -m "feat(streaming): useStreamingOffers client hook (non-persisted shared read)"
```

---

## Task 9: Render badge + deep link + price on title pages

**Files:**
- Modify: `src/components/title/ProviderTag.tsx`
- Modify: `src/components/pages/MoviePageClient.tsx`
- Modify: `src/components/pages/TVShowPageClient.tsx`

**Interfaces:**
- Consumes: `useStreamingOffers` (Task 8), `offerForProvider`/`isLeavingSoon`/`formatLeaving` (Task 7).

- [ ] **Step 1: Extend `ProviderTag` with an optional offer**

Add an optional `offer` prop. When present with a `link`, wrap the chip in an `<a>`; when leaving soon, append a `danger`-token badge; for rent/buy, show the price.

```tsx
// additions to ProviderTag.tsx props + render
import { type Offer, isLeavingSoon, formatLeaving } from '@/lib/streaming/offers';

interface ProviderTagProps {
  provider: { provider_id: number; provider_name: string };
  size?: 'sm' | 'md';
  offer?: Offer;            // NEW
  nowMs?: number;           // NEW (injectable for tests; defaults to Date.now())
}

// inside render, after computing the chip element `chip`:
const now = nowMs ?? Date.now();
const leaving = offer && isLeavingSoon(offer, now);
const price = offer && (offer.type === 'rent' || offer.type === 'buy') && offer.priceAmount != null
  ? `${offer.priceAmount} ${offer.priceCurrency ?? ''}`.trim()
  : null;

const body = (
  <span className="inline-flex items-center gap-1">
    {chip}
    {price && <span className="text-ink-2 text-[12px]">{price}</span>}
    {leaving && (
      <span className="rounded-sm bg-danger-soft text-danger-ink px-1 text-[11px]">
        {formatLeaving(offer!)}
      </span>
    )}
  </span>
);

return offer?.link
  ? <a href={offer.link} target="_blank" rel="noopener noreferrer">{body}</a>
  : body;
```

- [ ] **Step 2: Wire offers into the Movie provider row**

In `MoviePageClient.tsx`, near the existing provider row (around lines 223–264):

```tsx
import { useStreamingOffers } from '@/hooks/useStreamingOffers';
import { offerForProvider } from '@/lib/streaming/offers';

const { offers } = useStreamingOffers(movie.id);
// ...
{subscription.map((p) => (
  <ProviderTag key={p.provider_id} provider={p} size="md" offer={offerForProvider(offers, p.provider_id)} />
))}
```

(If a provider currently renders as an `<img>` logo rather than `ProviderTag`, keep the logo but wrap it in the same `<a href={offer.link}>` when an offer link exists, and render the leaving badge beside it.)

- [ ] **Step 3: Wire offers into the TV provider row**

Apply the same change in `TVShowPageClient.tsx` using `show.id`.

- [ ] **Step 4: Add MOTN attribution**

Where offers render, add a small credit line beside the existing `<JustWatchCredit />`:

```tsx
<span className="text-ink-3 text-[11px]">Tillgänglighet via Movie of the Night</span>
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open a movie that has a `streamingOffers` doc (seed one via the cron or manually in the emulator). Confirm: provider chip links out, rent/buy shows price, a near-future `leaving` shows the "lämnar …" badge in the danger color. Confirm a title with no doc renders exactly as before (no regressions).

- [ ] **Step 6: Typecheck + design guard test + commit**

Run: `npm run typecheck && npx vitest run src/lib/design/consistency.test.ts`
Expected: PASS.

```bash
git add src/components/title/ProviderTag.tsx src/components/pages/MoviePageClient.tsx src/components/pages/TVShowPageClient.tsx
git commit -m "feat(streaming): render deeplinks, prices, and lämnar-snart badge on title pages"
```

---

## Task 10: Pre-merge review + deploy

**Files:** none (process task).

- [ ] **Step 1: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green. (Note CLAUDE.md: `no-explicit-any` is an ERROR in deploy.yml — ensure no `as any` slipped into the new code; run `npx eslint` on the new files specifically.)

- [ ] **Step 2: Security + code review subagents**

Dispatch `binge-security-reviewer` (new Firestore rules + new external data flow) and `binge-code-reviewer` on the staged diff. Address findings.

- [ ] **Step 3: Deploy in the correct order**

```bash
firebase functions:secrets:set MOTN_API_KEY   # if not already set
firebase functions:secrets:set ADMIN_UID
firebase deploy --only firestore:rules
firebase deploy --only functions
# hosting deploys automatically on push to main
```

- [ ] **Step 4: Trigger one cron run + verify**

In Cloud Scheduler, "Run now" on `streamingOffersRefresh`. Confirm logs show a successful run and `streamingOffers` docs appear. Then push the client changes to main.

- [ ] **Step 5: Commit any review fixes**

```bash
git add -A && git commit -m "chore(streaming): address review feedback"
```

---

## Self-Review

**Spec coverage:**
- Leaving-soon → `Offer.leaving`, governor near-expiry tier, `isLeavingSoon` + badge (Tasks 2,7,9). ✓
- Deep links → `Offer.link`, `<a>` wrap (Tasks 3,9). ✓
- Rent/buy prices → `Offer.priceAmount/priceCurrency`, render (Tasks 3,9). ✓
- Free-tier hard cap → `DAILY_BUDGET=95`, batch selection caps output, cron stops at budget (Tasks 2,5). ✓
- Self-throttle by staleness → `selectRefreshBatch` stalest-first (Task 2). ✓
- Growth flag → `computeHealth` + `notifyAdmin` warn/critical (Tasks 2,5). ✓
- Shared cache (not per-user) → `streamingOffers/{tmdbId}`, function-written, client-read (Tasks 5,6,8). ✓
- Cost rule (lite pre-filter, no persist) → intent filter uses denormalized `providers`; `'streaming-offers'` excluded from persist (Tasks 2,8). ✓

**Placeholder scan:** MOTN endpoint path + `expiresOn` unit are explicitly flagged as a verify-first step (Task 4 Step 1, Task 3 note) rather than asserted — this is a known external-API unknown, surfaced as a concrete action, not a hidden TODO.

**Type consistency:** `Offer` shape is identical across `functions/src/streamingOffers/types.ts` and `src/lib/streaming/offers.ts` (providerId, type, link, priceAmount, priceCurrency, leaving). `selectRefreshBatch`/`computeHealth`/`isIntentTitle`/`dedupeIntent` signatures match their call sites in `index.ts`. `useStreamingOffers` returns `{ offers, checkedAt }` consumed in Task 9.
