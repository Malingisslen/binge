package nu.binge.tv

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import com.google.firebase.auth.FirebaseAuth

private enum class Tab(val label: String) {
    Home("Hem"), Tonight("Ikväll"), MyList("Min lista"), Calendar("Kalender"), Together("Tillsammans"), Household("Hushållet")
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HomeScreen(onRevoked: () -> Unit) {
    // Egen instans per inloggad TV: efter bortkoppling och ny koppling får inget gammalt läge eller
    // någon tidigare ägares lista följa med.
    val vm: HomeViewModel = viewModel(key = FirebaseAuth.getInstance().currentUser?.uid ?: "ingen")
    val state by vm.state.collectAsState()
    when (val s = state) {
        HomeState.Loading -> Centered("Hämtar din lista …")
        HomeState.Revoked -> LaunchedEffect(Unit) { onRevoked() }
        is HomeState.Failed -> Failed(s.message, onRetry = vm::refresh)
        is HomeState.Ready -> Ready(s, vm)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Centered(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 32.sp, color = BingeColors.Text)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Failed(message: String, onRetry: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
        Text(message, fontSize = 32.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        Button(onClick = onRetry, modifier = Modifier.padding(top = 24.dp).focusRequester(focus)) { Text("Försök igen") }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Ready(s: HomeState.Ready, vm: HomeViewModel) {
    var picked by remember { mutableStateOf(Tab.Home) }
    // Titelsidan ligger över flikarna. Efter "Sedd" laddas allt om och den stängs av sig själv.
    var open by remember { mutableStateOf<Title?>(null) }
    val household = s.overview.household?.takeIf { it.members.size >= 2 }
    val tabs = buildList {
        add(Tab.Home)
        add(Tab.Tonight)
        add(Tab.MyList)
        add(Tab.Calendar)
        if (s.overview.sessionId != null) add(Tab.Together)
        if (household != null) add(Tab.Household)
    }
    // Försvinner sessionen medan man står på dess flik går man tillbaka till Ikväll.
    val active = if (picked in tabs) picked else Tab.Home

    open?.let { t ->
        TitleDetail(t, s.overview.providers, onClose = { open = null }, onWatched = vm::markWatched)
        return
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("binge", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = BingeColors.Accent, modifier = Modifier.padding(end = 16.dp))
            if (tabs.size > 1) tabs.forEach { t ->
                Button(onClick = { picked = t }, colors = tabButtonColors(t == active)) { Text(t.label, fontSize = 20.sp) }
            }
        }
        when (active) {
            Tab.Home -> HomeShelves(s, onOpen = { open = it })
            Tab.Tonight -> Tonight(s, vm, onOpen = { open = it })
            Tab.MyList -> MyListScreen(s, onOpen = { open = it })
            Tab.Calendar -> CalendarScreen(s, onOpen = { open = it })
            Tab.Together -> TogetherScreen(s.overview.sessionId.orEmpty(), s.overview.providers)
            Tab.Household -> if (household != null) HouseholdScreen(household, s.seated, vm::toggleSeat)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Tonight(s: HomeState.Ready, vm: HomeViewModel, onOpen: (Title) -> Unit) {
    val current = s.current
    if (current == null) {
        Centered("Inget att se ikväll. Lägg till något i Vill se i Binge.")
        return
    }
    val others = s.picks.filterNot { it.docId == current.docId }
    // En rullbar lista: på en TV är skärmen lägre än hero och rader tillsammans, och raderna måste
    // gå att nå med pil ner i stället för att klippas av.
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    // Fokus på en knapp rullar bara så mycket att knappen syns och lämnar affisch och titel klippta;
    // hela förslaget ska alltid synas när man står på det.
    val showWholeHero: () -> Unit = { scope.launch { listState.animateScrollToItem(0) } }
    LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item { Hero(current, s.overview.providers, s.picks.size, s.index, onNext = vm::nextSuggestion, onWatched = vm::markWatched, onFocus = showWholeHero) }
        if (others.isNotEmpty()) item { PosterRow("Vill se", others, onOpen = onOpen) }
        if (s.upcoming.isNotEmpty()) item {
            PosterRow("Nästa avsnitt", s.upcoming, caption = { listOfNotNull(it.nextAirCode, it.nextAirDate).filter(String::isNotEmpty) }, onOpen = onOpen)
        }
        // TMDB:s villkor kräver den här texten där deras affischer och uppgifter visas.
        item {
            Text(
                "This product uses the TMDB API but is not endorsed or certified by TMDB.",
                fontSize = 14.sp,
                color = BingeColors.TextMuted,
            )
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Hero(t: Title, mine: Set<Long>, total: Int, index: Int, onNext: () -> Unit, onWatched: () -> Unit, onFocus: () -> Unit) {
    val focus = remember { FocusRequester() }
    // Fokus på "Nästa förslag" och bara en gång: en dubbeltryckning ska aldrig markera titeln som sedd.
    LaunchedEffect(Unit) { focus.requestFocus() }
    val rows = Providers.rows(t.providers, mine)
    // Skissens stora förslag: affischen som dämpad bakgrund bakom texten, stor titel och knapparna under.
    Box(Modifier.fillMaxWidth().height(380.dp).clip(RoundedCornerShape(16.dp)).background(BingeColors.Surface)) {
        PosterBackdrop(t.posterUrl, Modifier.fillMaxSize())
        Row(Modifier.fillMaxSize().padding(horizontal = 36.dp, vertical = 24.dp), horizontalArrangement = Arrangement.spacedBy(36.dp)) {
            PosterImage(t.posterUrl, t.title, Modifier.width(180.dp).height(270.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("IKVÄLL · FÖRSLAG ${index + 1} AV $total", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = BingeColors.Accent)
                // Fast höjd på titeln, så att knapparna ligger på samma ställe oavsett titel.
                Text(t.title, fontSize = 44.sp, fontWeight = FontWeight.ExtraBold, color = BingeColors.Text, minLines = 2, maxLines = 2)
                Text(
                    listOfNotNull(TonightPicker.reason(t, System.currentTimeMillis(), mine), t.runtime?.let { "$it min" }).joinToString(" · "),
                    fontSize = 22.sp, color = BingeColors.TextMuted, minLines = 2, maxLines = 2,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(top = 4.dp)) {
                    Button(onClick = onNext, colors = bingeButtonColors(), modifier = Modifier.focusRequester(focus).onFocusChanged { if (it.isFocused) onFocus() }) { Text("Nästa förslag") }
                    Button(onClick = onWatched, colors = bingeButtonColors(), modifier = Modifier.onFocusChanged { if (it.isFocused) onFocus() }) {
                        Text(if (t.isMovie) "Sedd" else "Såg första avsnittet")
                    }
                }
                ServiceStrip(rows, Modifier.padding(top = 4.dp), onFocus = onFocus)
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PosterRow(heading: String, titles: List<Title>, caption: (Title) -> List<String> = { emptyList() }, onOpen: (Title) -> Unit = {}) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(heading, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(titles, key = { it.docId }) { t ->
                Column(Modifier.width(112.dp)) {
                    Card(
                        onClick = { onOpen(t) },
                        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                    ) {
                        PosterImage(t.posterUrl, t.title, Modifier.width(112.dp).height(168.dp))
                    }
                    // Kod och datum på var sin rad, annars klipps datumet i en smal kolumn.
                    caption(t).forEachIndexed { i, line ->
                        Text(line, fontSize = 16.sp, color = BingeColors.TextMuted, maxLines = 1, modifier = Modifier.padding(top = if (i == 0) 6.dp else 0.dp))
                    }
                }
            }
        }
    }
}
