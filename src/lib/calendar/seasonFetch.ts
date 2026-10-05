import type { TMDBTVShow } from '@/types';

/**
 * PERF-1: hur långt bakåt kalendern behöver hela säsongen för en serie som slutat
 * sända. Äldre avsnitt än så visas bara om man bläddrar tillbaka i veckovyn;
 * seriens senaste avsnitt finns ändå kvar via `last_episode_to_air`-seeden i
 * buildCalendarEntries.
 */
export const SEASON_LOOKBACK_DAYS = 60;

function isoDaysAgo(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Behöver kalendern hämta seriens säsong? Ja om något avsnitt kan ligga inom
 * fönstret: ett nästa avsnitt är känt, det senaste sändes nyligen, eller en
 * säsong har premiärdatum från fönstrets början och framåt (aviserad säsong utan
 * `next_episode_to_air` än). Övriga serier ritas från show-nivåns seeds, vilket
 * kortar säsongsvågen från en per följd serie till de som faktiskt sänds.
 */
export function needsSeasonFetch(show: TMDBTVShow, now: Date): boolean {
  if (show.next_episode_to_air) return true;
  const cutoff = isoDaysAgo(now, SEASON_LOOKBACK_DAYS);
  const last = show.last_episode_to_air?.air_date;
  if (last && last >= cutoff) return true;
  return (show.seasons ?? []).some(s => s.season_number > 0 && !!s.air_date && s.air_date >= cutoff);
}
