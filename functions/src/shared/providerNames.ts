/**
 * BIN-1442 — the names a server notification may print for a streaming service.
 * Hand-copied from SWEDISH_PROVIDERS in the client's `src/lib/tmdb/providers.ts`
 * (functions/ cannot import client source); `src/lib/tmdb/providerNames.parity.test.ts`
 * fails the moment the two disagree.
 *
 * Why a server copy at all: the reminder that a pause is ending is built from a
 * client-writable field. The service name in it must come from here, never from
 * the user's document, and an id not listed here gets no reminder.
 */
export const PROVIDER_NAMES: Readonly<Record<number, string>> = {
  8: 'Netflix',
  119: 'Amazon Prime Video',
  337: 'Disney+',
  384: 'HBO Max',
  76: 'Viaplay',
  520: 'SVT Play',
  489: 'TV4 Play',
  350: 'Apple TV+',
  510: 'Discovery+',
  323: 'Crunchyroll',
  431: 'SkyShowtime',
  335: 'YouTube Premium',
  521: 'Tele2 Play',
  300: 'Pluto TV',
  538: 'Plex',
  11: 'MUBI',
  435: 'Draken Film',
  578: 'TriArt Play',
  35: 'Rakuten TV',
  3: 'Google Play Movies',
  2: 'Apple TV',
  426: 'SF Anytime',
  423: 'Blockbuster',
};
