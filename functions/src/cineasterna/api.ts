// functions/src/cineasterna/api.ts
import { logger } from 'firebase-functions/v2';
import { parseTitles, dedupeByImdb } from './parse';
import type { CineasternaTitle } from './types';

const BASE = 'https://backend.cineasterna.com';
const UA = 'binge.nu catalog sync (+https://binge.nu)';

/** Obtain a portal_sessionid via the handshake confirmed in Step 1. */
async function getSession(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/renew_portal_csrftoken`, {
      method: 'POST',
      headers: { 'User-Agent': UA },
    });
    const raw: unknown = await res.json().catch(() => ({}));
    const json: Record<string, unknown> =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const sid = json['portal_sessionid'] ?? null;
    if (typeof sid !== 'string' || sid.length === 0) return null;
    return sid;
  } catch (err) {
    logger.error('cineasterna: session handshake failed', err);
    return null;
  }
}

/** Pull the full Swedish catalogue (national feed, large page). */
export async function fetchCatalog(): Promise<CineasternaTitle[]> {
  try {
    const sid = await getSession();
    if (!sid) return [];
    const params = new URLSearchParams({ country_iso: 'se', num_titles: '10000', portal_sessionid: sid });
    const url = `${BASE}/library/title/get_new_titles?${params.toString()}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      logger.warn(`cineasterna: get_new_titles -> ${res.status}`);
      return [];
    }
    const titles = parseTitles(await res.json());
    return dedupeByImdb(titles);
  } catch (err) {
    logger.error('cineasterna: fetchCatalog failed', err);
    return [];
  }
}
