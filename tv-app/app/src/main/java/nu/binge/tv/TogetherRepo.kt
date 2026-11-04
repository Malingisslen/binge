package nu.binge.tv

import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Lyssnar live på en Tillsammans-session. Sessioner kan redan läsas av den som har id:t (länkmodellen),
 * så ingen regel behöver öppnas för TV:n. Funktionen tvOverview ger bara id:t till ägarens egen session.
 * Deltagarnas namn läses aldrig: TV:n räknar bara röster.
 */
class TogetherRepo(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    fun board(sessionId: String): Flow<TogetherState> = callbackFlow {
        var session: DocumentSnapshot? = null
        var participants: QuerySnapshot? = null
        var swipes: QuerySnapshot? = null

        fun emit() {
            val s = session ?: return
            val candidates = (s.get("candidates") as? List<*>)?.filterIsInstance<Map<*, *>>()?.mapNotNull { c ->
                TogetherCandidate(
                    tmdbId = (c["tmdbId"] as? Number)?.toLong() ?: return@mapNotNull null,
                    mediaType = c["mediaType"] as? String ?: "movie",
                    title = c["title"] as? String ?: return@mapNotNull null,
                    posterPath = c["posterPath"] as? String,
                    providers = (c["providers"] as? List<*>)?.mapNotNull { (it as? Number)?.toLong() } ?: emptyList(),
                )
            } ?: emptyList()
            val votes = swipes?.documents?.associate { d ->
                d.id to ((d.get("votes") as? Map<*, *>)?.entries?.mapNotNull { (k, v) ->
                    if (k is String && v is String) k to v else null
                }?.toMap() ?: emptyMap())
            } ?: emptyMap()
            trySend(TogetherBoard.build(candidates, participants?.size() ?: 0, votes))
        }

        val ref = db.document("sessions/$sessionId")
        val l1 = ref.addSnapshotListener { snap, e -> if (e != null) close(e) else { session = snap; emit() } }
        val l2 = ref.collection("participants").addSnapshotListener { snap, e -> if (e != null) close(e) else { participants = snap; emit() } }
        val l3 = ref.collection("swipes").addSnapshotListener { snap, e -> if (e != null) close(e) else { swipes = snap; emit() } }
        awaitClose { l1.remove(); l2.remove(); l3.remove() }
    }
}
