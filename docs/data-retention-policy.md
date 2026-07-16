# Dataretention + anonymisering-policy

_Status: 2026-04-24. Gäller från sprint 4._

## Policy-beslut

När ett konto raderas (via `Settings → Ta bort konto`) hanterar vi publikt
UGC enligt följande regler.

### Privat data → Hård radering

Allt som bara användaren själv ser tas bort helt:

- `users/{uid}` (privat profil-doc; sedan BIN-505 ägar-låst läsning)
- `publicProfiles/{uid}` (BIN-505 — den publika projektionen; TOP-LEVEL, ej en
  user-subcollection, så den raderas explicit i `collectDeletionRefs` via
  `snaps.publicProfileSnap.ref`, inte via subcollection-guarden)
- `users/{uid}/watchlist/*`
- `users/{uid}/watchlistTags/*` (privata fritext-taggar, BIN-164)
- `users/{uid}/watchlistNotes/*` (privata fritext-anteckningar, BIN-505 — flyttade
  av från den publikt läsbara watchlist-doc:en; free-text kan fånga tredjeparts
  personuppgifter, samma DPO-resonemang som taggar)
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
- `*/reactions/{reactionId}` (avsnitts-reaktioner, BIN-95) där `uid == me` →
  **delete** (collection-group). Ingen TTL-sweep — reaktioner behandlas som
  innehåll (likt reviews) och raderas bara vid kontoradering, inte på ålder.
  Se Console-bypass nedan för konton som raderas utanför app-cascaden.
- `lists/{listId}` där `uid == me` → **delete**
- `sessions/{sessionId}` där `hostUid == me` → **delete**

### Moderationsrapporter → Retention (Art. 17(3))

`reports/{reportId}` (UGC-rapporter, skapas via `submitReport`,
`src/lib/firebase/reports.ts`) är det medvetna UNDANTAGET från
raderingscascaden: `deleteAccount` rör dem aldrig, och `firestore.rules`
sätter `allow delete: if false` så klienten kan aldrig radera dem. Varje
rapport lagrar `reporterUid` (härlett från auth vid inskick), så en raderad
användares uid lever kvar i `reports/`.

**Beslut (BIN-277): behåll, anonymisera inte.** Rättslig grund: GDPR
Art. 17(3) — rätten till radering väger inte över när behandlingen behövs för
(b) att fullgöra en rättslig förpliktelse respektive (e) att fastställa, göra
gällande eller försvara rättsliga anspråk, samt det berättigade intresset av
abuse-hantering. Att anonymisera rapportören skulle bryta moderations-
spårbarheten: vi kunde inte längre upptäcka serie-falskanmälare, knyta en
anmälan till god tro, eller försvara ett moderationsbeslut i efterhand.

**Retention-fönster:** ingen auto-utgång idag (v1) — rapporter behålls så
länge moderationsbehovet finns; omvärderas vid skala (se Re-visit triggers).
Detta är en smal, dokumenterad PII-retention och rapportinnehållet är aldrig
publikt (klienten kan bara `create`, aldrig `read` — admin läser via Console).

**Transparens:** integritetspolicyn bör nämna att en anmälares uid kan behållas
i moderationssyfte efter kontoradering (Art. 13/14). Spåras som copy-följdpunkt
— ingen brådska nu när grunden är dokumenterad här.

### Grupp-medlemskap → Självborttag

När användaren raderas:

- I `groups/{groupId}` där `memberUids` innehåller mig → **ta bort mig
  ur array:en**
- `groups/{groupId}/joinAttempts/{myUid}` (BIN-329) → **delete**. Doc:et
  innehåller plaintext-invite-tokenet jag en gång skickade vid en token-join.
  `deleteAccount` raderar det per grupp jag är medlem i (omedelbar radering);
  den schemalagda `retentionCleanup`-sweepen tar resten — attempts i grupper jag
  aldrig blev medlem i (avbruten join) och konton raderade via Firebase Console
  (som inte kör klient-cascaden alls) — efter 1 timme. Ett lyckat join raderar
  sitt eget attempt på sekunder, så allt äldre är en spent-token-orphan.
  UNDANTAGET ur exporten (gruppens delade hemlighet, inte personuppgift).
- Om jag är owner (`ownerUid == me`) och det finns andra medlemmar →
  transferera ownership till första andra medlemmen (kommande sprint —
  TODO). För nuvarande: om owner raderar sig lämnas gruppen ägarlös och
  kan inte modifieras (okej tillstånd eftersom owner ändå kan delete:a
  gruppen först).

### Hushålls-bidrag (delade prenumerationskostnader) → Samtyckesbaserad, självstyrd radering (BIN-184, 2026-07-05)

`groups/{gid}/household/{uid}` — en OPT-IN "Hushåll"-yta i grupper. Varje
medlem skriver bara sitt eget bidrag (aldrig andras):

- **Innehåll:** `providerIds` (vilka tjänster), `providerCosts` (kr/tjänst,
  ordinarie pris — INGA nivå-/tier-namn, medveten minimering),
  `providerCampaigns` (kampanjpris + slutdatum, så kampanjer auto-återgår till
  ordinarie pris), `activeProviderIds` (vilka av tjänsterna som bär minst en
  osedd titel i backloggen — **usage-härlett, aldrig självrapporterat, och
  bara på tjänste-nivå, aldrig titel-nivå**; DPO-krav om att inte exponera VAD
  någon tittar på, bara VILKEN tjänst som bär vikt), `updatedAt`
  (server-stämplad).
- **Rättslig grund:** samtycke (art. 6.1.a) — explicit opt-in per grupp; en
  samtyckesskärm visas före första skrivningen. Att gå med i en grupp är INTE
  samtycke till att dela.
- **Vem kan läsa:** endast gruppmedlemmar som SJÄLVA delar (share-to-see-
  reciprocitet, `exists()`-check i `firestore.rules`) — se ADR 0010
  (`docs/org/adr/0010-household-read-gap.md`). Appens UI visar bara aggregat
  ("Disney+ betalas av 2 av er"), men en delande medlem kan tekniskt läsa en
  annan medlems post-för-post-lista; det är en medveten, founder-godkänd
  disclosure-lucka (ingen Cloud Function-proxy) — konsent-texten säger det
  rakt ut.
- **Radering:** ett tryck ("Sluta dela") raderar dokumentet omedelbart. Att
  lämna gruppen eller bli borttagen ur den raderar det också. Kontoradering
  kaskadar via BÅDA grenarna i `deleteAccount` (owner-grenen tar hela
  gruppens `household`-collection när gruppen raderas; medlems-grenen
  raderar bara mitt eget doc när jag lämnar) — emulator-testat.
- **Retention:** inget tidsbaserat utgångsdatum — dokumentet lever tills
  återkallelse/lämnande/borttagning/kontoradering.

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

> **Historik-/incident-not (BIN-505, 2026-07-14):** en tidigare rules-brist gjorde
> `users/{uid}` (email/hemkommun/kostnader) och watchlist-`notes` läsbara för
> publik/vänner. Fixad + internt breach-register enligt GDPR Art. 33(5):
> [`docs/incidents/2026-07-14-bin505-profile-pii-exposure.md`](incidents/2026-07-14-bin505-profile-pii-exposure.md).

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

**Console-bypass (känd begränsning):** `deleteAccount`-cascaden körs bara vid
självservice-radering i appen. Raderar en admin ett konto direkt i Firebase
Auth Console körs INGEN klient-cascade (det finns ingen Auth-`onDelete`-trigger),
så cascade-bara-data (avsnitts-reaktioner, fcmTokens m.fl.) blir kvar. För den
**säkerhetskänsliga** delen — plaintext-invite-tokenet i `joinAttempts` (BIN-329)
— är detta nu täppt: den schemalagda `retentionCleanup`-sweepen raderar varje
joinAttempt äldre än 1 timme oavsett hur kontot försvann (admin SDK kringgår
reglerna). Reaktioner/övrig cascade-bara-data efter en Console-radering är
fortfarande en öppen, bredare lucka (låg känslighet — inget hemligt) som ägs av
en framtida server-side reaper för konton vars ägar-uid inte längre finns.

## Retention-policy för icke-raderad data

### TMDB-fält-svep (BIN-402 / BIN-468) — aktiv auto-retention på tredjeparts-cachedata

**Syfte:** TMDB:s API-villkor §1.C förbjuder caching av TMDB-härledd data > 6 mån.
Watchlist-docs denormaliserar TMDB-fält utan TTL. Den schemalagda Cloud Functionen
`tmdbFieldsSweep` (månadsvis, `functions/src/tmdbTosSweep/`) **rensar** (nullar) dessa
fält när de är äldre än **5 mån** (medveten marginal under 6-månaderstaket) eller saknar
färskhetsstämpel.

**Per-grupp-färskhet (BIN-468):** en enda doc-nivå-stämpel räckte inte — titelsidan
skriver bara en delmängd av blocket men förnyar stämpeln, så en användare som bara
öppnar titelsidor kunde hålla stämpeln färsk i evighet medan providers/next-air-data
tyst åldrades förbi 6 mån. Fältet är därför uppdelat i **tre oberoende grupper**, var
och en med sin EGEN stämpel, staleness-check (5 mån) och reparationsväg. Svepen rensar
varje grupp för sig när dess stämpel är stale/saknas, och **raderar den gruppens stämpel
vid rensning** så att gruppens egen reparationsväg repopulerar den — aldrig med
överskrivning av en syskongrupp som fortfarande är färsk:

| Grupp | Fält | Stämpel | Reparationsväg |
|---|---|---|---|
| static | `title`, `posterPath`, `genreIds`, `tmdbStatus`, `runtime` | `tmdbFieldsRefreshedAt` | `addItem` + titelsidans `refreshTmdbFields` |
| providers | `providers` | `providersCheckedAt` | advisor/backfill; titelsidan som *fallback* (bara när `providersCheckedAt` inte är färskare än 60 d, så en färskare advisor-koll aldrig klobbras) |
| nextair | `nextAirDate`, `nextAirCode`, `nextAirProvider`, `digitalReleaseDate` | `nextAirUpdatedAt` | kalender-`nextAirReadRepair` (om-stämplar även vid oförändrat värde när stämpeln > 90 d, så en stabil `digitalReleaseDate` inte fryser → onödig rensa-rep, BIN-468 A3) |

**Terminal null-state:** en användare som t.ex. aldrig öppnar Kalendern reparerar aldrig
sin nextair-grupp — den rensas då till **null** och förblir null. Det är avsiktligt och
compliant: att visa *ingenting* är ToS-säkert, att visa stale TMDB-data är överträdelsen.
Null är alltså det korrekta slutläget, inte en bugg.

**Avgränsning (INTE användardata):** hård fält-allowlist per grupp — rör ALDRIG
user-authored fält (`status`, `rating`, `ratedAt`, `notes`, `tags`, `watchedAt`) eller
`updatedAt` (driver "Fortsätt titta"-sorteringen). Test-låst (`FORBIDDEN_FIELDS` +
per-grupp-nyckeluppsättningar i `logic.test.ts`). Det är dataminimering på
processor-cache, inte radering av användarens egna data — ingen ny rättslig grund krävs
(ADR 0009, DPO-panel 2026-07-11/2026-07-12).

**GDPR-export:** en rensad TMDB-grupp kan visa sig som `null` i en Art. 20-export
(`buildUserExport` exporterar hela råa watchlist-doc:en, cleared eller ej). Det är
förväntat och compliant — TMDB-fält är icke-personlig tredjeparts-metadata (se
export-README), inte dataförlust. En framtida ändring ska INTE "fixa" ett null-fält
som saknad data.

**Stämpelns integritet (Security):** de tre stämplarna är sweep-freshness-gates —
`firestore.rules` binder alla tre `is timestamp && <= request.time` (envägs-ratchet) så
en klient inte kan förfalska en framtida stämpel och få svepen att hoppa över en grupp i
evighet.

**Dry-run som default:** funktionen skriver inget förrän
`sweepState/tmdbFieldsSweep.mutateEnabled === true` (flippas i Console efter granskad
dry-run). Audit-record per körning i `sweepState/tmdbFieldsSweep.lastRun` inkl. en
**per-grupp**-uppdelning (`docsWouldClearByGroup`) — enable-grinden kräver att static- +
providers-grupperna ligger < 5 % rensning över ≥ 2 månaders dry-runs innan flip (nextair
undantas då den bara propagerar via Kalender-besök), plus en missad-körning-larm och en
konvergens-check mot `MAX_CLEARS_PER_RUN` (DBA-villkor).

### Spoilerfria avsnittssammanfattningar (BIN-185) — durabel delad cache, ingen TTL

`recaps/{tmdbId}_{s}_{e}` — en publik, delad cache av AI-genererade "var jag slutade"-sammanfattningar,
genererade en gång globalt per (serie, säsong, avsnitt) och serverade till alla. Sedan story-so-far-
omdesignen (2026-07-12, schemaVersion 2) har varje dokument även ett valfritt `textFull`-fält (fylligare
"den här säsongen hittills"-sammanfattning, samma boundary) för "Visa säsongens sammanfattning"-panelen.
Utöver boundary-dokumenten finns `recaps/{tmdbId}_season_{n}` — en helsäsongs-sammanfattning per AVSLUTAD
säsong, skriven en gång, för "Visa tidigare säsonger". **Ingen personuppgift** finns i någon av dessa
(inga uid, bara serie/säsongs/avsnitts-ID + text + källor); de är därför korrekt utanför
`collectUserDataSnapshots` (varken export eller radering rör dem). Skrivna ENDAST av den offline
`/recap`-batchen (Admin SDK); klienter kan bara läsa.

**Retention:** durabel för alltid, ingen TTL — samma klass som `titleRatings`. Till skillnad från BIN-402:
sammanfattningarna är **härledda från Wikipedia (CC BY-SA)**, inte TMDB-data, så TMDB:s §1.C-6-månaderstak
gäller INTE. En dålig/förgiftad post rättas via Admin-SDK (purge/regenerera — se runbook), inte via en
schemalagd svep. Se ADR 0011 för CC BY-SA-hållningen.

### "Släpps idag"-dedup-markörer (BIN-464) — 30-dagars svep (GDPR Art. 17 + tillväxtgräns)

`releaseNotifyState/{tmdbId}/notified/{uid}` — en per-användare-markör som
`availableNotify`-jobbet skriver när det pushat "släpps idag" för en bevakad film,
så samma användare inte får en andra push för samma digitala släppdatum. Doc-id är
`uid`, innehållet är `{ notifiedDate, updatedAt }`.

- **Varför den inte kan raderas via kontocascaden:** collectionen har INGEN
  `firestore.rules`-match → klienter är default-nekade, bara Admin SDK (Cloud
  Functions) rör den. Klientens `deleteAccount`-cascade körs med användarens egen
  auth och kan därför inte nå den (en `batch.delete` skulle nekas och — eftersom
  batchen är atomär — spränga hela raderingen). Samma form som `joinAttempts`.
- **Beslut:** den schemalagda `retentionCleanup`-sweepen (Admin SDK, kringgår
  reglerna) raderar varje markör vars `updatedAt` är äldre än **30 dagar**
  (`RELEASE_MARKER_MAX_AGE_MS`). Det är markörens ENDA Art. 17-raderingsväg och
  täcker självservice-, övergivna OCH Console-raderade konton lika.
- **Varför 30 dagar är säkert:** markörens enda funktion är dedup över catch-up-
  fönstret (`RELEASE_CATCHUP_GRACE_DAYS` = 3 dagar efter släppdatumet). När
  fönstret stängt kan `releaseDateToFire` aldrig returnera det passerade datumet
  igen, så markören är död vikt. 30 dagar är rejäl marginal över 3-dagarsfönstret
  (en fortfarande användbar markör reaps aldrig) och samtidigt prompt radering av
  uid-identifierande beteendedata (vilken film en användare bevakade / notifierades
  om, och när). Ett förnyat släppdatum stämplar om `updatedAt` → markören
  nollställer sin egen klocka. Ingen `firestore.indexes.json`-post krävs (svepet
  pagesar på `__name__` via det automatiska collection-group-indexet, som de andra).

### Framtida (ej byggt)

- **Gamla Tillsammans-sessioner** — bör delete:as efter 30 dagar via
  cron (kräver Cloud Functions, sprint 6 + 10)
- **Gamla notifikationer** — bör delete:as efter 90 dagar (samma)
- **Härvarande PITR** — Firebase cappar på 7 dagar, ingen ytterligare
  konfiguration behövs

Dessa är dokumenterade i FUTURE_ROADMAP.md sprint 6 (B34).

## Re-visit triggers

Policy ska omvärderas om:
- Rapporter om imitation via frigjorda usernames ökar
- `reports/`-volymen växer så att kvarhållen `reporterUid` motiverar ett
  auto-utgångsfönster eller en anonymiserings-/tombstone-väg (Admin-SDK) — då
  revisas BIN-277-beslutet
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
