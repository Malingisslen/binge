// Fil-baserad byggcache för TMDB-detaljsvar (server-only, node:fs).
//
// Syfte: en kod-deploy ska INTE hämta om ~25k titlar. Varje detaljsvar
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

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
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
