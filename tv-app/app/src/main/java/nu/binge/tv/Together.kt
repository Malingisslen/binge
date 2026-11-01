package nu.binge.tv

data class TogetherCandidate(
    val tmdbId: Long,
    val mediaType: String,
    val title: String,
    val posterPath: String?,
    val providers: List<Long>,
) {
    val key: String get() = "${mediaType}_$tmdbId"
    val posterUrl: String? get() = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" }
}

/** Röster som antal, aldrig namn: gäster är anonyma och skärmen ses av hela rummet. */
data class BoardEntry(
    val candidate: TogetherCandidate,
    val yes: Int,
    val no: Int,
    val veto: Int,
    val participants: Int,
) {
    val voted: Int get() = yes + no + veto
    val isMatch: Boolean get() = participants >= 2 && yes == participants && veto == 0
    val label: String get() = when {
        veto > 0 && yes > 0 -> "$yes ja · $veto veto"
        veto > 0 -> "$veto veto"
        yes > 0 -> "$yes ja"
        voted == 0 -> "väntar"
        else -> "inga ja"
    }
}

data class TogetherState(
    val participants: Int,
    val entries: List<BoardEntry>,
) {
    val match: BoardEntry? get() = entries.firstOrNull { it.isMatch }
}

object TogetherBoard {
    /**
     * `swipes` är rösterna per dokument-id (`movie_42` eller det äldre `42`), plats-id till röst.
     * De två formerna slås ihop per deltagare och den namngivna vinner, som i webben (BIN-608).
     */
    fun build(candidates: List<TogetherCandidate>, participants: Int, swipes: Map<String, Map<String, String>>): TogetherState {
        val entries = candidates.map { c ->
            val votes = (swipes[c.tmdbId.toString()].orEmpty()) + (swipes[c.key].orEmpty())
            BoardEntry(
                candidate = c,
                yes = votes.values.count { it == "yes" },
                no = votes.values.count { it == "no" },
                veto = votes.values.count { it == "veto" },
                participants = participants,
            )
        }
        // Match först, sedan flest ja; veto längst ner. Stabil sortering behåller kortlekens ordning vid lika.
        val sorted = entries.sortedWith(
            compareByDescending<BoardEntry> { it.isMatch }
                .thenBy { it.veto > 0 }
                .thenByDescending { it.yes },
        )
        return TogetherState(participants, sorted)
    }
}
