package nu.binge.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class IkappTextTest {
    private val members = listOf(HouseholdMember(0, "Malin", "M"), HouseholdMember(1, "Jonas", "J"))
    private fun row(vararg p: MemberProgress) = IkappRow(1, "Serie", null, p.toList())

    @Test fun sameEpisodeMeansCaughtUp() {
        assertEquals("Ni är ikapp", IkappText.status(row(MemberProgress(0, 2, 5), MemberProgress(1, 2, 5)), members))
    }

    @Test fun sameSeasonNamesWhoIsBehindAndByHowMany() {
        assertEquals("J ligger 2 efter", IkappText.status(row(MemberProgress(0, 2, 5), MemberProgress(1, 2, 3)), members))
    }

    @Test fun differentSeasonsAreSpelledOut() {
        assertEquals("M S3 E1 · J S2 E8", IkappText.status(row(MemberProgress(0, 3, 1), MemberProgress(1, 2, 8)), members))
    }

    @Test fun oneFollowerHasNothingToCompare() {
        assertEquals("", IkappText.status(row(MemberProgress(0, 1, 1)), members))
    }
}
