'use client';

import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { trackEvent } from './analytics';
import { captureError } from './sentry';

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
  // eslint-disable-next-line no-console
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
