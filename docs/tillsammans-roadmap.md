# Tillsammans — social roadmap

Levande dokument för Binges sociala lager. Uppdateras när beslut ändras.

## Vision

Binge sociala särart = **svensk streaming-tillgänglighet**. Killer-frågan är inte
"vad tyckte min kompis?" utan **"vad kan vi alla streama ikväll?"**. Alla sociala
funktioner ska förstärka den vinkeln.

Trogen Binges DNA: dense, tabellaktigt, inget festligt. Sociala element som tät
meta-data, inte dominerande feeds.

## Designbeslut (från intervju 2026-04-17)

| Beslut | Val | Anteckning |
| --- | --- | --- |
| Viktigaste funktion först | "Tillsammans ikväll"-motorn | Levererad i fas 1 |
| Sessionsstart | Grupper **+** ad-hoc | Båda behövs |
| Gäst-UX | Temporär länk à la Doodle | Ingen konto för gäst |
| Input för motorn | Befintlig historik + swipa rekommendationer | Kombinera |
| Röstnings-UI | Swipe-kort (med info) + tabell-toggle | Togglebart |
| TV-asymmetri | Tillåt med varning | Ingen hård synk |
| Profil-id | Publikt `@handle`, låst efter val | Finns redan |
| Reviews i MVP | Bara ratings | Reviews är redan byggt men inte prioriterat för sociala |
| Notifikationer | Bara in-app | Ingen e-post/push |
| Grupp-providers | Toggle per session/grupp | Intersect default för par |
| Aggregering | Användaren väljer per session | Least-misery / average / fair |
| Session-realtid | Async + auto-detektera live | MVP: async via onSnapshot räcker |
| Match-tröskel | Majoritet ja, 1 veto/person | Veto dödar definitivt |
| Privacy-default | Privat | Profil opt-in till publik |
| Monetisering | Inte berört | Skippas tills vidare |
| Första grund | Auth + Firestore | Redan på plats i kodbasen |

## Status per fas

### Fas 0 — Grund ✅

- Firebase Auth (Google + e-post)
- Firestore för watchlist, episodeProgress, profiler
- `@handle`-system (`usernames/{handle}`-kollektion, unikhets-index)
- Publika profiler, follow, reviews, lists
- Aktivitetsfeed (`/feed`)

### Fas 1 — "Tillsammans ikväll" ✅ (PR #1, squash `fdebda7`)

- Sessions-datamodell i Firestore (`sessions/{id}/participants`, `/swipes`)
- Trust-baserad unlisted-link-modell (pid i localStorage, inget krav på auth)
- Kandidatgenerering via TMDB Discover med provider-intersect/union
- Realtidsuppdatering av deltagare och röster (onSnapshot)
- Swipe-kort + tät tabellvy med toggle
- Veto: 1/person/session, modal-bekräftelse, röd knapp
- Match-logik: majoritet ja, veto dödar, ranking på `yes − no × 0.5`
- Sidomenylänk "Tillsammans"

### Fas 2 — Permanenta grupper (nästa)

Återkommande konstellationer så man slipper bjuda in varje kväll.

- `/grupper/ny` — skapa grupp, bjud in via `@handle` eller länk
- `/grupper/[id]` — gruppsida med gemensam watchlist, sett-lista, default-inställningar
- Gemensamma ratings per medlem (kolumn per person i tabell)
- TV-asymmetri-varning per rad (`A har sett t.o.m. S2E4`)
- "Starta session med denna grupp"-knapp
- Grupp-provider-drift: om medlem ändrar providers, uppdatera gruppens intersect automatiskt

**Datamodell-tillägg:**

```
groups/{groupId}
  name, ownerUid, memberUids[]
  defaults: { providerMode, aggregation, mediaType }

groups/{groupId}/members/{uid}
  role, joinedAt, notifications

groups/{groupId}/watchlist/{tmdbId}
  addedBy, addedAt, memberRatings: { uid: number }
```

### Fas 3 — Smak-overlap och taste-scoring

Just nu använder kandidatmotorn bara TMDB-popularitet. Förfining:

- Beräkna genre-viktat smakvektor per användare (watchlist + ratings)
- Cosine eller Jaccard-similaritet mellan smakvektorer
- Visa "smak-match %" på profiler och i sessioner
- Aggregeringsstrategierna (least-misery / average / fair) får verklig effekt när smak-scores finns
- Kalibreringsswipe för nya användare (10 titlar) om de har 0 ratings
- Nattlig Cloud Function: beräkna och cacha överlapp på user-dok

### Fas 4 — Social polish

- In-app-notifier ("2 deltagare väntar på dig i sessionen X")
- Live-läge-banner i session när alla är aktiva < 10 sek sedan
- Reaktioner på följdas aktivitet i feeden (✓ sett, + till min lista)
- "Smak-match"-kolumn på publika profiler
- Profil-stats: topp-genrer, topp-providers, senaste 30 dagar

### Fas 5 — Senare

- Push-notiser (web push, sedan mobil)
- Reviews-utbyggnad (likes, kommentarer, feed) — hooks finns, UI saknas
- Parental-control-läge för familj-grupper
- Affiliate-länkar till streaming-tjänsterna
- Monetisering (om relevant)

## Öppna frågor

- **Moderering av text-content** — rapportera-knapp + manuell eller LLM-filter?
- **Grupp-provider-drift** — bekräftelse eller automatik vid förändring?
- **@handle-reservation** — reservera kändis/vanliga namn?
- **Kalibrering vs tom historik** — tvinga kalibrering vid 0 ratings, eller funka med popularitet som fallback?
- **Session-TTL** — 7 dagar nu, korrekt?
- **GDPR på gäster** — anonyma pid i localStorage, inga personuppgifter — räcker det?

## Referenser

Inspiration som informerade planen:

- Letterboxd — social film discovery, private list sharing
- Serializd — Letterboxd-för-TV
- Trakt.tv — shared watchlists
- JustWatch — custom lists + svensk provider-data
- Matched (iOS) + Swipe With Friends — par/tinder-för-film
- "Watch and Chill" — kollaborativa listor
- Forskning: group recommender systems (least-misery, average, fairness-aggregering)
