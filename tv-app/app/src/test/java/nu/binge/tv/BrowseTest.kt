package nu.binge.tv

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class BrowseTest {
    private fun title(
        id: String,
        isMovie: Boolean = true,
        status: String = "vill_se",
        dropped: Boolean = false,
        lastSeason: Long? = null,
        added: Long = 0,
        watchedAt: Long? = null,
        nextAir: String? = null,
        code: String? = null,
        providers: List<Long> = emptyList(),
    ) = Title(id, 1, isMovie, id, null, status, dropped, lastSeason, null, added, watchedAt, nextAir, code, providers)

    private val all = listOf(
        title("film-vill-se", added = 2),
        title("film-sedd", status = "sedd", watchedAt = 5),
        title("film-sedd-tidigare", status = "sedd", watchedAt = 1),
        title("film-avbruten", status = "avbruten"),
        title("serie-ny", isMovie = false, status = "mina", added = 3),
        title("serie-pagar", isMovie = false, status = "mina", lastSeason = 1, added = 4),
        title("serie-avbruten", isMovie = false, status = "mina", dropped = true, lastSeason = 1),
    )

    @Test fun tabsSplitTheListWithoutOverlapOrLoss() {
        assertEquals(listOf("serie-ny", "film-vill-se"), Browse.inTab(all, ListTab.WantToSee).map { it.docId })
        assertEquals(listOf("serie-pagar"), Browse.inTab(all, ListTab.Watching).map { it.docId })
        assertEquals(listOf("film-sedd", "film-sedd-tidigare"), Browse.inTab(all, ListTab.Seen).map { it.docId })
    }

    @Test fun droppedTitlesAreInNoTab() {
        val ids = ListTab.values().flatMap { Browse.inTab(all, it) }.map { it.docId }
        assertEquals(false, "serie-avbruten" in ids)
        assertEquals(false, "film-avbruten" in ids)
    }

    @Test fun onMineKeepsOnlyTitlesOnAnOwnedService() {
        val netflix = title("a", providers = listOf(8))
        val other = title("b", providers = listOf(119))
        assertEquals(listOf("a"), Browse.onMine(listOf(netflix, other), setOf(8L)).map { it.docId })
    }

    @Test fun calendarGroupsByDayEarliestFirstAndOwnedServicesFirstWithinTheDay() {
        val list = listOf(
            title("sen", isMovie = false, status = "mina", nextAir = "2026-11-12"),
            title("annan", isMovie = false, status = "mina", nextAir = "2026-11-07", providers = listOf(119)),
            title("min", isMovie = false, status = "mina", nextAir = "2026-11-07", providers = listOf(8)),
        )
        val days = Browse.calendar(list, setOf(8L))
        assertEquals(listOf("2026-11-07", "2026-11-12"), days.map { it.date })
        assertEquals(listOf("min", "annan"), days[0].titles.map { it.docId })
    }

    @Test fun dayLabelNamesTonightTomorrowAndLaterDays() {
        val today = LocalDate.of(2026, 11, 3)
        assertEquals("IKVÄLL", Browse.dayLabel("2026-11-03", today))
        assertEquals("IMORGON", Browse.dayLabel("2026-11-04", today))
        assertEquals("LÖRDAG 7 NOV", Browse.dayLabel("2026-11-07", today))
        assertEquals("SEDAN TIDIGARE", Browse.dayLabel("2026-10-30", today))
        assertEquals("inte-ett-datum", Browse.dayLabel("inte-ett-datum", today))
    }

    @Test fun factsSayOnlyWhatTheListKnows() {
        assertEquals("Film", Browse.facts(title("f")))
        assertEquals("Serie · Nästa avsnitt S02E03 · 2026-11-07", Browse.facts(title("s", isMovie = false, nextAir = "2026-11-07", code = "S02E03")))
    }
}
