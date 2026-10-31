package nu.binge.tv

import android.content.Context
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

object AppCheckSetup {
    fun install(@Suppress("UNUSED_PARAMETER") context: Context) {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance(),
        )
    }

    /** Release har ingen testnyckel att visa. */
    fun debugToken(@Suppress("UNUSED_PARAMETER") context: Context): String? = null
}
