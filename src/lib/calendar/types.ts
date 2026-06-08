// Kalenderns entry-modell. Kalendern visar tre slags händelser:
//   1. Avsnitt av serier du tittar på ('mina')
//   2. Avsnitt av serier du vill se ('vill_se') — samma pipeline, annan källa
//   3. Digitala filmsläpp för filmer du vill se ('vill_se', media 'movie')
//
// Avsnitt och filmsläpp har olika form, så CalendarEntry är en diskriminerad
// union på `kind`. Delade fält ligger i CalendarEntryBase; per-kind-logik
// (nyckel, länk, badge) bor i `entry.ts` så konsumenterna slipper sprida
// `if (kind === ...)` överallt.

/** Vilken watchlist-status titeln kom ifrån. Styr bl.a. om vi visar
 *  "markera sedd"-toggeln (bara på 'mina' — du tittar faktiskt). */
export type CalendarSource = 'mina' | 'vill_se';

interface CalendarEntryBase {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** yyyy-mm-dd. För avsnitt = air_date, för film = svenskt digitalt släppdatum. */
  airDate: string;
  provider?: string;
  genreIds?: number[];
  source: CalendarSource;
}

export interface EpisodeEntry extends CalendarEntryBase {
  kind: 'episode';
  mediaType: 'tv';
  season: number;
  episode: number;
  episodeCode: string;
  episodeName?: string;
  episodeOverview?: string;
  runtime?: number;
  isPremiere?: boolean;
  isFinale?: boolean;
}

export interface MovieEntry extends CalendarEntryBase {
  kind: 'movie';
  mediaType: 'movie';
  /** Just nu bara 'digital' — fältet finns för framtida bio/fysisk-utbyggnad. */
  releaseType: 'digital';
  overview?: string;
  runtime?: number;
}

export type CalendarEntry = EpisodeEntry | MovieEntry;
