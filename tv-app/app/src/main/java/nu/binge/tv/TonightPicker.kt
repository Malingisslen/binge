package nu.binge.tv

/**
 * Urvalet följer webbens Väljare (film med status vill_se, serie i Mina som inte är påbörjad).
 * Titlar som finns på dina egna tjänster kommer först (tjänsterna kommer från servern, TV:n läser
 * inte profilen), därefter senast tillagd.
 */
object TonightPicker {
    fun picks(all: List<Title>, mine: Set<Long> = emptySet()): List<Title> =
        all.filter(::isCandidate)
            .sortedWith(compareByDescending<Title> { fitsMine(it, mine) }.thenByDescending { it.addedAtMs })

    /** Titeln finns på en tjänst du redan betalar för. */
    fun fitsMine(t: Title, mine: Set<Long>): Boolean = Providers.rows(t.providers, mine).any { it.mine }

    /** Kommande avsnitt, närmast först. Datumen är ISO-strängar, så textordning är datumordning. */
    fun upcoming(all: List<Title>): List<Title> =
        all.filter { !it.isMovie && it.status == "mina" && !it.dropped && !it.nextAirDate.isNullOrEmpty() }
            .sortedBy { it.nextAirDate }

    /** Skälet, med tjänsten först när titeln finns på en du har. */
    fun reason(title: Title, nowMs: Long, mine: Set<Long>): String {
        val service = Providers.rows(title.providers, mine).firstOrNull { it.mine }?.info?.name
        return if (service != null) "Finns på $service som du har. ${reason(title, nowMs)}" else reason(title, nowMs)
    }

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
