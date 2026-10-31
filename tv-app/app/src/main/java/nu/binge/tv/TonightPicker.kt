package nu.binge.tv

/**
 * Urvalet följer webbens Väljare (film med status vill_se, serie i Mina som inte är påbörjad).
 * Ordningen är kortare än webbens: bara senast tillagd först. Webben lägger titlar som ryms i
 * ens egna abonnemang före resten, men TV:n får inte läsa profilen och vet därför inte vilka
 * tjänster som är dina.
 */
object TonightPicker {
    fun picks(all: List<Title>): List<Title> =
        all.filter(::isCandidate)
            .sortedByDescending { it.addedAtMs }

    /** Kommande avsnitt, närmast först. Datumen är ISO-strängar, så textordning är datumordning. */
    fun upcoming(all: List<Title>): List<Title> =
        all.filter { !it.isMovie && it.status == "mina" && !it.dropped && !it.nextAirDate.isNullOrEmpty() }
            .sortedBy { it.nextAirDate }

    /** Kort skäl under förslaget. Bara det som går att säga ur den egna listan. */
    fun reason(title: Title, nowMs: Long): String {
        val days = ((nowMs - title.addedAtMs) / DAY_MS).coerceAtLeast(0)
        return when (days) {
            0L -> "Nytt i din Vill se"
            1L -> "Legat i din Vill se sedan igår"
            else -> "Legat i din Vill se i $days dagar"
        }
    }

    private fun isCandidate(t: Title): Boolean = when {
        t.isMovie -> t.status == "vill_se"
        else -> t.status == "mina" && !t.dropped && t.lastWatchedSeason == null
    }

    private const val DAY_MS = 24L * 60 * 60 * 1000
}
