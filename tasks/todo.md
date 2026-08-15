# Plan — BIN-727 villkor 4: `communityRatings` bakom en port

Datum: 2026-08-15. Bevakad session; Malin har sagt "ta det tredje jobbet och dra sen
ut det i molnet". Planen täcker bygget; deployen är ett eget steg efteråt.

## Rollkastning — körd FÖRE planen

`node docs/org/route.mjs functions/src/communityRatings/index.ts
functions/src/communityRatings/runAggregate.ts
src/test/rules/community-ratings-orchestrator.test.ts`

| tier | reasonCode | panel | highStakes |
| --- | --- | --- | --- |
| `medium` | `owned` | #27 Databasansvarig | inga |

En blind kritik hämtad från #27, grundad i dossiersektion §27 + världsmodellen.
**VERDICT: SUPPORT WITH CONDITIONS**, fem villkor. Alla fem är bindande
acceptanskriterier nedan. Ingen av dem är avfärdad.

## Vad biljetten kräver

BIN-727:s omskopning 2026-08-06, villkor 4, ordagrant:

> `communityRatings`: dedup-kontrollen får aldrig hamna utanför transaktionen som
> räknar upp. Ett test ska tvinga fram en samtidig omkörning och visa att inget
> dubbelräknas.

Fem av sex villkor är avklarade av steg 1 (`79d108d`) och steg 2 (`9fa182c`). Det
här är det sista.

## Utgångsläget i koden

`functions/src/communityRatings/index.ts` (83 rader) är en `onDocumentWritten`-
trigger på `users/{uid}/watchlist/{tmdbId}`. Dedup-kontrollen ligger **redan** inne
i transaktionen — invarianten håller idag. Det som saknas är beviset.

Två saker som ingen test rör alls idag (`logic.test.ts` testar bara `ratingDelta`
och `isNoOp`):

1. **Röstförfalskningsinvarianten** (`index.ts:34–60`): aggregatets doc-id härleds
   ur watchlist-dokumentets **sökväg**, aldrig ur dess kropp. Firestore garanterar
   ett dokument per sökväg, alltså högst ett betyg per konto och titel. Läses
   tmdbId ur kroppen kan en användare skapa N dokument som alla räknar upp samma
   aggregat. #27 kallar den här **allvarligare** än samtidighetsfallet.
2. **Legacy-grenen** för o-namngivna numeriska doc-id:n. Kommentaren kallar den
   "defense-in-depth"; #27:s dom är att den ska **testas, inte raderas** — otestad
   defense-in-depth är den kod ingen märker är trasig förrän dagen den behövs.

## Verifierat före bygget

- **Ingen annan skrivare** av `titleRatingsAggregate` finns i `functions/` eller
  `scripts/`. Reglerna ger `read: true, write: false` — bara Admin-SDK:n skriver.
  Det är förutsättningen för villkor 1 nedan.
- **`retry` är opt-in** i firebase-functions v2 (`options.d.ts:190`, "Whether failed
  executions should be delivered again") och sätts ingenstans i `functions/`. Alltså
  ger ett kastat fel **ingen** omleverans idag. Det ändrar villkor 5:s fråga från
  "kasta eller svälja" till "slå på `retry: true` eller inte" — se nedan.

## Acceptanskriterier (bindande, från #27)

1. **Inga ogenomskinliga värden korsar portgränsen.** `increment()` och
   `serverTimestamp()` tas INTE in i porten. `count`/`sum` räknas som vanliga tal ur
   transaktionens egen läsning; varje portimplementation stämplar `updatedAt` själv,
   precis som `writeReleaseMarker`/`writeAvailableState` gör. Motivering skrivs i
   portens doc-kommentar: läsningen finns redan för `lastEventId`, så transaktionens
   OCC garanterar redan det som `FieldValue.increment` annars köpte — och vad som
   skulle göra det osäkert (att läsningen tas bort, eller att en andra skrivare
   utanför transaktionen tillkommer) namnges där.
2. **Kapplöpningstestet, samma `event.id`:** slutligt `{count, sum}` = exakt EN
   tillämpning av deltat, `lastEventId === event.id`, OCH
   transaktionsåterkallelsen kördes **mer än två gånger totalt** över de två
   leveranserna — annars bevisar testet bara att siffrorna råkade bli rätt, inte att
   Firestores konfliktväg gjorde jobbet.
3. **Kontrastfallet, två OLIKA `event.id`:** samma titel, samma ögonblick, **båda**
   deltana ska landa. Utan det kan villkor 2 inte skilja äkta dedup från en
   implementation som tappar skrivningar under all samtidighet — dataförlust som ser
   ut som ett grönt test.
4. **Icke-samtidig täckning:** sekventiell omleverans hoppas över; no-op-vakten ger
   **noll** anrop till `runTransaction` (mätt på anropsräkning, inte på ett saknat
   dokument); och doc-id-härledningen prövas för BÅDA grenarna — namngiven och
   legacy-numerisk — inklusive att en förfalskad `mediaType`/`tmdbId` i kroppen inte
   flyttar en annan titels aggregat.
5. **Den svalda transaktionsfel-vägen avgörs skriftligt**, inte underförstått.

## Villkor 5 — vad jag gör, och vad som går till Malin

Bygget ändrar **ingenting** i felhanteringen. Men #27:s premiss stämmer inte helt:
plattformens omleverans "fires" inte idag oavsett, eftersom `retry` inte är påslaget.
Så valet är inte "kasta eller svälja" utan "slå på `retry: true` eller inte", och det
är en riktig kostnads- och beteendefråga på en trigger som fyrar på **varje**
watchlist-skrivning.

Konsekvensen av dagens beteende, exakt och utan försköning: ett svalt fel betyder att
just det betyget **permanent** saknas i aggregatet. Det självläker inte — en senare
ändring 4→5 ger `countDelta: 0`, så antalet ligger kvar en för lågt för alltid.
Effekten är ett något felaktigt snitt på en titel, och felet syns som `logger.error`.

Det skrivs i kodkommentaren med den siffran, och frågan om `retry: true` filas som
egen biljett med egen panel. Den byggs inte här: att slå på omleverans för en trigger
som fyrar på varje watchlist-skrivning är en kostnadsändring mot 25 kr/mån-taket, och
den hör inte hemma i en testbarhetsbiljett. **Malin får frågan i klartext.**

## Filer

`functions/src/communityRatings/index.ts` (blir port), ny
`functions/src/communityRatings/runAggregate.ts`, ny
`src/test/rules/community-ratings-orchestrator.test.ts`, samt
`docs/role-responsibilities.md` + `docs/org/ownership-map.json` för den nya
testfilens ägare — **utan backticks runt katalogen**, som steg 2 lärde oss.

## Öppna frågor

En, och den blockerar inte bygget: ska `retry: true` slås på för
`communityRatingMaintain`? Ställs till Malin efter bygget, med kostnaden namngiven.
Allt annat är avgjort av #27:s kritik.
