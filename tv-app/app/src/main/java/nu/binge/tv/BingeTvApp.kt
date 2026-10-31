package nu.binge.tv

import android.app.Application
import com.google.firebase.FirebaseApp

class BingeTvApp : Application() {
    override fun onCreate() {
        super.onCreate()
        FirebaseApp.initializeApp(this)
        AppCheckSetup.install(this)
    }
}
