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

data class Overview(val providers: Set<Long>, val sessionId: String?, val household: HouseholdOverview?) {
    companion object {
        val EMPTY = Overview(emptySet(), null, null)

        private fun num(v: Any?): Long? = (v as? Number)?.toLong()
        private fun str(v: Any?): String? = v as? String
        private fun list(v: Any?): List<Map<*, *>> = (v as? List<*>)?.filterIsInstance<Map<*, *>>() ?: emptyList()

        private fun titleRef(m: Map<*, *>): TitleRef? {
            val id = num(m["tmdbId"]) ?: return null
            return TitleRef(id, str(m["mediaType"]) ?: "movie", str(m["title"]) ?: return null, str(m["posterPath"]))
        }

        fun parse(res: Map<*, *>): Overview {
            val providers = (res["providers"] as? List<*>)?.mapNotNull(::num)?.toSet() ?: emptySet()
            val household = (res["household"] as? Map<*, *>)?.let { h ->
                val members = list(h["members"]).mapNotNull { m ->
                    HouseholdMember(num(m["index"])?.toInt() ?: return@mapNotNull null, str(m["name"]).orEmpty(), str(m["initial"]) ?: "?")
                }
                val view = (h["view"] as? Map<*, *>)?.let { v ->
                    HouseholdView(
                        shared = list(v["shared"]).mapNotNull(::titleRef),
                        onlyOne = list(v["onlyOne"]).mapNotNull { o ->
                            OnlyOne(num(o["member"])?.toInt() ?: return@mapNotNull null, list(o["titles"]).mapNotNull(::titleRef))
                        },
                        ikapp = list(v["ikapp"]).mapNotNull { i ->
                            IkappRow(
                                num(i["tmdbId"]) ?: return@mapNotNull null,
                                str(i["title"]) ?: return@mapNotNull null,
                                str(i["posterPath"]),
                                list(i["progress"]).mapNotNull { p ->
                                    MemberProgress(
                                        num(p["member"])?.toInt() ?: return@mapNotNull null,
                                        num(p["season"])?.toInt() ?: return@mapNotNull null,
                                        num(p["episode"])?.toInt() ?: return@mapNotNull null,
                                    )
                                },
                            )
                        },
                    )
                }
                HouseholdOverview(members, view, str(h["roster"]), h["seatingReset"] == true)
            }
            return Overview(providers, str(res["sessionId"]), household)
        }
    }
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

    /**
     * Ägarens tjänster, pågående Tillsammans-session och hushållsvyn, färdigfiltrerade av servern.
     * `seated` är platserna i soffan; de sparas aldrig, varken här eller på servern.
     */
    suspend fun overview(seated: List<Int>, roster: String? = null): Overview {
        val res = functions.getHttpsCallable("tvOverview")
            .call(mapOf("seated" to seated, "roster" to roster)).await().getData() as Map<*, *>
        return Overview.parse(res)
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
