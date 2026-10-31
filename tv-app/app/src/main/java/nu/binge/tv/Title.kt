package nu.binge.tv

/**
 * Det TV:n läser ur en watchlist-post. `notes` och `rating` läses medvetet aldrig: TV:n står
 * i vardagsrummet och visar bara titel, affisch, status och speltid.
 */
data class Title(
    val docId: String,
    val tmdbId: Long,
    val isMovie: Boolean,
    val title: String,
    val posterPath: String?,
    /** Redan normaliserad med [StatusMigration]. */
    val status: String,
    val dropped: Boolean,
    val lastWatchedSeason: Long?,
    val runtime: Long?,
    val addedAtMs: Long,
    /** Användarens egna datum; en ny markering får aldrig skriva över det (BIN-593). */
    val watchedAtMs: Long?,
    val nextAirDate: String?,
    val nextAirCode: String?,
) {
    val posterUrl: String? get() = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" }
}
