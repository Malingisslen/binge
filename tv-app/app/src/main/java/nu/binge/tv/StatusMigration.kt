package nu.binge.tv

/**
 * Samma tabell som webbens migrateStatus (src/lib/watchStatus.migration.ts): gamla poster ligger
 * kvar i Firestore med äldre statusvärden, och alla läsare måste normalisera dem.
 */
object StatusMigration {
    fun migrate(raw: String, isMovie: Boolean, droppedFlag: Boolean): String {
        if (droppedFlag) return "avbruten"
        return when (raw) {
            "watching", "följer" -> if (isMovie) "sedd" else "mina"
            "want_to_watch", "vill_se" -> if (isMovie) "vill_se" else "mina"
            "watched", "sedd" -> if (isMovie) "sedd" else "mina"
            "dropped", "avbruten" -> "avbruten"
            "mina" -> if (isMovie) "sedd" else "mina"
            else -> if (isMovie) "vill_se" else "mina"
        }
    }
}
