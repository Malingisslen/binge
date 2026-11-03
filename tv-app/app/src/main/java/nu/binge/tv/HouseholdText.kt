package nu.binge.tv

data class HouseholdMember(val index: Int, val name: String, val initial: String)

data class TitleRef(val tmdbId: Long, val mediaType: String, val title: String, val posterPath: String?) {
    val key: String get() = "${mediaType}_$tmdbId"
    val posterUrl: String? get() = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" }
}

data class MemberProgress(val member: Int, val season: Int, val episode: Int)

data class IkappRow(val tmdbId: Long, val title: String, val posterPath: String?, val progress: List<MemberProgress>) {
    val posterUrl: String? get() = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" }
}

data class OnlyOne(val member: Int, val titles: List<TitleRef>)

data class HouseholdView(val shared: List<TitleRef>, val onlyOne: List<OnlyOne>, val ikapp: List<IkappRow>)

/**
 * `roster` är en kvittens på vilka personer platserna 0, 1, 2 … pekar på just nu. Skickas tillbaka med
 * nästa val; har hushållet ändrats nollställer servern soffan (`seatingReset`).
 */
data class HouseholdOverview(val members: List<HouseholdMember>, val view: HouseholdView?, val roster: String? = null, val seatingReset: Boolean = false)

/** Texterna i Ikapp-vyn. Rena funktioner så att de går att prova utan skärm. */
object IkappText {
    /** "Ni är ikapp", "J ligger 2 efter" eller en jämförelse i klartext när säsongerna skiljer. */
    fun status(row: IkappRow, members: List<HouseholdMember>): String {
        val p = row.progress
        if (p.size < 2) return ""
        val name = { i: Int -> members.firstOrNull { it.index == i }?.initial ?: "?" }
        val first = p.first()
        if (p.all { it.season == first.season && it.episode == first.episode }) return "Ni är ikapp"
        if (p.map { it.season }.distinct().size == 1) {
            val ahead = p.maxOf { it.episode }
            val behind = p.filter { it.episode < ahead }
            val gap = ahead - behind.minOf { it.episode }
            return "${behind.joinToString(" och ") { name(it.member) }} ligger $gap efter"
        }
        return p.joinToString(" · ") { "${name(it.member)} S${it.season} E${it.episode}" }
    }

    fun code(p: MemberProgress) = "S${p.season} E${p.episode}"
}
