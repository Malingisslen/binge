import { isEndedStatus } from '@/lib/airingState';
import { isUserBehindOnAired } from '@/hooks/useSubscriptionAdvisor.helpers';
import type { TMDBTVShow } from '@/types/tmdb';
import type { WatchStatus, WatchlistItem, MediaType, TvSubState } from '@/types';

// User-facing labels per status. TV och film delar 'vill_se' och 'avbruten'
// men har olika "main" status — TV bor i 'mina' (UI: "Följer"), film i 'sedd'.
// Vokabulär dokumenterat i docs/voice-and-tone.md.
export const STATUS_LABELS: Record<WatchStatus, string> = {
  'vill_se': 'Vill se',
  'mina': 'Följer',
  'sedd': 'Sedd',
  'avbruten': 'Avbruten',
};

// Status-alternativ som visas i StatusButton-dropdown per mediaType.
//
// 'mina' är medvetet *inte* ett menyalternativ för TV — det är ett *resultat*,
// inte ett mål. Sätts automatiskt av WatchlistContext.updateProgress när
// användaren markerar första avsnittet (auto-promote vill_se → mina). Att
// exponera det i menyn är redundant.
//
// 'sedd' i TV-menyn är en genväg som översätts till status='mina' +
// lastWatched satt till sista aireade avsnittet (sub-state derives till
// 'ikapp'/'avslutad'). 'sedd' lagras aldrig som status på en TV-titel.
export const TV_STATUS_OPTIONS: WatchStatus[] = ['vill_se', 'sedd', 'avbruten'];
export const MOVIE_STATUS_OPTIONS: WatchStatus[] = ['vill_se', 'sedd', 'avbruten'];

export function statusOptionsFor(mediaType: MediaType): WatchStatus[] {
  return mediaType === 'tv' ? TV_STATUS_OPTIONS : MOVIE_STATUS_OPTIONS;
}

// statusLabel hanterar två kanttillfällen utöver STATUS_LABELS:
//   - 'mina' på film bör aldrig hända i normalt UI; defensiv översättning till 'Sedd'.
//   - 'sedd' i TV-menyn är en genväg som markerar alla avsnitt sedda → label
//     förtydligas så användaren förstår effekten.
export function statusLabel(status: WatchStatus, mediaType?: MediaType): string {
  if (mediaType === 'movie' && status === 'mina') return 'Sedd';
  if (mediaType === 'tv' && status === 'sedd') return 'Sedd (alla avsnitt)';
  return STATUS_LABELS[status];
}

// Sub-state för TV-shows i 'mina'. Härleds — aldrig sparat. Behöver TMDB-data
// för att veta last_episode_to_air; fallback till tmdbStatus-only om showen
// inte är i cachen ännu (t.ex. badge på första render).
export function tvSubState(item: WatchlistItem, show: TMDBTVShow | undefined): TvSubState {
  // Om vi har full TMDB-data: rikt avgöra ikapp-vs-aktiv-vs-avslutad.
  if (show) {
    const behind = isUserBehindOnAired(item, show);
    if (behind) return 'aktiv';
    return isEndedStatus(show.status) ? 'avslutad' : 'ikapp';
  }
  // Fallback: utan TMDB i cachen, gissa från lagrad tmdbStatus + lastWatched.
  // Aktiv = har börjat men vi vet inte om det finns mer aireat → konservativ
  // gissning är "ikapp" om Ended, annars "aktiv". Bättre att visa "aktiv" som
  // default eftersom det driver användaren till att titta.
  if (item.tmdbStatus && isEndedStatus(item.tmdbStatus) && item.lastWatchedSeason != null) {
    return 'avslutad';
  }
  return 'aktiv';
}

export const SUB_STATE_LABELS: Record<TvSubState, string> = {
  'aktiv': 'Ligger efter',
  'ikapp': 'Ikapp',
  'avslutad': 'Avslutad',
};

const TV_STATUS_MAP: Record<string, string> = {
  'Ended': 'Avslutad',
  'Returning Series': 'Pågår',
  'Canceled': 'Inställd',
  'In Production': 'Under produktion',
};

export function tvShowStatusLabel(status: string): string {
  return TV_STATUS_MAP[status] ?? status;
}
