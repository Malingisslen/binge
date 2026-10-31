package nu.binge.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class StatusMigrationTest {
    private fun m(raw: String, movie: Boolean, dropped: Boolean = false) = StatusMigration.migrate(raw, movie, dropped)

    @Test fun droppedFlagWinsOverEveryStatus() {
        assertEquals("avbruten", m("vill_se", movie = true, dropped = true))
        assertEquals("avbruten", m("mina", movie = false, dropped = true))
    }

    @Test fun legacySeriesStatusesBecomeMina() {
        for (raw in listOf("watching", "följer", "want_to_watch", "vill_se", "watched", "sedd", "mina", "något-okänt")) {
            assertEquals(raw, "mina", m(raw, movie = false))
        }
    }

    @Test fun legacyMovieStatusesFollowTheWebTable() {
        assertEquals("sedd", m("watching", movie = true))
        assertEquals("sedd", m("följer", movie = true))
        assertEquals("vill_se", m("want_to_watch", movie = true))
        assertEquals("vill_se", m("vill_se", movie = true))
        assertEquals("sedd", m("watched", movie = true))
        assertEquals("sedd", m("sedd", movie = true))
        assertEquals("sedd", m("mina", movie = true))
        assertEquals("avbruten", m("dropped", movie = true))
        assertEquals("avbruten", m("avbruten", movie = false))
        assertEquals("vill_se", m("något-okänt", movie = true))
    }
}
