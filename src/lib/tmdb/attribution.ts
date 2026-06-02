/**
 * TMDB attribution strings — krävs av TMDB's användarvillkor på varje yta
 * där deras data visas.
 *
 * Svenska (TMDB_ATTRIBUTION_SV) används i footer + sidebar (UI).
 * Engelska (TMDB_ATTRIBUTION_EN) används i data-export + metadata där
 * formellt språkkrav råder.
 */

export const TMDB_ATTRIBUTION_EN =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export const TMDB_ATTRIBUTION_SV =
  'Binge använder TMDB:s API men är inte godkänd eller certifierad av TMDB.';

/**
 * JustWatch-attribution — separat krav utöver TMDB-creditet ovan.
 *
 * Watch-provider-datan (`watch/providers`) som TMDB returnerar licensieras
 * från JustWatch, och TMDB's villkor kräver en EGEN JustWatch-credit *där
 * provider-datan visas* — inte bara en engångs-footer. TMDB-staff (Travis
 * Bell) på https://www.themoviedb.org/talk/60355e30a284eb003da676f2:
 * "For this data, we expect a reference or logo on each media item, just like
 * we do here on TMDb." Påföljd vid brott: indragen API-åtkomst.
 *
 * "a reference OR logo" → en text-referens räcker; logon är rekommenderad men
 * inte tvingande. Vi väljer text (token-stylad, ingen dekorativ bild) i linje
 * med Direction H. Rendera via `JustWatchCredit`-komponenten överallt där
 * watch-provider-data visas, så vi har en enda källa att uppdatera.
 */
export const JUSTWATCH_ATTRIBUTION_SV = 'Streaminginfo från JustWatch';

export const JUSTWATCH_ATTRIBUTION_EN =
  'Streaming availability data provided by JustWatch.';
