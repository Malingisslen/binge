// Fil-baserad byggcache för TMDB-detaljsvar (server-only, node:fs).
//
// Syfte: en kod-deploy ska INTE hämta om ~25k titlar. Varje detaljsvar
// persistas i .tmdb-cache/{kind}-{id}.json med en tidsstämpel; nästa build
// återanvänder det inom TTL. Cache-katalogen persistas mellan CI-körningar
// via actions/cache (se .github/workflows/deploy.yml). Veckovis schemalagd
// deploy sätter TMDB_CACHE_BUST=1 -> färsk hämtning som repopulerar cachen.
//
// Best-effort: alla fel (saknad/korrupt fil, skrivfel) behandlas som miss och
// får ALDRIG bryta bygget.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagar

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

// TMDB_CACHE_DIR override:as i tester; default .tmdb-cache/ i repo-roten
// (gitignored, persistas via actions/cache).
function cacheDir(): string {
  return process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache');
}

function cachePath(kind: string, id: number): string {
  return join(cacheDir(), `${kind}-${id}.json`);
}

export function readBuildCache<T>(kind: string, id: number, now: number = Date.now()): T | null {
  // Bust: tvinga miss så builden hämtar färskt och skriver om cachen.
  if (process.env.TMDB_CACHE_BUST === '1') return null;
  try {
    const raw = readFileSync(cachePath(kind, id), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.fetchedAt !== 'number') return null;
    if (now - entry.fetchedAt > TTL_MS) return null;
    return entry.data;
  } catch {
    return null; // saknad / korrupt -> miss
  }
}

export function writeBuildCache<T>(kind: string, id: number, data: T, now: number = Date.now()): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
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
