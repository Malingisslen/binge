# Dataexport — format

Binge erbjuder GDPR Art. 20 data-portabilitet via `Settings → Exportera min data`.

Filen är en JSON med följande top-level-struktur (se
`src/lib/firebase/dataExport.ts` för kanoniska fält):

```jsonc
{
  "schemaVersion": "2.0",
  "exportedAt": "2026-04-24T10:30:00.000Z",
  "userId": "firebase-uid",
  "readme": "…",
  "tmdbAttribution": "…",
  "justwatchAttribution": "…",
  "profile": { /* users/{uid} — privat, ägar-låst */ },
  "publicProfile": { /* publicProfiles/{uid} — den publika projektionen andra ser */ },
  "watchlist":      [{ "id": "…", "data": { /* … */ } }],
  "watchlistTags":  [{ "id": "tmdbId", "data": { "tags": ["…"] } }],
  "watchlistNotes": [{ "id": "tmdbId", "data": { "note": "…" } }],
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
  "listFollows":        [ … ],
  "reviews":         [ … ],
  "reviewLikes":     [ … ],
  "reviewComments":  [ … ],
  "episodeReactions":[ … ],
  "lists":           [ … ],
  "editableLists":   [ … ],
  "sessions":        [ … ],
  "groupMemberships":[ … ],
  "householdContributions": [ … ]
}
```

## Fältinnehåll

| Fält | Källa | Innehåll |
|------|-------|----------|
| `profile` | `users/{uid}` (ägar-låst läsning, BIN-505) | displayName, email, hemkommun, photoURL, username, bio, isPublic, myProviders, defaultView, providerCosts, providerCampaigns, providerTiers, providerPauses, calibrationGenres, termsAcceptedAt, termsVersion, onboardingCompletedAt, notificationSettings, createdAt, updatedAt. Denna doc är sedan BIN-505 **bara läsbar för dig** — känsliga fält (email, hemkommun, kostnader) läcker inte längre till andra. |
| `publicProfile` | `publicProfiles/{uid}` (BIN-505) | Den publika projektionen andra användare ser: displayName, username, photoURL, bio, createdAt. INGA känsliga fält (ingen email/hemkommun/kostnader/myProviders). `null` om den aldrig backfillats. |
| `watchlist` | `users/{uid}/watchlist/{tmdbId}` | Per-titel: status, betyg, progress (TV), rewatchCount, genreIds, visibility. (Anteckningar ligger sedan BIN-505 i `watchlistNotes`, inte här.) Plus TMDB-metadata cachead som bekvämlighet (denormaliserad; ingår i exporten): title, posterPath, releaseYear, totalSeasons, tmdbStatus, runtime, providers, subscriptionProviders, providersCheckedAt, nextAirDate, nextAirCode, nextAirProvider, nextAirUpdatedAt, digitalReleaseDate |
| `watchlistTags` | `users/{uid}/watchlistTags/{tmdbId}` | Dina egna fritext-taggar per titel (privata; egen ägar-skyddad subcollection) |
| `watchlistNotes` | `users/{uid}/watchlistNotes/{tmdbId}` | Dina egna fritext-anteckningar per titel (privata; egen ägar-skyddad subcollection, BIN-505 — flyttade av från den publikt läsbara watchlist-doc:en) |
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
| `episodeReactions` | `episodeReactions/*/reactions/{id}` (where uid==me) | Dina avsnitts-reaktioner (BIN-95) |
| `listFollows` | `users/{uid}/listFollows/{listId}` | Listor du följer (BIN-96) |
| `lists` | `lists/{listId}` (where uid==me) | Dina egenkurerade listor + items |
| `editableLists` | `lists/{listId}` (editors array-contains me) | Listor du är medredigerare i (BIN-100) |
| `sessions` | `sessions/{sessionId}` (where hostUid==me) | Tillsammans-sessioner du är värd för |
| `groupMemberships` | `groups/{groupId}` (array-contains me) | Grupper du är medlem i + gruppdata |
| `householdContributions` | `groups/{groupId}/household/{uid}` (endast grupper du opt:at in i, BIN-184) | Ditt delade hushålls-bidrag per grupp: providerIds, providerCosts (kr/tjänst, ordinarie pris — inga tier-namn), providerCampaigns (kampanjpris + slutdatum), activeProviderIds (tjänster med minst en osedd backlog-titel — usage-härlett, inte självrapporterat), updatedAt |

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
- **1.1 (2026-07-01, BIN-164)** — Lade till `watchlistTags` (dina privata
  fritext-taggar per titel, egen ägar-skyddad subcollection). Additivt fält →
  minor-bump 1.0 → 1.1.
- **1.2 (2026-07-05, BIN-184)** — Lade till `householdContributions` (dina
  delade hushålls-bidrag i grupper du opt:at in i — providerIds,
  providerCosts, providerCampaigns, activeProviderIds, updatedAt). Additivt
  fält → minor-bump 1.1 → 1.2.
- **1.3 (2026-07-14, BIN-505)** — Lade till `publicProfile` (den publika
  projektionen andra ser) och `watchlistNotes` (dina privata anteckningar,
  flyttade av från den publikt läsbara watchlist-doc:en till en ägar-skyddad
  subcollection). Additiva fält → minor-bump 1.2 → 1.3.
- **2.0 (2026-07-22, BIN-560)** — MAJOR: BETYDELSEÄNDRING av `id`-fältet (inte
  additivt). `id` på varje personlig-bibliotek-doc (`watchlist`, `watchlistTags`,
  `watchlistNotes`, `episodeProgress`, `notInterested`) kodar nu BÅDE medietyp
  och TMDB-id som `${mediaType}_${tmdbId}` (t.ex. `movie_603`, `tv_1399`) i
  stället för bara det numeriska tmdbId. En film och en serie kan dela samma
  TMDB-nummer; namespacet håller dem åtskilda i dina egna poster. En consumer som
  tolkade `id` som ett tal måste nu dela på första `_` (eller läsa `tmdbId`/
  `mediaType`-fälten i doc-kroppen). Major-bump 1.3 → 2.0 så gamla parsers
  failar högljutt i stället för att tyst mis-matcha en film mot en samnumrerad serie.
