import { preferOriginalTitle } from './preferOriginalTitle';
import { hasNonLatinTitle } from './titleFilter';

export interface DisplayName {
  primary: string;
  /** Original-script form, only when it is non-Latin and differs from `primary`. */
  secondary: string | null;
}

/**
 * Swedish when TMDB has it, otherwise a Latin-script name (the original, then
 * `english`), with the non-Latin original kept as a small line underneath.
 * TMDB falls back to the original-script name when there is no Swedish
 * translation, so a non-Latin `localized` means "no Swedish name exists".
 */
export function resolveDisplayName(input: {
  localized?: string | null;
  original?: string | null;
  english?: string | null;
}): DisplayName {
  const { localized, original, english } = input;
  let primary = preferOriginalTitle(localized, original);
  if (hasNonLatinTitle(primary) && english && !hasNonLatinTitle(english)) {
    primary = english;
  }
  const secondary =
    [original, localized].find(s => !!s && s !== primary && hasNonLatinTitle(s)) ?? null;
  return { primary: primary || 'Okänd titel', secondary };
}

/** Lowest-effort Latin alias, for people whose sv-SE name is in another script. */
export function firstLatinAlias(aliases: readonly string[] | undefined): string | null {
  return aliases?.find(a => a && !hasNonLatinTitle(a)) ?? null;
}

/** Credits rows: `name` follows the sv-SE request, `original_name` is TMDB's own spelling. */
export function personName(
  p: { id?: number; name: string; original_name?: string },
  latinNames?: ReadonlyMap<number, string>,
): DisplayName {
  const english = p.id != null ? latinNames?.get(p.id) : undefined;
  return resolveDisplayName({ localized: p.name, original: p.original_name, english });
}
