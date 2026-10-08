'use client';

import { useMemo } from 'react';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { keepOnMyServices } from '@/lib/recommendations/myServicesFilter';
import type { RowTitle } from '@/types';

/** Applies "Mina tjänster" to a list of titles; a no-op (and no fetching) when off. */
export function useMyServicesFilter(items: RowTitle[], myProviders: number[] | null): RowTitle[] {
  const providerMap = useSearchProviders(myProviders ? items : []);
  return useMemo(
    () => (myProviders ? keepOnMyServices(items, providerMap, myProviders) : items),
    [items, providerMap, myProviders],
  );
}
