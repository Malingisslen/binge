import type { WatchlistItem } from '@/types';
import type { CalendarEntry } from './types';

// Instant week (2026-07): tunna kalender-seeds från de denormaliserade
// next-air-fälten på watchlist-items. Matar SAMMA pickFocalEntry/HemHero-
// render-väg som de fulla TMDB-entrisarna — en render-väg, två datakällor.
// Live-fan-outen ersätter seedsen per titel när den löst (page.tsx unionerar
// med live-företräde). Endast dagens datum och framåt: ett passerat
// nextAirDate betyder bara att read-repairen inte hunnit ikapp — det får
// aldrig bli ett falskt "i går"-innehåll.

const CODE_RE = /^S(\d+)E(\d+)$/;

export function seedCalendarEntries(items: WatchlistItem[], now: Date = new Date()): CalendarEntry[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${m}-${d}`;

  const out: CalendarEntry[] = [];
  for (const item of items) {
    if (item.dropped) continue;
    if (item.mediaType === 'tv' && item.status === 'mina' && item.nextAirDate && item.nextAirDate >= todayKey) {
      const match = CODE_RE.exec(item.nextAirCode ?? '');
      if (!match) continue;
      const season = Number(match[1]);
      const episode = Number(match[2]);
      out.push({
        kind: 'episode',
        mediaType: 'tv',
        tmdbId: item.tmdbId,
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: null,
        season,
        episode,
        episodeCode: item.nextAirCode as string,
        airDate: item.nextAirDate,
        provider: item.nextAirProvider ?? undefined,
        isPremiere: episode === 1,
        isFinale: false,
        genreIds: item.genreIds,
      });
    } else if (item.mediaType === 'movie' && item.status === 'vill_se' && item.digitalReleaseDate && item.digitalReleaseDate >= todayKey) {
      out.push({
        kind: 'movie',
        mediaType: 'movie',
        releaseType: 'digital',
        tmdbId: item.tmdbId,
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: null,
        airDate: item.digitalReleaseDate,
        genreIds: item.genreIds,
      });
    }
  }
  return out;
}
