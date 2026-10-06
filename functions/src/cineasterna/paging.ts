// functions/src/cineasterna/paging.ts
import { parseTitles } from './parse';
import type { CineasternaTitle } from './types';

/**
 * A ceiling on pages per run, so a server that keeps answering with titles can't hold
 * the function until its timeout. Library 71 measured 3896 titles at 28 per page
 * (2026-10-06), which needs 140 pages.
 */
export const MAX_PAGES = 400;

/** One `get_titles` answer: `{ count, titles, success }`, or null when unusable. */
export function parseTitlesPage(json: unknown): { count: number; titles: CineasternaTitle[]; raw: number } | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as { success?: unknown; count?: unknown; titles?: unknown };
  if (o.success !== true || typeof o.count !== 'number' || !Array.isArray(o.titles)) return null;
  return { count: o.count, titles: parseTitles(json), raw: o.titles.length };
}

/**
 * Page through `get_titles` from page 1 until the raw titles seen reach the answer's
 * `count`, the way the Cineasterna web app does. Any unusable page returns null so
 * the caller keeps the previous catalogue instead of saving a partial one. An empty
 * page before `count` is reached is unusable too.
 */
export async function collectAllPages(
  fetchPage: (page: number) => Promise<unknown>,
  { maxPages = MAX_PAGES, deadlineMs = Infinity, now = Date.now }: {
    maxPages?: number;
    /** Epoch ms after which no further page is requested, leaving the run time for TMDB resolution. */
    deadlineMs?: number;
    now?: () => number;
  } = {},
): Promise<CineasternaTitle[] | null> {
  const out: CineasternaTitle[] = [];
  let seen = 0;
  for (let page = 1; page <= maxPages; page++) {
    if (now() > deadlineMs) return null;
    const parsed = parseTitlesPage(await fetchPage(page));
    if (!parsed || parsed.raw === 0) return null;
    out.push(...parsed.titles);
    seen += parsed.raw;
    if (seen >= parsed.count) return out;
  }
  return null;
}
