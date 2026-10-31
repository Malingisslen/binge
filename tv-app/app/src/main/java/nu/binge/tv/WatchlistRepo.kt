package nu.binge.tv

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.tasks.await

/** Läser ägarens watchlist med TV:ns egen inloggning. Reglerna släpper bara in just de här vägarna. */
class WatchlistRepo(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private suspend fun ownerUid(): String {
        val claims = auth.currentUser?.getIdToken(false)?.await()?.claims
        return claims?.get("ownerUid") as? String ?: error("TV:n saknar koppling")
    }

    suspend fun load(): List<Title> {
        val uid = ownerUid()
        // Alltid från servern: en minnescache får inte visa en tidigare ägares titlar efter ny koppling.
        return db.collection("users/$uid/watchlist").get(Source.SERVER).await().documents.mapNotNull(::parse)
    }

    /**
     * Film: sedd. Serie: första avsnittet sett. Bara fält som reglerna tillåter TV:n att skriva.
     * `watchedAt` skrivs bara när titeln saknar datum (BIN-593), och `dropped` nollas så att en
     * gammal avbruten-flagga inte får webben att läsa titeln som avbruten igen.
     */
    suspend fun markWatched(title: Title) {
        val uid = ownerUid()
        val update = mutableMapOf<String, Any>("updatedAt" to FieldValue.serverTimestamp())
        if (title.isMovie) {
            update["status"] = "sedd"
            update["dropped"] = false
            if (title.watchedAtMs == null) update["watchedAt"] = FieldValue.serverTimestamp()
        } else {
            // Reglerna kräver ett giltigt status efter skrivningen, och en gammal post kan ha ett äldre värde.
            update["status"] = "mina"
            update["lastWatchedSeason"] = 1
            update["lastWatchedEpisode"] = 1
        }
        db.document("users/$uid/watchlist/${title.docId}").update(update).await()
    }

    private fun parse(d: DocumentSnapshot): Title? {
        val title = d.getString("title") ?: return null
        val isMovie = d.getString("mediaType") == "movie"
        val dropped = d.getBoolean("dropped") == true
        val added = d.getTimestamp("addedAt") ?: d.getTimestamp("updatedAt")
        return Title(
            docId = d.id,
            tmdbId = d.getLong("tmdbId") ?: return null,
            isMovie = isMovie,
            title = title,
            posterPath = d.getString("posterPath"),
            status = StatusMigration.migrate(d.getString("status") ?: return null, isMovie, dropped),
            dropped = dropped,
            lastWatchedSeason = d.getLong("lastWatchedSeason"),
            runtime = d.getLong("runtime"),
            addedAtMs = added?.toDate()?.time ?: 0L,
            watchedAtMs = d.getTimestamp("watchedAt")?.toDate()?.time,
            nextAirDate = d.getString("nextAirDate"),
            nextAirCode = d.getString("nextAirCode"),
        )
    }
}
