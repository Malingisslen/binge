package nu.binge.tv

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight

/** Webbens mörka läge (binge.nu, `globals.css` `[data-theme=dark]`) omräknat från oklch till sRGB. */
object BingeColors {
    val Background = Color(0xFF110F0D)
    val Surface = Color(0xFF201E1B)
    val Text = Color(0xFFEFEEEB)
    val TextMuted = Color(0xFFB9B7B3)
    val Accent = Color(0xFFDE9C31)
    val AccentSoft = Color(0xFF3A2A12)
    val OnAccent = Color(0xFF110F0D)
}

/** Albert Sans (OFL), samma typsnitt som webben. En variabel fil, en instans per vikt. */
@OptIn(ExperimentalTextApi::class)
val AlbertSans = FontFamily(
    listOf(400, 500, 600, 700, 800).map { w ->
        Font(
            resId = R.font.albert_sans,
            weight = FontWeight(w),
            variationSettings = FontVariation.Settings(FontVariation.weight(w)),
        )
    },
)
