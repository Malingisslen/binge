package nu.binge.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import kotlinx.coroutines.CancellationException

/** Tillsammans som live-tavla: affischerna byter plats när rösterna kommer in, och en match fyller skärmen. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TogetherScreen(sessionId: String, mine: Set<Long>) {
    var failed by remember(sessionId) { mutableStateOf(false) }
    val state by produceState<TogetherState?>(null, sessionId) {
        try {
            TogetherRepo().board(sessionId).collect { value = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = true
        }
    }
    val s = state
    when {
        failed -> Message("Sessionen går inte att nå just nu.")
        s == null -> Message("Ansluter till sessionen …")
        s.entries.isEmpty() -> Message("Sessionen har inga förslag än. Starta kortleken i Binge på telefonen.")
        s.match != null -> Match(s.match!!, mine)
        else -> Board(s)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Message(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 30.sp, color = BingeColors.Text)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Board(s: TogetherState) {
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Chip("Tillsammans · ${s.participants} med", accent = true)
            Text("Rösterna kommer in medan ni svajpar", fontSize = 20.sp, color = BingeColors.TextMuted)
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(s.entries.take(7), key = { it.candidate.key }) { e ->
                Column(Modifier.width(150.dp).animateItem(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Card(
                        onClick = {},
                        border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                    ) {
                        PosterImage(e.candidate.posterUrl, e.candidate.title, Modifier.width(150.dp).height(225.dp))
                    }
                    Votes(e)
                }
            }
        }
    }
}

/** Ja-räknaren pulserar till när en ny röst kommer in. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Votes(e: BoardEntry) {
    val pulse = remember { Animatable(1f) }
    LaunchedEffect(e.yes, e.veto) {
        pulse.snapTo(1.25f)
        pulse.animateTo(1f)
    }
    Text(
        e.label,
        fontSize = 22.sp,
        fontWeight = if (e.yes > 0) FontWeight.Bold else FontWeight.Normal,
        color = if (e.yes > 0) BingeColors.Accent else BingeColors.TextMuted,
        modifier = Modifier.scale(pulse.value),
    )
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Match(e: BoardEntry, mine: Set<Long>) {
    val rows = Providers.rows(e.candidate.providers, mine)
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(48.dp), verticalAlignment = Alignment.CenterVertically) {
        PosterImage(e.candidate.posterUrl, e.candidate.title, Modifier.width(260.dp).height(390.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Chip("Match!", accent = true)
            Text(e.candidate.title, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold, color = BingeColors.Text, maxLines = 2)
            Text("Alla ${e.participants} sa ja", fontSize = 26.sp, color = BingeColors.TextMuted)
            ServiceStrip(rows, Modifier.padding(top = 16.dp))
        }
    }
}
