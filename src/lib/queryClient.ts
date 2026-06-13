'use client';

import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { trackEvent } from './analytics';
import { captureError } from './sentry';

/** Delas med Providers.tsx — persist-fönstret OCH queryernas gcTime måste
 *  vara samma värde: med gcTime < maxAge GC:as cachen innan den hinner
 *  persisteras och localStorage-persisten blir i praktiken tom. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Whitelist för vad som persisteras till localStorage (~5 MB-kvot).
// Lite-queries (show-nivå) + katalogytor = det som gör återbesök snabba.
// INTE fulla ['tv']/['movie']-detaljsvar (20–80 KB JSON styck × bibliotek
// spränger kvoten) och INTE search (flyktigt).
//
// INTE 'tv-season': säsongssvaren (fulla avsnittslistor med stills/overviews)
// är 30–60 KB/säsong och dominerade hela 5 MB-budgeten i produktion (mätt:
// 5053 av 5092 KB var tv-season), vilket trängde ut de små värdefulla
// queryerna via removeOldestQuery-eviction. Säsongsdata är kalender-specifik
// och re-fetchas billigt (SEASON-tier, WeekStrip-defer:ad) — den hör inte
// hemma i den knappa localStorage-budgeten. Show-nivå-'tv-lite' räcker för
// att rådgivare/bibliotek ska rendera direkt vid återbesök.
const PERSISTED_QUERY_PREFIXES = new Set([
  'tv-lite', 'movie-lite',
  'genres-movie', 'genres-tv', 'watch-providers',
  'trending', 'popular-movies', 'popular-tv', 'discover-movies', 'discover-tv',
]);

export function shouldPersistQuery(query: {
  queryKey: readonly unknown[];
  state: { status: string };
}): boolean {
  if (query.state.status !== 'success') return false;
  const head = query.queryKey[0];
  return typeof head === 'string' && PERSISTED_QUERY_PREFIXES.has(head);
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
        // Retry-kedja: 1 försök till med kort backoff. Firestore permission-fel
        // retryas inte eftersom de inte blir bättre av att försökas igen.
        retry: (failureCount, error) => {
          if (failureCount >= 2) return false;
          const msg = error instanceof Error ? error.message : '';
          if (/permission-denied|unauthenticated|not-found/i.test(msg)) return false;
          return true;
        },
        retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
