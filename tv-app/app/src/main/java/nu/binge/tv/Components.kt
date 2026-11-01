package nu.binge.tv

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Text
import coil.compose.AsyncImage

/** Tydlig fokus: den valda knappen är saffran, de andra är mörka. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun bingeButtonColors() = ButtonDefaults.colors(
    containerColor = BingeColors.Surface,
    contentColor = BingeColors.Text,
    focusedContainerColor = BingeColors.Accent,
    focusedContentColor = BingeColors.OnAccent,
)

/** Aktiv flik är saffran också när den inte har fokus, så man ser var man är. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun tabButtonColors(selected: Boolean) = ButtonDefaults.colors(
    containerColor = if (selected) BingeColors.AccentSoft else BingeColors.Surface,
    contentColor = if (selected) BingeColors.Accent else BingeColors.TextMuted,
    focusedContainerColor = BingeColors.Accent,
    focusedContentColor = BingeColors.OnAccent,
)

@Composable
fun PosterImage(url: String?, description: String, modifier: Modifier) {
    AsyncImage(
        model = url,
        contentDescription = description,
        contentScale = ContentScale.Crop,
        modifier = modifier.clip(RoundedCornerShape(10.dp)).background(BingeColors.Surface),
    )
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun Chip(text: String, accent: Boolean = false) {
    Box(
        Modifier.clip(RoundedCornerShape(6.dp))
            .background(if (accent) BingeColors.AccentSoft else BingeColors.Surface)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = if (accent) BingeColors.Accent else BingeColors.TextMuted, maxLines = 1)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun Initial(letter: String, filled: Boolean, size: Dp = 56.dp) {
    Box(
        Modifier.size(size).clip(CircleShape).background(if (filled) BingeColors.Accent else BingeColors.Surface),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold, color = if (filled) BingeColors.OnAccent else BingeColors.TextMuted)
    }
}

/** En rad affischer som går att flytta fokus till; ingen åtgärd än. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TitleRow(heading: String, titles: List<TitleRef>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(heading, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(titles, key = { it.key }) { t ->
                Card(
                    onClick = {},
                    border = CardDefaults.border(focusedBorder = Border(BorderStroke(3.dp, BingeColors.Accent))),
                ) {
                    PosterImage(t.posterUrl, t.title, Modifier.size(width = 112.dp, height = 168.dp))
                }
            }
        }
    }
}

/**
 * Remsan "Öppna i tjänsten": titelns tjänster med dina först. En tjänst utan känt paketnamn kan inte
 * öppnas härifrån och säger det i stället för att göra ingenting.
 */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ServiceStrip(rows: List<StripRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) return
    val context = LocalContext.current
    var notice by remember(rows) { mutableStateOf<String?>(null) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            rows.forEach { row ->
                Button(
                    onClick = {
                        notice = if (ServiceLauncher.open(context, row.info)) null
                        else "${row.info.name} går inte att öppna härifrån än. Öppna appen själv på TV:n."
                    },
                    colors = bingeButtonColors(),
                ) {
                    Text("${row.info.name} · ${row.label}", fontSize = 18.sp, maxLines = 1)
                }
            }
        }
        notice?.let { Text(it, fontSize = 18.sp, color = BingeColors.TextMuted) }
    }
}

object ServiceLauncher {
    /** Startar tjänstens app om den är installerad. Falskt när paketnamnet är okänt eller appen saknas. */
    fun open(context: Context, info: ProviderInfo): Boolean {
        val pkg = info.packageName ?: return false
        val pm = context.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return true
    }
}
