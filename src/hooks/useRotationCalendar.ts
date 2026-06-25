'use client';

import { useMemo } from 'react';
import { useSubscriptionAdvisor } from './useSubscriptionAdvisor';
import { useUpcomingShowsForAdvisor } from './useUpcomingShowsForAdvisor';
import { usePauseHistory } from './usePauseHistory';
import { useAuth } from './useAuth';
import { buildRotationStates } from '@/lib/advisor/rotationStates';
import { buildRotationCalendar, type RotationCalendar } from '@/lib/advisor/rotationCalendar';
import { rollupSavingsLedger, type SavingsLedger } from '@/lib/advisor/savingsLedger';

// BIN-181 — wire the (tested, pure) rotation-calendar + savings-ledger logic to
// live advisor data. The hooks inject the clock (`new Date()`); the libs stay
// deterministic. No new TMDB calls — both ride the advisor/upcoming queries that
// the Streamingrådgivaren page already runs.

const HORIZON_WEEKS = 8;

export interface UseRotationCalendarResult extends RotationCalendar {
  isLoading: boolean;
}

export function useRotationCalendar(): UseRotationCalendarResult {
  const advisor = useSubscriptionAdvisor();
  const upcoming = useUpcomingShowsForAdvisor(HORIZON_WEEKS);
  const { user } = useAuth();

  const calendar = useMemo(() => {
    const states = buildRotationStates(
      advisor.providers.map(p => ({
        providerId: p.providerId,
        providerName: p.providerName,
        shortName: p.shortName,
        color: p.color,
        monthlyCost: p.monthlyCost,
      })),
      upcoming.shows.map(s => ({
        providerId: s.providerId,
        episodes: s.episodes.map(e => ({ airDate: e.airDate, weekIndex: e.weekIndex })),
      })),
      user?.providerRenewalDays ?? {},
      { weeks: HORIZON_WEEKS },
    );
    return buildRotationCalendar(states, { today: new Date() });
  }, [advisor.providers, upcoming.shows, user?.providerRenewalDays]);

  return { ...calendar, isLoading: advisor.isLoading || upcoming.isLoading };
}

export function useSavingsLedger(): SavingsLedger {
  const { history } = usePauseHistory();
  return useMemo(
    () =>
      rollupSavingsLedger(
        history.map(h => ({
          providerId: h.providerId,
          providerShortName: h.providerShortName,
          savedAmount: h.savedAmount,
          durationDays: h.durationDays,
          resumedAt: h.resumedAt,
        })),
        { today: new Date() },
      ),
    [history],
  );
}
