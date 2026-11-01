package nu.binge.tv

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text

private enum class Step(val label: String) { Couch("Vem tittar?"), Ikapp("Ikapp med varandra"), Circles("Våra cirklar") }

/**
 * Hushållet i tre steg: soffan, ikapp-listan och cirklarna. Vem som sitter i soffan väljs här och
 * styr vad servern skickar; ingen annans lista visas för den som inte satt sig.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HouseholdScreen(household: HouseholdOverview, seated: Set<Int>, onToggleSeat: (Int) -> Unit) {
    var step by remember { mutableStateOf(Step.Couch) }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Step.values().forEach { st ->
                Button(onClick = { step = st }, colors = tabButtonColors(st == step)) { Text(st.label, fontSize = 18.sp) }
            }
        }
        when (step) {
            Step.Couch -> Couch(household, seated, onToggleSeat)
            Step.Ikapp -> Ikapp(household, seated)
            Step.Circles -> Circles(household, seated)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Couch(h: HouseholdOverview, seated: Set<Int>, onToggle: (Int) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Text("Vem tittar ikväll?", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            h.members.forEach { m ->
                val on = m.index in seated
                Card(
                    onClick = { onToggle(m.index) },
                    border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                ) {
                    Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Initial(m.initial, filled = on, size = 72.dp)
                        Text(m.name.ifEmpty { m.initial }, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text, maxLines = 1)
                        Text(if (on) "i soffan" else "inte här", fontSize = 16.sp, color = BingeColors.TextMuted)
                    }
                }
            }
        }
        val shared = h.view?.shared.orEmpty()
        when {
            seated.size < 2 -> Text("Sitter du ensam ser du din vanliga Ikväll. Sätt dig med någon för att se vad ni kan se ihop.", fontSize = 22.sp, color = BingeColors.TextMuted)
            shared.isEmpty() -> Text("Ni har ingen titel som alla i soffan vill se än.", fontSize = 22.sp, color = BingeColors.TextMuted)
            else -> TitleRow("Ni kan se ikväll", shared)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Ikapp(h: HouseholdOverview, seated: Set<Int>) {
    val rows = h.view?.ikapp.orEmpty()
    if (seated.size < 2 || rows.isEmpty()) {
        Text(
            if (seated.size < 2) "Sätt dig i soffan med någon för att se var ni ligger i serierna."
            else "Ni följer ingen serie ihop än.",
            fontSize = 24.sp, color = BingeColors.TextMuted,
        )
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(rows, key = { it.tmdbId }) { row ->
            Card(
                onClick = {},
                border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
            ) {
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    PosterImage(row.posterUrl, row.title, Modifier.width(60.dp).height(90.dp))
                    Column(Modifier.width(420.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(row.title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text, maxLines = 1)
                        Text(
                            row.progress.joinToString("   ") { p -> "${h.members.firstOrNull { it.index == p.member }?.initial ?: "?"} ${IkappText.code(p)}" },
                            fontSize = 18.sp, color = BingeColors.TextMuted, maxLines = 1,
                        )
                    }
                    val status = IkappText.status(row, h.members)
                    Chip(status, accent = status == "Ni är ikapp")
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun Circles(h: HouseholdOverview, seated: Set<Int>) {
    val view = h.view
    if (seated.size < 2 || view == null) {
        Text("Sätt dig i soffan med någon för att se vad ni vill se ihop och var för sig.", fontSize = 24.sp, color = BingeColors.TextMuted)
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item {
            val heading = if (seated.size == 2) "NI BÅDA" else "NI ALLA"
            if (view.shared.isEmpty()) Text("$heading · inget gemensamt än", fontSize = 22.sp, color = BingeColors.TextMuted)
            else TitleRow(heading, view.shared)
        }
        // Med fyra eller fler skickar servern inga enskilda listor: cirklarna går inte att läsa på avstånd.
        items(view.onlyOne.filter { it.titles.isNotEmpty() }, key = { it.member }) { o ->
            val name = h.members.firstOrNull { it.index == o.member }
            TitleRow("BARA ${name?.name?.uppercase()?.ifEmpty { null } ?: name?.initial ?: "?"}", o.titles)
        }
    }
}
