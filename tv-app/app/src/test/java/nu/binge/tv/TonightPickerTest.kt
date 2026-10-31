package nu.binge.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TonightPickerTest {
    private fun title(
        id: String,
        isMovie: Boolean = true,
        status: String = "vill_se",
        dropped: Boolean = false,
        lastSeason: Long? = null,
        runtime: Long? = 100,
        added: Long = 0,
        nextAir: String? = null,
    ) = Title(id, 1, isMovie, id, null, status, dropped, lastSeason, runtime, added, null, nextAir, null)

    @Test fun onlyUnwatchedMoviesAndUnstartedSeriesAreCandidates() {
        val all = listOf(
            title("film-vill-se"),
            title("film-sedd", status = "sedd"),
            title("film-avbruten", status = "avbruten"),
            title("serie-ej-paborjad", isMovie = false, status = "mina"),
            title("serie-paborjad", isMovie = false, status = "mina", lastSeason = 1),
            title("serie-avbruten", isMovie = false, status = "mina", dropped = true),
            title("serie-vill-se", isMovie = false, status = "vill_se"),
            title("serie-sedd", isMovie = false, status = "sedd"),
        )
        assertEquals(listOf("film-vill-se", "serie-ej-paborjad"), TonightPicker.picks(all).map { it.docId }.sorted())
    }

    @Test fun seriesWithSeasonZeroCountsAsStarted() {
        assertTrue(TonightPicker.picks(listOf(title("s", isMovie = false, status = "mina", lastSeason = 0))).isEmpty())
    }

    @Test fun newestAddedComesFirstRegardlessOfRuntime() {
        val all = listOf(
            title("okand-speltid", runtime = null, added = 9),
            title("gammal", added = 1),
            title("ny", added = 5),
        )
        assertEquals(listOf("okand-speltid", "ny", "gammal"), TonightPicker.picks(all).map { it.docId })
    }

    @Test fun upcomingIsSortedByDateAndSkipsMoviesAndDropped() {
        val all = listOf(
            title("senare", isMovie = false, status = "mina", nextAir = "2026-11-09"),
            title("snart", isMovie = false, status = "mina", nextAir = "2026-11-02"),
            title("film", nextAir = "2026-11-01"),
            title("serie-sedd", isMovie = false, status = "sedd", nextAir = "2026-11-01"),
            title("avbruten", isMovie = false, status = "mina", dropped = true, nextAir = "2026-11-01"),
            title("utan-datum", isMovie = false, status = "mina"),
            title("tom-sträng", isMovie = false, status = "mina", nextAir = ""),
        )
        assertEquals(listOf("snart", "senare"), TonightPicker.upcoming(all).map { it.docId })
    }

    @Test fun reasonNamesTheWait() {
        val day = 24L * 60 * 60 * 1000
        assertEquals("Nytt i din Vill se", TonightPicker.reason(title("a", added = 5 * day), 5 * day))
        assertEquals("Nytt i din Vill se", TonightPicker.reason(title("a", added = 0), day - 1))
        assertEquals("Legat i din Vill se sedan igår", TonightPicker.reason(title("a", added = 0), day))
        assertEquals("Legat i din Vill se i 12 dagar", TonightPicker.reason(title("a", added = 0), 12 * day))
    }

    @Test fun reasonNeverGoesNegativeForAFutureAddedDate() {
        assertEquals("Nytt i din Vill se", TonightPicker.reason(title("a", added = 1000), 0))
    }
}
