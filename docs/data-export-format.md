# Dataexport — format

Binge erbjuder GDPR Art. 20 data-portabilitet via `Settings → Exportera min data`.

Filen är en JSON med följande top-level-struktur (se
`src/lib/firebase/dataExport.ts` för kanoniska fält):

```jsonc
{
  "schemaVersion": "1.0",
  "exportedAt": "2026-04-24T10:30:00.000Z",
  "userId": "firebase-uid",
  "readme": "…",
  "tmdbAttribution": "…",
  "justwatchAttribution": "…",
  "profile": { /* users/{uid} */ },
  "watchlist":      [{ "id": "…", "data": { /* … */ } }],
  "episodeProgress": [ … ],
  "notInterested":   [ … ],
  "notifications":   [ … ],
  "blocked":         [ … ],
  "following":       [ … ],
  "followers":       [ … ],
  "friends":            [ … ],
  "friendRequests":     [ … ],
  "friendRequestsSent": [ … ],
  "groupInvites":       [ … ],
  "pauseHistory":       [ … ],
  "reviews":         [ … ],
  "reviewLikes":     [ … ],
  "reviewComments":  [ … ],
  "lists":           [ … ],
  "editableLists":   [ … ],
  "sessions":        [ … ],
  "groupMemberships":[ … ]
}
```

## Fältinnehåll

| Fält | Källa | Innehåll |
|------|-------|----------|
| `profile` | `users/{uid}` | displayName, email, photoURL, username, bio, isPublic, myProviders, defaultView, providerCosts, providerTiers, providerPauses, calibrationGenres, termsAcceptedAt, termsVersion, onboardingCompletedAt, notificationSettings, createdAt, updatedAt |
| `watchlist` | `users/{uid}/watchlist/{tmdbId}` | Per-titel: status, betyg, notes, progress (TV), rewatchCount, providers, genreIds, tmdbStatus |
| `episodeProgress` | `users/{uid}/episodeProgress/{tmdbId}` | Watched-flagga per avsnitt |
| `notInterested` | `users/{uid}/notInterested/{tmdbId}` | Gömda titlar från rekommendationer |
| `notifications` | `users/{uid}/notifications/{notifId}` | Notifikations-inbox |
| `blocked` | `users/{uid}/blocked/{targetUid}` | Blockerade användare + timestamps |
| `following` | `users/{uid}/following/{targetUid}` | Följda användar-uids + timestamps |
| `followers` | `users/{uid}/followers/{followerUid}` | Uids av de som följer dig + timestamps |
| `friends` | `users/{uid}/friends/{friendUid}` | Vänner (ömsesidiga följningar) + timestamps |
| `friendRequests` | `users/{uid}/friendRequests/{fromUid}` | Inkomna vänförfrågningar |
| `friendRequestsSent` | `users/{uid}/friendRequestsSent/{toUid}` | Skickade vänförfrågningar |
| `groupInvites` | `users/{uid}/groupInvites/{groupId}` | Inkomna grupp-inbjudningar |
| `pauseHistory` | `users/{uid}/pauseHistory/{historyId}` | Sparbeslut-historik från Streamingrådgivaren |
| `reviews` | `reviews/{reviewId}` (where uid==me) | Dina recensioner med text, betyg, spoiler-flagga |
| `reviewLikes` | `reviews/*/likes/{uid}` | Likes du gjort på andras recensioner (doc-id = ditt uid) |
| `reviewComments` | `reviews/*/comments/{commentId}` (where uid==me) | Dina kommentarer |
| `lists` | `lists/{listId}` (where uid==me) | Dina egenkurerade listor + items |
| `editableLists` | `lists/{listId}` (editors array-contains me) | Listor du är medredigerare i (BIN-100) |
| `sessions` | `sessions/{sessionId}` (where hostUid==me) | Tillsammans-sessioner du är värd för |
| `groupMemberships` | `groups/{groupId}` (array-contains me) | Grupper du är medlem i + gruppdata |

## Datumserialisering

Firestore Timestamps blir Firestore-serializerade objekt i JSON:

```json
{ "_seconds": 1745474400, "_nanoseconds": 0 }
```

Vid re-import: konvertera med `new Date(seconds * 1000)` eller Firestore
Admin-SDK:s `Timestamp.fromMillis()`.

## Vad ingår INTE i exporten

- TMDB-metadata (titel, poster, genrer) är cachead bekvämlighet, inte dina
  personuppgifter. Källan är TMDB.
- Andra användares data (t.ex. kommentarer du fått på dina recensioner —
  de är deras personuppgifter, inte dina).
- Historiska versioner — vi sparar bara nuvarande state.
- Auth-metadata (Firebase Auth-objekt) — den kontrolleras av Firebase
  direkt, inte av vår app.

## Vad du får ut

Exporten räcker för att:
1. **Arkivera** hela ditt tittande i ett öppet format.
2. **Re-importera** till en framtida version av Binge (om/när det blir
   aktuellt — det finns inget import-flöde idag, men schemat är stabilt).
3. **Migrera** till en annan mediatracker — kräver manuell mappning men
   all relevant data finns.
4. **Lämna in** till en tillsynsmyndighet om du begär register-utdrag.

## Schema-version

Bump `SCHEMA_VERSION` i `src/lib/firebase/dataExport.ts` när strukturen
ändras på ett icke-bakåtkompatibelt sätt:
- Lägga till ett nytt fält: minor (1.0 → 1.1)
- Ta bort ett fält: major (1.x → 2.0)
- Ändra betydelse av ett fält: major

Dokumentera ändringar i CHANGELOG.md-sektionen nedan.

### Changelog

- **1.0 (2026-04-24)** — Initial version.
- **1.0 (2026-05-29)** — Lade till user-owned-fält som redan hämtades men
  tappades i exporten: `friends`, `friendRequests`, `friendRequestsSent`,
  `groupInvites`, `pauseHistory`. Rent additivt (inga befintliga fält
  ändrade), därför hålls `schemaVersion` på `1.0`.
