package nu.binge.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.tv.material3.Button
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text

class MainActivity : ComponentActivity() {
    private val vm: PairingViewModel by viewModels()

    @OptIn(ExperimentalTvMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val state by vm.state.collectAsState()
                Box(Modifier.fillMaxSize().background(BingeColors.Background).padding(64.dp)) {
                    when (val s = state) {
                        PairingState.Loading -> CenteredText("Hämtar kod …")
                        is PairingState.ShowCode -> CodeScreen(s)
                        PairingState.Paused -> PausedScreen(onNewCode = vm::begin)
                        PairingState.Paired -> CenteredText("TV:n är kopplad. Ikväll kommer här.")
                        is PairingState.Failed -> FailedScreen(s)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun CenteredText(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 32.sp, color = BingeColors.Text)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun CodeScreen(s: PairingState.ShowCode) {
    val qr = remember(s.qrUrl) { qrBitmap(s.qrUrl) }
    val spaced = s.userCode.chunked(4).joinToString("  ")
    Row(
        Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(96.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Text("Koppla Binge till TV:n", fontSize = 44.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
            Text("Öppna Binge på telefonen och skanna koden, eller skriv in koden på binge.nu/tv.", fontSize = 24.sp, color = BingeColors.TextMuted)
            Text(spaced, fontSize = 64.sp, fontWeight = FontWeight.Bold, color = BingeColors.Accent)
            Text("Koden gäller i en minut och byts ut automatiskt.", fontSize = 20.sp, color = BingeColors.TextMuted)
        }
        Image(
            bitmap = qr,
            contentDescription = "QR-kod för att koppla TV:n",
            modifier = Modifier.size(320.dp).clip(RoundedCornerShape(16.dp)),
        )
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FailedScreen(s: PairingState.Failed) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
        Text(s.message, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        Text("Försöker igen om en stund.", fontSize = 22.sp, color = BingeColors.TextMuted, modifier = Modifier.padding(top = 12.dp))
        s.appCheckToken?.let {
            Text("Testnyckel att registrera i Firebase Console:", fontSize = 22.sp, color = BingeColors.TextMuted, modifier = Modifier.padding(top = 32.dp))
            Text(it, fontSize = 30.sp, color = BingeColors.Accent)
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun PausedScreen(onNewCode: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
        Text("Koden har gått ut", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = BingeColors.Text)
        Text("Tryck Ok för att visa en ny kod.", fontSize = 22.sp, color = BingeColors.TextMuted, modifier = Modifier.padding(top = 12.dp, bottom = 32.dp))
        Button(onClick = onNewCode, modifier = Modifier.focusRequester(focus)) { Text("Visa ny kod") }
    }
}
