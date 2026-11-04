package nu.binge.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProvidersTest {
    @Test fun yourOwnServicesComeFirst() {
        val rows = Providers.rows(listOf(8, 337, 119), mine = setOf(119))
        assertEquals(listOf(119L, 8L, 337L), rows.map { it.info.id })
        assertTrue(rows.first().mine)
        assertEquals("Du har", rows.first().label)
    }

    @Test fun unknownIdsAndDuplicatesAreSkipped() {
        assertEquals(listOf(8L), Providers.rows(listOf(999999, 8, 8), emptySet()).map { it.info.id })
    }

    @Test fun svtAliasCountsAsSvtAndIsFree() {
        val row = Providers.rows(listOf(493), mine = emptySet()).single()
        assertEquals(520L, row.info.id)
        assertEquals("Gratis", row.label)
    }

    @Test fun netflixAliasShowsAsNetflix() {
        assertEquals(8L, Providers.rows(listOf(175), emptySet()).single().info.id)
    }

    @Test fun everyWebAliasMapsToItsService() {
        // Samma par som src/lib/tmdb/providers.ts: HBO Max, TV4 Play och Apple TV+ har flera id:n.
        mapOf(1899L to 384L, 1825L to 384L, 1944L to 489L, 1759L to 489L, 2243L to 350L).forEach { (alias, service) ->
            assertEquals(service, Providers.rows(listOf(alias), emptySet()).single().info.id)
        }
    }

    @Test fun ownedAliasMatchesTheCanonicalService() {
        assertTrue(Providers.rows(listOf(520), mine = setOf(493)).single().mine)
    }

    @Test fun titleOnYourServiceIsPickedBeforeAnNewerOneThatIsNot() {
        fun t(id: String, added: Long, providers: List<Long>) =
            Title(id, 1, true, id, null, "vill_se", false, null, 100, added, null, null, null, providers)
        val picks = TonightPicker.picks(listOf(t("ny-annan", 9, listOf(76)), t("gammal-min", 1, listOf(8))), mine = setOf(8))
        assertEquals(listOf("gammal-min", "ny-annan"), picks.map { it.docId })
    }

    @Test fun reasonNamesTheServiceOnlyWhenYouHaveIt() {
        val t = Title("a", 1, true, "a", null, "vill_se", false, null, 100, 0, null, null, null, listOf(8))
        assertTrue(TonightPicker.reason(t, 0, setOf(8)).startsWith("Finns på Netflix som du har."))
        assertFalse(TonightPicker.reason(t, 0, emptySet()).contains("Netflix"))
    }

    @Test fun priceTextIsFreeOrFromPriceAndNeverInvented() {
        assertEquals("från 129 kr/mån", Providers.info(8)?.priceText)
        assertEquals("gratis", Providers.info(520)?.priceText)
        assertEquals("från 99 kr/mån", Providers.info(76)?.priceText)
    }
}
