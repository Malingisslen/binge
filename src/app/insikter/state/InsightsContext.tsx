'use client';
import { createContext, useContext } from 'react';
import type { InsightsData } from '../insights.types';

/**
 * `data` is the picked window; `previous` the equally long window before it (or null
 * when it could not be fetched or the picker is custom) — see comparison.ts.
 */
export interface InsightsState {
  data: InsightsData;
  previous: InsightsData | null | undefined;
}

const InsightsContext = createContext<InsightsState | null>(null);

export const InsightsProvider = InsightsContext.Provider;

export function useInsightsContext(): InsightsState {
  const ctx = useContext(InsightsContext);
  if (!ctx) throw new Error('useInsightsContext must be used within InsightsProvider');
  return ctx;
}
