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
// TV: 'mina' (menylabel "Följ") är huvudvalet — att vilja se en serie ÄR att
// följa den; "har inte börjat" härleds som sub-state 'ej_paborjad' från
// avsaknad av progress. 'vill_se' skrivs aldrig för TV (lazy-migreras vid
// läsning, se watchStatus.migration.ts).
//
// 'sedd' i TV-menyn är en genväg som översätts till status='mina' +
// lastWatched satt till sista aireade avsnittet (sub-state derives till
// 'ikapp'/'avslutad'). 'sedd' lagras aldrig som status på en TV-titel.
export const TV_STATUS_OPTIONS: WatchStatus[] = ['mina', 'sedd', 'avbruten'];
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

// Menyer/CTA:er använder verb där statusen är substantiv (voice-and-tone:
// "verb i CTAs, substantiv i statusar"). Knappen heter "Följ"; chipen "Följer".
export function statusMenuLabel(status: WatchStatus, mediaType?: MediaType): string {
  if (mediaType === 'tv' && status === 'mina') return 'Följ';
  return statusLabel(status, mediaType);
}

// Sub-state för TV-shows i 'mina'. Härleds — aldrig sparat.
// 'ej_paborjad' prövas först: utan progress finns inget att vara "bakom" på,
// oavsett TMDB-data. (== null, inte falsy: säsong 0/Specials är giltig
// progress.) Därefter behövs TMDB-data för aktiv/ikapp/avslutad; fallback
// till tmdbStatus-only om showen inte är i cachen ännu.
export function tvSubState(item: WatchlistItem, show: TMDBTVShow | undefined): TvSubState {
  if (item.lastWatchedSeason == null) return 'ej_paborjad';
  if (show) {
    const behind = isUserBehindOnAired(item, show);
    if (behind) return 'aktiv';
    return isEndedStatus(show.status) ? 'avslutad' : 'ikapp';
  }
  // Fallback utan TMDB i cachen: progress finns (guarden ovan), så gissa
  // från lagrad tmdbStatus. Ended → avslutad, annars konservativt "aktiv"
  // (driver användaren till att titta).
  if (item.tmdbStatus && isEndedStatus(item.tmdbStatus)) return 'avslutad';
  return 'aktiv';
}

export const SUB_STATE_LABELS: Record<TvSubState, string> = {
  'ej_paborjad': 'Ej påbörjad',
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
