// The user's saved content filters (settings → Innehållsfilter) must hold in
// Fråga Binge too; an explicit language in the question ("koreansk serie") is the
// one thing that overrides them, so the answer is not silently empty.

import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import type { RowTitle } from '@/types';
import type { AskFilter } from './types';

export interface SavedContentFilters {
  hideNonLatinTitles: boolean;
  hiddenCountries: readonly string[];
}

export const NO_SAVED_FILTERS: SavedContentFilters = { hideNonLatinTitles: false, hiddenCountries: [] };

/** Titles the saved filters let through for this question. */
export function applySavedFilters(
  items: RowTitle[],
  filter: AskFilter,
  saved: SavedContentFilters,
): RowTitle[] {
  if (filter.originalLanguage) return items;
  return items.filter((t) => {
    const tn = t as RowTitle & { name?: string; original_name?: string };
    if (saved.hideNonLatinTitles && hasNonLatinTitle(t.title ?? tn.name, t.original_title ?? tn.original_name)) return false;
    if (isFromHiddenCountry(t.origin_country, [...saved.hiddenCountries])) return false;
    return true;
  });
}
