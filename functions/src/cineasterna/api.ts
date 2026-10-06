// functions/src/cineasterna/api.ts
import { logger } from 'firebase-functions/v2';
import { parseTitles, dedupeByImdb, parseSessionId } from './parse';
import type { CineasternaTitle } from './types';

const BASE = 'https://backend.cineasterna.com';
const UA = 'binge.nu catalog sync (+https://binge.nu)';

/** `get_new_titles` answers with at most this many titles, measured 2026-10-06 with num_titles=10000. */
const NEW_TITLES_CAP = 50;

/** Headers the Cineasterna web app sends on every backend call (read from its bundle 2026-10-06). */
const APP_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  'X-App-Location': 'https://www.cineasterna.com/sv/',
  'X-Cineasterna-Language': 'sv',
};

/**
 * Open a portal session. Every failure is logged here: before 2026-10-06 a non-200
 * answer returned null without a line, so the sync's log only ever said the
 * catalogue came back empty.
 */
async function getSession(): Promise<string | null> {
  try {
    // BIN-293: cap the handshake — a hung connection would otherwise block the
    // weekly sync to the function's 300s ceiling. 20s is generous for a tiny
    // token POST; the catch below already degrades a throw to null.
    const res = await fetch(`${BASE}/init_portal_session`, {
      method: 'POST',
      headers: { ...APP_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20_000),
    });
    const raw: unknown = await res.json().catch(() => null);
    const sid = res.ok ? parseSessionId(raw) : null;
    if (!sid) logger.error(`cineasterna: init_portal_session -> ${res.status}, no session id`);
    return sid;
  } catch (err) {
    logger.error('cineasterna: session handshake failed', err);
    return null;
  }
}

/**
 * Pull the Swedish catalogue's newest titles. `get_new_titles` caps its answer at 50
 * whatever `num_titles` asks for, so this is not the whole library.
 */
export async function fetchCatalog(): Promise<CineasternaTitle[]> {
  try {
    const sid = await getSession();
    if (!sid) return [];
    const params = new URLSearchParams({ country_iso: 'se', num_titles: String(NEW_TITLES_CAP), portal_sessionid: sid });
    const url = `${BASE}/library/title/get_new_titles?${params.toString()}`;
    // BIN-293: 90s ceiling for the catalogue download — well under the function's
    // 300s timeoutSeconds, leaving room for parse/dedupe. Covers only the fetch; the
    // catch degrades a timeout to [] (next weekly run retries).
    const res = await fetch(url, { headers: APP_HEADERS, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) {
      logger.error(`cineasterna: get_new_titles -> ${res.status}`);
      return [];
    }
    const titles = parseTitles(await res.json());
    if (titles.length >= NEW_TITLES_CAP) {
      logger.warn(`cineasterna: get_new_titles returned its cap of ${NEW_TITLES_CAP}; the catalogue is only the newest titles`);
    }
    return dedupeByImdb(titles);
  } catch (err) {
    logger.error('cineasterna: fetchCatalog failed', err);
    return [];
  }
}
