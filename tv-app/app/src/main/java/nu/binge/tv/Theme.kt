package nu.binge.tv

import androidx.compose.ui.graphics.Color

/** Webbens mörka läge (binge.nu, `globals.css` `[data-theme=dark]`) omräknat från oklch till sRGB. */
object BingeColors {
    val Background = Color(0xFF110F0D)
    val Surface = Color(0xFF201E1B)
    val Text = Color(0xFFEFEEEB)
    val TextMuted = Color(0xFFB9B7B3)
    val Accent = Color(0xFFDE9C31)
    val OnAccent = Color(0xFF110F0D)
}
