package nu.binge.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class TogetherBoardTest {
    private fun c(id: Long, type: String = "movie") = TogetherCandidate(id, type, "T$id", null, emptyList())

    @Test fun matchNeedsEveryoneToSayYesAndNoVeto() {
        val s = TogetherBoard.build(listOf(c(1), c(2)), 3, mapOf(
            "movie_1" to mapOf("a" to "yes", "b" to "yes", "c" to "yes"),
            "movie_2" to mapOf("a" to "yes", "b" to "yes"),
        ))
        assertEquals(1L, s.match?.candidate?.tmdbId)
    }

    @Test fun aVetoBlocksAMatchEvenWhenAsManySaidYesAsThereAreParticipants() {
        // Två deltagare har sagt ja och en tredje röst är veto (en deltagare som sedan lämnat): bara veto-villkoret avgör.
        val s = TogetherBoard.build(listOf(c(1)), 2, mapOf("movie_1" to mapOf("a" to "yes", "b" to "yes", "c" to "veto")))
        assertNull(s.match)
    }

    @Test fun aSingleParticipantNeverMatches() {
        assertFalse(TogetherBoard.build(listOf(c(1)), 1, mapOf("movie_1" to mapOf("a" to "yes"))).entries.single().isMatch)
    }

    @Test fun mostYesComesFirstAndVetoedTitlesLast() {
        val s = TogetherBoard.build(listOf(c(1), c(2), c(3)), 4, mapOf(
            "movie_1" to mapOf("a" to "yes"),
            "movie_2" to mapOf("a" to "yes", "b" to "yes", "c" to "veto"),
            "movie_3" to mapOf("a" to "yes", "b" to "yes", "c" to "yes"),
        ))
        assertEquals(listOf(3L, 1L, 2L), s.entries.map { it.candidate.tmdbId })
    }

    @Test fun movieAndSeriesWithTheSameNumberDoNotShareVotes() {
        val s = TogetherBoard.build(listOf(c(42, "movie"), c(42, "tv")), 2, mapOf("movie_42" to mapOf("a" to "yes", "b" to "yes")))
        assertEquals(1, s.entries.count { it.isMatch })
        assertEquals("movie", s.match?.candidate?.mediaType)
    }

    @Test fun legacyNumericDocIsMergedPerParticipantAndTheNamedOneWins() {
        val s = TogetherBoard.build(listOf(c(7)), 2, mapOf(
            "7" to mapOf("a" to "no", "b" to "yes"),
            "movie_7" to mapOf("a" to "yes"),
        ))
        assertEquals(2, s.entries.single().yes)
    }

    @Test fun labelsShowCountsNeverNames() {
        val e = TogetherBoard.build(listOf(c(1)), 3, mapOf("movie_1" to mapOf("a" to "yes", "b" to "veto"))).entries.single()
        assertEquals("1 ja · 1 veto", e.label)
        assertEquals("väntar", TogetherBoard.build(listOf(c(2)), 3, emptyMap()).entries.single().label)
        assertEquals("2 ja", TogetherBoard.build(listOf(c(3)), 3, mapOf("movie_3" to mapOf("a" to "yes", "b" to "yes"))).entries.single().label)
        assertEquals("1 veto", TogetherBoard.build(listOf(c(4)), 3, mapOf("movie_4" to mapOf("a" to "veto"))).entries.single().label)
        assertEquals("inga ja", TogetherBoard.build(listOf(c(5)), 3, mapOf("movie_5" to mapOf("a" to "no"))).entries.single().label)
    }
}
