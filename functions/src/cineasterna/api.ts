// functions/src/cineasterna/api.ts
import { logger } from 'firebase-functions/v2';
import { dedupeByImdb, parseSessionId } from './parse';
import { collectAllPages } from './paging';
import type { CineasternaTitle } from './types';

const BASE = 'https://backend.cineasterna.com';
const UA = 'binge.nu catalog sync (+https://binge.nu)';

/**
 * `get_titles` requires a library and each library's catalogue differs slightly
 * (2026-10-06: library 71 Alingsås counted 3896 titles, library 278 counted 3872).
 * Binge shows one badge for every user, so it reads one library's list.
 */
const LIBRARY_ID = 71;

/** A pause between pages, so the weekly run never bursts at their backend. */
const PAGE_GAP_MS = 200;

/** Paging stops after this long, so the run keeps time for TMDB resolution inside its 540s timeout. */
const PAGING_BUDGET_MS = 180_000;

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
    // weekly sync to the function's timeout. 20s is generous for a tiny
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
 * Pull one Swedish library's whole catalogue from `get_titles`, page by page. Malin
 * decided on 2026-10-06 that Binge reads it while Cineasterna publishes no terms against
 * it, and removes it if they object. Returns [] on any failure; the caller then keeps
 * the previous catalogue.
 */
export async function fetchCatalog(): Promise<CineasternaTitle[]> {
  try {
    const sid = await getSession();
    if (!sid) return [];
    const startedAt = Date.now();
    const titles = await collectAllPages(async (page) => {
      if (page > 1) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
      const params = new URLSearchParams({
        library_id: String(LIBRARY_ID),
        country_iso: 'se',
        locale: 'sv',
        page: String(page),
        sort: 'asc',
        portal_sessionid: sid,
      });
      // BIN-293: cap each page so a hung connection can't hold the run to its timeout.
      const res = await fetch(`${BASE}/library/title/get_titles?${params.toString()}`, {
        headers: APP_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        logger.error(`cineasterna: get_titles page ${page} -> ${res.status}`);
        return null;
      }
      return res.json();
    }, { deadlineMs: startedAt + PAGING_BUDGET_MS });
    const elapsedMs = Date.now() - startedAt;
    if (!titles) {
      logger.error('cineasterna: catalogue paging stopped before count was reached', { elapsedMs });
      return [];
    }
    logger.info('cineasterna: catalogue paged', { titles: titles.length, elapsedMs });
    return dedupeByImdb(titles);
  } catch (err) {
    logger.error('cineasterna: fetchCatalog failed', err);
    return [];
  }
}
