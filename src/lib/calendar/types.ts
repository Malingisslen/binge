// Kalenderns entry-modell. Kalendern visar två slags händelser:
//   1. Avsnitt av serier du följer ('mina') — inkl. ej påbörjade; toggeln
//      "markera sedd" gäller alla (att bocka av första avsnittet från
//      kalendern flyttar bara läget ej_paborjad → aktiv/ikapp).
//   2. Digitala filmsläpp för filmer du vill se ('vill_se', media 'movie')
//
// Avsnitt och filmsläpp har olika form, så CalendarEntry är en diskriminerad
// union på `kind`. Delade fält ligger i CalendarEntryBase; per-kind-logik
// (nyckel, länk, badge) bor i `entry.ts` så konsumenterna slipper sprida
// `if (kind === ...)` överallt.

interface CalendarEntryBase {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** yyyy-mm-dd. För avsnitt = air_date, för film = svenskt digitalt släppdatum. */
  airDate: string;
  provider?: string;
  genreIds?: number[];
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
