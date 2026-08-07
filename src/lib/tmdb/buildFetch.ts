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

// ── Vakthund (BIN-815) ───────────────────────────────────────────────────────
//
// Bygget hängde 4 av 6 körningar 2026-08-07, alltid till byggstegets tidsgräns,
// aldrig långsamt. Sista loggraden var alltid `Collecting page data using 3
// workers ...` och sedan tystnad — ingen stack, ingen delvis progress, inget
// som säger VAD som inte återvände.
//
// Vakthunden finns för att göra nästa hängning läsbar, och dess viktigaste rad
// är den den skriver när INGENTING är i flykt: hänger bygget medan pulsen
// fortsätter rapportera `inflight=0` ligger felet inte i TMDB-lagret.
//
// DEN SLUTSATSEN ÄR BARA GILTIG OM ALLA byggtidsanrop i den fasen är
// registrerade, och det tog tre granskningsrundor att få rätt. Första versionen
// registrerade bara `fetchForBuild` — som inte anropas EN ENDA GÅNG under
// `Collecting page data`. Andra versionen registrerade sitemap:en, som körs i en
// senare fas. Det som faktiskt körs i den hängande fasen är
// `generateStaticParams` i movie/[id] (1000 list-anrop), tv/[id] (1000) och
// person/[id] (~2100 via collectPersonIds). Alla tre anropar `trackBuildCall`.
// Övriga generateStaticParams (provider, genre, billigaste, forsvinner och
// catch-all [...path]) är statiska listor utan nätverk.
//
// INTE instrumenterad: allt som hämtar i den SENARE fasen `Generating static
// pages` — sitemap.ts:s egen kopia av `collectIds` (störst), plus app/page.tsx,
// discover, films, series, provider/[id] och genre/[slug]. Vakthunden lever kvar
// dit men pulsen bär ingen fasmarkör, så `inflight=0` är BARA bevis under
// page-collection. `collectIds` finns i tre nästan identiska kopior; bryts de ut
// till en delad hjälpare ska registreringen följa med.
//
// Timern är unref:ad. En vakthund som själv kunde hålla Node-processen vid liv
// vore ett nytt sätt att hänga bygget — det enda utfall den här ändringen inte
// har råd med.
const WATCHDOG_TICK_MS = 30_000;
// Först bortom BUILD_FETCH_TIMEOUT_MS: en hämtning som lever längre än sitt eget
// abort-tak är per definition något annat än en långsam förfrågan.
const STUCK_AFTER_MS = BUILD_FETCH_TIMEOUT_MS + 10_000;
// Rapportera de äldsta, inte alla. Se kommentaren i tick-loopen.
const STUCK_REPORT_LIMIT = 5;
// En AGGREGAT-post (en etikett som täcker en hel pipeline av anrop) har inget
// eget 20 s-tak — `collectPersonIds` kör två sekventiella allSettled-faser, så
// ~40 s är normalt och friskt. Med samma tröskel som ett enskilt anrop skulle
// varje grönt bygge skriva STUCK, och en rad som alltid syns slutar betyda
// något. Egen, generös tröskel i stället.
const AGGREGATE_STUCK_AFTER_MS = 4 * 60_000;

type InFlight = { label: string; startedAt: number; aggregate: boolean };
const inFlight = new Map<number, InFlight>();
let inFlightSeq = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

/** Injicerbar för test — produktionen loggar till stderr så raden aldrig blandas
 *  ihop med Next egna stdout-progress. */
let logLine: (msg: string) => void = (msg) => process.stderr.write(`${msg}\n`);

function startWatchdog(): void {
  if (watchdog !== null) return;
  watchdog = setInterval(() => {
    const now = Date.now();
    let oldest = 0;
    for (const f of inFlight.values()) {
      const age = now - f.startedAt;
      if (age > oldest) oldest = age;
    }
    // `fetched` räknar BARA fetchForBuild — list-anropen via trackBuildCall
    // kostar ingen refresh-budget, så att blanda in dem skulle göra siffran
    // obegriplig. Namnet säger vad den är i stället för att skriva samma tal
    // två gånger under två etiketter.
    logLine(
      `[build-fetch] pid=${process.pid} inflight=${inFlight.size}` +
        ` fetched=${networkFetches}/${refreshBudget()} oldest=${Math.round(oldest / 1000)}s`,
    );
    // En STUCK-rad för ett ENSKILT anrop betyder att det överlevt sin egen
    // abort-deadline (20 s) — den mest värdefulla signalen verktyget kan ge, för
    // en post som bara köar bakom semaforen avvisas vid 20 s och hinner aldrig
    // hit. En AGGREGAT-post har ingen sådan deadline och får därför en egen,
    // generös tröskel; annars skriver ett friskt bygge STUCK varje puls.
    // Taket på antal rader finns för att tusen samtidiga anrop annars kan bli
    // tusen rader var 30:e sekund om aborten någon gång slutar fungera.
    const stuck = [...inFlight.values()]
      .filter((f) => now - f.startedAt >= (f.aggregate ? AGGREGATE_STUCK_AFTER_MS : STUCK_AFTER_MS))
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const f of stuck.slice(0, STUCK_REPORT_LIMIT)) {
      logLine(`[build-fetch]   STUCK ${Math.round((now - f.startedAt) / 1000)}s  ${f.label}`);
    }
    if (stuck.length > STUCK_REPORT_LIMIT) {
      logLine(`[build-fetch]   … och ${stuck.length - STUCK_REPORT_LIMIT} till`);
    }
    // Ingen avstängning. Första versionen tystnade när budgeten var slut och
    // inget var i flykt — vilket är exakt läget på svansen av ett 25k-sidorsbygge,
    // alltså där en hängning är billigast att missa. En tyst vakthund går inte
    // att skilja från en som aldrig startade. Kostnaden för att låta den gå är
    // en rad var 30:e sekund per worker: ~350 rader på det längsta byggfönstret.
  }, WATCHDOG_TICK_MS);
  // Får aldrig hålla processen vid liv.
  watchdog.unref?.();
}

function stopWatchdog(): void {
  if (watchdog === null) return;
  clearInterval(watchdog);
  watchdog = null;
}

/** Endast för tester: byt ut loggutskriften. */
export function __setBuildFetchLogger(fn: (msg: string) => void): void {
  logLine = fn;
}

/**
 * Starta pulsen utan att göra ett anrop. Anropas överst i de byggtidsfaser som
 * kan hänga innan någon hämtning hunnit registrera sig — annars finns ingen
 * timer att skriva från när fasen är den som fastnar.
 */
export function startBuildWatchdog(): void {
  startWatchdog();
}

/**
 * Registrera ett byggtidsanrop som INTE går genom `fetchForBuild` — det vill
 * säga list-hämtarna i generateStaticParams. Utan detta rapporterar pulsen
 * `inflight=0` mitt i en hängning och pekar utredningen åt fel håll.
 *
 * Kostar ingen budget: budgeten styr cache-refresh av detaljposter, inte
 * listorna, och att räkna dem här skulle tyst krympa detalj-refreshen.
 */
export async function trackBuildCall<T>(
  label: string,
  run: () => Promise<T>,
  opts?: { aggregate?: boolean },
): Promise<T> {
  const token = ++inFlightSeq;
  inFlight.set(token, { label, startedAt: Date.now(), aggregate: opts?.aggregate === true });
  startWatchdog();
  try {
    return await run();
  } finally {
    inFlight.delete(token);
  }
}

/** Nollställ budget-räknaren, vakthunden och in-flight-registret. Endast för tester. */
export function __resetBuildFetchState(): void {
  networkFetches = 0;
  inFlight.clear();
  inFlightSeq = 0;
  stopWatchdog();
  logLine = (msg) => process.stderr.write(`${msg}\n`);
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
  // Före cache-läsningen, inte efter. En varm cache gör noll nätverksanrop —
  // och det är precis det läget en kod-deploy körs i, alltså det läge de fyra
  // hängningarna 2026-08-07 inträffade i. Startade pulsen först vid en
  // cache-miss vore den tyst just då.
  startWatchdog();
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
  // Registrera FÖRE await:en — poängen är att kunna namnge en hämtning som
  // aldrig återvänder, och den hinner aldrig registrera sig själv efteråt.
  const token = ++inFlightSeq;
  inFlight.set(token, { label: `${kind}/${id}`, startedAt: Date.now(), aggregate: false });
  try {
    const data = await fetcher(id, { signal: buildSignal() });
    writeBuildCache(kind, id, data, now);
    return data;
  } catch (err) {
    // Hämtning misslyckades (timeout/429/nät): servera stale om vi har den,
    // annars upp till anroparens fallback.
    if (entry !== null) return entry.data;
    throw err;
  } finally {
    inFlight.delete(token);
  }
}
