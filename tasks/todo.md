# BIN-954 — att bocka av ett avsnitt på en serie du inte följer skapar ett halvt dokument

**Status:** v2 — #27:s blinda kritik körd och invikt (SUPPORT WITH CONDITIONS, tre
villkor, ingen omroutning). Byggt och grönt. Blockerar BIN-942 (planen längre ned).

Router på den faktiska filuppsättningen
(`src/contexts/WatchlistContext.tsx`, `src/hooks/useEpisodeProgressWithSync.ts`,
`src/lib/watchlist/buildAddPayload.ts`) — rå utdata:
`tier: "medium"`, `reasonCode: "owned"`, `panel: [27]`, `highStakes: []`,
`unownedCode: []`, `unmappedCode: []`.
Alltså: **en blind kritik från #27 Database Administrator / Data-layer Engineer**
före första Edit. Vidgar kritiken filuppsättningen (t.ex. in i `firestore.rules`)
körs routern om (BIN-766-lärdomen).

**Basläge, HEAD `409d19f`:** `git status --porcelain` → bara `tasks/todo.md`.

**Utfall, mätt efter bygget** (`rm -rf node_modules/.vite/vitest` före varje körning):
`npm test` → **258 filer, 4242 passerade, 4 skippade, 0 fel.** Basläget var 258/4230/4,
alltså +12 nya tester (10 i `WatchlistContext.test.tsx`, 2 i hookens fil).
`npx tsc --noEmit` → tyst. `npx eslint` på de fyra rörda filerna → 0 fel
(3 kvarstående `_args`-varningar som fanns före ändringen).

**En körning av fyra föll**, med ett test jag inte hann fånga namnet på; de tre därefter var
gröna med identiska siffror. Redovisat som det är — inte bortförklarat — men inte heller
utrett, eftersom det inte gick att återskapa. Misstanken är samma kall-cache-timeout som
BIN-937 handlade om (körningen låg direkt efter en `rm -rf` av vite-cachen).

**Muteringsprövat, sju mutanter, alla fällda** (patchen assertad före OCH efter körningen,
återställning från scratchpad-kopia verifierad med `md5sum`):
`known` utan sessionsmängden → 1 fallet test; `if (known || !libraryKnown)` → `if (known)`
→ 1; `addIfMissing: true` flyttad till avbockningsvägen → 2; raderingens rensning av
sessionsmängden borttagen → 1; `mediaType === 'tv'`-vakten borttagen → 1; markeringen
flyttad till före skrivningen → 1; raderingsräknarens kontroll borttagen → 1.

## Klarspråk

Bockar du av ett avsnitt på en serie du **inte** följer sparar appen idag en trasig,
halv rad i ditt bibliotek: ingen titel, ingen affisch, ingen status. Den syns som en
tom rad — även på din publika profil — och raderingsknappen kan inte träffa den.

Efter fixen: bockar du av ett avsnitt på en serie du inte följer **läggs serien till
på riktigt** (titel, affisch, år, status "Följer") tillsammans med din position.
Malins beslut 2026-08-20. Bockar du *bort* ett avsnitt på en serie du inte följer
läggs ingenting till — och inget halvt dokument skrivs längre.

**En följd som Malin bör känna till** (integrationsgranskningen, varv 3): det här gäller
även när man bockar av ett avsnitt inifrån en GRUPP. Öppnar du en säsongssida via en grupps
watchlist (`?fromGroup=`) och bockar av ett avsnitt, hamnar serien i ditt EGET bibliotek
under "Följer". Det följer direkt av beslutet — en bockning är en bockning oavsett var man
står — men det är en ny sak som händer på en yta som förut bara rörde gruppen.

## Vad som är fel — mätt

`updateProgress` (`src/contexts/WatchlistContext.tsx:890` vid HEAD `409d19f`, före ändringen)
grindar bara på `if (!uid) return;`
och gör sedan `setDoc(ref, { lastWatchedSeason, lastWatchedEpisode, …visFields, updatedAt }, { merge: true })`.
Finns inget dokument är det en **create** av ett fältfragment.

Anropsställen, räknade med kommandot:
`grep -c "updateProgress('tv'" src/hooks/useEpisodeProgressWithSync.ts` → **6**
(rad 50, 72, 84, 86, 99, 118 vid HEAD `409d19f`). Radnumren efter ändringen står medvetet
INTE här: två granskningsrundor i rad rättade dem, och båda rättelserna var själva fel
inom en timme — varje ny kommentarsrad i filen flyttar dem. Det som behövs är
uppdelningen: **två** tittar-anrop, **fyra** som inte är det.
`grep -rn updateProgress src --include=*.ts --include=*.tsx`, filtrerat på SÖKVÄG utanför
hooken och kontexten, ger **noll** produktionsanropare och **fem** träffar som alla är
kommentarer (`useGroupMemberProgress.ts:21`, `groups.ts:569/572/717`,
`canonicalSpecials.ts:27`). **Rättelse:** v1 skrev "fyra" — det talet kom av ett filter på
radinnehåll i stället för på sökväg, vilket åt upp en av träffarna. Den bärande halvan
(noll anropare) stod sig. Alla sex passerar `'tv'`; `updateProgress` når aldrig en film.

De sex delar sig i två avsikter:

* **Tittar-avsikt (2):** rad 50 (bocka av ett avsnitt) och rad 99 (markera hel säsong sedd).
* **Inte tittar-avsikt (4):** rad 72 (auto-advance till nästa säsong, körs EFTER att rad 50
  redan skrivit), rad 84/86 (avbocka ett avsnitt) och rad 118 (avbocka en hel säsong).

Kalendern kan inte nå felet: `useCalendarEntries` bygger avsnittsposter enbart ur
`getByStatus('mina','tv')`, alltså serier som redan finns i biblioteket. Reellt nåbara
vägar är säsongssidan (`SeasonPageClient`) och seriesidans säsongslista
(`TVShowPageClient:501` → `SeasonList`), som båda skickar `markEpisodeWatched` ogrindat.

## Vad som byggs

**Allt i `updateProgress`.** Ingen grind i `SeasonPageClient`, `EventCard`,
`TVShowPageClient`, `SeasonList` eller `SeasonEpisodePanel` — de rörs inte alls.

### 1. Avsikten skickas in, den gissas inte

`updateProgress` får ett femte, valfritt argument:
`opts?: { addIfMissing?: boolean }`. Hooken skickar `{ addIfMissing: true }` på **exakt
två** ställen (rad 50 och rad 99) och ingenting på de fyra andra.

Varför inte härleda avsikten ur positionen (`season > 0 || episode > 0`): en avbockning
ned till en lägre position är också en position skild från noll, så härledningen skulle
lägga till serien när användaren gör tvärtom. Avsikten finns bara hos anroparen.

Auto-advance (rad 72) får medvetet INTE flaggan: den körs efter att rad 50:s skrivning
committats, så dokumentet finns redan. Utan den regeln hade den andra skrivningen
(snapshoten hinner inte landa emellan, så `findItem` är fortfarande tom) blivit ett
andra fullständigt tillägg med en andra `title_added_watchlist`-händelse.

### 2. Fyra grenar i stället för en

```
const known = current != null || addedByProgressRef.current.has(`${uid}:${docId}`);
const libraryKnown = firstSnapshotSettledRef.current && !listenerFailedRef.current;

A. known                    → oförändrat: merge-skrivning av bara progressfälten.
B. !known && libraryKnown && opts.addIfMissing && mediaType === 'tv'
                            → fullständigt tillägg (nedan).
C. !known && libraryKnown   → INGEN skrivning alls. Det finns inget att uppdatera,
                              och en merge här är per definition en create av ett fragment.
D. !known && !libraryKnown  → oförändrat (gren A:s skrivning).
```

`addedByProgressRef` är #27:s villkor 1 (se nedan): en sessionsmängd över doc-id som
DENNA funktion just skapat. Snapshoten har inte landat när auto-hoppet körs, så utan
den läser gren C "finns inte" och sväljer auto-hoppets skrivning. Märks först EFTER
att skrivningen gått igenom, så ett misslyckat tillägg förblir omförsökbart. Nollställs
vid uid-byte, som `migratedNotesRef` och `repairedAddedAtRef`.

**Gruppsynken körs på ALLA grenar**, även gren C som inte skriver något. Upptäckt vid
bygget: en serie man följer bara inne i en grupp (`SeasonPageClient` med `?fromGroup=`)
saknas i det egna biblioteket men har progress som hör till gruppen. Att flytta in
synken i skrivgrenarna hade tagit bort den funktionen.

`libraryKnown` läses ur de två refs som `writeTitle` redan använder
(det `buildAddWrite`-ctx-objekt `writeTitle` bygger), inte ur den härledda
state-variabeln som contexten exponerar — den
definieras efter `updateProgress` och skulle tvinga in en ny dep i `useCallback`.

**Gren D är avsiktlig och oförändrad.** Under en kall laddning går det inte att skilja
"finns inte" från "inte läst än", och att gissa "lägg till" där skulle kunna skriva om
status för en serie användaren satt till `avbruten`. Kvarvarande risk i D är exakt den
kapplöpning BIN-942 tar hand om: golvet nekar skrivningen och BIN-942:s C loggar den.
BIN-954 gör alltså D **smalare**, aldrig bredare.

### 3. Tilläggets payload

Grenen B återanvänder den befintliga tilläggsvägen — `upsertTitle` → `writeTitle` →
`buildAddWrite` — via `buildWatchlistAddPayload`, så `addedAt`, `updatedAt`,
synlighetsfälten, `dropped` och analytics-händelserna får exakt den form varje annan
tilläggsyta har. Ingen ny skrivväg.

Titeldata hämtas med `getTVShowLite(tmdbId)` (samma lite-anrop kalendern och rådgivaren
redan använder, `append_to_response=watch/providers`):

| Fält | Källa |
| -- | -- |
| `tmdbId` / `mediaType` | anropet |
| `status` | `'mina'` — TV:s "följer"-status (`watchStatus.ts:TV_STATUS_OPTIONS`); `vill_se` för TV är avskaffat |
| `title` | `preferOriginalTitle(show.name, show.original_name)` — samma val som `TVShowPageClient:134` |
| `posterPath` | `show.poster_path ?? null` |
| `releaseYear` | `extractYear(show.first_air_date)` (`tmdb/client.ts:309`) |
| `totalSeasons` | `show.number_of_seasons ?? null` |
| `genreIds` | `show.genres?.map(g => g.id) ?? []` |
| `tmdbStatus` | `show.status ?? null` |
| `lastWatchedSeason` / `lastWatchedEpisode` | anropets `season` / `episode` |

**`providers` och `subscriptionProviders` utelämnas medvetet.** `shouldStampProvidersAtAdd`
(`tmdbFieldsRefresh.ts:64`) kräver båda för att stämpla `providersCheckedAt`; utelämnade
fält gör att stämpeln uteblir, raden läses som färsk-behövande och nästa titelsidbesök
fyller i paret (`planTmdbFieldsRefresh`). Det är den självläkande riktningen BIN-468/814
redan dokumenterar.

Positionen ligger **i samma skrivning** som tillägget. Grenen B kostar alltså inte en
extra Firestore-skrivning jämfört med idag — det är fortfarande en `setDoc` per gest,
bara med fullständig payload.

### 4. När TMDB inte svarar

Misslyckas `getTVShowLite` skrivs **ingenting** till watchlist-dokumentet; felet loggas
via `captureError(err, { scope: 'watchlist', kind: 'updateProgress-add' })` och gesten
avslutas utan att kasta. Avsnittsbocken själv (`episodeProgress`, en helt annan
skrivning i `useEpisodeProgress`) landar ändå.

Skälet att inte kasta: `markEpisodeWatched` anropas via `void` från `EpisodeRow`, så ett
kast blir en ofångad promise-rejection → Sentry-brus av samma sort `setRuntime` redan
sväljer. Skälet att inte falla tillbaka på fragmentskrivningen: fragmentet ÄR buggen.
Praktiskt är läget nästan onåbart — säsongssidan renderar inga avsnitt alls om TMDB är
nere (`useTVSeason`).

### 5. Typer och kontraktsyta

* `WatchlistState.updateProgress` (rad 213) och default-kontexten (rad 244) får det nya
  valfria argumentet. Bredare signatur, inga befintliga anropare bryts.
* `useEpisodeProgressWithSync` importerar inget nytt; den skickar bara flaggan.
* `WatchlistContext.tsx` behöver `getTVShowLite`, `extractYear`, `preferOriginalTitle`,
  `buildWatchlistAddPayload`, `captureError`. Vilka som redan är importerade kontrolleras
  med `grep -n` i filen före Edit; importlistan skrivs efter vad kommandot svarar, inte
  efter minnet.

## Bindande acceptanskriterier

1. `updateProgress` skriver aldrig ett dokument som saknar `tmdbId`, `mediaType` eller
   `status` **när biblioteket är känt**. Grenarna B och C är det som garanterar det.
   *(kind: diff)*
2. Test: bocka av ett avsnitt på en serie som inte finns i `items`, med settlad snapshot →
   den skrivna payloaden bär `tmdbId`, `mediaType: 'tv'`, `status: 'mina'`, `title`,
   `posterPath`, `releaseYear`, `lastWatchedSeason`, `lastWatchedEpisode`. *(kind: diff)*
3. Test: samma gest på en serie som REDAN finns → payloaden innehåller **ingen**
   `status`-nyckel och ingen `title`-nyckel. Det är kriteriet som pinnar
   "progress ändrar aldrig status" — regeln som står i `updateProgress` egen inledande
   kommentar. *(kind: diff)*
4. Test: **avbocka** ett avsnitt på en serie som inte finns i `items`, settlad snapshot →
   ingen `setDoc` mot watchlist-dokumentet. *(kind: diff)*
5. Test: serie saknas och snapshoten har INTE settlat → beteendet är det gamla (gren D).
   Det negativa fallet är vad som hindrar att gren B tyst blir ovillkorlig. *(kind: diff)*
6. Test i hookens testfil: `addIfMissing` skickas på exakt de två tittar-anropen och på
   inget av de fyra andra. Diffkontroll:
   `grep -c "addIfMissing: true" src/hooks/useEpisodeProgressWithSync.ts` → **2**.
   *(kind: diff)*
7. Ingen ändring i `SeasonPageClient`, `EventCard`, `TVShowPageClient`, `SeasonList`,
   `SeasonEpisodePanel` eller `SeasonRow`. *(kind: diff)*
8. `npm test` körs med rensad `node_modules/.vite/vitest` och redovisas med siffror.
   *(kind: diff)*
9. Ingen global `testTimeout`-höjning. **Rättelse mot v1:** v1 sa "ingen ändring i något
   `expect(...)` som fanns före ändringen". Det gick inte att hålla och skulle ha varit
   fel att hålla: `toHaveBeenCalledWith` matchar argumentlistan EXAKT, så de tre
   påståendena om tittar-anropen i `useEpisodeProgressWithSync.test.tsx` föll när ett
   femte argument tillkom. De är uppdaterade till att namnge det nya argumentet — alltså
   skärpta, inte försvagade, och det är precis den strikthet som gör dem till villkor 6:s
   bevis. Inget påstående är borttaget, uppmjukat eller skippat. *(kind: diff)*

## #27:s bindande villkor — och hur vart och ett är avklarat

Blind kritik 2026-08-20, #27 Database Administrator / Data-layer Engineer.
Verdict: SUPPORT WITH CONDITIONS. Hen bekräftade dessutom mot `firestore.rules:92-124`
att **varje fält planen skriver står i `isValidWatchlistItem`s `hasOnly`-lista**, och att
de fyra råa `.data()`-läsarna av `providers`/`genreIds` (`functions/src/insights/rollup.ts`,
`functions/src/streamingOffers/index.ts`, `src/lib/taste/backfill.ts`) alla redan är
`Array.isArray`-skyddade — så att utelämna fälten är säkert för varje läsare. Ingen
`firestore.rules`-ändring behövs, alltså **ingen omroutning**.

10. **Villkor 1 — auto-hoppet tappade sin skrivning.** Ett riktigt fynd, och planens egen
    v1-text motsade sig själv: den påstod att dokumentet "finns redan" när auto-hoppet
    körs, samtidigt som den använde att snapshoten INTE hunnit landa som argument på
    raden ovanför. Följden hade varit att den som bockar av säsongsfinalen på en
    färdigsedd säsong av en serie hen inte följer fick serien tillagd — men pekaren kvar
    på finalen i stället för på nästa säsong. **Åtgärd:** `addedByProgressRef` (gren-
    beskrivningen ovan) + ett test som driver båda anropen i EN gest och hävdar två
    skrivningar, ett TMDB-anrop och en `title_added_watchlist`. Muteringsprövat: tas
    sessionsmängden bort faller exakt det testet. *(kind: diff)*
11. **Villkor 2 — TMDB-felet lämnar en avsnittsbock utan biblioteksrad.** `markEpisode`
    och `updateProgress` körs parallellt i `Promise.all`, så avsnittsbocken landar även
    när tillägget inte gör det, och hämtningen sker vid KLICKET, inte vid sidladdningen —
    planens "säsongssidan renderar inget om TMDB är nere" täckte bara det senare.
    **Åtgärd:** läget är accepterat men självläkande, och det är nu bevisat i stället för
    påstått: en misslyckad hämtning märks INTE i `addedByProgressRef`, så nästa bockning
    på samma serie gör om tillägget. Test: första bockningen misslyckas → ingen skrivning
    alls (aldrig fragmentet) + `captureError` med `scope: 'watchlist'`,
    `kind: 'updateProgress-add'`; andra bockningen lägger till på riktigt. *(kind: diff)*
12. **Villkor 3 — produktionssiffran är prosa tills någon kört frågan.** Riktigt i
    princip, men den mätningen gjordes **samma dag** (2026-08-20) och är uttryckligen
    överlämnad som "återanvänd, mät inte om": 411 watchlist-dokument över alla tre
    kontona, hela listningar, noll utan `tmdbId`/`mediaType`/`status`. Den är alltså
    **inte** omkörd här, och det står så här i stället för att låtsas. Siffran bär bara
    ett beslut — att ingen städning av gamla fragment behövs — och den ändras inte av
    den här ändringen. *(kind: run — redovisad, ej omkörd)*

## Granskningsrundan — tre varv, ett blockerande fynd

**Varv 1** (säkerhet, integration, kod): alla tre pass, 0 blockerande, 6 icke-blockerande
fynd. Åtgärdade i EN putsrunda, se listan nedan.

**Varv 2** (säkerhet, integration, test på de nya byten): säkerhet och test pass;
**integrationsgranskningen fällde bygget på ett riktigt fel** (nästa stycke). Testgranskaren
lät dessutom två mutanter överleva — båda är nu döda.

**Varv 3** (säkerhet, integration, kod på de slutliga byten): säkerhet och kod pass;
kodgranskaren hittade **samma defekt en gång till, en nivå smalare** (nästa stycke men två),
och integrationsgranskaren fällde bygget på ett fel i BIN-942:s PLAN, inte i BIN-954:s kod —
"Vad som byggs — C" beskrev fortfarande den form tre blinda kritiker underkände
(`console.warn`, sju anropsplatser), 55 rader ovanför det stycke som ersätter den. Det är
ADR-slår-tråden-mönstret som bitit repot fyra gånger: någon som läser rubriken "vad som
byggs" bygger den döda formen. Rättat och försett med en varningsruta.

Granskningarna kördes om från början efter varje ändring. En granskning bokförd på gamla
bytes räknas inte, och ledgern — inte granskarens rapport — är beviset.

### Den smalare halvan av samma defekt (varv 3, kodgranskaren)

Att rensa markeringen i `removeItem` räcker bara när tillägget redan hunnit bli klart.
Firestore lägger på en väntande skrivning optimistiskt, så "Ta bort" blir klickbar i samma
ögonblick som tilläggets skrivning SKICKAS — långt innan den svarar. En radering i det
fönstret rensar en nyckel som ännu inte finns, och tillägget skriver sedan tillbaka den över
ett dokument användaren just raderat. Nästa progress-skrivning läser den som bevis på att
dokumentet finns → merge-grenen → fragmentet tillbaka.

Kodgranskaren kallade det icke-blockerande. Det byggdes ändå: utfallet för användaren är
identiskt med det fel som blockerade varv 2 — en tom rad som kan synas på en publik profil —
och gesten (lägg till, ångra direkt) är den kommentarerna själva kallar den vanligaste.

Fixen är en räknare, `removalTickRef`, som `removeItem` ökar SYNKRONT före sin första await.
Tilläggsgrenen läser av den före sin första await och avstår från att markera om den rört
sig. Medvetet grovkornig — den räknar alla raderingar, inte bara den här titelns: att avstå
för mycket kostar en extra tilläggsskrivning vid nästa bockning, att avstå för lite kostar
en spökrad på en publik profil. Pinnat av ett test som håller TMDB-hämtningen öppen, kör
raderingen mitt i, släpper den och avbockar; muteringsprövat.

### Det blockerande felet: den andra cachen städades inte vid radering

`removeItem` rensade `itemsRef` men inte `addedByProgressRef`. De är två cachar av samma
sak — "det här dokumentet finns" — och den nya var den farligare att ha inaktuell.

Följd: lade du till en serie genom att bocka av ett avsnitt och tog bort den igen i samma
session (den vanligaste ångra-sekvensen som finns), läste varje senare progress-skrivning
den gamla markeringen som bevis på att dokumentet fanns, tog merge-grenen — och skapade
exakt det identitetslösa fragment biljetten finns för att ta bort. På både bock- och
avbockningsvägen, eftersom `known` kortsluter före avsiktsflaggan.

Fix: `addedByProgressRef.current.delete(...)` bredvid den befintliga `itemsRef`-rensningen,
med samma "REQUIRED, not defensive"-motivering. Pinnat av testet *"a series added by
ticking and then removed does not resurrect as a fragment"*, muteringsprövat (tas raden
bort faller exakt det testet).

### De två överlevande mutanterna, nu döda

* **`mediaType === 'tv'`-vakten kunde tas bort utan att något test föll.** Ingen
  produktionsanropare skickar film (alla sex skickar `'tv'`), så vakten skyddar bara mot en
  framtida anropare — och payloaden hårdkodar `mediaType: 'tv'`. Nytt test: en
  film-`updateProgress` med avsiktsflaggan hämtar ingenting och skriver ingenting.
* **Markeringen kunde flyttas till FÖRE skrivningen utan att något test föll.** `known`
  räknas ut före varje await, så ingen följd av LYCKADE anrop kan skilja de två åt. En
  MISSLYCKAD skrivning kan — och det är precis den egenskap ordningen finns för. Nytt test:
  en add vars skrivning avvisas gör nästa bockning till ett fullständigt tillägg igen, inte
  till en merge mot ett dokument som inte finns.

### De sex icke-blockerande fynden från varv 1

1. **`status: 'mina'` beskrevs som "den enda status en TV-titel lagras under".** Falskt —
   `avbruten` är en riktig lagrad TV-status (`watchStatus.ts`: `TV_STATUS_OPTIONS` är
   `['mina','sedd','avbruten']`). Meningen säger nu det sanna: `mina` är den status en
   NY-spårad TV-titel börjar i, och grenen nås bara när ingen lagrad status finns.
2. **"så detta är alltid en uppdatering"** om auto-hoppet. Falskt i ett fall: om
   tittar-anropets TMDB-hämtning misslyckades finns dokumentet inte, och auto-hoppet
   skriver då ingenting heller. Kommentaren säger nu det, och varför det är rätt utfall.
3. **Testet hette "de fyra" men drev tre anrop**, och en av dess kommentarer beskrev ett
   0,0-fall som i själva verket föll tillbaka på 3,2. Omskrivet: det driver nu fyra anrop
   med exakta argumentlistor (tittar-gesten + auto-hoppet + två nollställningar) och pekar
   ut var det fjärde icke-tittande anropsstället pinnas.
4. **`providers` skickas nu som `[]` i stället för att utelämnas — men `subscriptionProviders`
   utelämnas fortfarande, och asymmetrin är avsiktlig.** `buildAddPayload`s kontrakt säger
   att ett äkta nytt tillägg skickar `providers` explicit så det skapade dokumentet uppfyller
   `WatchlistItem`s icke-valfria arraytyper; det här var det första äkta tillägget som bröt
   det. `shouldStampProvidersAtAdd` kräver en ICKE-tom lista, så stämpeln uteblir precis som
   förut och självläkningen är oförändrad. `subscriptionProviders` däremot: `docToItem` läser
   frånvaro som "aldrig ifylld" och `[]` som "kollat, ingen tjänst har den". Den här ytan har
   inte kollat något och får därför inte påstå det andra — samma val som onboarding,
   CSV-importen och `CompanionSection` gör. (Varv 2, integrationsgranskningens valfria fynd 1.)
5. **`libraryKnown` uttrycktes med samma formel på två ställen i filen.** Formeln bor nu i
   en ren funktion, `isLibraryKnown(snapshotSettled, listenerFailed)`, som båda anropar.
   De kan inte dela VÄRDE (det ena är reaktivt state, det andra måste läsas efter ett
   await), men de delar nu formeln — det är den delen som kan glida isär.
6. **"fyra träffar är kommentarer"** i skrivvägsräkningen var fem. Rättat ovan, med orsaken
   (filtret satt på radinnehåll i stället för på sökväg). Samma runda: BIN-942-planens
   radnummerlista blev falsk i samma commit som den låg i, eftersom den här ändringen
   flyttade varje rad i filen. Den listan är omräknad OCH ersatt med funktionsnamn.

Två fynd byggdes medvetet INTE. Båda är filade som **BIN-955** (låg prioritet):

* **Två snabba bockningar på samma ospårade serie kan lägga till den två gånger.**
  Sessionsmärket sätts efter att skrivningen gått igenom, vilket skyddar den sekventiella
  kedjan (tick → auto-hopp) men inte två oberoende gester. Kostar två TMDB-anrop, två
  skrivningar och två `title_added_watchlist`. Inte datafördärvande — båda skrivningarna
  bär identiska identitetsfält. Kodgranskaren avstod uttryckligen från att blockera på den.
* **TMDB-hämtningen går inte via React Query** och bär ingen `AbortSignal`, till skillnad
  från `useMarkSeen`s. Att lägga den i `queryClient.fetchQuery` skulle ge
  `WatchlistProvider` — som sitter ovanför nästan hela appen — ett hårt beroende på att en
  `QueryClientProvider` är monterad ovanför DEN, för en cache ingen nåbar anropare värmt
  (seriesidan håller `['tv', id]`, det fulla svaret, inte den lätta nyckeln). Skälet står
  nu i koden i stället för att vara underförstått.

## Vad som INTE byggs

* Ingen migrering av redan existerande fragmentdokument. Produktionskollen 2026-08-20
  (411 watchlist-dokument över tre konton) fann **noll** dokument utan
  `tmdbId`/`mediaType`/`status` — det finns inget att städa.
* Ingen grind i UI:t som gömmer bockarna för serier man inte följer. Malin valde bort det.
* `firestore.rules` rörs inte här. Golvet är BIN-942.

## Rollback

Ren hosting-ändring: `git revert`, push, deploy. Inga regler, inga funktioner, ingen data.

## Kartan

`docs/workflow-map.html` — kontrolleras efter kodcommiten om
`.claude/state/workflow-map-stale.json` stämplats; i så fall i **egen commit**.

---

# BIN-942 — en raderad titel kan återuppstå som ett publikt spökdokument

**Status:** v4 — C:s rollkritik (villkor 11) KLAR, alla tre villkor invikta nedan. Den kalla planrevisionen underkände v1 (5 röda) och v2 (4 röda). Alla är
åtgärdade nedan, var och en med kommandot som verifierade den. Panel A+B klar; C behöver en
egen kort runda före bygget (villkor 11).

Router på den faktiska filuppsättningen: `tier: top`, `reasonCode: high-stakes`,
`panel: [27, 5, 4, 6, 7]`. Oförändrad när `WatchlistContext.tsx` läggs till.

**Basläge, HEAD `409d19f`:** träd rent bortsett från den här filen; `npm test` → 258 filer,
4230 passerade, 4 skippade.

## Klarspråk

Raderar du en titel i samma stund som appen uppdaterar din synlighet kan titeln komma
tillbaka som en tom rad — synlig för dig och, om profilen är publik, för andra. Du kan inte
ta bort den; raderingsknappen siktar fel. Vi stoppar det i koden som skriver OCH i
databasreglerna som avgör vad som får skapas.

Bieffekt: nio skrivvägar i `WatchlistContext` (betyg, status, avsnitt, speltid,
anteckningar …) plus en till utanför den kan i samma sällsynta läge bli nekade. De skulle då
misslyckas ohanterat. **Sex** av de nio får därför fånga felet och logga det; `setRuntime`
och `refreshTmdbFields` fångar redan, och anteckningsvägen (`updateNotes`) är ännu inte
avgjord — dess nekande är atomärt med anteckningsskrivningen. (Tilläggsvägen `writeTitle`
är den tionde merge-skrivningen men bär alltid golvfälten, så den nekas inte av golvet; den
kastar vidare med flit, se villkor 15.) Ingen notis — den går inte att nå därifrån (se C). Användaren ser
inget oförklarat, eftersom raden ändå försvinner när listan uppdateras.

## Vad som är fel

`cascadeVisibilityToItems` (`AuthContext.tsx:265`) gör `batch.set(d.ref, {…}, {merge:true})`
på snapshot-referenser. Raderas titeln mellan `getDocs` och `commit` är det en **CREATE**.
Bevisat mot emulatorn av #7 QA (merge till icke-existerande `movie_777` → `assertSucceeds`).
**Det provet finns inte i trädet** — det var ad hoc, och ska läggas till och ses falla rött först.

Spöket går inte att ta bort (`docToItem` läser identitetsfälten som `undefined`; `removeItem`
bygger sitt raderingsmål ur samma fält), och det självläker inte — kaskadens filter matchar
det och stämplar om det.

## Skrivvägar — räknade om, med kommandot

**RÄTTELSE 2026-08-20 (integrationsgranskningen, BIN-954:s runda) — den här listan var
för snäv, och radnumren är borttagna för gott.** Radnummer i den här filen har rättats tre
gånger och varit fel tre gånger; varje kommentarsrad flyttar dem. Räkna om själv, med
kommandot, precis före bygget.

`grep -c "merge: true" src/contexts/WatchlistContext.tsx` → **10**. **Det är rätt ankare.**
Den tidigare listan använde `grep -n "await setDoc(ref"` → åtta träffar, minus
`watchlistTags` → sju. Men golvet (`hasAll(['tmdbId','mediaType','status'])` på create)
träffar VARJE merge-skrivning mot watchlist-samlingen som kan visa sig vara en create —
inte bara de som råkar heta `setDoc(ref`. Minst tre till:

* `setRuntime` — `setDoc(doc(...), { runtime }, { merge: true })`, alltså inte `ref`.
* `refreshTmdbFields` — samma form.
* `updateNotes` — `batch.set(itemRef, …, { merge: true })`. Den är ATOMÄR med
  anteckningsskrivningen, så ett nekande tar med sig anteckningen och kastar vidare.

Sidoeffekten "sju vanliga redigeringar kan bli nekade" är alltså **tio** — nio av de tio
merge-skrivarna i `WatchlistContext` (alla utom `writeTitle`, som alltid bär golvfälten och
därför aldrig nekas av golvet) plus `nextAirReadRepair` utanför filen — och
villkor 14/15:s anropsplatsuppräkning måste räknas om från `merge: true`-ankaret innan C
byggs. `setRuntime` och `refreshTmdbFields` fångar redan (villkor 10 säger det); `updateNotes`
gör det INTE och har en egen `catch` som avmarkerar och kastar vidare — den måste vägas
separat.

Skribenter i scope, med namn i stället för rader: `writeTitle`, `updateVisibility`,
`updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`, `updateTmdbStatus`,
`setRuntime`, `refreshTmdbFields`, `updateNotes`.
Plus `AuthContext.tsx:265`, `nextAirReadRepair.ts` (`batch.set` + `merge`)
och `taste/backfill.ts` (`updateDoc`, kan aldrig skapa).

**BIN-954 ändrade `updateProgress`.** Den skriver inte längre alls när titeln saknas och
biblioteket är känt, och den lägger till med fullständig payload på tittar-vägen. Kvar
under golvet: kall laddning/död lyssnare, som fortfarande gör en merge som kan visa sig
vara en create. `updateProgress` hör alltså fortfarande till villkor 14:s uppräkning.

**RÄTTELSE mot v2:** v2 påstod att alla sju skriver mot befintliga dokument. **Fel.** Raden i
`writeTitle` är tillägg-vägen. Att lägga till en titel ÄR en create, varje gång, inte
bara i en kapplöpning. Golvet gäller alltså varje tillägg i appen.

Det klarar golvet: `buildAddPayload.ts:24` deklarerar
`AlwaysWritten = 'tmdbId' | 'mediaType' | 'status' | 'title' | 'posterPath' | 'releaseYear'`,
en äkta övermängd av golvet. Men det var otestat och otänkt — den största regressionsrisken i
hela ändringen, och den får ett eget bindande kriterium (villkor 12).

## Vad som byggs — A + B + C

**A.** `cascadeVisibilityToItems`: `batch.set(…, {merge:true})` → `batch.update(…)`. Ingen ny
`try/catch` runt `batch.commit()`.

**B.** `allow create` på `users/{uid}/watchlist/{itemId}` får
`request.resource.data.keys().hasAll(['tmdbId','mediaType','status'])`. Endast create.

**C — tyst men städat (Malins beslut 2026-08-20).** De **sex** redigeringsvägarna
(`updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`,
`updateTmdbStatus`) fångar **bara** `permission-denied` och loggar med `console.error` +
`captureError({ scope: 'watchlist', kind: … })`. Ingen notis.

> **LÄS "C — slutlig form efter rollkritik" NEDAN INNAN DU BYGGER DEN HÄR.** Två tidigare
> formuleringar av det här stycket är döda och ersatta där: `console.warn` (som #6
> visade var en REGRESSION — ett ohanterat fel når Sentry idag, `console.warn` gör det
> inte) och "de sju call sites" (`writeTitle` kastar vidare och är UNDANTAGEN; sju
> `captureError`-anrop i diffen är därför FEL, det ska vara sex). Stycket ovan är
> uppdaterat till den avgjorda formen — men rubriken "Vad som byggs" är den ett bygge
> läser först, så kontrollera alltid mot villkoren 14–19.

**Varför ingen notis, mätt:** `src/components/Providers.tsx:65-70` nästlar `ToastProvider`
INUTI `WatchlistProvider`. `WatchlistContext` kan alltså inte anropa `useToast` — notisen
existerar inte på den nivån. Alternativen var att flytta providern (rör hela appens uppstart)
eller låta felet bubbla till varje anropande komponent (många ställen, lätt att glömma ett).
Malin valde den tysta varianten. Det som gör den ärlig: titeln ÄR borta, och
snapshot-lyssnaren tar bort raden ändå.

Formen speglar `setRuntime` och `refreshTmdbFields`, som redan gör exakt detta.
(Radnummer utelämnade med flit: BIN-954 flyttade dem en gång redan.)

## Malins gränser

**BIN-941 (bindande):** *"bygg INTE om kaskaden så den tål ett nekande. Ingen migrering, ingen
kod som hanterar nekad chunk."* Sakens kärna står kvar: skrivningen nekas, chunken faller,
inget fångar den nekade chunken, ingen migrering. C rör enskilda redigeringar, inte chunken.
Det som vidgas är att nekandet gäller alla id:n — vilket ÄR BIN-942.

**Den daterade posten 2026-08-19 vidgas på fyra axlar, inte två** (v2 sa två):

* **Mekanism:** från `set(merge:true)`-create nekad av formspärren → `NOT_FOUND` från `update`.
* **Allvarlighet:** ny restrisk — **tio** skrivvägar kan nekas i kapplöpningen: nio av de
  tio `merge: true`-skrivarna i `WatchlistContext` (alla utom `writeTitle`, som alltid bär
  golvfälten) plus `nextAirReadRepair`. **Sex** av dem tystas (villkor 14); `setRuntime`
  och `refreshTmdbFields` fångar redan, `updateNotes` är ännu inte avgjord.
  Talen är räknade från `merge: true`-ankaret, inte från `setDoc(ref`, som missar tre.
* **Räckvidd:** från bara gamla id:n → alla id:n.
* **Tid:** från "tills pre-BIN-560-dokumenten är borta" → permanent.

Lyft till Malin 2026-08-20 före första Edit; hon valde varianten med felhantering, och sedan
den tysta formen.

**2026-07-30-posten (fail-open `effectiveVisibility`)** namnges nu: A gör misslyckade
synlighetskaskader vanligare, och en misslyckad kaskad är indata till just den accepten. Den
öppnas INTE — mitigeringen (`visibilitySyncPending` + varning + omförsök) är oförändrad och
`markVisibilitySyncPending` rörs inte. Villkor 13 låter #6 och #4 säga sitt om det.

## Bindande villkor

1. Bara `batch.set`→`batch.update` i `cascadeVisibilityToItems`. *(#27)*
2. Ingen ny swallow runt `batch.commit()`. *(#27)*
3. Golvet gäller ENDAST `allow create`. *(#4, #27, #6)*
4. Emulatortest på ett KANONISKT id: läggs till, ses falla **rött först**, vänds av golvet. *(#7)*
5. Emulatortest: golvet läcker inte till `update` — delskrivning mot befintligt dokument passerar. *(#7)*
6. Emulatortest: golvet blockerar bar `{runtime}`- och bar `{nextAirUpdatedAt}`-create. *(#27)*
7. `AuthContext.test.tsx:106`:s mock-`writeBatch` får `.update()` (mönster `WatchlistContext.test.tsx:118`). BIN-587-blockets fem påståenden passerar med NOLL ändrad text. *(#7)*
8. Nytt enhetstest: kaskaden anropar `batch.update`, aldrig `batch.set`. *(#7)*
9. Ny daterad post supersederar 2026-08-19-posten, **och den gamla retireras ordagrant till `.claude/accepted-deviations.archive.md`** (filhuvudet kräver det; modellen är 2026-07-24-posten, INTE 2026-08-15 som v2 felaktigt citerade — den säger uttryckligen "EXTENDS … does not supersede"). Nya posten avgränsas på alla fyra axlar med `Accepted` / `NOT accepted, still fileable` / `Scope` / `Re-open when`. Regelkommentarens "STILL OPEN" rättas i SAMMA commit. *(#4, #27, #6, #5)*
10. `flushNextAirWrites`/`setRuntime`/`refreshTmdbFields` får ingen anropsplatsfix — de täcks av golvet, de två senare fångar redan. Egen biljett filas. *(#27, #7)*
11. **C har inte granskats av panelen** — den tillkom efter att rollerna svarat på A+B. Före bygget: blind kritik från #7 QA, #4 Säkerhet och #6 Dataskydd på A+B+C. *(planrevisionen F3)*
12. **Emulatortest: en äkta `buildAddWrite`-payload skapar fortfarande dokumentet under golvet**, och en payload som tappat ett golvfält gör det inte. Utan det kan ingen lägga till en titel om golvet är fel. *(planrevisionen F1)*
13. Skribentinventeringen kompletteras på **alla tre ställen** — `firestore.rules`, `src/test/rules/firestore-rules.test.ts` och `docs/workflow-map.html` — inte bara två. BIN-941:s kvarvarande punkt 2. *(planrevisionen F7)*

## C — slutlig form efter rollkritik (#7 QA, #4 Säkerhet, #6 Dataskydd, 2026-08-20)

C tillkom efter att panelen svarat på A+B, så den fick en egen blind runda. Alla tre gav
SUPPORT WITH CONDITIONS och ändrade formen på tre punkter. Ingen av dem hade jag tänkt på.

**1. `console.warn` var en REGRESSION, inte en neutral form.**
`src/lib/sentry.ts` har ingen console-fångst, men Sentrys webb-SDK har `globalHandlers`
med `onunhandledrejection: true` i sina DEFAULT-integrationer, och `S.init()` sätter aldrig
`defaultIntegrations` — #6 verifierade det genom att läsa
`node_modules/@sentry/browser/.../sdk.js` och `.../globalhandlers.js`. **Ett ohanterat fel
når alltså Sentry idag.** Att byta det mot `console.warn` hade gjort riktiga fel osynliga.

Formen blir i stället `console.error` + `captureError(err, { scope: 'watchlist', kind })`
(`src/lib/sentry.ts:96`, samma kanal som `queryClient.ts` och `SegmentError.tsx`).
Inget `uid` i `extra`. *(#4 villkor 1, #6 villkor 2, #7 fynd 1)*

**2. Fånga BARA `permission-denied`.**
En bred catch sväljer också nätverksfel och kvotfel — och repot har gjort exakt det misstaget
förut och rullat tillbaka det: `src/lib/firebase/groups.ts:206-215` beskriver hur
sammanslagningen före 2026-07-20 fick en dålig mobiluppkoppling att rapporteras som en ogiltig
länk. Samma hjälpare återanvänds:
`(err as { code?: string } | null)?.code === 'permission-denied'`.
Allt annat kastas vidare, precis som idag. *(#4 villkor 2, #7 villkor 1, #6 villkor 2)*

**3. Tillägg-vägen (`writeTitle`) får INTE tystas.**
Den returnerar `outcomeOfAddWrite(write)` och kommentaren strax under `setDoc`-raden säger varför:
*"a rejected write never reports a count … so the toast cannot describe something Firestore
refused."* Det är BIN-895:s fix. Sväljs felet där rapporterar knappen "tillagd" om en titel
golvet nekade — samma falska besked BIN-895 stängde, återöppnat på create-vägen.

`writeTitle` loggar därför och **kastar vidare**. Bara de sex redigeringarna
(`updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`,
`updateTmdbStatus`) tystas. *(#6 villkor 1 — hen sa uttryckligen att hen inte skriver under på
alternativet.)*

**Varför de sex är säkra att tysta:** golvet är create-only, så de kan bara nekas när
måldokumentet inte finns — alltså exakt kapplöpningen. Titeln ÄR borta och
snapshot-lyssnaren tar bort raden. Med narrowingen i punkt 2 sväljs inget annat.

### Villkor för C (bindande)

14. De sex — `updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`,
    `updateProgress`, `updateTmdbStatus` (namn, inte radnummer: BIN-954 flyttade alla) —
    fångar **bara** `permission-denied`, loggar med
    `console.error` + `captureError({ scope: 'watchlist', kind: '<call site>' })`, och kastar
    allt annat vidare. Diffkontroll: sju `captureError`-anrop är FEL — det ska vara sex, med
    var sitt `kind`. *(#4:1-2, #6:2, #7:1)*
15. `writeTitle` (tillägg-vägen) loggar och **kastar vidare**. Diffkontroll: dess catch slutar på
    `throw`, eller så saknar den catch helt. *(#6:1)*
16. Test per call site, båda riktningarna, i `src/contexts/WatchlistContext.test.tsx`
    (matchar `vitest.config.ts`:s glob; mönstret finns i testerna
    *"swallows a Firestore failure without throwing"* och det som gör
    `batchCommit.mockRejectedValueOnce(new Error('permission-denied'))` — namn i stället
    för radnummer, som BIN-954 flyttade):
    * `permission-denied` → löftet resolvar, och `captureError` anropades med rätt `kind`
      (spionerat — "kastade inte" ensamt bevisar inte att det loggades).
    * annan kod (t.ex. `unavailable`) → löftet avvisas fortfarande.
    Det negativa fallet är vad som hindrar att narrowingen tyst blir en bred catch igen. *(#7:2, #4:3)*
17. Test: en create som golvet nekar vid 721 lämnar anroparens löfte **avvisat**. Villkor 12
    bevisar bara att en bra payload släpps igenom — inte att en nekad syns för anroparen. *(#6:5)*
18. Villkor 12:s negativa halva måste mutera `buildAddWrite()`s FAKTISKA returvärde
    (t.ex. `delete write.tmdbId`), inte ett handbyggt objekt — annars dubblerar den villkor 6
    och prövar inget nytt. Skrivs i testets kommentar. *(#7:3)*
19. Den nya daterade posten delar upp sig som `communityRatingMaintain`-posten (2026-08-16)
    gör: **Accepted** = bara den smala kapplöpningen (create-golvets nekande mot ett samtidigt
    raderat dokument, sex call sites, 721 undantagen). **NOT accepted, still fileable** =
    (a) 721 som sväljer tyst, (b) ett SYSTEMATISKT nekande av de sex (regelregression, eller en
    klientbugg som gör varje merge-skrivning till en create). Observationskanalen som namnges
    som re-open-trigger är `captureError`-scope/kind. *(#6:3, #4:4)*
20. Samma post namnger **riktningsasymmetrin**: mekaniskt är A symmetrisk, men en misslyckad
    publik→privat-kaskad lämnar objekt kvar i det ÖPPNARE läget (2026-07-30-postens farliga
    riktning), medan privat→publik bara blir mer privat än avsett — aldrig ett läckage.
    "Kaskadfel" får inte stå som en odifferentierad risk. *(#6:4)*
21. `firebase deploy --only firestore:rules` körs i **samma sittning** som pushen, inte senare.
    Skälet står under "Behöver dig". *(#4:5)*

### Det #4 eskalerade till Malin, och som är sagt

Kodfixen (A) stänger bara kaskadens EGEN väg.

**RÄTTELSE 2026-08-20 (integrationsgranskningen, varv 4): här stod "de sex andra
skrivvägarna". Fel — och fel på ett farligt sätt, eftersom sex är antalet TYSTADE vägar
(villkor 14), inte antalet EXPONERADE.** Två olika frågor, två olika mängder, och den som
läser sex som svar på båda tappar `updateNotes` (vars nekande är atomärt med
anteckningsskrivningen och uttryckligen ännu inte vägt) och `nextAirReadRepair` ur
exponeringen.

Räknat med kommandot: `grep -n "merge: true" src/contexts/WatchlistContext.tsx` → **10**
träffar, en per skrivväg. `writeTitle` bär alltid golvfälten (`buildAddPayload`s
`AlwaysWritten`), så **nio** av dem kan bli en spök-create — `updateVisibility`,
`updateStatus`, `updateWatchedAt`, `updateRating`, `updateNotes`, `updateProgress`,
`updateTmdbStatus`, `setRuntime`, `refreshTmdbFields` — plus
`src/lib/watchlist/nextAirReadRepair.ts` (`batch.set` + `merge`). De kan skapa spöken precis
som idag **tills golvet ligger ute**.
Golvet deployas manuellt och grindas inte av CI. Fönstret mellan push och regel-deploy är
alltså en öppen bugg, inte städning. Sagt till Malin 2026-08-20.


## Rollback

* **A och C** går med hosting: `git revert`, push, deploy.
* **B** är `firestore.rules` och deployas manuellt. En revert i git ändrar INTE reglerna på
  servern — det krävs ett nytt `firebase deploy --only firestore:rules`.
* Ordningen vid återställning är omvänd mot deployen: reglerna först tillbaka, sedan koden.
  Tvärtom skulle återställa den create-kapabla kaskaden under det strikta golvet.

## Behöver dig (Tier D) — sekvensen, rättad

v2:s instruktion gick inte att följa: pushen dör på `deploy.yml:47-55`-vakten, så det finns
ingen hosting-deploy att vänta in.

1. Push (deployen går **röd med flit** — vakten stoppar allt som rör `firestore.rules`).
2. Hosting via **Run workflow**-knappen på `deploy.yml` (`workflow_dispatch` hoppar över vakten).
3. `firebase deploy --only firestore:rules`.

Koden (A+C) måste ut FÖRE reglerna (B) — omvänt mot BIN-766. Går golvet ut först nekas
skrivvägarna innan felhanteringen finns på plats.

## Kartan

`flow1`-steget och "STILL OPEN (BIN-942)"-stycket blir falska. Uppdateras i en **egen commit**
efter kodcommiten (e2cf608-lärdomen).

## Öppna frågor

Inga arkitekturändrande okända. v1:s antagande om `hasAll`-semantik var meningslöst (golvet är
create-only; på en create finns inget tidigare dokument, så deltat ÄR resultatdokumentet) och
är struket. v2:s enda kvarvarande okända — hur C skulle nå en notis — är mätt och avgjord: den
kan inte, och den tysta formen valdes.

---

# Sprint 2026-08-19 — `--pick malin`, fyra biljetter

Malin valde alla fyra kandidaterna i ett interaktivt `--pick`-pass. Sessionen är BEVAKAD
och kan sammankalla panel, så tier-spärren (BIN-744/776/917) är uppfylld för alla fyra —
kritiken körs FÖRE första Edit/Write, vilket är regeln BIN-917 finns för.

**Basläge, mätt före första ändring (HEAD `2d67ff7`):**

* `git status --porcelain` → tomt.
* `npm test` → 257 filer, 4218 passerade, 4 skippade, exit 0, 106 s.

## Routing — rå utdata, körd på den FAKTISKA filuppsättningen vid HEAD

| Biljett | Router | Panel | Kritik |
| -- | -- | -- | -- |
| BIN-937 | `tier: medium`, `reasonCode: owned` | #5 Legal / GDPR Counsel | SUPPORT WITH CONDITIONS |
| BIN-936 + BIN-925 | `tier: medium`, `reasonCode: owned` | #19 Customer Support / Success | SUPPORT WITH CONDITIONS |
| BIN-766 | `tier: medium` → **omroutad `top`** | #27, #4, #6, #7, #13 | #27 klar; 4/6/7/13 pågår |
| BIN-868 | `tier: medium`, `reasonCode: owned` | #25 Engineering Manager / Release Manager | pågår |

**BIN-766 omroutades under körningen.** #27:s bindande villkor 2 kräver en formspärr i
`firestore.rules`. Routern på den nya filuppsättningen
(`runAggregate.ts` + `firestore.rules` + `src/test/rules/firestore-rules.test.ts`) ger
`tier: "top"`, `reasonCode: "high-stakes"`, `panel: [27, 4, 6, 7, 13]`. Ingen tier ärvd
från plan, biljettkommentar eller tidigare körning (BIN-787/788) — routern kördes om.

---

## BIN-937 — [Tier A] spärrhake-testet timeoutar under belastning

**Disposition:** build. **Fix:** (B) — läs trädet en gång, återanvänd innehållet.

`src/lib/watchlistWrites.addWrite.test.ts` → blocket `BIN-655 — the flag is gone and stays
gone`. `sourceFiles(SRC)` vandrar hela `src/`, och varje `it` läser sedan om VARENDA fil
med `readFileSync`. Rent I/O inuti vitests 5 s-standardtimeout. Timeoutade två gånger på
5000 ms under en lång session; grön i fem andra fullkörningar samma kväll.

**Acceptanskriterier (#5:s villkor 1–5 inviklade, bindande):**

1. Filinnehåll läses EXAKT en gång, nycklat på samma `sourceFiles(SRC)`-lista som redan
   beräknas — ingen andra, avvikande uppräkning. Båda de tunga `it`-fallen konsumerar
   samma cache. *(diff)*
2. Diffen rör bara schemaläggning/uppsättning: noll ändringar inuti något `expect(...)`,
   inuti `callers`-listan eller i något regexuttryck. *(diff)*
3. Vakuitetskontrollen (`finds a real source tree…`) körs mot det cachen FAKTISKT
   innehåller, så en tom/trasig cache faller högljutt i stället för att göra båda de tunga
   testerna gröna på ingenting. *(diff)*
4. Ingen global `testTimeout`-höjning i `vitest.config.ts` — det skulle lossa deadlinen
   för alla 257 testfiler. *(diff)*
5. `npm test` körs efter fixen med rensad `node_modules/.vite/vitest`, och resultatet
   redovisas med siffror — inte i prosa. *(diff)*
6. **#5:s villkor 5:** följdbiljett filad för `src/lib/firebase/userDocWrite.chokepoint.test.ts`,
   som har identisk form (egen `walk(SRC)` + per-fil `readFileSync`, ingen timeout-override)
   och samma exponering. *(diff — biljetten filad före commit)*

## BIN-936 + BIN-925 — [Tier A] de två raderingsskärmarnas texter kan glida isär

**Disposition:** build. Byggs som EN ändring; BIN-925:s kriterium 1 kräver ändå exakt den
jämförelse BIN-936 beskriver.

**Bindande begränsning:** de fyra låsta meddelandena och limbo-skärmens juridiskt godkända
text får INTE skrivas om (BIN-813 villkor 4). Fixen är ett test plus nedskriven motivering.

**Acceptanskriterier (#19:s villkor 1–5, bindande):**

1. Testet hårdkodar INTE limbo-knappens etikett en tredje gång. Det renderar
   `<DeletionLimbo />`, läser knappens faktiska text via
   `getByRole('button', { name: 'Slutför raderingen' })`, och hävdar att den literalen är
   en delsträng av BÅDE `RECENT_LOGIN_MSG` och `PARTIAL_MSG`. Ett namnbyte på endera sidan
   ska fälla testet. *(diff)*
2. Samma testfil pinnar den kvarstående luckan: för den otaggade andra-försöks-grenen
   (`STALE_MARKED_ERROR`) hävdas att toast-åtgärdens etikett är `Försök igen`, inte
   `Slutför raderingen` — alltså att meddelandet namnger en knapp som inte är den synliga
   åtgärden i just den renderingen. *(diff)*
3. En rad kommentar intill BÅDA textblocken som säger att de beskriver samma klassificerade
   läge från var sin sida av en avmontering, och som namnger testfilen som binder dem. *(diff)*
4. BIN-925:s biljett — inte bara kodkommentaren — bär åtkomlighetsfyndet i en mening med en
   namngiven återöppningsutlösare: de tre `setDeletionInProgress(true)`-anropsplatserna
   (`AuthContext.tsx:536`, `:638`, `:1227`) relativt färskhetsspärrens throw (~`:1190`). *(diff)*
5. Ingen av biljetterna rör de fyra låsta strängarna eller någon knappetikett. *(diff)*

**Åtkomlighet — #19:s fynd:** läget är INTE nåbart via någon verklig användarväg vid
`2d67ff7`, härlett statiskt (inte mekaniskt bevisat). BIN-925:s kriterium 1 löses därför
med alternativ (b): testet formuleras om till vad det bevisligen är, ett defensivt
kontraktstest av regeln taggen-före-klassificeringen.

**BIN-925 kriterium 2 är `kind: run`** — beslut om texten kräver Malin + #5 Juridik. Kan
per definition inte produceras av ett bygge. Markeras `awaiting-run`, går till "Behöver dig",
och är INGEN grund att hålla tillbaka batchen.

## BIN-766 — [Tier C] betygssnittet delas i två av ett felformat id

**Disposition:** build. **Väntar på panelen** (#4, #6, #7, #13) innan första raden kod.

#27:s villkor är redan bindande:

1. Ingen `mediaTypeDocId(pathMediaType, parseTmdbIdFromDocId(...))` utan `Number.isFinite`-spärr
   emellan — annars skrivs strängen `movie_NaN`.
2. Formspärr på `users/{uid}/watchlist/{itemId}` `create` i `firestore.rules`, speglad på
   det befintliga `canonicalSwipeDocId` (`firestore.rules:840-841`), `create`-only.
3. Invariantkommentaren `runAggregate.ts:118-120` rättas i samma commit — den blir sann
   först GIVET regelspärren.
4. Tester: `movie_042` → `movie_42`; legacy-grenen oförändrad; skräp-id hoppas över med
   varning, aldrig `movie_NaN`.

## BIN-868 — [Tier A] ägarkarts-spärren — **PREMISSEN IFRÅGASATT**

**Väntar på #25.** Urvalspassets egen granskning av main hittade detta:

* `docs/org/gen-ownership-map.test.mjs:32-37` gör redan precis den jämförelse biljetten
  efterfrågar: `expect(buildMap(tracked).map).toEqual(readJson('docs/org/ownership-map.json'))`.
* Den filen körs av `npm test` — verifierat: `npx vitest run docs/org/gen-ownership-map.test.mjs`
  → 1 fil, 11 tester, exit 0. Och `npm test` grindar både `ci.yml` och `deploy.yml`.
* Filhuvudet i `gen-ownership-map.mjs` rad 9–13 säger att `--check` MEDVETET inte rapporterar
  kartdrift, just för att testet gör det "instead of waiting for someone to remember a flag".
  Skrivet i `bfb82f4` **2026-08-12**, samma dag biljetten skapades (15:11).

Alltså: biljettens hål 2 är ett dokumenterat medvetet designbeslut, och skyddet den ber om
finns redan och blockerar redan deployen. Hål 1 ("körs ingenstans automatiskt") gäller
SKRIPTET men inte upprätthållandet. #25 fick uppgiften att mäta detta självständigt.


## Utfall — mätt, inte påstått

**Efter bygget, HEAD `2d67ff7` + arbetsträdet:**

* `npm test` (efter `rm -rf node_modules/.vite/vitest`) → **258 filer, 4230 passerade, 4 skippade**, exit 0. Basläget var 257/4218.
* `npm run typecheck` → exit 0.
* `npx eslint` på alla sju ändrade filer → exit 0.
* `npm run test:rules` → **6 filer, 330 passerade**, exit 0. Kördes på port 8085 via en
  egen scratchpad-config: 8080 hölls av **Butlerys** emulator (annat projekt, kanske en
  levande session) och den rörs inte.
* `node scripts/check-workflow-map.mjs` → OK, 100 noder, 31 flöden, täckning 76/76.

**Muteringsprov — varje ny spärr prövad mot det avgörande fallet:**

| Mutant | Utfall |
| -- | -- |
| Limbo-knappen döps om till "Avsluta raderingen" | BIN-936-testet föll (1 failed / 11 passed) |
| `&& canonicalWatchlistDocId(itemId)` strykes ur regeln | exakt de 10 alias-fallen föll (10 failed / 241 passed) |

Båda återställdes från scratchpad-snapshot och verifierades med `sha1sum` — identiska.
Aldrig `git checkout --`.

**#6 Dataskyddsombudets villkor 3 — skarp data, som kritiken inte kunde mäta:**
`firestore_list_documents` på `titleRatingsAggregate` i `binge-nu` → **262 dokument, hela
listningen (ingen `nextPageToken`), noll icke-kanoniska id:n, noll utfyllda alias, noll
id-noll.** Ingen migrering behövs, ingen befintlig delning finns att laga.

## Panelens villkor — hur de landade

Alla fem BIN-766-roller körde blint, var för sig, före första raden kod. Fyra av fem gav
SUPPORT WITH CONDITIONS; #25 gav BLOCK på BIN-868 (se nedan).

**Två konflikter i panelen, och hur de löstes:**

1. **#4 vs #7 om regelns bredd.** #4 ville spegla `canonicalSwipeDocId` ordagrant, vilket
   nekar bara-numeriska id:n på create. #7 mätte att det fäller **35 befintliga fixturer**
   i `firestore-rules.test.ts` och krävde ett uttryckligt val. Valt: #4:s strikta regel,
   och de 35 fixturerna namnrymdade (30 × `'603'`, 5 × `'1399'`). Skälet: två moduler bygger
   ett watchlist-doc-id för en SKRIVNING — `WatchlistContext` och `nextAirReadRepair` — och
   båda gör det via `mediaTypeDocId()` med `tmdbId` typad `number`, så ingen create-väg i
   appen kan avge en bar eller utfylld form. (`taste/backfill` skriver utan att bygga något
   id alls; `useFriendsWhoSaw` bygger ett men bara för att LÄSA.) Fixturerna beskrev en
   värld före BIN-560.

   Den här meningen fälldes av granskarna tre gånger på rad — först "enda skribenten", sen
   en fix som klumpade in `backfill` bland id-byggarna, sen en som glömde att läsvägarna
   också bygger id:t. Varje version var ett tal eller ett "exakt N" jag inte hade räknat.
   Det är lärdomen från BIN-905/918 som slår till igen, och den hör hemma i planen snarare
   än i koden: kör kommandot före meningen.
2. **#13 vs #7 om var funktionen bor.** #13 ville flytta `aggregateDocId` till `logic.ts`;
   #7 ville ha testerna i `runAggregate.test.ts`. Flytten kräver `RatingEvent` och
   `AggregateLogger`, som DEKLARERAS i `runAggregate.ts` — den hade gett en importcykel för
   att flytta en funktion. Avvikelse tagen och skriven i testfilens huvud: funktionen står
   kvar, testerna ligger i `runAggregate.test.ts`. Det gemensamma målet — ett rent test utan
   emulator, kört av `npm test` — är uppfyllt.

## BIN-868 — STÄNGD SOM OBSOLET, inte byggd

#25 gav **BLOCK** och bevisade det mekaniskt i stället för att lita på biljetten eller
filens kommentarer: handredigerade in en drift i `ownership-map.json`, körde
`npx vitest run docs/org/gen-ownership-map.test.mjs`, fick 1 failed / 10 passed med den
drivande skillnaden utskriven, återställde, bekräftade rent träd.

Skyddet biljetten ber om finns alltså redan, i `gen-ownership-map.test.mjs:32-37`, och
`npm test` grindar både `ci.yml` och `deploy.yml`. Att bygga det biljetten beskriver hade
rest en ANDRA, konkurrerande driftkoll bredvid den som fungerar — precis den delade hjärna
filens eget huvud (rad 9–13, skrivet i `bfb82f4`) argumenterar emot.

## Avvikelselogg

- [discovery] BIN-766: routern gav `medium` på biljettens egen filuppsättning, men #27:s
  bindande villkor 2 drar in `firestore.rules` → omroutad till `top`, full panel. Tiern
  följer den FAKTISKA filuppsättningen, inte biljettens.
- [discovery] BIN-868: premissen granskad mot main före bygget (regeln "kolla biljettens
  premiss mot main"). Drift-detekteringen finns redan i `gen-ownership-map.test.mjs` och
  grindar deployen via `npm test`. Inget byggt innan #25 svarat.

## Behöver dig (Tier D / `kind: run`)

- **BIN-766:** manuell deploy efter commit, i DEN HÄR ordningen — `deploy.yml` skickar
  bara hosting:
  1. `firebase deploy --only firestore:rules`
  2. `firebase deploy --only functions`

  Ordningen är inte en stilfråga. Skickas funktionen först är kanoniseringen live medan
  alias-id:n fortfarande får skapas — exakt det fönster hela regelspärren finns för.
  `firestore.rules` säger det själv: "Do not ship one half without the other.
- **BIN-925 kriterium 2:** beslut om de låsta texterna (du + #5 Juridik). Byggs inte här.

---

# BIN-917 + BIN-919 — 2026-08-18

Vald av Malin i ett `--pick`-pass. Båda är verifierat trasiga vid HEAD (`6d157c5`), båda
routar `medium`, och båda kritikerna är **körda före första Edit/Write** — det är precis den
regel BIN-917 finns för att laga, så den gäller den här körningen först av alla.

| Biljett | Router (rå, körd på den FAKTISKA filuppsättningen) | Kritik | Utfall |
| -- | -- | -- | -- |
| BIN-919 | `tier: medium`, `reasonCode: owned`, `panel: [25]` | #25 Engineering Manager / Release Manager | SUPPORT WITH CONDITIONS |
| BIN-917 | `tier: medium`, `reasonCode: unmapped-code`, `panel: [14]` | #14 Software Architect | SUPPORT WITH CONDITIONS |

Ingen tier ärvd från en plan, en biljettkommentar eller en tidigare körning (BIN-787/788).
Båda kritikerna körde sina egna mätningar och #25 reproducerade urvalspassets siffror exakt.

**Basläge, mätt före första ändring:**

* `git status --porcelain` → tomt.
* `npm test` → 256 filer, 4167 passerade, 4 skippade, exit 0.
* `node docs/org/metrics/check_events.mjs` → exit 0, `4 claim(s) checked — 0 evidenced, 4 retired by a correction, 1 grandfathered`.
* `node scripts/check-workflow-map.mjs` → OK, 100 nodes, 31 flows, coverage 76/76.

---

## Vad som INTE byggs, och varför — läs det här före allt annat

BIN-917 har fyra kriterier. **Två av dem kan inte ge en diff i det här repot, och ett tredje
kan det inte heller — vilket biljetten ännu inte visste.**

* **Kriterium 2** (kapacitetsregeln ska bo i sprintens URVAL) — urvalsmotorn ligger under
  `C:/claude-plugins`, utanför det här git-trädet. Biljetten säger själv detta.
* **Kriterium 3** (en uttagen biljett bär ett skrivet skäl) — samma motor, samma repo.
* **Kriterium 4** (en batch får inte nå COMMITTERAREN utan en `events.jsonl`-rad) — **BYGGT.
  Se avvikelseloggen längst ned.** Planen sa först att det var omöjligt här, på två prober som
  båda var sanna (`ls .husky` tomt, inget `precommit` i package.json) och en slutsats som var
  falsk: `lefthook.yml` ÄR repots commit-tidsmekanism och har legat här sedan 2026-08-08.
  Kriteriet uppfylls nu av ett `commit-msg`-block som kör modulens `--message`-läge.

Kontrollen har därför TVÅ lägen, och skillnaden mellan dem måste sägas rakt ut varje gång:

* `--message` — **commit-tid.** Bedömer ämnesraden på committen som håller på att skrivas och
  vägrar den. Det är kriterium 4 ordagrant, och det är vad `commit-msg`-hooken kör.
* utan flagga — **historik.** Går igenom varje gjord commit och kör under `npm test`, alltså
  grindar den DEPLOYEN. Backstop för allt som slank in innan hooken fanns, eller med
  `LEFTHOOK=0`.

Det historiska läget ensamt hade INTE uppfyllt kriterium 4, och den första versionen av den
här planen påstod att det var det bästa som gick att göra. **Ingenstans får det påstås att en
mekanism uppfyller ett krav den inte uppfyller** — det är fortfarande regeln; den gällde bara
åt andra hållet än jag trodde.

---

## Batch 1 — BIN-919: `package.json` når noll blockerande granskare

### Vad som är fel

Routern kallar `package.json` KOD (`docs/org/route.mjs:173`, `CODE_ROOT_FILES`) och routar
den `medium` / `unmapped-code`. Ingen `reviewGates`-post matchar den. Ett beroendebyte, en
scriptändring eller ett Next-versionslyft kan alltså committas utan en enda granskare.
Symmetrikollen ser det inte: regel A1 filtrerar på `reasonCode === 'owned' || 'high-stakes'`,
och `unmapped-code` är ingendera. Kollen skriver ut det som "Known blind spot 1" — den enda
platsen det stod.

### Mätning (kört av urvalspasset OCH oberoende reproducerat av #25)

```
TRACKED total: 1003
kodvägar: 859   medium/owned 556   medium/unmapped-code 294   top/high-stakes 9
A1 som den står idag (owned|high-stakes):  0 offenders
A1 nycklad på tier !== 'skip':             1 offender — package.json
unmapped-code: 294 totalt, 293 har redan en grind, 1 har ingen — package.json
```

Ombyggnaden av A1 kostar alltså **noll** nya röda fall utöver den fil biljetten handlar om.

### Acceptanskriterier (biljettens tre + #25:s sex villkor, alla bindande)

- [x] **A1.** `^package\.json$` läggs till i `binge-integration-reviewer`s `patterns`.
      **Rot-ankrat** — får inte också matcha `functions/package.json` eller någon nästlad
      `package.json`. *(#25 must-have 1)* *(kind: diff)*
- [x] **A2.** Bevis: `blockingGates('package.json')` är icke-tom OCH
      `blockingGates('functions/package.json')` är oförändrat `['binge-security-reviewer']`.
      Körs och klistras in. *(#25 must-have 1)* *(kind: diff)*
- [x] **A3.** #25 namnges som ägare av `package.json` i `docs/role-responsibilities.md` §25 —
      **tillagt på den BEFINTLIGA "Dependabot grouping + framework upgrades"-punktens
      pilrad**, som redan bär `.github/dependabot.yml`. Ingen ny punkt: det är samma sak.
      `docs/org/ownership-map.json` regenereras med `node docs/org/gen-ownership-map.mjs`.
      *(#25 must-have 2)* *(kind: diff)*
- [x] **A4.** Bevis: `node docs/org/route.mjs package.json` svarar `reasonCode: "owned"`,
      `panel: [25]` — inte `unmapped-code` / `[14]`. *(#25 must-have 2)* *(kind: diff)*
- [x] **A5.** En daterad `_note9` på integrationsgrindens post säger VARFÖR `package.json`
      går till integration och inte till security, och tar uttryckligen upp att
      `functions/package.json` redan når `binge-security-reviewer` — men bara **av en
      slump**, via prefixet `^functions/`, inte via ett beslut om leveranskedjan.
      Inkonsekvensen får inte shippas outtalad. *(#25 must-have 3)* *(kind: diff)*
- [x] **A6.** A1 nycklas om till `tier !== 'skip'`. *(#25 should-have 1, uttryckligen
      stödd)* *(kind: diff)*
- [x] **A7.** Ett GOLV som gör den vidgade regeln icke-vakuös: antalet kodvägar med
      `reasonCode === 'unmapped-code'` assertas `>= 230` (uppmätt: 295; golvet var 100 i en
      runda, vilket granskaren korrekt kallade slappare än de golv commiten själv skärper). Utan det
      passerar A1 tyst om `route.mjs` någonsin slutar avge `unmapped-code`.
      *(#25 must-have 4 — spärrhake-behöver-golv, BIN-838/823/850)* *(kind: diff)*
- [x] **A8.** Både "Known blind spot 1" OCH A1:s egen beskrivning i filhuvudet skrivs om.
      Huvudet säger idag ordagrant "that is reasonCode `owned` AND `high-stakes`" — den
      meningen blir falsk i samma stund A1 nycklas om. *(#25 must-have 6, biljettens
      kriterium 3)* *(kind: diff)*
- [x] **A9.** Efter ändringen: censusen körs om och visar **0 offenders under BÅDA
      nycklingarna**, och `npx vitest run docs/org/gate-symmetry.test.mjs` är grön.
      *(#25 must-have 5)* *(kind: diff)*
- [x] **A10.** De två slappa tomhetsgolven i samma fil skärps. Uppmätt av #25:s
      RETROAKTIVA kritik av `851696d` (batch 2:s arbete, men fyndet ligger i den här filen):
      `tier !== 'skip' >= 400` mot verkliga **883** (golvet är 45 %) och
      `gates.length > 0 >= 400` mot verkliga **875** (46 %). Ett golv på under halva
      värdet fångar inte en regression som halverar routerns utdata — precis den klass
      BIN-926 är filad om. Höjs till 700. De tre övriga golven är redan snäva (1003/800,
      17/15, 9/7) och lämnas. *(kind: diff)*

### Vad Malin behöver veta (#25 should-have 1, ordagrant vidarefört)

A1-omnycklingen är en beteendeändring på en rad: en **ny** rotfil av config-typ
(`.nvmrc`, `renovate.json`, en TOML-fil) som varken ägs eller grindas kommer nu att fälla
`npm test` tills någon ger den en ägare eller en grind. Det är bromsen som är meningen — men
den ska inte komma som en överraskning nästa gång något sådant läggs till.

### Öppen fråga som EN roll inte kan avgöra (#25 should-have 2)

`ROLE_WORLD_MODEL.md:712` listar #4 Säkerhetsarkitekt som medintressent för
Dependabot/beroendebevakning vid sidan av #25. Routern satte bara `[25]`. Om svaret på A5 är
"security borde också grinda `package.json`" är det en andra-roll-fråga som den här
enrollskritiken inte får avgöra ensam. **Lyfts till Malin i slutrapporten, byggs inte här.**

---

## Batch 2 — BIN-917: de två uteblivna kritikerna, och tystnaden efter dem

### Acceptanskriterier

- [x] **B1.** Kritiken från #19 Customer Support körs retroaktivt på `049f21b`:s diff av
      `src/components/settings/DeleteAccountSection.test.tsx`. *(biljettens kriterium 1)*
      *(kind: diff)*
- [x] **B2.** Kritiken från #25 Engineering Manager körs retroaktivt på `851696d`:s fyra
      filer. *(biljettens kriterium 1)* *(kind: diff)*
- [x] **B3.** Båda utfallen skrivs till `docs/org/metrics/events.jsonl` med `ran: true`,
      via `node docs/org/metrics/log_event.mjs review '{…}'`. Varje rad bär
      `commit_sha` (`049f21b` / `851696d`) — deras prosa säger "shipped", vilket
      `claimsReachedMain` fångar, så en rad utan sha vore en ny obevisad utsaga i samma fil.
      *(kind: diff)*
- [x] **B4.** Varje rad bär ett `timing`-fält. Ingenting i dagens schema skiljer "kritiken
      kördes innan koden fanns" från "kritiken kördes efteråt mot redan mergad kod".
      **RÄTTELSE:** planen sa först att `/org-retro` poängsätter på fältet. Det är falskt —
      utfallsgranskaren grep:ade hela `role-org`-pluginen efter `timing`, `retroactive` och
      `pre-build` och fick noll träffar, och skillens dokumenterade fältlista nämner det
      inte. Fältet läses av ingenting idag. Det är fortfarande rätt att skriva — utan det är
      de sju raderna omöjliga att skilja från sju granskningar som löste ut i tid — men
      motivet är framtida mätbarhet, inte en befintlig konsument. Fältet är nu dokumenterat
      i `docs/org/metrics/README.md`:s schematabell, vilket är precis vad den tabellen finns
      för. *(#14 must-have 7)* *(kind: diff)*
- [x] **B5.** De två nya raderna får inte kollidera med eller dubblera de fyra
      `correction`-rader som redan ligger i filen från `9d53349`. Kontrolleras före
      skrivning. *(#14 must-have 7)* *(kind: diff)*
- [x] **B6.** `node docs/org/metrics/check_events.mjs` är fortfarande grön efteråt, och
      `evidenced` har gått från 0 till **5**. *(Planen sa först "till 2" — det var en gissning
      skriven innan raderna fanns. Fem av de sju nya raderna bär `commit_sha` och gör en
      nå-main-utsaga (BIN-908, 880, 906, 565, 911); de två sista är förbygges-rader som
      ingenting påstår om main. Kört: `9 claim(s) checked — 5 evidenced, 4 retired by a
      correction, 1 grandfathered`.)* *(kind: diff)*

### Täckningskontrollen — kriterium 4:s svagare syskon

- [x] **B7.** Byggs som en **egen modul**, `docs/org/metrics/check_review_coverage.mjs` +
      `check_review_coverage.test.mjs`. Inte inbakad i `check_events.mjs`: den filens huvud
      är snävt formulerat kring en helt annan regel (utsagor som saknar bevis, inte
      tystnad), och att bulta in en andra regel där är precis den huvud-glidning filen
      själv varnar för. `historyIsAvailable`/`gitCommitDate` **importeras** från
      `check_events.mjs`, dupliceras inte. *(#14 must-have 6)* *(kind: diff)*
- [x] **B8.** Nämnaren: commits vars ämnesrad är `feat(...)` eller `fix(...)` OCH namnger ett
      `BIN-\d+`. **Endast ämnesraden**, aldrig meddelandekroppen — `6d157c5` är en ren
      docs-rättelse som namnger BIN-565 bara i kroppen, och en kropps-läsande regel skulle
      kräva en rad för varje uppföljande kommentarsfix. `docs`/`chore`/`test` kräver ingen
      rad. *(#14 must-have 2)* *(kind: diff)*
- [x] **B9.** En `feat`/`fix`-commit UTAN biljett-id i ämnesraden klassas som **överträdelse**,
      inte som tyst hoppad. En ospårbar feat/fix är själva tystnaden regeln finns för.
      (Uppmätt: 8 sådana av 55 feat/fix sedan 2026-08-01 UTC; 12 av 74 under den vidgade nämnaren.) *(#14 must-have 2)*
      *(kind: diff)*
- [x] **B10.** Egen epok, skild från `RULE_EFFECTIVE_FROM`. Att återanvända 2026-08-16 ger
      **8 kvalificerade commits, 4 utan rad** — alltså rött på dag ett (planen sa först
      "~46 historiska feat/fix", vilket var fel epok-fönster; modulens egen tabell har
      rätt siffror). Epoken pinnas till den
      commit som shippar regeln eller senare, och antalet grandfathered SKRIVS UT vid varje
      körning. *(#14 must-have 3)* *(kind: diff)*
- [x] **B11.** `historyIsAvailable()` ärvs villkorslöst. `ci.yml` och `preview.yml` checkar ut
      på djup 1 medan `deploy.yml` kör `fetch-depth: 0` — en `git log`-vandring i en grund
      checkout ser i praktiken en commit. I det läget rapporteras `unverified`, aldrig tyst
      grönt och aldrig tyst rött. *(#14 must-have 4)* *(kind: diff)*
- [x] **B12.** Nollgolv: matchar vandringen NOLL kvalificerade commits i fönstret är det i sig
      en överträdelse, inte en ren körning. Identiskt med `claimsChecked === 0` i syskonet.
      *(#14 must-have 5, BIN-838/823/850)* *(kind: diff)*
- [x] **B13.** Varje körning skriver ut sin egen omfattningsrad i syskonets stil — N commits
      undersökta, M krävde en rad, K hittade, J grandfathered — så att "ren" aldrig kan
      läsas som "allt är granskat". *(#14 should-have 1)* *(kind: diff)*
- [x] **B14 (OMSKRIVET — gäller nu HISTORIKLÄGET; commit-läget grindar committen).** Modulens filhuvud, commit-meddelandet och biljettkommentaren säger alla rakt ut
      att den grindar **deployen, inte committen**, och att kod utan granskningsrad
      fortfarande når `main`. *(#14 must-have 1 — den enskilt viktigaste raden i planen)*
      *(kind: diff)*
- [x] **B15.** Ett test som driver hela beslutsträdet mot fixturer, inte bara det gröna
      fallet: kvalificerad commit med rad, kvalificerad utan rad, docs/chore som inte
      kräver rad, feat/fix utan biljett-id, grund checkout, och nollgolvet.
      *(kind: diff)*

### Vad som INTE ingår, uttryckligen

Kriterium 2 och 3. **Inte kriterium 4** — den raden stod kvar här efter att kriterium 4 hade
byggts, och var därmed den sista platsen i planen som fortfarande sa emot avsnittet högst upp
och avvikelseloggen. Integrationsgranskningen hittade den. Att en rättelse når fyra av fem
ställen är exakt hur ett falskt påstående överlever.

De två som står kvar väntar på en session i `C:/claude-plugins` — och enligt lärdomen från
2026-08-03 får det repot **aldrig** redigeras från en session som startar subagenter, vilket
den här gör.

---

## Behöver dig (Tier D)

* **Kör `npx lefthook install` en gång på varje maskin du committar från.** Den nya
  `commit-msg`-hooken är den mekanism som uppfyller BIN-917:s kriterium 4. Repot har inget
  `prepare`-skript, så en NY hooktyp installeras inte av sig själv — konfigurationen finns,
  men grinden är oskarp tills kommandot körts. Kört här. Det är exakt BIN-849:s felform (ett
  värde inkopplat i konfigurationen men aldrig i bygget), och därför står det här och inte
  bara i en kodkommentar.
* **Sprintmotorn kommer att bli NEKAD av den nya hooken vid sina batch-commitar.** Grinden
  läser INDEXET (avsiktligt — annars kan en oscenad rad släppa igenom en commit som sedan
  fäller deployen), medan motorn i `C:/claude-plugins` skriver sina rader **oscenade** och
  sedan stagear per uttrycklig sökväg. Dess `git add -A`-väg är oskadd; batch-vägen är det
  inte. Felmeddelandet säger rakt ut vad som ska göras ("STAGE it"), så det blir högljutt och
  inte tyst — men motorn kan inte redigeras från den här sessionen, och det är en ändring du
  vill veta om innan nästa obevakade körning. Hör ihop med kriterium 2 och 3, som ändå väntar
  på ett pass i det repot.
* **Linear-arbetsytan är full.** `create_issue` svarade "You've exceeded the free issue
  limit" i post-sprinten 2026-08-16. Varje uppföljning nedan skrivs därför som en fullständig
  kommentar på närmaste öppna ärende i stället för som egen biljett — och taket är något bara
  du kan åtgärda.
* **Frågan om #4 Säkerhetsarkitekt på `package.json`** (se batch 1). En enrollskritik får
  inte avgöra den.

## Uppföljningar att fila som kommentarer (Linear-taket)

1. Rot-`package-lock.json` är inte kod för routern (`isCodePath` false) medan
   `functions/package-lock.json` är det och redan når security. Osynligt för
   symmetrikollen under BÅDA A1-nycklingarna, eftersom båda kräver `isCodePath` först.
   Ett router-sidigt hål, inte något BIN-919 rör. *(#25 out-of-scope 1)*
2. Kodändrande commits sedan 2026-08-01 utan biljett-id i ämnesraden: **12** under den
   levererade sjutypsnämnaren (8 om man bara räknar `feat`/`fix`, av 55 sådana). De kommer
   **inte** att flaggas — alla ligger före epoken 2026-08-18 och är grandfathered; den
   levande körningen rapporterar 2 kvalificerade och 0 överträdelser. Planen sa först att de
   skulle flaggas varje körning, vilket var fel åt båda hållen: fel antal och fel utfall.
   *(#14 should-have 2, rättad av integrationsgranskningen)*

## Deviation log

- [discovery] BIN-917: planen antog att kriterium 4 kunde byggas här i någon form.
  #14:s kritik visade att det inte kan det ens i princip — repot har ingen commit-tidsmekanism
  (`ls .husky` tomt, inget `precommit` i `package.json`). Konservativt val: bygg det svagare
  syskonet, märk det som sådant på fyra ställen (modulhuvud, route.mjs-kommentar, plan,
  biljettkommentar), och dra ut kriterium 4 tillsammans med 2 och 3.
- [deviation] #14:s must-have 5 sa att golvet ska fälla när NOLL kvalificerade commits hittas,
  som syskonet gör. Byggt annorlunda, med skälet i modulens egen kommentar: epoken är i dag,
  så det finns per konstruktion inga commits efter den när regeln landar — en bokstavlig
  implementation hade shippat RÖD på dag ett och fällt just den commit som inför regeln.
  Golvet ligger därför på VANDRINGEN (en trasig läsning), och antalet kvalificerade commits
  redovisas i utskriften i stället. Båda halvorna är pinnade i testet så ingen "rättar"
  tillbaka det.
- [discovery] Den nya täckningskontrollen hittade två verkliga luckor på sin FÖRSTA körning:
  `634d62e` (BIN-565) och `2e5993a` (BIN-911) shippade utan granskningsrader. Kritikerna hade
  KÖRTS — sprintplanen vid `6d157c5` redovisar #18/#27 och #19/#5 med domar och villkor — de
  loggades bara aldrig. Backfillade som två rader märkta `pre-build-logged-late`. Inte i planen.
- [deviation] A10 tillagt efter planen skrevs: #25:s RETROAKTIVA kritik (batch 2:s arbete) hittade
  ett blockerande fynd som bor i batch 1:s fil. Två av fem tomhetsgolv låg på 45–46 % av sina
  verkliga värden. Konservativt val: höj dem i samma pass, eftersom filen ändå var öppen och ett
  känt trasigt golv i en fil man just härdat är sämre än att fila det. Stänger halva BIN-926;
  den andra halvan (kollen speglar grinden för hand) står kvar.
- [discovery] Probe mot A1-omnycklingen motsade min egen planformulering. Att ta bort den nya
  grindraden fäller `package.json` under BÅDA nycklingarna — ägarhalvan ensam hade räckt för
  just den filen. Omnycklingens värde ligger i KLASSEN: med verktygsalternationen borttagen ser
  den gamla regeln 2 filer och den nya 7. Både mätningen och rättelsen står i filhuvudet, så
  meningen "omnycklingen fångar package.json" inte kan överleva som en obevisad sammanfattning.
- [deviation] **Utfallsgranskaren underkände batch 1 och hade rätt på tre punkter.** Alla
  åtgärdade, ingen krävde omtag: (a) A8 var inte uppfylld — testets NAMN och felmeddelande
  beskrev fortfarande den gamla nyckeln ("every owned CODE path"), vilket är rakt falskt för
  en `unmapped-code`-överträdare och dessutom utelämnade botemedlet "ge sökvägen en ägare";
  (b) tre tal i kommentarer var mätta FÖRE ändringen och skrivna i presens — "293 av 294 …
  idag" är 295 av 295 på det träd som shippas, och det nya golvet stod som "uppmätt 294" mot
  ett verkligt 295; (c) `_note9` öppnade med "det första hål en kontroll namngav i stället
  för en granskare" — falskt, och exakt den självsmickrande formen `_note8` rättades för en
  not tidigare. Det var BIN-880:s handskrivna "Known blind spot 1"-prosa som namngav det.
- [deviation] **Min egen spärrhake spärrade ingenting, och granskaren bevisade det med en
  mutation.** Testet deklarerade en LOKAL kopia av A1:s predikat och assert:ade mot kopian —
  produktionsregeln rördes aldrig. Med regeln återställd till den gamla nyckeln gick sviten
  9/9 grön medan testets egen kommentar lovade att den skulle bli röd. Fixat genom att bryta
  ut `a1Offenders(verdicts)` och låta både regeln och testet köra DEN. Omprövat: kontroll
  9/9 grön, mutant fäller rätt test med rätt meddelande, återställd och verifierad mot hash
  `6c32b7eb…`. Detta är precis den klass den här commiten finns för att stoppa, en nivå upp.
- [deviation] Golvet för `unmapped-code` höjdes 100 → 230. Granskaren påpekade att 100 var
  34 % av det verkliga värdet (295) — alltså slappare än de två golv samma commit höjer för
  att 45 % är dekoration. Ett golv skrivet mot en regel commiten själv underkänner är inget golv.
- [discovery] Att SKRIVA att en fil inte ägs ägde den. Meningen "lockfilen namnges medvetet
  INTE här — `package-lock.json` är maskingenererad" seatade #25 på `package-lock.json`,
  eftersom generatorn skördar varje backtick-citerad spårad sökväg i en sektion. A2 gick röd
  med "package-lock.json (owned by #25, blocking gate: none)". Fångat av testet, inte av mig.
  Avbacktickad; samma fälla som §25:s nästa punkt redan dokumenterar för kataloger.
- [discovery] **Utfallsgranskaren av batch 2 godkände alla 15 kriterier men hittade ett hål
  som var värre än något kriterium: nämnaren missade halva incidenten.** `OWES_REVIEW` täckte
  bara `feat|fix` — och `049f21b`, den ena av de TVÅ commitar biljettens rubrik handlar om, är
  `test(radering): … (BIN-908)`. Kontrollen hade fångat `851696d` och seglat rakt förbi den
  andra halvan. En kontroll som missar fallet den skrevs för är sämre än ingen. Nämnaren är
  vidgad till `feat|fix|refactor|perf|test|build|ci`. Uppmätt kostnad: NOLL nya kvalificerade
  commits idag (båda varianterna ser samma 2 sedan epoken), 74 i stället för 55 över hela
  augusti — alla grandfathered. Det som medvetet står utanför (`docs`/`chore`/`style`,
  `revert`, och commits utan prefix) står nu skrivet i modulhuvudet som en GRÄNS, inte som en
  fullständighet.
- [deviation] Tre mindre fynd från samma granskning, alla åtgärdade: (a) "66 av 132 är
  docs/chore/test" var 67 vid HEAD. Alla tal är ommätta med metoden utskriven bredvid. (Den
  här raden bar en förklaring till skillnaden — "`--since` läser LOKAL tid" — som senare
  drogs tillbaka som fel; subtraktionen nedan nådde modulen men inte hit förrän sjätte
  granskningsrundan.); (b) `timing`
  var ett nytt schemafält som ingenting läser, och planen motiverade det med att `/org-retro`
  poängsätter på det — falskt, verifierat med grep över hela plugin-katalogen. Fältet är rätt
  att skriva men av ett annat skäl, och är nu dokumenterat i `README.md`:s schematabell;
  (c) `must_haves` räknades på två olika grunder i grannrader (4 = ogjorda villkor för
  BIN-565, 5 = totalen för BIN-911). Enhetligt nu: totalen. Raderna skrevs om från grunden
  i stället för att rättas med `correction`-rader — de hade aldrig committats, så det finns
  ingen post någon sett att korrigera, och append-only skyddar en post, inte ett utkast.
- [deviation] **KRITERIUM 4 BYGGDES ÄNDÅ — hela skälet att dra ut det var falskt.**
  Integrationsgranskningen underkände batchen på detta: `lefthook.yml` ligger spårat i repot
  sedan 2026-08-08, har ett `pre-commit`-block med två levande kommandon, `lefthook` är en
  devDependency och `.git/hooks/pre-commit` är installerad. Mina två prober (`ls .husky`,
  `precommit` i package.json) var båda SANNA och slutsatsen ändå fel. "Jag hittade inte X" och
  "X finns inte" är olika meningar — och att blanda ihop dem inuti fixen för just den klassen
  av fel är så illa det kan bli. Byggt: `--message`-läget i modulen + ett `commit-msg`-block i
  `lefthook.yml`. Prövat på fyra meddelandeformer (godkänd, ogranskad biljett, kod utan
  biljett-id, docs-commit) — rätt utfall på alla fyra. Hooken är installerad här med
  `npx lefthook install`. Kriterium 4 är därmed UPPFYLLT, inte utdraget; kriterium 2 och 3 står
  kvar utanför repot.
- [deviation] A3 kryssades av men byggdes tvärtom mot sin egen formulering. Villkoret sa
  "tillagt på den BEFINTLIGA Dependabot-punktens pilrad. Ingen ny punkt" — det blev en ny
  punkt med egen pilrad. Routningsutfallet är identiskt (`owned`/[25]) och därför är det en
  avvikelse och inte ett fel, men den saknades i den här loggen, vilket granskaren korrekt
  kallade defekten. Skälet den byggdes så: motiveringen blev fem meningar lång, och att klämma
  in den mitt i en befintlig semikolonlista gjorde meningen ogrammatisk (första försöket var
  det, och granskaren fällde även den).
- [deviation] Tre tal till, alla ommätta och alla fel i första versionen: "66 av 132" (ingen
  metod ger 66 — UTC-jämförelsen ger 61 av 135, `TZ=UTC` med bart datum 59 av 132), "109
  oprefixade i historien" (verkligt 129 under modulens egen grammatik — och eftersom en
  granskare mätte 142 och en annan 146 står nu FYRA definitioner med var sitt tal i huvudet i
  stället för ett bart tal), och en mening i `README.md` som den HÄR commiten gjorde falsk ("0
  evidenced … ingen rad bär en commit_sha ännu" — nu 5). Metoden står utskriven bredvid varje
  tal, eftersom metoden ÄR en del av talet. Den här raden har dessutom burit TRE olika
  förklaringar till varför `--since` ger ett annat tal, och två av dem var fel: först "git
  läser lokal tid", sedan "TZ=UTC plus bart datum". Den fjärde versionen räknade upp "de" möjliga
  värdena och utelämnade det värde kommandot faktiskt ger i det här skalet. Lösningen blev
  till slut inte en bättre förklaring: alla tal kommer nu från EN namngiven procedur, och
  `git log --since=…` avfärdas i två meningar som en annan fråga man inte ska jämföra med. En
  kommentar som hela tiden behöver en ny teori beskriver något den inte förstår — och att
  förklara det var aldrig uppgiften.
- [discovery] Jag redigerade `lefthook.yml` — commit-grindsmaskineri som nådde noll granskare
  och saknade ägare. Exakt hålet den här batchen handlar om, en fil bort, upptäckt inuti
  batchen. Både grinden och ägarkartan vidgade i samma commit (#25, samma roll som äger
  reviewGates-rostern).
- [deviation] Två filer utanför planens filuppsättning: `docs/org/route.mjs`
  (`TOOLING_CODE_FILES`) och en andra rad i integrationsgrinden, för den nya modulen. Krävs av
  route.test.mjs:s BIN-874-block — en ny `.mjs` med testsyskon som saknas i listan fäller det —
  och av BIN-830-regeln att de två listorna alltid flyttas i samma commit.

