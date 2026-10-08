// Fil-baserad byggcache för TMDB-detaljsvar (server-only, node:fs).
//
// Syfte: en kod-deploy ska INTE hämta om titlarna. Varje detaljsvar
// persistas i .tmdb-cache/{kind}-{id}.json med en tidsstämpel; nästa build
// återanvänder det. Cache-katalogen persistas mellan CI-körningar via
// actions/cache (se .github/workflows/deploy.yml).
//
// Färskhets-beslutet (när en post ska re-hämtas) bor i anroparen
// (buildFetch.ts), inte här — den här modulen läser/skriver bara råa poster +
// tidsstämpel och tillämpar ett HÅRT tak (HARD_TTL) bortom vilket en post är
// för gammal för att ens serveras stale. Det gör att buildFetch kan göra en
// MJUK, budgeterad rullande refresh istället för en allt-eller-inget-bust som
// sprängde bygg-timeouten.
//
// Best-effort: alla fel (saknad/korrupt fil, skrivfel) behandlas som miss och
// får ALDRIG bryta bygget.

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Hårt tak: en post äldre än så här serveras inte ens som stale — den
// behandlas som saknad (→ buildFetch hämtar färskt eller faller tillbaka på
// tunn metadata). Generöst tilltaget; den mjuka refresh-tröskeln (buildFetch)
// är mycket kortare, så i praktiken når nästan inga poster hit.
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagar

export interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

// TMDB_CACHE_DIR override:as i tester; default .tmdb-cache/ i repo-roten
// (gitignored, persistas via actions/cache).
//
// Exporterad för att selectionManifest.ts lägger sina filer i SAMMA katalog och
// därmed rider på samma actions/cache-livscykel. Två kopior av sökvägslogiken
// hade kunnat glida isär och tyst lämna manifesten utanför cachen — vilket ser
// ut som "manifestet saknas varje bygge", alltså precis den härledning per
// deploy som BIN-823 finns för att ta bort.
export function buildCacheDir(): string {
  return process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache');
}

function cachePath(kind: string, id: number): string {
  return join(buildCacheDir(), `${kind}-${id}.json`);
}

/**
 * Läs den råa cache-posten (data + tidsstämpel) eller null vid miss/korrupt/
 * bortom HARD_TTL. Anroparen avgör om posten är färsk nog att slippa refresh.
 */
export function readBuildCacheEntry<T>(
  kind: string,
  id: number,
  now: number = Date.now(),
): CacheEntry<T> | null {
  try {
    const raw = readFileSync(cachePath(kind, id), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== 'number') return null;
    if (now - entry.fetchedAt > HARD_TTL_MS) return null; // för gammal → behandla som miss
    return entry;
  } catch {
    return null; // saknad / korrupt -> miss
  }
}

export function writeBuildCache<T>(kind: string, id: number, data: T, now: number = Date.now()): void {
  try {
    mkdirSync(buildCacheDir(), { recursive: true });
    stampContentChange(kind, id, data, now);
    const entry: CacheEntry<T> = { fetchedAt: now, data };
    // Atomisk skrivning (temp + rename) så parallella Next-workers aldrig
    // läser en halvskriven fil.
    const tmp = `${cachePath(kind, id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, cachePath(kind, id));
  } catch {
    // best-effort — skrivfel får aldrig fälla bygget
  }
}

// ---- Sitemap support (SEO-5 / SEO-13) ----
//
// `lastmod` in the sitemap should say when a page's CONTENT last changed, not when
// the build ran: every weekly refresh re-fetches every title, and a lastmod that
// moves on all of them at once tells Google nothing. So each refresh compares the
// page-visible part of the new answer with the old one and only moves a small
// sidecar stamp (`{kind}-{id}.changed`) when they differ.

/**
 * Fields TMDB moves on nearly every fetch: ranking numbers, and the "similar
 * titles" lists, whose order follows popularity. The page does show the rating,
 * so a rating change alone does not move lastmod — on purpose, or every title
 * would carry a new date every week.
 */
const VOLATILE_KEYS = new Set(['popularity', 'vote_average', 'vote_count', 'recommendations', 'similar']);

/** Hash of the page-visible content of a TMDB detail answer. */
export function contentFingerprint(data: unknown): string {
  const json = JSON.stringify(data, (key, value) => (VOLATILE_KEYS.has(key) ? undefined : value));
  return createHash('sha1').update(json ?? '').digest('hex');
}

function changedPath(kind: string, id: number): string {
  return join(buildCacheDir(), `${kind}-${id}.changed`);
}

function stampContentChange(kind: string, id: number, data: unknown, now: number): void {
  try {
    const old = readBuildCacheEntry<unknown>(kind, id, now);
    if (old !== null && contentFingerprint(old.data) === contentFingerprint(data)) {
      // Unchanged. Keep an existing stamp; an entry from before stamps existed
      // gets its own fetch time, the latest moment the content is known to be from.
      if (readContentChangedAt(kind, id) === null) writeFileSync(changedPath(kind, id), String(old.fetchedAt));
      return;
    }
    writeFileSync(changedPath(kind, id), String(now));
  } catch {
    // best-effort, like the cache itself
  }
}

/** When this entry's page-visible content last changed, or null when unknown. */
export function readContentChangedAt(kind: string, id: number): number | null {
  try {
    const n = Number(readFileSync(changedPath(kind, id), 'utf8'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// A pre-rendered title whose build fetch failed ships `noindex` (see
// generateMetadata in the title routes). The marker lets the sitemap leave that
// URL out instead of submitting a page that tells Google not to index it.
//
// The marker can be ONE BUILD behind. Next renders the sitemap routes in the same
// "Generating static pages" phase as the title pages, in no fixed order (measured:
// a local build listed ids whose marker the same build wrote). So the sitemap reads
// whatever the latest build to reach that id left: a page that fails now can stay
// listed until the next build, and one that recovers can stay out until then.
// The content-change stamp above lags the same way.

function failedPath(kind: string, id: number): string {
  return join(buildCacheDir(), `${kind}-${id}.failed`);
}

export function recordBuildFetchOutcome(kind: string, id: number, ok: boolean): void {
  try {
    if (ok) {
      unlinkSync(failedPath(kind, id));
    } else {
      mkdirSync(buildCacheDir(), { recursive: true });
      writeFileSync(failedPath(kind, id), '');
    }
  } catch {
    // ENOENT on a success is the normal case; anything else is best-effort.
  }
}

export function buildFetchFailed(kind: string, id: number): boolean {
  return existsSync(failedPath(kind, id));
}
