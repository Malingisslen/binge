package nu.binge.tv

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.debug.internal.StorageHelper
import java.util.UUID

/**
 * Testvarianten har ingen Play Integrity (appen ligger inte i Play), så den använder App Checks
 * testläge. SDK:t skulle bara logga sin nyckel; TV:n har ingen loggvisning, så appen väljer nyckeln
 * själv och visar den på skärmen när Binge nekar den, så den kan registreras i Firebase Console.
 */
object AppCheckSetup {
    fun install(context: Context) {
        val store = StorageHelper(context, FirebaseApp.getInstance().persistenceKey)
        if (store.retrieveDebugSecret() == null) store.saveDebugSecret(UUID.randomUUID().toString())
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance(),
        )
    }

    fun debugToken(context: Context): String? =
        StorageHelper(context, FirebaseApp.getInstance().persistenceKey).retrieveDebugSecret()
}
