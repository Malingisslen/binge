// BIN-93 (mood half) — mood lenses for the Väljaren ("vad ska jag se ikväll?").
// Pure genre mapping over WatchlistItem.genreIds (already loaded) — no TMDB
// fetch, no migration. The runtime-budget lens is the other axis and genuinely
// needs WatchlistItem.runtime denormalised (a schema backfill), so it's not here.
//
// Genre ids are TMDB's (movie + TV variants where they differ).

export interface MoodDef { id: string; label: string; genreIds: number[] }

export const MOODS: MoodDef[] = [
  { id: 'mysig',    label: 'Mysig',    genreIds: [35, 10751, 10749, 16] },   // komedi, familj, romantik, animerat
  { id: 'spanning', label: 'Spänning', genreIds: [53, 80, 9648, 28, 10759] }, // thriller, krim, mystik, action, action&äventyr
  { id: 'skratta',  label: 'Skratta',  genreIds: [35] },                      // komedi
  { id: 'tankvard', label: 'Tänkvärd', genreIds: [18, 99, 36, 10752] },       // drama, dokumentär, historia, krig
  { id: 'skrack',   label: 'Skräck',   genreIds: [27] },                      // skräck
];

/** Filter items to those whose genres intersect the given mood. null = no filter. */
export function filterByMood<T extends { genreIds: number[] }>(items: T[], moodId: string | null): T[] {
  if (!moodId) return items;
  const mood = MOODS.find(m => m.id === moodId);
  if (!mood) return items;
  const set = new Set(mood.genreIds);
  return items.filter(i => i.genreIds.some(g => set.has(g)));
}
