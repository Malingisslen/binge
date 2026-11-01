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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.google.firebase.auth.FirebaseAuth

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
    val current = s.current
    if (current == null) {
        Centered("Inget att se ikväll. Lägg till något i Vill se i Binge.")
        return
    }
    val others = s.picks.filterNot { it.docId == current.docId }
    // En rullbar lista: på en TV är skärmen lägre än hero och rader tillsammans, och raderna måste
    // gå att nå med pil ner i stället för att klippas av.
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(32.dp)) {
        item { Hero(current, onNext = vm::nextSuggestion, onWatched = vm::markWatched) }
        if (others.isNotEmpty()) item { PosterRow("Vill se", others) }
        if (s.upcoming.isNotEmpty()) item {
            PosterRow("Nästa avsnitt", s.upcoming, caption = { listOfNotNull(it.nextAirCode, it.nextAirDate).filter(String::isNotEmpty) })
        }
    }
}

/** Tydlig fokus: den valda knappen är saffran, de andra är mörka. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun bingeButtonColors() = ButtonDefaults.colors(
    containerColor = BingeColors.Surface,
    contentColor = BingeColors.Text,
    focusedContainerColor = BingeColors.Accent,
    focusedContentColor = BingeColors.Background,
)

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Hero(t: Title, onNext: () -> Unit, onWatched: () -> Unit) {
    val focus = remember { FocusRequester() }
    // Fokus på "Nästa förslag" och bara en gång: en dubbeltryckning ska aldrig markera titeln som sedd.
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Poster(t, Modifier.width(180.dp).height(270.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("IKVÄLL", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = BingeColors.Accent)
            // Fast höjd på titeln, så att knapparna ligger på samma ställe oavsett titel.
            Text(t.title, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text, minLines = 2, maxLines = 2)
            Text(TonightPicker.reason(t, System.currentTimeMillis()), fontSize = 22.sp, color = BingeColors.TextMuted)
            Text(t.runtime?.let { "$it min" }.orEmpty(), fontSize = 22.sp, color = BingeColors.TextMuted, minLines = 1, maxLines = 1)
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(top = 8.dp)) {
                Button(onClick = onNext, colors = bingeButtonColors(), modifier = Modifier.focusRequester(focus)) { Text("Nästa förslag") }
                Button(onClick = onWatched, colors = bingeButtonColors()) {
                    Text(if (t.isMovie) "Sedd" else "Såg första avsnittet")
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PosterRow(heading: String, titles: List<Title>, caption: (Title) -> List<String> = { emptyList() }) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(heading, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(titles, key = { it.docId }) { t ->
                Column(Modifier.width(140.dp)) {
                    // Valbar så att fokus kan flyttas hit med pil ner; ingen åtgärd än.
                    Card(
                        onClick = {},
                        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                    ) {
                        Poster(t, Modifier.width(140.dp).height(210.dp))
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

@Composable
private fun Poster(t: Title, modifier: Modifier) {
    AsyncImage(
        model = t.posterUrl,
        contentDescription = t.title,
        contentScale = ContentScale.Crop,
        modifier = modifier.clip(RoundedCornerShape(10.dp)).background(BingeColors.Surface),
    )
}
