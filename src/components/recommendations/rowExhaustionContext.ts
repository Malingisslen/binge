'use client';

import { createContext } from 'react';

/**
 * Lets a RecRow report, up to RecommendationsHub, that its pool is "tapped out"
 * (the user has rotated through every suggestion). The hub collects these and
 * sinks tapped-out rows down the cascade so a fresher row rises in their place.
 * Reporting via context avoids prop-drilling the callback through the seven
 * per-kind row wrappers in RowDispatch.
 */
export type ReportExhaustion = (rowKey: string, exhausted: boolean) => void;

export const RowExhaustionContext = createContext<ReportExhaustion>(() => {});
