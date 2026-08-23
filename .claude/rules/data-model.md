---
paths:
  - "src/lib/firebase/**"
  - "src/lib/watchStatus.ts"
  - "src/lib/watchStatus.migration.ts"
  - "src/lib/libraryView.ts"
  - "src/contexts/AuthContext.tsx"
  - "src/lib/passwordStrength.ts"
  - "firestore.rules"
  - "firestore.indexes.json"
---

# Data model (Firestore) + Auth

```
users/{uid}                               — profil, preferenser, termsAcceptedAt, onboardingCompletedAt
users/{uid}/watchlist/{mediaType_tmdbId} — mediaTypeDocId(), t.ex. movie_42 / tv_42 (BIN-560).
                                           Sedan BIN-766 binder firestore.rules FORMEN på create
                                           (`^(movie|tv)_[1-9][0-9]*$` sedan BIN-797) — communityRatings
                                           härleder betygsaggregatets nyckel ur den här vägen och
                                           kanoniserar sifferdelen, så en alias-stavning (movie_042)
                                           skulle annars landa på samma publika dokument som den
                                           riktiga titeln och kunna räknas om och om igen.
                                           update är AVSIKTLIGT ogrindad: ett legacy bara-numeriskt
                                           dokument måste kunna redigeras vidare.
                                           Fält: status (vill_se/mina/sedd/avbruten), rating,
                                           providers, isPublic (denormaliserad)
users/{uid}/episodeProgress/{mediaType_tmdbId} — per-avsnitt watched-state (alltid tv_N)
users/{uid}/notInterested/{mediaType_tmdbId}   — gömda titlar från rekommendationer
users/{uid}/notifications/{notifId}      — inbox
users/{uid}/blocked/{targetUid}          — blockerade användare
users/{uid}/following/{targetUid}        — följ-out
users/{uid}/followers/{followerUid}      — följ-in (speglad)

reviews/{reviewId}                       — top-level, public read
reviews/{id}/likes/{uid}                 — doc-id = uid (för enkel is-liked-lookup)
reviews/{id}/comments/{commentId}        — public read

lists/{listId}                           — kurerade titellistor, isPublic på dokument-nivå
sessions/{sessionId}                     — Tillsammans-sessioner, expiresAt + 7 dagar
sessions/{id}/participants/{pid}
sessions/{id}/swipes/{mediaType_tmdbId}   — mediaTypeDocId(), t.ex. movie_42 / tv_42 (BIN-569).
                                           Legacy bara-numeriska docs läses fortfarande och
                                           slås ihop PER DELTAGARE med det namngivna doc:et
                                           (`votes` är en map flera skribenter fyller på —
                                           ett dokument-val tappar röster, BIN-608), tills
                                           sessionens TTL städat bort dem.

groups/{groupId}                         — permanenta grupper, inviteToken + inviteTokenRotatedAt
groups/{id}/members/{uid}
groups/{id}/watchlist/{mediaType_tmdbId}

usernames/{username}                     — global username-reservation, värdet är { uid }
reports/{reportId}                       — UGC-moderation, create-only från klient, admin-läses via Console
```

## Delad Firestore-helper: `collectUserDataSnapshots`

`src/lib/firebase/userData.ts` konsumeras av både `buildUserExport` (GDPR Art.
20 export) och `deleteAccount` (konto-radering). Om du lägger till en ny
user-owned subcollection: uppdatera den här helpern så båda flödena får med
den.

## WatchStatus + TV sub-states (TV-aware schema)

```
'vill_se'   — vill se (ENDAST film sedan 2026-06; TV-vill_se lazy-migreras till 'mina')
'mina'      — TV ONLY: följer (UI "Följer"; läge derive:as från progress + TMDB)
'sedd'      — film ONLY: terminal (filmer går aldrig tillbaka)
'avbruten'  — gav upp (både film + TV)
```

**TV sub-state** (deriverat, aldrig sparat — beräknas via `tvSubState()` i
`src/lib/watchStatus.ts`; biblioteket använder den persisted-fields-only
varianten `librarySubState()` i `src/lib/libraryView.ts`):
- `ej_paborjad` — följs men inget avsnitt markerat (ingen progress)
- `aktiv`    — bakom på aireade avsnitt (har osedda S/E mot TMDB:s last_episode_to_air)
- `ikapp`    — caught up + Returning Series → väntar på nytt
- `avslutad` — caught up + Ended/Canceled → klar

**Designval:** TV är aldrig "klar" på samma sätt som film — show vaknar från
döden, får spinoffs, returnerar med nya säsonger. Därför har TV inget 'sedd'
slutläge; istället bor seriens HELA liv under 'mina' (från ej påbörjad till
avslutad) och läget ändras automatiskt när progress eller TMDB:s
last_episode_to_air rör sig. "Vill se en serie" ÄR att följa den — knappen
heter "Följ" (CTA-verb), chipen "Följer". Endast film har 'sedd' som terminal
och 'vill_se' som bookmark — film är klar när den är klar.

**Progress ändrar aldrig status.** `WatchlistContext.updateProgress` skriver
bara lastWatched-fälten; läget (ej_paborjad → aktiv/ikapp) härleds. Den gamla
auto-promote-flytten vill_se → mina togs bort 2026-06.

**Ej påbörjad nycklar beteende på flera ställen** — använd progress
(`lastWatchedSeason == null`), inte status: rådgivaren behandlar dem som
will see-ankare (`splitTvByProgress`), Tillsammans behåller dem som
sessionskandidater (`libraryExclusionIds`), taste-vikterna ger dem
vill_se-nivå, och episodeNotify skickar inga pushar för dem.

**Migration** (lazy, klient-sidigt i `migrateStatus`, `src/lib/watchStatus.migration.ts`):
- 'vill_se' (TV) → 'mina' (landar som ej_paborjad); 'vill_se' (film) → oförändrat
- 'följer' (TV) → 'mina'; 'följer' (film) → 'sedd' (rare)
- 'sedd' (TV) → 'mina'; 'sedd' (film) → 'sedd' (oförändrat)
- Engelska v1-schema (`watching`/`want_to_watch`/`watched`/`dropped`) hanteras samtidigt
- Firestore-docs skrivs aldrig om bara för migration — bara när användaren
  ändrar något på en titel skrivs den med nya schemat. Så Firestore kan
  innehålla 'följer'/'vill_se'-strängar på serier i mångmånader; läsare normaliserar.

**Routes:**
- `/my/series` — TV i 'mina' (sektioner: ligger efter/pågående/ej påbörjade/avslutade)
- `/my/films` — film i 'sedd'
- `/my/vill-se` — väljaren ("vad ska du se ikväll?"): filmer i 'vill_se' + serier
  i 'mina' utan progress. Ingen statushantering — `VillSePickerPage`, inte WatchlistPage.
- `/my/avbrutna`, `/my/all` — mixed
- Gamla `/my/following` → 301 → `/my/series` (firebase.json redirects)
- Gamla `/my/watched` → 301 → `/my/films`

## Auth

- Firebase Auth är riktigt aktivt (inte stub)
- Google SSO + email/password (med password-strength-validation via
  `src/lib/passwordStrength.ts`)
- Email-verification skickas vid sign-up; banner i AppShell med resend-knapp
- Firebase App Check är opt-in via `NEXT_PUBLIC_APP_CHECK_SITE_KEY`
  (reCAPTCHA v3) — no-op utan site key, säker default
