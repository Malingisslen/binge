// BIN-192 — Svensk & nordisk upptäckt: a discovery lens that filters results to
// Swedish/Nordic original-language titles. Pure param helpers — the toggle that
// drives them lives on the discover page. Free via TMDB's `with_original_language`
// (a pipe-joined OR list of ISO-639-1 codes); no new data source.
//
// Why it's a local moat: a Swedish-original-language filter is culturally
// specific — Letterboxd surfaces Cannes/Oscars, not Nordic-language cinema.
//
// NOTE: the Guldbagge / Nordic Council winners shelf from the BIN-192 plan is a
// separate follow-up — it needs a curated list of *verified* TMDB ids (a one-time
// build), which can't be hand-authored reliably here without fabricating ids.

// TMDB `original_language` codes for the Nordic languages. TMDB stores Norwegian
// only as 'no' (ISO-639-1) — the Bokmål/Nynorsk variants 'nb'/'nn' are not valid
// discover codes and silently no-op, so they're excluded (BIN-202).
// Note: this is an original-LANGUAGE filter, so English-language Nordic
// co-productions (a Swedish-made English film) fall outside it by design.
export const NORDIC_LANGUAGES = ['sv', 'da', 'no', 'fi', 'is'] as const;

// Pipe-joined OR list for TMDB discover's `with_original_language`.
export function nordicLanguageParam(): string {
  return NORDIC_LANGUAGES.join('|');
}

// Stricter Swedish-only lens.
export function swedishLanguageParam(): string {
  return 'sv';
}

// "Nordisk noir" preset: crime (80) + thriller (53) TMDB genre ids, OR-joined.
export const NORDIC_NOIR_GENRES = '80|53';
