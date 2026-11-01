package nu.binge.tv

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

// Compose-färgens `value` är inte en ARGB-int, så pixlarna skrivs som vanliga Android-färger.
private const val BLACK = 0xFF000000.toInt()
private const val WHITE = 0xFFFFFFFF.toInt()

fun qrBitmap(content: String, sizePx: Int = 512): ImageBitmap {
    val matrix = QRCodeWriter().encode(
        content, BarcodeFormat.QR_CODE, sizePx, sizePx,
        mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2),
    )
    val pixels = IntArray(sizePx * sizePx) { i ->
        if (matrix.get(i % sizePx, i / sizePx)) BLACK else WHITE
    }
    return Bitmap.createBitmap(pixels, sizePx, sizePx, Bitmap.Config.ARGB_8888).asImageBitmap()
}
