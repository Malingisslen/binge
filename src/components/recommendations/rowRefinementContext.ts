'use client';

import { createContext } from 'react';
import { NO_REFINEMENT, type RowRefinement } from '@/lib/recommendations/refineTitles';

/**
 * The service, length and sort choices every row applies. Shared by context so every
 * row honours them without threading them through each per-kind row wrapper.
 */
export const RowRefinementContext = createContext<RowRefinement>(NO_REFINEMENT);

/**
 * Lets a row tell the hub whether filters left it with nothing to show, once its data
 * has settled. The hub stops counting such rows and shows one empty state when none remain.
 */
export type ReportEmpty = (rowKey: string, empty: boolean) => void;
export const RowEmptyContext = createContext<ReportEmpty>(() => {});
