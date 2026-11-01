package nu.binge.tv

/** `fromPrice` är billigaste nivån utan sport, kr/mån, samma värde som webbens cheapestEntertainmentTier. */
data class ProviderInfo(val id: Long, val name: String, val packageName: String?, val free: Boolean = false, val fromPrice: Int? = null) {
    val priceText: String? get() = when {
        free -> "gratis"
        fromPrice != null -> "från $fromPrice kr/mån"
        else -> null
    }
}

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
        ProviderInfo(8, "Netflix", "com.netflix.ninja", fromPrice = 129),
        ProviderInfo(119, "Prime Video", "com.amazon.amazonvideo.livingroom", fromPrice = 69),
        ProviderInfo(337, "Disney+", "com.disney.disneyplus", fromPrice = 89),
        ProviderInfo(384, "HBO Max", "com.wbd.stream", fromPrice = 89),
        ProviderInfo(76, "Viaplay", null, fromPrice = 99),
        ProviderInfo(520, "SVT Play", null, free = true),
        ProviderInfo(489, "TV4 Play", null, fromPrice = 69),
        ProviderInfo(350, "Apple TV+", "com.apple.atve.androidtv.appletv", fromPrice = 119),
        ProviderInfo(510, "Discovery+", null, fromPrice = 59),
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
