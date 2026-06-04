'use client';
import { createContext, useContext } from 'react';
import type { InsightsData } from '../insights.types';

const Ctx = createContext<InsightsData | null>(null);
export const InsightsProvider = Ctx.Provider;

export function useInsightsContext(): InsightsData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInsightsContext used outside InsightsProvider');
  return v;
}
