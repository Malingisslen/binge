'use client';

import { createContext } from 'react';

/**
 * The user's services while the "Mina tjänster" filter is on, else null. Shared by
 * context so every row honours the filter without threading it through each
 * per-kind row wrapper.
 */
export const MyServicesFilterContext = createContext<number[] | null>(null);
