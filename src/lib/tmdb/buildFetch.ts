// Byggtids-wrapper runt TMDB-detalj-fetchar (server-only, importeras bara från
// route-filernas generateStaticParams/generateMetadata/page).
//
// Varför: build:en pre-renderar ~25k titelsidor, var och en med ett TMDB-anrop.
// Under last stryper TMDB och anropen köar bakom klientens 8-slot-semafor; en
// sida som väntar förbi Next 60s-tak fäller HELA exporten. En AbortSignal.timeout
// gör att ett anrop ger upp i god tid → fetchern kastar → sidans
// generateMetadata/page faller tillbaka på tom metadata / undefined data
// (try/catch finns redan på alla anropställen) → bygget förblir grönt.
//
// Färskhet via RULLANDE, BUDGETERAD refresh (inte allt-eller-inget):
//   - En post som är färskare än REFRESH_AFTER_MS serveras direkt (ingen fetch).
//   - En stale/saknad post re-hämtas BARA om bygget inte nått sin
//     nätverksbudget (REFRESH_BUDGET). Över budget serveras stale från cache
//     (eller, om posten saknas helt, kastar vi → sidans try/catch ger tunn
//     metadata och posten fylls i ett senare bygge).
//
// Det gör varje kod-deploy tidsbundet oavsett hur kall cachen är (kan aldrig dra
// iväg mot bygg-timeouten), medan den veckovisa schemalagda deployen kör med en
// stor budget (TMDB_BUILD_REFRESH_BUDGET) + längre timeout → full metadata-
// refresh. Eftersom färska poster inte kostar budget vandrar budgeten av sig
// själv genom den stale svansen över flera kod-deployer.
//
// Budgeten är per Next-worker-process (modul-global). Med N workers blir det
// N×budget fetchar totalt, men väggklockan styrs av en enskild workers budget —
// fortfarande bundet, vilket är poängen.

import { readBuildCacheEntry, writeBuildCache } from './buildCache';

type IdFetcher<T> = (id: number, opts?: { signal?: AbortSignal }) => Promise<T>;

// < Next 60s static-generation-tak med god marginal. Långt nog att en frisk
// fetch hinner klart även under måttlig kö, kort nog att aldrig nå taket.
export const BUILD_FETCH_TIMEOUT_MS = 20_000;

// Re-hämta poster äldre än så här (om budget finns); färskare serveras direkt.
export const REFRESH_AFTER_MS = 6 * 24 * 60 * 60 * 1000; // 6 dagar

// Default-tak för nätverkshämtningar per bygge (per worker). Schemalagd deploy
// höjer det via TMDB_BUILD_REFRESH_BUDGET för en full refresh.
// Tajt nog att ett KALLT kod-bygge (alla entries stale → budget förbrukas helt)
// + 25k-sidors render ryms väl under push-byggets timeout även en trög TMDB-dag.
// (3000 tippade över 30 min på en kall cache 2026-06-15.) Cachen värms ändå upp
// av den veckovisa schemalagda full-refreshen; per-bygge-freshness är sekundärt.
const DEFAULT_REFRESH_BUDGET = 1500;

function refreshBudget(): number {
  const v = Number(process.env.TMDB_BUILD_REFRESH_BUDGET);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_REFRESH_BUDGET;
}

// Modul-global räknare över faktiska nätverkshämtningar detta bygge (per worker).
let networkFetches = 0;

/** Nollställ budget-räknaren. Endast för tester. */
export function __resetBuildFetchState(): void {
  networkFetches = 0;
}

/** Antal nätverkshämtningar hittills detta bygge (per worker). För test/insyn. */
export function buildFetchCount(): number {
  return networkFetches;
}

/** AbortSignal med byggtids-deadline. Används även för list-fetcharna i
 *  generateStaticParams (getPopular…/getTopRated…). */
export function buildSignal(): AbortSignal {
  return AbortSignal.timeout(BUILD_FETCH_TIMEOUT_MS);
}

export async function fetchForBuild<T>(
  kind: string,
  fetcher: IdFetcher<T>,
  id: number,
  now: number = Date.now(),
): Promise<T> {
  const entry = readBuildCacheEntry<T>(kind, id, now);

  // Färsk nog → servera direkt, ingen fetch, ingen budget.
  if (entry !== null && now - entry.fetchedAt <= REFRESH_AFTER_MS) {
    return entry.data;
  }

  // Stale eller saknad → vill re-hämta, men respektera nätverksbudgeten.
  if (networkFetches >= refreshBudget()) {
    if (entry !== null) return entry.data; // servera stale hellre än att hämta
    // Helt saknad + över budget: låt anroparens try/catch falla tillbaka på
    // tunn metadata; posten fylls i ett senare bygge när budget finns.
    throw new Error(`build-fetch budget reached; ${kind}/${id} deferred to a later build`);
  }

  networkFetches++;
  try {
    const data = await fetcher(id, { signal: buildSignal() });
    writeBuildCache(kind, id, data, now);
    return data;
  } catch (err) {
    // Hämtning misslyckades (timeout/429/nät): servera stale om vi har den,
    // annars upp till anroparens fallback.
    if (entry !== null) return entry.data;
    throw err;
  }
}
