// Persisterat URVAL av vilka titel-id:n som pre-renderas (BIN-823).
//
// buildCache.ts cachar SVAREN för ett id. Den här modulen cachar frågan innan
// den: VILKA id:n bygget överhuvudtaget ska rendera. Fram till nu härleddes den
// listan färskt vid varje bygge ur TMDB:s populäritetslistor — ~8 200 ocachade
// anrop per deploy, och eftersom TMDB:s ranking roterar veckovis roterade
// urvalet med den. En titel som ramlade ur listan slutade pre-renderas, föll
// till catch-all-routens `noindex`-default (rätt för okända sökvägar, förödande
// för en sida Google redan indexerat) och avindexerades. GSC: 264 → 117
// indexerade sidor på fem veckor, 16 av 20 stickprov ur de kvarvarande svarade
// `noindex`.
//
// SPÄRRHAKE, inte frysning: en ren frysning hade svält nytt innehåll (nya
// populära titlar hade aldrig fått en sida). Måndagsbygget härleder om och
// UNIONERAR med det tidigare urvalet; kod-deployer läser bara. Ett id lämnar
// urvalet först när taket tvingar fram evakuering, och då går det äldsta först
// — långsamt, vid marginalen, i stället för veckovis rotation genom hela listan.
//
// Taken sänktes 2026-10-05 (ADR 0024, Malins "Banta"): Google valde bort de
// ~29 000 tunna titelsidorna och lät dem dra ned hela domänen. Urvalet är nu en
// kärna av titlar som går att se på en svensk tjänst. Personsidorna har inget
// urval längre; de förrenderas inte för Google.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { buildCacheDir } from './buildCache';
import {
  buildCallStats,
  isSelectionRefresh,
  withAggregateTimeout,
  RESCUE_DERIVE_TIMEOUT_MS,
  REFRESH_DERIVE_TIMEOUT_MS,
  type BuildCallStats,
} from './buildFetch';

export type SelectionType = 'movie' | 'tv';

// Bump:as vid inkompatibel schemaändring. En äldre version läses som "saknas" →
// bygget härleder om i stället för att tolka fält som flyttat.
//
// 2 (ADR 0024): urvalets KÄLLA bytte, inte bara schemat. Ett v1-manifest bär
// ~10 000 id ur topplistorna; att läsa det mot det nya taket hade evakuerat ned
// till 1 000 av fel titlar, och 80 %-regeln i `floorFor` hade fällt bygget.
export const MANIFEST_VERSION = 2;

export interface ManifestEntry {
  id: number;
  /** Senaste bygge där id:t fanns med i en FÄRSK härledning. Driver evakuering. */
  lastDerived: number;
}

export interface SelectionManifest {
  version: number;
  type: SelectionType;
  /** Senaste lyckade härledning. Driver staleness, inte evakuering. */
  derivedAt: number;
  /** First-seen-ordning — bärande, se mergeManifest. */
  ids: ManifestEntry[];
}

// Ändra INTE utan ett beslut (ADR 0024). En höjning är en kostnads- OCH en
// SEO-fråga: räkna lagringen per sida mot den mätta punkten i ADR 0018 Fork B,
// och mät först om kärnan blivit indexerad.
//
// Invarianten TAK > HÄRLEDNING bär spärrhaken: härledningen kapas vid
// `SEO_TITLE_TARGET_IDS` i seoCoverage.ts, så luften är skillnaden mellan talen.
export const SELECTION_CEILING: Record<SelectionType, number> = {
  movie: 1_000,
  tv: 1_000,
};

// Absolut täckningsgolv. Fångar EN sak: att bygget hamnat på ren fallback
// (`SEO_FALLBACK_*` ger 10 id per typ) och är på väg att ersätta kärnan med den.
// Det är inte en kvalitetsribba på härledningen.
//
// Sänkt med taket i ADR 0024. Golvet ska ligga långt över fallbacken och under en
// strypt härledning; ett bygge 2026-08-08 fick ungefär hälften av listsidorna
// genom TMDB:s strypning, och `Promise.allSettled` sväljer resten.
export const SELECTION_ABSOLUTE_FLOOR: Record<SelectionType, number> = {
  movie: 500,
  tv: 500,
};

/**
 * Bygget saknar med flit TMDB-åtkomst och får därför ha ett tunt urval.
 *
 * INGEN workflow sätter den längre — de två som gjorde det raderades i BIN-1028
 * (Malins beslut 2026-08-27) eftersom de aldrig körde på main. Kontrollera i stället
 * för att tro på den här meningen: `grep -rn SELECTION_ALLOW_THIN .github/`. Flaggan
 * är numera ett rent lokalt verktyg: den finns kvar för ett bygge man kör för hand
 * utan TMDB-nyckel.
 *
 * `deploy.yml` sätter den ALDRIG, och det är fortfarande den egenskap golvet vilar
 * på — den är enda vägen till produktion, och där ska ett tunt urval fälla bygget.
 * Att gissa på nyckelns värde i stället ("är den 'ci-dummy'?") vore att lägga en
 * byggdetalj i produktionskod, vilket är varför flaggan är uttrycklig.
 */
export function allowThinSelection(): boolean {
  return process.env.SELECTION_ALLOW_THIN === '1';
}

// Samma hårda tak som buildCache: ett manifest äldre än så här betyder att den
// veckovisa refreshen varit trasig i en månad, och då är urvalet inte längre
// något vi vill fortsätta lita på blint.
export const MANIFEST_HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function manifestPath(type: SelectionType): string {
  return join(buildCacheDir(), `selection-${type}.json`);
}

/**
 * Täckningsgolvet för en typ.
 *
 * Det ABSOLUTA golvet är det som betyder något, och det gäller oavsett om det
 * finns ett tidigare manifest. Det är en rättelse av en tidigare utformning som
 * bara jämförde mot föregående urval: spärrhaken garanterar att urvalet aldrig
 * KRYMPER (mergen behåller allt under taket), så ett relativt golv kunde per
 * konstruktion aldrig fyra. Den farliga vägen är den motsatta — manifestet
 * borta (evakuerad actions/cache) OCH härledningen misslyckad, alltså
 * previousCount = 0 och ett urval av bara fallback-id. Ett relativt
 * golv passerar det glatt; ett absolut fäller det.
 *
 * 80 %-regeln finns kvar som komplement för den dag mergen får en väg att
 * krympa (en framtida sänkning av taket, en migrering): då ska ett stort tapp
 * fällas även om det landar över det absoluta golvet.
 */
export function floorFor(type: SelectionType, previousCount: number): number {
  if (allowThinSelection()) return 0;
  return Math.max(SELECTION_ABSOLUTE_FLOOR[type], Math.ceil(Math.max(previousCount, 0) * 0.8));
}

/**
 * Egen felklass i stället för att sniffa på meddelandeprefix.
 *
 * Routernas `catch` finns för att en TMDB-hick ska ge tunn metadata i stället
 * för ett fällt bygge — men golvets kast MÅSTE ta sig förbi den. En kontroll på
 * `message.startsWith('[selection]')` vore ett kontrakt duplicerat i tre filer
 * och upphävt av vilken omslagande `throw new Error(err.message)` som helst.
 */
export class SelectionFloorError extends Error {
  // Utan detta skriver bygglogggen `Error: [selection] …` och den som läser
  // stackspårningen ser inte att det var golvet som avsiktligt fällde bygget.
  override name = 'SelectionFloorError';
}

/**
 * Kastar om det upplösta urvalet krympt under golvet.
 *
 * Poängen är att bevara dagens felbeteende, inte mildra det. Innan BIN-823 gav
 * en trasig härledning ett RÖTT bygge (hängning → byggstegets tidsgräns) och
 * den gamla sajten låg kvar. Med manifest + fallback finns plötsligt en tyst
 * väg: härledningen misslyckas, `SEO_FALLBACK_*` ger 10 id:n per typ, bygget
 * blir GRÖNT och `firebase deploy` ersätter kärnan med en handfull sidor. Det vore
 * exakt den skada den här filen finns för att stoppa, fast utan larm.
 */
export function assertCoverageFloor(
  type: SelectionType,
  resolvedCount: number,
  previousCount: number,
): void {
  const floor = floorFor(type, previousCount);
  if (resolvedCount < floor) {
    throw new SelectionFloorError(
      `[selection] ${type}: urvalet gav ${resolvedCount} id:n, golvet är ${floor} ` +
        `(föregående urval: ${previousCount}). Bygget fälls hellre än att deploya ` +
        `en förkrympt sajt — se BIN-823.\n` +
        `  · Produktion: kör om deployen som workflow_dispatch med full_refresh=true ` +
        `(obegränsad budget, 175-minutersfönster) så härledningen hinner klart.\n` +
        `  · Bygge helt utan TMDB-nyckel: sätt SELECTION_ALLOW_THIN=1.`,
    );
  }
}

export function isManifestStale(manifest: SelectionManifest, now: number = Date.now()): boolean {
  return now - manifest.derivedAt > MANIFEST_HARD_TTL_MS;
}

/**
 * Tolka ett rått manifest. Allt tvivelaktigt → null, vilket anroparen behandlar
 * som "saknas" och härleder om. Typkontrollen finns för att en felläst fil
 * (movie-manifestet under tv:s namn) annars hade sett giltig ut och tyst bytt
 * ut hela ena mediatypens urval.
 */
export function parseManifest(raw: string, expectedType: SelectionType): SelectionManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SelectionManifest>;
    if (parsed.version !== MANIFEST_VERSION) return null;
    if (parsed.type !== expectedType) return null;
    if (typeof parsed.derivedAt !== 'number') return null;
    if (!Array.isArray(parsed.ids)) return null;
    const ids: ManifestEntry[] = [];
    for (const entry of parsed.ids) {
      if (!entry || typeof entry !== 'object') return null;
      const { id, lastDerived } = entry as ManifestEntry;
      if (!Number.isFinite(id) || !Number.isFinite(lastDerived)) return null;
      ids.push({ id, lastDerived });
    }
    return { version: MANIFEST_VERSION, type: expectedType, derivedAt: parsed.derivedAt, ids };
  } catch {
    return null;
  }
}

/**
 * Spärrhaken. Ren funktion — all IO ligger utanför.
 *
 * 1. Utgå från föregående urval; behållna id:n behåller sin first-seen-position.
 * 2. Id som finns i BÅDA: `lastDerived` bumpas, positionen är orörd.
 * 3. Id som bara finns i föregående: behålls orört. Det är hela poängen — det
 *    är rotationen vi vägrar följa. Dess `lastDerived` åldras, vilket gör det
 *    till första evakueringskandidat om taket någon gång tvingar fram ett val.
 * 4. Nya id:n appendas i härledningsordning.
 * 5. Över taket: evakuera äldst `lastDerived` först. Vid LIKA ålder evakueras
 *    den SENAST tillkomna först — inte den först insatta. Riktningen är inte en
 *    smaksak, den är hela spärrhaken: en full refresh bumpar alla närvarande
 *    id:n till samma `now`, så oavgjort är normalfallet, inte ett undantag.
 *    Med motsatt ordning evakueras de sittande och nykomlingarna behålls, vilket
 *    ger 100 % utbyte varje vecka — exakt den rotation modulen finns för att
 *    stoppa. (Fångades av integrationsgranskningen 2026-08-08; koden gjorde fel
 *    och testet pinnade felet som avsikt. Replay: tak 1 000, härledning 3 000,
 *    två veckor ⇒ 0 av 1 000 överlevande.) Överlevarna emitteras i
 *    first-seen-ordning, INTE i evakueringssorteringens ordning.
 *
 * En tom `freshIds` betyder misslyckad härledning, inte "urvalet är tomt": då
 * returneras föregående manifest oförändrat, med `derivedAt` intakt så att
 * staleness-klockan inte nollställs av ett bygge som aldrig hämtade något.
 */
export function mergeManifest(
  previous: SelectionManifest | null,
  type: SelectionType,
  freshIds: readonly number[],
  now: number = Date.now(),
): SelectionManifest {
  if (freshIds.length === 0 && previous !== null) return previous;

  const fresh = new Set(freshIds);
  const merged: ManifestEntry[] = [];
  const seen = new Set<number>();

  for (const entry of previous?.ids ?? []) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(fresh.has(entry.id) ? { id: entry.id, lastDerived: now } : entry);
  }
  for (const id of freshIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, lastDerived: now });
  }

  const ceiling = SELECTION_CEILING[type];
  let ids = merged;
  if (merged.length > ceiling) {
    const byAge = merged
      .map((entry, index) => ({ entry, index }))
      // Ålder först; vid lika ålder högst index (senast tillkommen) först ut.
      .sort((a, b) => a.entry.lastDerived - b.entry.lastDerived || b.index - a.index);
    const evicted = new Set(byAge.slice(0, merged.length - ceiling).map(x => x.index));
    ids = merged.filter((_, index) => !evicted.has(index));
  }

  return { version: MANIFEST_VERSION, type, derivedAt: now, ids };
}

/**
 * Manifestets id:n plus frö-id:n som inte redan finns där.
 *
 * Frön unioneras vid LÄSNING och lagras aldrig i manifestet. Därför kan de inte
 * evakueras av taket, och de överlever ett raderat, korrupt eller för gammalt
 * manifest.
 */
export function resolvedIds(
  manifest: SelectionManifest | null,
  seedIds: readonly number[] = [],
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of manifest?.ids ?? []) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    ids.push(entry.id);
  }
  for (const id of seedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Läs manifestet för en typ, eller null vid saknad/korrupt/fel version/fel typ. */
export function readSelectionManifest(type: SelectionType): SelectionManifest | null {
  try {
    return parseManifest(readFileSync(manifestPath(type), 'utf8'), type);
  } catch {
    return null;
  }
}

/**
 * Skriv manifestet atomiskt (temp + rename, samma mönster som buildCache).
 *
 * Atomiciteten är inte teoretisk här: cache-sparningen i deploy.yml kör med
 * `if: always()`, alltså även när bygget fällts halvvägs. Med en direktskrivning
 * hade den kunnat tara en halvskriven fil och göra nästa bygges manifest
 * korrupt. Med rename ser sparningen alltid antingen förra bygget eller det
 * här — aldrig något däremellan.
 */
export function writeSelectionManifest(manifest: SelectionManifest): void {
  try {
    mkdirSync(buildCacheDir(), { recursive: true });
    const target = manifestPath(manifest.type);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest));
    renameSync(tmp, target);
  } catch {
    // Best-effort: ett skrivfel ska inte fälla bygget HÄR. Nästa bygge härleder
    // om. Men om skrivningen aldrig lyckas fäller sitemapen bygget senare, med
    // flit.
  }
}

/**
 * Hur många id:n en utbytesrad räknar upp innan den kortar av. Formen är
 * `buildFetch.ts`s (`… och N till`): en full uppräkning är oläsbar och riskerar
 * loggradsgränsen.
 */
const EXCHANGE_SAMPLE_LIMIT = 5;

function sample(ids: readonly (number | string)[]): string {
  if (ids.length === 0) return '—';
  const head = ids.slice(0, EXCHANGE_SAMPLE_LIMIT).join(', ');
  return ids.length > EXCHANGE_SAMPLE_LIMIT
    ? `${head} … och ${ids.length - EXCHANGE_SAMPLE_LIMIT} till`
    : head;
}

/**
 * BIN-1423: vad härledningen tappade på vägen. Räknas ur buildFetch.ts räknare
 * mellan att `derive` startar och att den avgörs eller når sitt tak; ett anrop
 * som överges efter det hör inte till den här härledningen.
 */
interface AbandonedDuringDerive {
  started: number;
  abandoned: number;
  labels: string[];
}

function abandonedSince(type: SelectionType, before: BuildCallStats): AbandonedDuringDerive {
  const after = buildCallStats(type);
  return {
    started: after.started - before.started,
    abandoned: after.abandoned - before.abandoned,
    labels: after.abandonedLabels.slice(before.abandonedLabels.length),
  };
}

function abandonedNote(a: AbandonedDuringDerive): string {
  return `Övergivna anrop ${a.abandoned} av ${a.started}${a.abandoned > 0 ? ` (${sample(a.labels)})` : ''}.`;
}

/**
 * Utbytet vid mergen (BIN-826) — utan det märks ett tyst haveri först i Search
 * Console, veckor senare. Skrivs vid varje LYCKAD härledning, alltså även på en
 * räddningshärledning under en vanlig kod-deploy, inte bara i veckobygget.
 *
 * Härleds ur `mergeManifest`-körningens in- och utdata; funktionen
 * anropas aldrig en andra gång för att "återskapa" det evakuerade, eftersom en
 * andra körning med ett annat `now` inte är samma beräkning.
 *
 * Talet som svarar på hur länge andrummet räcker är `evicted`, inte
 * `refreshed`: en post lämnar urvalet när taket trycker ut den.
 */
function reportExchange(
  type: SelectionType,
  previous: SelectionManifest | null,
  freshIds: readonly number[],
  merged: SelectionManifest,
  abandoned: AbandonedDuringDerive,
): void {
  const before = new Set((previous?.ids ?? []).map(e => e.id));
  const after = new Set(merged.ids.map(e => e.id));
  const fresh = new Set(freshIds);

  const retained: number[] = [];
  const evicted: number[] = [];
  for (const id of before) (after.has(id) ? retained : evicted).push(id);
  const added = merged.ids.filter(e => !before.has(e.id)).map(e => e.id);
  let refreshed = 0;
  for (const id of before) if (fresh.has(id)) refreshed += 1;

  // En härledning som tappat anrop blir en varning, så en krympt vecka syns i sammanfattningen.
  const level = abandoned.abandoned > 0 ? 'warning' : 'notice';
  process.stderr.write(
    `::${level}::[selection] ${type} utbyte: behållna ${retained.length}, ` +
      `evakuerade ${evicted.length}, nytillkomna ${added.length}, ` +
      `varav omhärledda ${refreshed} av ${before.size}. ` +
      `Härledningen gav ${freshIds.length} id, manifestet håller ${after.size} ` +
      `(tak ${SELECTION_CEILING[type]}). Evakuerade: ${sample(evicted)}. ` +
      `Nytillkomna: ${sample(added)}. ${abandonedNote(abandoned)}\n`,
  );

  // Över taket degraderar spärrhaken TYST till rotation: allt som härleds får
  // plats bara om det ryms, och resten evakueras varje vecka — exakt det
  // nederlag modulen finns för att stoppa. Invarianten TAK > HÄRLEDNING är
  // framtvingad av `SEO_TITLE_TARGET_IDS` mot `SELECTION_CEILING`.
  if (freshIds.length >= SELECTION_CEILING[type]) {
    process.stderr.write(
      `::warning::[selection] ${type}: härledningen gav ${freshIds.length} id mot taket ` +
        `${SELECTION_CEILING[type]}. Spärrhaken har ingen luft kvar och degraderar till ` +
        `rotation — höj taket med en kostnadssatt biljett, eller krymp härledningen.\n`,
    );
  }
}

/**
 * Hela urvalsbeslutet för en route, på ett ställe.
 *
 * Ligger här och inte i route-filerna: duplicering är det som fick sitemap och
 * pre-render att glida isär och producera "Genomsökt – inte indexerad". Härled
 * anroparna med `git grep -n "resolveSelection(" -- src/app`; funktionen får
 * inte kopieras. Sitemapen anropar den INTE —
 * den läser samma artefakt via `readSelectionManifest` + `resolvedIds`, vilket
 * är samma id-mängd i samma ordning utan att kunna trigga en härledning.
 *
 * Ordningen är medveten:
 *  1. Läs manifestet. Ett färskt manifest på en kod-deploy är hela vinsten —
 *     noll listanrop, noll skrivningar.
 *  2. Härled bara om regimen säger det (veckobygget) eller om manifestet saknas
 *     eller är för gammalt. Ett för gammalt manifest betyder att veckobygget
 *     varit trasigt i en månad; att fortsätta bygga på det i evighet vore att
 *     byta ut en tyst avindexering mot en tyst förstening.
 *  3. Härledningen körs under fastak — kort i räddningsläget, långt i
 *     veckobygget.
 *  4. Golvet sist, mot antalet id:n i FÖREGÅENDE manifest. Går bygget under det
 *     kastar vi hellre än att låta `firebase deploy` ersätta kärnan med en
 *     handfull fallback-id:n.
 */
export async function resolveSelection(opts: {
  type: SelectionType;
  /** Id som alltid ska med, oavsett manifest. Inga routrar skickar några sedan ADR 0024. */
  seedIds?: readonly number[];
  /** Den färska härledningen — de dyra listanropen. Körs bara när den behövs. */
  derive: () => Promise<number[]>;
  /** Sista utväg när ingenting annat finns (bygge utan giltig TMDB-nyckel). */
  fallbackIds: readonly number[];
  now?: number;
}): Promise<number[]> {
  const { type, seedIds = [], derive, fallbackIds, now = Date.now() } = opts;

  const previous = readSelectionManifest(type);
  // Räknas seed-inkluderat på BÅDA sidor, annars är 80 %-regeln systematiskt
  // slappare med precis antalet frön.
  const previousCount = resolvedIds(previous, seedIds).length;
  const stale = previous !== null && isManifestStale(previous, now);
  // Ett manifest som redan ligger under golvet är inte något att bygga vidare
  // på. Utan det här villkoret kunde EN misslyckad kall härledning skriva ett
  // tunt manifest, och varje efterföljande kod-deploy hade sett det som
  // "färskt", hoppat över härledningen och dött på golvet — rött i upp till 30
  // dagar tills staleness-taket löste ut. Nu härleder nästa bygge i stället.
  const tooThin = previous !== null && previousCount < floorFor(type, 0);
  const refresh = isSelectionRefresh();
  const mustDerive = refresh || previous === null || stale || tooThin;

  let manifest = previous;

  if (mustDerive) {
    if (stale && !refresh) {
      // GitHub Actions plockar upp ::warning:: i körningssammanfattningen. Att
      // bara härleda tyst hade dolt att veckobygget varit trasigt i en månad.
      process.stderr.write(
        `::warning::[selection] ${type}-manifestet är äldre än 30 dagar — ` +
          `veckobygget har troligen inte gått igenom. Härleder om under kort tak.\n`,
      );
    }
    const budget = refresh ? REFRESH_DERIVE_TIMEOUT_MS : RESCUE_DERIVE_TIMEOUT_MS;
    // En härledning som KASTAR måste behandlas precis som en som tar för lång
    // tid. Läts felet passera vidare fångades det av routernas fallback-catch,
    // som svarar SEO_FALLBACK_* — tio id:n, grönt bygge, deploy. Det är exakt
    // det golvet finns för att förhindra, på en väg golvet aldrig ens nåddes.
    // Fullt nåbar: `collectIds` läser `r.value.results` utanför allSettled, så
    // ett 200-svar med oväntad form kastar rakt ur `derive`.
    // De två felen får INTE dela varningsrad. En tidigare utformning skrev
    // "kastade …" i catch-satsen och lät sedan den gemensamma else-grenen skriva
    // "nådde sitt tak (N ms)" ovanpå — alltså en osann andra rad vid varje kast,
    // som pekar nästa hängningsutredning mot ett tak som aldrig löpte ut.
    // (Den överlappningen gjorde också att ett test på ::warning::-prefixet
    // kunde uppfyllas av grannraden; testgranskningen 2026-08-08.)
    let derived: { ok: true; value: number[] } | { ok: false };
    const callsBefore = buildCallStats(type);
    let abandoned: AbandonedDuringDerive;
    try {
      derived = await withAggregateTimeout(derive, budget);
      abandoned = abandonedSince(type, callsBefore);
      if (!derived.ok) {
        process.stderr.write(
          `::warning::[selection] ${type}: härledningen nådde sitt tak (${budget} ms). ` +
            `Behåller befintligt urval; täckningsgolvet avgör om bygget får fortsätta. ${abandonedNote(abandoned)}\n`,
        );
      }
    } catch (err) {
      abandoned = abandonedSince(type, callsBefore);
      process.stderr.write(
        `::warning::[selection] ${type}: härledningen kastade (${String(err)}). ` +
          `Behåller befintligt urval; täckningsgolvet avgör om bygget får fortsätta. ${abandonedNote(abandoned)}\n`,
      );
      derived = { ok: false };
    }
    if (derived.ok) {
      // En härledning som LYCKAS MED TOM LISTA är en tredje tyst väg, skild från
      // taket och kastet ovan: `mergeManifest` returnerar då `previous` oförändrat,
      // golvet mäter mot samma tal som förra bygget och passerar, och ingenting i
      // loggen skiljer den från ett bygge som faktiskt hämtade allt. Raden nedan
      // namnger just det fallet — den delar medvetet inte lydelse med
      // utbytesraden, som fyrar på SAMMA händelse med 0 evakuerade och 0 nya.
      if (derived.value.length === 0) {
        process.stderr.write(
          `::warning::[selection] ${type}: härledningen returnerade TOM lista utan att ` +
            `misslyckas. Ingen id-hämtning skedde. ${abandonedNote(abandoned)}\n`,
        );
      }
      manifest = mergeManifest(previous, type, derived.value, now);
      writeSelectionManifest(manifest);
      reportExchange(type, previous, derived.value, manifest, abandoned);
    }
  }

  const ids = resolvedIds(manifest, seedIds);
  assertCoverageFloor(type, ids.length, previousCount);
  // Slutantalet per typ, så att sitemapens storlek går att stämma av mot bygget.
  process.stderr.write(`::notice::[selection] ${type}: ${ids.length} id förrenderas.\n`);

  // Next 16 + static export kastar på en tom generateStaticParams. Ett bygge utan
  // manifest och utan härledning (ingen TMDB-nyckel, `SELECTION_ALLOW_THIN`)
  // hamnar här och förrenderar `fallbackIds`.
  return ids.length > 0 ? ids : [...fallbackIds];
}
