// BIN-178 — MOTN /changes client for the "vad försvinner" rollup. Fetches what's
// EXPIRING in SE within the window, paginated. Same RapidAPI host/auth as motn.ts.
// Returns null on a hard failure with no data; partial pages are returned as-is
// (better a short list than none).

import { logger } from 'firebase-functions/v2';
import type { ChangeItem, ShowRef } from './logic';

const HOST = 'streaming-availability.p.rapidapi.com';
const MAX_PAGES = 20; // 25 changes/page → up to 500 expiring titles; ample for SE/31d

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
 * All SE subscription expirations in [fromSec, toSec] (unix seconds, ≤31 days
 * ahead per MOTN). Reads process.env.MOTN_API_KEY (bound via defineSecret).
 */
export async function fetchExpiringChanges(
  fromSec: number,
  toSec: number,
): Promise<{ changes: ChangeItem[]; shows: Record<string, ShowRef> } | null> {
  const key = process.env.MOTN_API_KEY;
  if (!key) {
    logger.error('leavingRollup: MOTN_API_KEY not set');
    return null;
  }

  const changes: ChangeItem[] = [];
  const shows: Record<string, ShowRef> = {};
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      country: 'se',
      change_type: 'expiring',
      item_type: 'show',
      from: String(fromSec),
      to: String(toSec),
    });
    if (cursor) params.set('cursor', cursor);
    const url = `https://${HOST}/changes?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn('leavingRollup: changes fetch failed', err);
      return changes.length ? { changes, shows } : null;
    }
    if (!res.ok) {
      logger.warn(`leavingRollup: changes -> ${res.status}`);
      return changes.length ? { changes, shows } : null;
    }

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

    if (!json.hasMore || !json.nextCursor) break;
    cursor = json.nextCursor;
  }

  return { changes, shows };
}
