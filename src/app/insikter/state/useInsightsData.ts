'use client';
import { useState, useEffect } from 'react';
import type { InsightsData } from '../insights.types';
import type { DateRange } from './useDateRange';
import { fetchInsights, InsightsApiError } from '../api';

/**
 * Fetches /api/insights, re-fetching when the range changes.
 *
 * `getToken` resolves the bearer credential per fetch — a fresh Firebase ID
 * token for an admin, or the static URL token. Returning null means "no access"
 * and the hook stays idle (the client renders an access message instead).
 *
 * Stale-while-error: on a failed refetch we keep the last good data and surface
 * `error` so the UI can show a ribbon without blanking the dashboard.
 */
export function useInsightsData(getToken: () => Promise<string | null>, range: DateRange) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  // State (not a ref) so it can be read during render without tripping binge's
  // react-hooks/refs lint. Flips false once the first fetch settles.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError('Ingen behörighet.');
          return;
        }
        const d = await fetchInsights(token, range, controller.signal);
        setData(d);
        setLastFetchedAt(new Date());
        setError(null);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError(err instanceof InsightsApiError ? err.message : 'Kunde inte ladda data.');
      } finally {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    })();
    return () => controller.abort();
    // getToken is stable per the client's useCallback; refetch on range change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.preset, range.from, range.to]);

  return { data, loading, error, lastFetchedAt, isFirstLoad: !hasLoadedOnce };
}
