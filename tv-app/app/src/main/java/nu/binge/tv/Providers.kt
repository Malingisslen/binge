package nu.binge.tv

data class ProviderInfo(val id: Long, val name: String, val packageName: String?, val free: Boolean = false)

/** En rad i remsan "Öppna i tjänsten". */
data class StripRow(val info: ProviderInfo, val mine: Boolean) {
    val label: String get() = when {
        mine -> "Du har"
        info.free -> "Gratis"
        else -> "Ingår"
    }
}

/**
 * Tjänsterna och deras id:n följer webbens lista (src/lib/tmdb/providers.ts). Appens paketnamn är
 * bara satta där de är kända; saknas ett finns ingen Öppna-knapp i stället för en som gissar fel.
 */
object Providers {
    private val known = listOf(
        ProviderInfo(8, "Netflix", "com.netflix.ninja"),
        ProviderInfo(119, "Prime Video", "com.amazon.amazonvideo.livingroom"),
        ProviderInfo(337, "Disney+", "com.disney.disneyplus"),
        ProviderInfo(384, "HBO Max", "com.wbd.stream"),
        ProviderInfo(76, "Viaplay", null),
        ProviderInfo(520, "SVT Play", null, free = true),
        ProviderInfo(489, "TV4 Play", null),
        ProviderInfo(350, "Apple TV+", "com.apple.atve.androidtv.appletv"),
        ProviderInfo(510, "Discovery+", null),
    )
    private val byId = known.associateBy { it.id }
    // Samma alias som webbens lista (src/lib/tmdb/providers.ts): TMDB har flera id:n för samma tjänst.
    private val aliases = mapOf(493L to 520L, 175L to 8L, 1899L to 384L, 1825L to 384L, 1944L to 489L, 1759L to 489L, 2243L to 350L)

    val packageNames: List<String> get() = known.mapNotNull { it.packageName }

    fun canonical(id: Long): Long = aliases[id] ?: id

    fun info(id: Long): ProviderInfo? = byId[canonical(id)]

    /** Tjänster titeln finns på, dina egna först. Okända id:n och dubbletter hoppas över. */
    fun rows(titleProviders: List<Long>, mine: Set<Long>): List<StripRow> {
        val mineCanonical = mine.map(::canonical).toSet()
        val rows = titleProviders.map(::canonical).distinct().mapNotNull { id ->
            byId[id]?.let { StripRow(it, mine = id in mineCanonical) }
        }
        return rows.filter { it.mine } + rows.filterNot { it.mine }
    }
}
