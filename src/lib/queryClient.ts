'use client';

import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { trackEvent } from './analytics';
import { captureError } from './sentry';

/** Delas med Providers.tsx — persist-fönstret OCH queryernas gcTime måste
 *  vara samma värde: med gcTime < maxAge GC:as cachen innan den hinner
 *  persisteras och localStorage-persisten blir i praktiken tom. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Whitelist för vad som persisteras till localStorage (~5 MB-kvot).
//
// PRINCIP: bara SMÅ, DELADE katalog-queryer — aldrig per-titel-data.
// Per-titel-svar (tv-lite/movie-lite/tv-season) skalar med bibliotekets
// storlek och får helt enkelt inte plats i den knappa ~5 MB-budgeten:
// produktionsmätning på ett 222-titlars bibliotek visade att tv-lite ensamt
// fyllde hela taket (4583 KB) precis som tv-season gjorde före det — cachen
// låg konstant vid 5 MB och thrashade via removeOldestQuery-eviction.
// Per-titel-data re-fetchas billigt (gated av WeekStrip-defer + advisor) och
// biblioteks-/watchlist-datan är redan momentan via Firestores IndexedDB-cache
// (persistentLocalCache), så återbesöks-upplevelsen bevaras ändå. Katalog-
// queryerna nedan är några få KB totalt, stabila och delade mellan användare.
// OBS: 'watch-providers' hör INTE hit — det är per-titel ('watch-providers',
// mediaType, id) och multi-country-svaren är ~40 KB/titel. Mätt i produktion
// stod den för 1396 av 1409 KB efter att tv-lite tagits bort. Samma princip:
// per-titel-data persisteras aldrig, oavsett hur "liten" den ser ut.
const PERSISTED_QUERY_PREFIXES = new Set([
  'genres-movie', 'genres-tv',
  'trending', 'popular-movies', 'popular-tv', 'discover-movies', 'discover-tv',
  'cineasterna-catalog', // small shared catalog (~tens of KB); safe to persist
]);

export function shouldPersistQuery(query: {
  queryKey: readonly unknown[];
  state: { status: string };
}): boolean {
  if (query.state.status !== 'success') return false;
  const head = query.queryKey[0];
  return typeof head === 'string' && PERSISTED_QUERY_PREFIXES.has(head);
}

/** Suffixet varje klient-satt läsbudget märker sitt timeout-fel med.
 *
 *  BIN-746: BIN-733 delade bara EN sträng ('streamingOffers timeout') mellan
 *  hooken och retry-predikatet, så nästa läsning med egen tidsgräns (useRecap)
 *  föll utanför i tysthet och väntade fortfarande 10s + 1s backoff + 10s ≈ 21s.
 *  Markören är därför gemensam: bygg meddelandet med `readTimeoutMessage()` och
 *  en ny tidsatt läsning täcks av no-retry-regeln samma dag den shippas.
 *  Hooken äger tidsgränsen, klienten äger beslutet att inte försöka igen. */
const READ_TIMEOUT_SUFFIX = ' timeout';

/** Bygg felmeddelandet för en läsning som slagit i sin egen tidsgräns. */
export function readTimeoutMessage(source: string): string {
  return `${source}${READ_TIMEOUT_SUFFIX}`;
}

/** Är detta ett fel från en läsnings EGEN tidsbudget (och därmed inte värt ett
 *  nytt försök)? Kräver något före suffixet så en bar 'timeout' från ett
 *  främmande lager inte råkar matcha. */
export function isReadTimeoutMessage(message: string): boolean {
  return message.length > READ_TIMEOUT_SUFFIX.length && message.endsWith(READ_TIMEOUT_SUFFIX);
}

/** Felmeddelandet useStreamingOffers kastar när dess egen 10s-budget löper ut. */
export const STREAMING_OFFERS_TIMEOUT_MESSAGE = readTimeoutMessage('streamingOffers');

/** Felmeddelandet useRecaps doc-läsningar kastar när deras 10s-budget löper ut. */
export const RECAP_TIMEOUT_MESSAGE = readTimeoutMessage('recap');

/**
 * Ska en fallerad query göras om?
 *
 * Extraherad som ren funktion (test-extraction-mönstret) så retry-policyn kan
 * pinnas utan att starta en QueryClient.
 *
 * BIN-733: ett fel som REDAN är en tidsgräns blir inte bättre av ett nytt
 * försök — det bara fördubblar väntan. Streamingrutan väntade 10s, backade av
 * 1s och väntade 10s till (~22s) innan den gav upp; nu ger den upp vid ~10s.
 *
 * BIN-746: regeln gäller ALLA läsningar med egen tidsbudget, inte bara
 * streamingrutan — recap-läsningarna matchade inte den ursprungliga strängen
 * och väntade fortfarande ~21s.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const msg = error instanceof Error ? error.message : '';
  // Firestore permission-fel blir inte bättre av att försökas igen.
  if (/permission-denied|unauthenticated|not-found/i.test(msg)) return false;
  if (isReadTimeoutMessage(msg)) return false;
  return true;
}

/**
 * Central React Query-klient med global felhantering.
 *
 * Tidigare blev fel i bakgrundsfetcher tysta — toast saknades, inget
 * spårades i Plausible, och ingen logg hjälpte oss ta reda på varifrån
 * felet kom. Nu:
 *
 * 1. console.error() med queryKey/mutationKey så DevTools visar scope
 * 2. trackEvent('query_error', { scope, kind }) — icke-PII-telemetri till
 *    Plausible (vi mäter bara vilken sub-query som fallerar, inte datat)
 * 3. Krok för framtida Sentry.captureException — när 8.1 landar byter vi
 *    bara ut reportError() mot Sentry.captureException + tags
 *
 * Vi använder inte global toast här eftersom varje hook redan har egna
 * error-states — globala toaster skulle dubblera felmeddelanden.
 */

function scopeFromKey(key: readonly unknown[] | undefined): string {
  if (!key || key.length === 0) return 'unknown';
  const first = key[0];
  if (typeof first === 'string') return first;
  return 'unknown';
}

function reportError(
  error: unknown,
  kind: 'query' | 'mutation',
  scope: string,
): void {

  console.error(`[rq:${kind}:${scope}]`, error);

  try {
    trackEvent('query_error', { scope, kind });
  } catch {
    // Aldrig låt analytik krascha vår error-rapportering.
  }

  try {
    captureError(error, { scope, kind });
  } catch {
    // No-op — Sentry får aldrig krascha app-logik.
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportError(error, 'query', scopeFromKey(query.queryKey));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        reportError(error, 'mutation', scopeFromKey(mutation.options.mutationKey));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        // Matchar PERSIST_MAX_AGE — se kommentaren vid konstanten.
        gcTime: PERSIST_MAX_AGE,
        refetchOnWindowFocus: false,
        // Retry-kedja: 1 försök till med kort backoff — se shouldRetryQuery för
        // vilka fel som inte retryas alls.
        retry: shouldRetryQuery,
        retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
