package nu.binge.tv

import java.time.LocalDate

enum class ListTab(val label: String) { WantToSee("Vill se"), Watching("Tittar på"), Seen("Sett") }

data class CalendarDay(val date: String, val titles: List<Title>)

/**
 * Urval och gruppering för Hem, Min lista och Kalender. Allt kommer ur den egna listan: TV:n har
 * ingen TMDB-nyckel och ingen sökning, så "populärt" och "liknande" finns inte här.
 */
object Browse {
    /** Filmer som inte är sedda och serier som inte är påbörjade, senast tillagd först. */
    fun wantToSee(all: List<Title>): List<Title> =
        all.filter { !it.dropped && if (it.isMovie) it.status == "vill_se" else it.status == "mina" && it.lastWatchedSeason == null }
            .sortedByDescending { it.addedAtMs }

    fun watching(all: List<Title>): List<Title> =
        all.filter { !it.isMovie && !it.dropped && it.status == "mina" && it.lastWatchedSeason != null }
            .sortedByDescending { it.addedAtMs }

    fun seen(all: List<Title>): List<Title> =
        all.filter { it.isMovie && !it.dropped && it.status == "sedd" }
            .sortedByDescending { it.watchedAtMs ?: it.addedAtMs }

    fun inTab(all: List<Title>, tab: ListTab): List<Title> = when (tab) {
        ListTab.WantToSee -> wantToSee(all)
        ListTab.Watching -> watching(all)
        ListTab.Seen -> seen(all)
    }

    /** Det du vill se och kan se direkt på en tjänst du har. */
    fun onMine(titles: List<Title>, mine: Set<Long>): List<Title> = titles.filter { TonightPicker.fitsMine(it, mine) }

    /** Kommande avsnitt per dag, närmast först; titlar på dina tjänster står först inom dagen. */
    fun calendar(all: List<Title>, mine: Set<Long>): List<CalendarDay> =
        TonightPicker.upcoming(all)
            .groupBy { it.nextAirDate.orEmpty() }
            .map { (date, titles) -> CalendarDay(date, titles.sortedByDescending { TonightPicker.fitsMine(it, mine) }) }
            .sortedBy { it.date }

    private val weekdays = listOf("MÅNDAG", "TISDAG", "ONSDAG", "TORSDAG", "FREDAG", "LÖRDAG", "SÖNDAG")
    private val months = listOf("JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC")

    /** "IKVÄLL", "IMORGON" eller till exempel "LÖRDAG 7 NOV"; ett datum som redan passerat heter "SEDAN TIDIGARE". */
    fun dayLabel(iso: String, today: LocalDate): String {
        val date = try { LocalDate.parse(iso) } catch (e: Exception) { return iso }
        return when {
            date.isBefore(today) -> "SEDAN TIDIGARE"
            date == today -> "IKVÄLL"
            date == today.plusDays(1) -> "IMORGON"
            else -> "${weekdays[date.dayOfWeek.value - 1]} ${date.dayOfMonth} ${months[date.monthValue - 1]}"
        }
    }

    /** Raden under titelsidans rubrik, till exempel "Serie · 45 min · Nästa avsnitt S02E03 · 2026-11-07". */
    fun facts(t: Title): String = listOfNotNull(
        if (t.isMovie) "Film" else "Serie",
        t.runtime?.let { "$it min" },
        if (!t.isMovie && !t.nextAirCode.isNullOrEmpty()) "Nästa avsnitt ${t.nextAirCode}" + (t.nextAirDate?.let { " · $it" } ?: "") else null,
    ).joinToString(" · ")
}
