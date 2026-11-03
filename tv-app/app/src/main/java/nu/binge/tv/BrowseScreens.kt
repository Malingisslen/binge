package nu.binge.tv

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.LaunchedEffect
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import java.time.LocalDate

/**
 * Hem: ett stort förslag överst och hyllor under (skiss A, vald av Malin 3 nov). Hyllorna kommer
 * ur den egna listan; en tom hylla visas inte.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HomeShelves(s: HomeState.Ready, onOpen: (Title) -> Unit) {
    val mine = s.overview.providers
    val wantToSee = Browse.wantToSee(s.all)
    // Ikväll äger dagens förslag; Hem öppnar i stället med nästa avsnitt som kommer, så de två flikarna inte visar samma sak.
    val featured = s.upcoming.firstOrNull()
    if (featured == null && wantToSee.isEmpty() && Browse.watching(s.all).isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Din lista är tom. Lägg till något i Binge så dyker det upp här.", fontSize = 28.sp, color = BingeColors.Text)
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        featured?.let { t -> item { Featured(t, mine, onOpen) } }
        val newOnMine = Browse.onMine(wantToSee, mine)
        if (newOnMine.isNotEmpty()) item { PosterRow("På dina tjänster", newOnMine, onOpen = onOpen) }
        if (wantToSee.isNotEmpty()) item { PosterRow("Vill se", wantToSee, onOpen = onOpen) }
        val laterEpisodes = s.upcoming.drop(1)
        if (laterEpisodes.isNotEmpty()) item {
            PosterRow("Fler avsnitt på väg", laterEpisodes, caption = { listOfNotNull(it.nextAirCode, it.nextAirDate).filter(String::isNotEmpty) }, onOpen = onOpen)
        }
        val watching = Browse.watching(s.all)
        if (watching.isNotEmpty()) item { PosterRow("Tittar på", watching, onOpen = onOpen) }
        item { TmdbNotice() }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Featured(t: Title, mine: Set<Long>, onOpen: (Title) -> Unit) {
    val rows = Providers.rows(t.providers, mine)
    Box(Modifier.fillMaxWidth().height(300.dp).clip(RoundedCornerShape(16.dp)).background(BingeColors.Surface)) {
        PosterBackdrop(t.posterUrl, Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize().padding(horizontal = 36.dp, vertical = 24.dp), verticalArrangement = Arrangement.Bottom) {
            val day = t.nextAirDate?.let { Browse.dayLabel(it, LocalDate.now()) }
            Text(listOfNotNull("NÄSTA AVSNITT", day).joinToString(" · "), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = BingeColors.Accent)
            Text(t.title, fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, color = BingeColors.Text, maxLines = 1)
            Text(
                t.nextAirCode.orEmpty(),
                fontSize = 20.sp, color = BingeColors.TextMuted, maxLines = 1,
                modifier = Modifier.padding(bottom = 12.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                if (rows.isNotEmpty()) ServiceStrip(rows)
                Button(onClick = { onOpen(t) }, colors = bingeButtonColors()) { Text("Mer om titeln") }
            }
        }
    }
}

/** Min lista: flikarna Vill se, Tittar på och Sett som affischer, med filter för det som finns på dina tjänster. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun MyListScreen(s: HomeState.Ready, onOpen: (Title) -> Unit) {
    var tab by remember { mutableStateOf(ListTab.WantToSee) }
    var onlyMine by remember { mutableStateOf(false) }
    val mine = s.overview.providers
    val base = Browse.inTab(s.all, tab)
    val shown = if (onlyMine) Browse.onMine(base, mine) else base
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            ListTab.values().forEach { t ->
                Button(onClick = { tab = t }, colors = tabButtonColors(t == tab)) { Text("${t.label} ${Browse.inTab(s.all, t).size}", fontSize = 20.sp) }
            }
            Spacer(Modifier.weight(1f))
            // Utan hämtade tjänster skulle filtret bara tömma listan.
            if (mine.isNotEmpty()) Button(onClick = { onlyMine = !onlyMine }, colors = tabButtonColors(onlyMine)) { Text("På mina tjänster", fontSize = 20.sp) }
        }
        if (shown.isEmpty()) {
            Text(
                if (onlyMine) "Inget i den här fliken finns på dina tjänster." else "Inget här än.",
                fontSize = 24.sp, color = BingeColors.TextMuted,
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(130.dp),
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                gridItems(shown, key = { it.docId }) { t ->
                    Card(
                        onClick = { onOpen(t) },
                        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                    ) {
                        PosterImage(t.posterUrl, t.title, Modifier.fillMaxWidth().height(195.dp))
                    }
                }
            }
        }
        // TMDB:s villkor kräver den här texten där deras affischer visas.
        TmdbNotice()
    }
}

/** Kalender: kommande avsnitt per dag, dina tjänster först inom dagen. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun CalendarScreen(s: HomeState.Ready, onOpen: (Title) -> Unit) {
    val days = Browse.calendar(s.all, s.overview.providers)
    if (days.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Inga kommande avsnitt. Serier du följer dyker upp här.", fontSize = 28.sp, color = BingeColors.Text)
        }
        return
    }
    val today = LocalDate.now()
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        items(days, key = { it.date }) { day ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(Browse.dayLabel(day.date, today), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = BingeColors.Accent)
                day.titles.forEach { t ->
                    val service = Providers.rows(t.providers, s.overview.providers).firstOrNull { it.mine }?.info?.name
                    Card(
                        onClick = { onOpen(t) },
                        modifier = Modifier.fillMaxWidth(),
                        // Kortets standardfärg är ljus och gör vit text oläslig mot mörk bakgrund.
                        colors = CardDefaults.colors(
                            containerColor = BingeColors.Surface,
                            contentColor = BingeColors.Text,
                            focusedContainerColor = BingeColors.AccentSoft,
                            focusedContentColor = BingeColors.Text,
                        ),
                        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                    ) {
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            PosterImage(t.posterUrl, t.title, Modifier.width(48.dp).height(72.dp))
                            Column(Modifier.weight(1f)) {
                                Text(t.title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text, maxLines = 1)
                                t.nextAirCode?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 18.sp, color = BingeColors.TextMuted) }
                            }
                            service?.let { Text(it, fontSize = 20.sp, color = BingeColors.Accent) }
                        }
                    }
                }
            }
        }
        item { TmdbNotice() }
    }
}

/** Sidan för en titel: bakgrund, den stora knappen med priser, och Sedd. Tillbaka stänger den. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TitleDetail(t: Title, mine: Set<Long>, onClose: () -> Unit, onWatched: (Title) -> Unit) {
    BackHandler(onBack = onClose)
    val rows = Providers.rows(t.providers, mine)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp)).background(BingeColors.Surface)) {
        PosterBackdrop(t.posterUrl, Modifier.fillMaxSize())
        Row(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 32.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            PosterImage(t.posterUrl, t.title, Modifier.width(220.dp).height(330.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(t.title, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold, color = BingeColors.Text, maxLines = 2)
                Text(Browse.facts(t), fontSize = 22.sp, color = BingeColors.TextMuted)
                if (rows.isNotEmpty()) ServiceStrip(rows)
                else Text("Vi vet inte var den finns just nu.", fontSize = 20.sp, color = BingeColors.TextMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(top = 8.dp)) {
                    if (canMarkWatched(t)) {
                        Button(onClick = { onWatched(t) }, colors = bingeButtonColors(), modifier = Modifier.focusRequester(focus)) {
                            Text(if (t.isMovie) "Sedd" else "Såg första avsnittet")
                        }
                    }
                    Button(
                        onClick = onClose, colors = bingeButtonColors(),
                        modifier = if (canMarkWatched(t)) Modifier else Modifier.focusRequester(focus),
                    ) { Text("Tillbaka") }
                }
                TmdbNotice()
            }
        }
    }
}

/** Det TV:n får skriva är bara "sedd" på en film som inte är sedd och första avsnittet på en ny serie. */
fun canMarkWatched(t: Title): Boolean =
    !t.dropped && if (t.isMovie) t.status == "vill_se" else t.status == "mina" && t.lastWatchedSeason == null

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TmdbNotice() {
    Text("This product uses the TMDB API but is not endorsed or certified by TMDB.", fontSize = 14.sp, color = BingeColors.TextMuted)
}
