import { isEndedStatus } from '@/lib/airingState';
import { isUserBehindOnAired } from '@/hooks/useSubscriptionAdvisor.helpers';
import type { TMDBTVShow } from '@/types/tmdb';
import type { WatchStatus, WatchlistItem, MediaType, TvSubState } from '@/types';

// User-facing labels per status. TV och film delar 'vill_se' och 'avbruten'
// men har olika "main" status — TV bor i 'mina', film i 'sedd'.
export const STATUS_LABELS: Record<WatchStatus, string> = {
  'vill_se': 'Vill se',
  'mina': 'Mina serier',
  'sedd': 'Sedd',
  'avbruten': 'Avbröt',
};

// Status-alternativ som visas i StatusButton-dropdown per mediaType.
// För TV är 'sedd' en *genväg* — det sparas som 'mina' med lastWatched satt
// till sista aireade avsnittet (sub-state derives till 'ikapp'/'avslutad').
// 'sedd' lagras aldrig på en TV-titel (lazy migration normaliserar gamla docs).
export const TV_STATUS_OPTIONS: WatchStatus[] = ['vill_se', 'mina', 'sedd', 'avbruten'];
export const MOVIE_STATUS_OPTIONS: WatchStatus[] = ['vill_se', 'sedd', 'avbruten'];

export function statusOptionsFor(mediaType: MediaType): WatchStatus[] {
  return mediaType === 'tv' ? TV_STATUS_OPTIONS : MOVIE_STATUS_OPTIONS;
}

// I StatusButton vill vi visa "Lägger till" rather than "Mina serier" som
// label på den aktiva valbart-att-välja-knappen. 'mina' = "Lägg till i samling".
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
  if (item.tmdbStatus && isEndedStatus(item.tmdbStatus) && item.lastWatchedSeason) {
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
