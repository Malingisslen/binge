# Dataretention + anonymisering-policy

_Status: 2026-04-24. Gäller från sprint 4._

## Policy-beslut

När ett konto raderas (via `Settings → Ta bort konto`) hanterar vi publikt
UGC enligt följande regler.

### Privat data → Hård radering

Allt som bara användaren själv ser tas bort helt:

- `users/{uid}` (profil-doc)
- `users/{uid}/watchlist/*`
- `users/{uid}/episodeProgress/*`
- `users/{uid}/notInterested/*`
- `users/{uid}/notifications/*`
- `users/{uid}/blocked/*`
- `users/{uid}/following/*` (ensidig)
- `users/{uid}/followers/*` (matchande följ-relationer på andra håll)
- `users/{uid}/friends/*` (+ speglad radering på vännens sida)
- `users/{uid}/friendRequests/*` (inkommande, + speglad sent-sida)
- `users/{uid}/friendRequestsSent/*` (utgående, + speglad in-sida)
- `users/{uid}/groupInvites/*` (inkomna grupp-inbjudningar)
- `users/{uid}/listFollows/*` (följda listor, BIN-96)
- `users/{uid}/pauseHistory/*` (paus-/återupptag-historik från Sparande)

#### Operationell metadata → Hård radering

Teknisk metadata som användaren aldrig ser men som ändå raderas helt vid
kontoradering (samlas via samma `collectUserDataSnapshots`-helper):

- `users/{uid}/fcmTokens/*` — push-enhetstokens; raderas så Cloud Functions
  slutar försöka skicka push till ett raderat konto
- `users/{uid}/reportMeta/*` — rapport-throttle-stämpel (anti-abuse, BIN-25/49)
- `users/{uid}/askBingeMeta/*` — Fråga Binge LLM-throttle-stämpel (kostnadstak)

Dessa tre är medvetet UNDANTAGNA ur GDPR-exporten (Art. 20) — de är
drift-/säkerhetsmetadata, inte användarens egna data — men raderas ändå helt
vid kontoradering. Export och radering läser samma helper
(`src/lib/firebase/userData.ts`), så listorna hålls i synk: lägger man till en
ny user-owned subcollection måste helpern uppdateras så båda flödena får med den.

Inga återhämtningsbara referenser till datan finns efter radering,
förutom Firestore PITR inom 7 dagar (administrativt bara).

#### Per-titel-borttagning ("Ta bort" i biblioteket)

"Ta bort" på en titel raderar watchlist-docen men lämnar medvetet kvar
`users/{uid}/episodeProgress/{tmdbId}` — den som lägger tillbaka serien
återupptar där hen var. Användaren informeras i borttagnings-toasten
("Avsnittshistoriken sparas.") och kan välja **Rensa helt**, som även
raderar historik-docen (`clearEpisodeProgress`). Vid kontoradering
försvinner allt oavsett, enligt listan ovan.

### Publikt UGC → Hård radering (v1)

Public-facing UGC tas bort helt, INTE anonymiseras, för följande
anledningar:

- **Juridiskt rentare.** GDPR Art. 17 ger absolut rätt till radering
  när användaren begär det. "Vi tog bort ditt namn men behöll innehållet"
  är en laglig gråzon som vi inte vill testa.
- **Ingen threading-risk.** Binges reviews-kommentarer är grunda (inte
  Reddit-style nested trees). Borttagning av en kommentar bryter inte
  en konversation i oigenkännlig form.
- **Enkelt att implementera.** `deleteAccount`-cascaden behöver ingen
  speciell "anonymiseringsväg" — bara delete-ops.

Så vid radering:

- `reviews/{reviewId}` där `uid == me` → **delete**
- `reviews/*/comments/{commentId}` där `uid == me` → **delete**
- `reviews/*/likes/{uid}` där doc-id == me → **delete**
- `lists/{listId}` där `uid == me` → **delete**
- `sessions/{sessionId}` där `hostUid == me` → **delete**

### Grupp-medlemskap → Självborttag

När användaren raderas:

- I `groups/{groupId}` där `memberUids` innehåller mig → **ta bort mig
  ur array:en**
- Om jag är owner (`ownerUid == me`) och det finns andra medlemmar →
  transferera ownership till första andra medlemmen (kommande sprint —
  TODO). För nuvarande: om owner raderar sig lämnas gruppen ägarlös och
  kan inte modifieras (okej tillstånd eftersom owner ändå kan delete:a
  gruppen först).

### Användarnamn → Hård radering + release

`usernames/{username}` doc tas bort → användarnamnet blir tillgängligt
för framtida användare att claim:a.

Detta är en avvikelse från många plattformar som "tombstonar" usernames
för att förhindra imitation. Avvägning:
- Imitations-risken är låg (Binge är inte en celebrity-plattform)
- Låst-username-pool växer oändligt och är användarhostile

Om imitations-rapporter ökar senare — revisit: behåll username-doc med
`retired: true`-flagga, blockera claim.

## Tekniska implikationer

`AuthContext.deleteAccount` implementerar redan hård radering via
`writeBatch` i 450-ops chunks. Ingen cascade-ändring krävs för Sprint 4,
men:

- `firestore.indexes.json` har redan single-field collection-group-index
  på `comments.uid` + `likes` documentId — behövs för delete-queryn.
- Firestore PITR ger 7-dagars recovery om användaren ångrar sig (men
  bara via admin). Vi dokumenterar inte detta i UI eftersom "pseudo-
  radering" skulle förvirra GDPR-kraven.

## Export- vs raderingstäckning (BIN-328)

Både GDPR-exporten (Art. 20, `buildUserExport`) och kontoraderingen (Art. 17,
`deleteAccount`) läser samma kärna: `collectUserDataSnapshots`
(`src/lib/firebase/userData.ts`). Varje snapshot-nyckel ska vara wired in i
**båda** flödena. Ett kompileringstidskontrakt
(`src/lib/firebase/dataExport.coverage.test.ts`) tvingar varje ny nyckel att
klassificeras — annars failar bygget.

**Tre nycklar är medvetet UNDANTAGNA ur exporten** (men raderas ändå av
cascaden) — operationell metadata, inte användarens "lämnade" personuppgifter:

- `fcmTokens` — device-push-tokens, system-genererade, meningslösa utanför Firebase.
- `reportMeta` — rapport-throttle-stämpel (timestamp/räknare), inte rapportinnehåll.
- `askBingeMeta` — Ask-Binge LLM-fallback-throttle (timestamp/räknare).

**En nyckel är medvetet UNDANTAGEN ur cascaden** (men ingår i exporten):

- `followers` — inkommande följare. Varje doc ägs av följaren (rules:
  `isOwner(followerUid)`), så kontoinnehavaren kan inte radera dem. Dangling-
  referenser filtreras lazy på läsning och städas av den veckovisa
  `reclaimOrphanFollows`-sweepen.

**Täckningsgräns (ärlig):** kontraktet skyddar nycklar som finns i kärnan. En
helt ny `users/{uid}/<x>`-subcollection som aldrig läggs till i helpern fångas
INTE (den blir aldrig en `keyof`). Att täcka den klassen kräver ett emulator-
backat raderingstest + en subcollection-enumeration mot `firestore.rules` —
spårat som följdticket.

## Retention-policy för icke-raderad data

Ingen auto-retention idag (v1). Saker som kommer behövas vid tillväxt:

- **Gamla Tillsammans-sessioner** — bör delete:as efter 30 dagar via
  cron (kräver Cloud Functions, sprint 6 + 10)
- **Gamla notifikationer** — bör delete:as efter 90 dagar (samma)
- **Härvarande PITR** — Firebase cappar på 7 dagar, ingen ytterligare
  konfiguration behövs

Dessa är dokumenterade i FUTURE_ROADMAP.md sprint 6 (B34).

## Re-visit triggers

Policy ska omvärderas om:
- Rapporter om imitation via frigjorda usernames ökar
- Threading blir djupare (kommentarer på kommentarer) och breakage
  blir användarfientligt
- Cloud Functions finns — då kan vi göra "mjuk radering" med 30-dagars
  ångra-fönster ovanpå hård radering

## Kopplingar

- **Integritetspolicy** (`src/app/integritet/page.tsx`) ska reflektera
  denna policy för användare — uppdateras i sprint 4 dag 5.
- **Terms of Service** (`src/app/villkor/page.tsx`) — ingen direkt
  ändring men nämner att borttaget innehåll inte återställs.
- **Moderation-runbook** (`docs/moderation.md`, pending sprint 5) —
  samma delete-cascade används när admin tar bort en användare för
  policy-brott.
