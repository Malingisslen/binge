package nu.binge.tv

import android.os.Build
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await

data class PairingCode(
    val pairingId: String,
    val deviceSecret: String,
    val userCode: String,
    val qrUrl: String,
    val expiresInSeconds: Int,
)

sealed interface PollResult {
    data object Pending : PollResult
    data object Expired : PollResult
    data class Approved(val token: String) : PollResult
}

/** Anropar de tre kopplingsfunktionerna i europe-west1. Hemligheten lämnar aldrig minnet utom i poll-anropet. */
class TvApi(
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance("europe-west1"),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) {
    suspend fun start(): PairingCode {
        val res = functions.getHttpsCallable("tvPairStart")
            .call(mapOf("deviceName" to Build.MODEL)).await().getData() as Map<*, *>
        return PairingCode(
            pairingId = res["pairingId"] as String,
            deviceSecret = res["deviceSecret"] as String,
            userCode = res["userCode"] as String,
            qrUrl = res["qrUrl"] as String,
            expiresInSeconds = (res["expiresInSeconds"] as Number).toInt(),
        )
    }

    suspend fun poll(code: PairingCode): PollResult {
        val res = functions.getHttpsCallable("tvPairPoll")
            .call(mapOf("pairingId" to code.pairingId, "deviceSecret" to code.deviceSecret))
            .await().getData() as Map<*, *>
        return when (res["status"]) {
            "approved" -> PollResult.Approved(res["token"] as String)
            "pending" -> PollResult.Pending
            else -> PollResult.Expired
        }
    }

    suspend fun signIn(token: String) {
        auth.signInWithCustomToken(token).await()
    }

    val isSignedIn: Boolean get() = auth.currentUser != null

    fun signOut() = auth.signOut()

    companion object {
        /** Funktionernas felkod, för att skilja "App Check nekade" från vanligt nätfel. */
        fun isRateLimited(e: Throwable): Boolean =
            e is FirebaseFunctionsException && e.code == FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED

        fun isAppCheckDenied(e: Throwable): Boolean =
            e is FirebaseFunctionsException && e.code == FirebaseFunctionsException.Code.UNAUTHENTICATED
    }
}
