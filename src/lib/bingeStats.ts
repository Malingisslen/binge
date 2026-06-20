// BIN-102 — binge detection. Light engagement stats derived from watch
// timestamps: current day-streak, biggest single-day episode binge, and a
// 30-day episode count. Pure + `now`-injected so it's deterministic to test.
// Surfaced on the diary, which already loads the episode data (zero extra reads).

export interface BingeStats {
  currentStreakDays: number;   // consecutive days with activity, ending today or yesterday
  biggestDayEpisodes: number;  // most episodes watched in one calendar day (all time)
  biggestDay: Date | null;
  episodesLast30: number;      // episodes watched in the last 30 days
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Local-midnight day index, so "consecutive days" is calendar-based (not 24h windows).
function dayNumber(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

export function computeBingeStats(
  episodes: { watchedAt: Date }[],
  films: { watchedAt: Date }[],
  now: Date,
): BingeStats {
  // Biggest single-day binge — episodes only (a "binge" is episodes in a sitting).
  const perDayEpisodes = new Map<string, { count: number; date: Date }>();
  for (const e of episodes) {
    const k = dayKey(e.watchedAt);
    const cur = perDayEpisodes.get(k);
    if (cur) cur.count += 1;
    else perDayEpisodes.set(k, { count: 1, date: e.watchedAt });
  }
  let biggestDayEpisodes = 0;
  let biggestDay: Date | null = null;
  for (const { count, date } of perDayEpisodes.values()) {
    if (count > biggestDayEpisodes) { biggestDayEpisodes = count; biggestDay = date; }
  }

  // Episodes in the last 30 days.
  const cutoff = now.getTime() - 30 * 86_400_000;
  const episodesLast30 = episodes.filter(e => e.watchedAt.getTime() >= cutoff).length;

  // Current streak — consecutive calendar days with ANY activity (episode or film),
  // ending today or yesterday (so it doesn't read 0 just because today's not watched yet).
  const activeDays = new Set<number>();
  for (const e of episodes) activeDays.add(dayNumber(e.watchedAt));
  for (const f of films) activeDays.add(dayNumber(f.watchedAt));
  const today = dayNumber(now);
  let cursor: number;
  if (activeDays.has(today)) cursor = today;
  else if (activeDays.has(today - 1)) cursor = today - 1;
  else return { currentStreakDays: 0, biggestDayEpisodes, biggestDay, episodesLast30 };
  let currentStreakDays = 0;
  while (activeDays.has(cursor)) { currentStreakDays += 1; cursor -= 1; }

  return { currentStreakDays, biggestDayEpisodes, biggestDay, episodesLast30 };
}
