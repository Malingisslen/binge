// BIN-178 — MOTN /changes client for the "vad försvinner" rollup. Fetches what's
// EXPIRING in SE within the window, paginated. Same RapidAPI host/auth as motn.ts.
// Returns null on a hard failure with no data; partial pages are returned as-is
// (better a short list than none).
//
// BIN-541 (2026-07-17): this used to page with NO quota accounting at all, even
// though it shares the same MOTN account/key as streamingOffers — up to
// MAX_PAGES calls a day, uncounted, was the likely real driver of the vendor's
// "85% of monthly quota used" alert (the plan is 500/MONTH, not 100/day as
// originally assumed). `canFetchPage` gates every page (including the first)
// against the caller's own budget reservation, so this job can never spend
// vendor quota the caller hasn't granted.

import { logger } from 'firebase-functions/v2';
import type { ChangeItem, ShowRef } from './logic';
import { MAX_PAGES } from './config';
// BIN-857: the host and the mask-then-truncate rule were duplicated verbatim
// between this client and streamingOffers/motn.ts — same vendor, same key, same
// account. Both now come from one admin-free module.
import { MOTN_HOST, redactVendorBody } from '../util/motnVendor';

// BIN-543: 18, not 20 — sized so a worst-case run (every run maxes this out)
// still survives the full ~31-day cycle under the new 96h cadence, see the
// arithmetic proof on LEAVING_HARD_CYCLE_CAP in index.ts (18 × 8 runs = 144 ≤
// 150). 25 changes/page → up to 450 expiring titles per run; still ample for SE/31d.
// Lives in ./config.ts (admin-free) so motnChanges.test.ts can import it
// without transitively pulling in this file's 'firebase-functions/v2' import
// — that import isn't resolvable under the root CI vitest toolchain's `npm
// ci` (same class of gap previously only seen for firebase-admin).

interface RawChange {
  showId?: string;
  streamingOptionType?: string;
  service?: { id?: string };
  timestamp?: number;
}
interface RawResponse {
  changes?: RawChange[];
  shows?: Record<string, ShowRef>;
  hasMore?: boolean;
  nextCursor?: string;
}

/**
 * All SE subscription expirations in [fromSec, toSec] (unix seconds, up to 31
 * days ahead per MOTN). Reads process.env.MOTN_API_KEY (bound via defineSecret).
 *
 * `canFetchPage` is checked before EVERY page (including the first) and must
 * reserve a vendor-quota slot itself (see index.ts) — this function spends no
 * quota `canFetchPage` didn't already grant. Returns whatever was accumulated
 * so far (possibly empty) if pagination stops early for ANY reason; `null` is
 * reserved for the one true hard failure (no API key) where nothing was even
 * attempted. `rateLimited` is true if any page hit a 429 (for confirmed-
 * exhaustion tracking). `pagesFetched` counts pages that got a real (non-429)
 * HTTP response, even if that page's `changes` list was legitimately empty —
 * the caller uses this to tell "genuinely nothing expiring" apart from "made
 * no vendor call at all" (budget denied before page 0), which must NOT count
 * as a clean quota signal.
 *
 * Code review (2026-07-17): `complete` is true ONLY when pagination reached
 * its genuine natural end (`!hasMore`) — every other exit (429, budget denial,
 * a plain network error or non-ok status mid-pagination, or hitting MAX_PAGES
 * without running out of pages) leaves it false. A prior version conflated
 * "got SOME data" with "got ALL the data" by returning a non-null partial
 * result on a mid-pagination failure — the caller then had no way to tell a
 * genuinely complete (if short) list apart from a silently truncated one, and
 * could publish the truncated list as if it were the whole picture.
 */
export async function fetchExpiringChanges(
  fromSec: number,
  toSec: number,
  canFetchPage: () => Promise<boolean>,
): Promise<{ changes: ChangeItem[]; shows: Record<string, ShowRef>; rateLimited: boolean; pagesFetched: number; complete: boolean } | null> {
  const key = process.env.MOTN_API_KEY;
  if (!key) {
    logger.error('leavingRollup: MOTN_API_KEY not set');
    return null;
  }

  const changes: ChangeItem[] = [];
  const shows: Record<string, ShowRef> = {};
  let cursor: string | undefined;
  let rateLimited = false;
  let pagesFetched = 0;
  let complete = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (!(await canFetchPage())) {
      logger.warn('leavingRollup: MOTN cycle budget exhausted — stopping pagination', { page });
      break;
    }
    const params = new URLSearchParams({
      country: 'se',
      change_type: 'expiring',
      item_type: 'show',
      from: String(fromSec),
      to: String(toSec),
    });
    if (cursor) params.set('cursor', cursor);
    const url = `https://${MOTN_HOST}/changes?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': MOTN_HOST },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn('leavingRollup: changes fetch failed', err);
      return { changes, shows, rateLimited, pagesFetched, complete };
    }
    if (res.status === 429) {
      logger.warn('leavingRollup: MOTN 429 rate-limited');
      rateLimited = true;
      break;
    }
    if (!res.ok) {
      // BIN-856: keep the vendor's own error text, not just the status. Its
      // sibling client (streamingOffers/motn.ts) logged only the number, and
      // that is why a 400 which said in plain words exactly what was wrong
      // ("parameter \"output_language\" has an invalid value: sv") read as
      // ordinary flakiness for a month. Same vendor, same key, same blind
      // spot — so the same fix belongs on both halves of the account.
      // Redact the key before logging: an auth error is exactly the kind of
      // prose that quotes the credential it rejected. BIN-857 moved that rule
      // into ../util/motnVendor.ts — it was written out twice, and the ORDER
      // (mask, THEN truncate) is what makes it correct, which nothing pinned.
      const body = await res.text().catch(() => '');
      const detail = { body: redactVendorBody(body, key) };
      // Integration review: a 4xx here is OUR defect (bad parameter, bad key),
      // not vendor flakiness, and its consequence is the BIN-856 shape exactly
      // — `complete` stays false, so the public "vad försvinner" rollup is
      // silently never updated and the previous list is served indefinitely.
      // That deserves `error`, not the `warn` a transient 5xx gets.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        logger.error(`leavingRollup: MOTN rejected our request (${res.status}) — rollup left stale`, detail);
      } else {
        logger.warn(`leavingRollup: changes -> ${res.status}`, detail);
      }
      return { changes, shows, rateLimited, pagesFetched, complete };
    }

    pagesFetched += 1;
    const json = (await res.json()) as RawResponse;
    for (const ch of json.changes ?? []) {
      changes.push({
        showId: String(ch.showId ?? ''),
        streamingOptionType: String(ch.streamingOptionType ?? ''),
        serviceId: String(ch.service?.id ?? ''),
        timestamp: typeof ch.timestamp === 'number' ? ch.timestamp : null,
      });
    }
    Object.assign(shows, json.shows ?? {});

    if (!json.hasMore) { complete = true; break; }
    // Code review (2026-07-17): `hasMore: true` with no `nextCursor` is a
    // malformed/degenerate vendor response, not a genuine end — the ORIGINAL
    // `!hasMore || !nextCursor` condition marked THIS case `complete: true`
    // too, which is wrong: the vendor explicitly said there's more data we
    // never fetched. Stop (can't continue without a cursor) but leave
    // `complete` false — an honest "incomplete", not a false "done".
    if (!json.nextCursor) {
      logger.warn('leavingRollup: MOTN hasMore=true but no nextCursor — stopping (incomplete)', { page });
      break;
    }
    cursor = json.nextCursor;
  }

  return { changes, shows, rateLimited, pagesFetched, complete };
}
