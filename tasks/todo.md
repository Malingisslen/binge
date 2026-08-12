# Plan 2026-08-12 — BIN-856: MOTN svarar 400 på varje anrop

## Problemet (bevisat, inte antaget)

`functions/src/streamingOffers/motn.ts` byggde varje förfrågan som
`/shows/{mediaType}/{tmdbId}?country=se&output_language=sv`. Leverantören avvisar det sista
värdet:

```
HTTP 400
{"message":"parameter \"output_language\" has an invalid value: sv"}
```

Nio anrop per dygn, varje dygn sedan minst 2026-07-11, noll lyckade. Samma nio tv-id:n varje
dag — urvalet rör sig aldrig eftersom `checkedAt` bara skrivs efter ett lyckat svar.

Verifierat live mot den skarpa nyckeln 2026-08-11: samma URL **utan** parametern ger HTTP 200
för **alla nio** id:n som legat och failat. Alltså inte en utgången nyckel och inte ett ändrat
gränssnitt — ett felformat anrop.

Ingenting nedströms läste någonsin lokaliserad text: `parse.ts` konsumerar bara
`streamingOptions.se` (service-id, type, link, price, expiresOn).

## Router

`node docs/org/route.mjs functions/src/streamingOffers/motn.ts …` → `tier: "medium"`,
`panel: [13]`, inga high-stakes. En blind kritik från #13 Data / Integrations Engineer kördes
före bygget. Utfall: **approve-with-conditions**, två bindande villkor (se nedan).

## Vad som byggs

1. **Ny admin-fri `motnRequest.ts`** — `offersUrl()` (bara `country=se`) och `classifyStatus()`.
   Egen modul så testerna kan importera den utan `firebase-functions/v2`, som inte går att
   resolva under rot-CI:ns vitest-toolchain. Samma precedens som `leavingRollup/config.ts`.
2. **`motnRequest.test.ts`** — query-strängen nagelfäst som **allowlist**, inte bara
   "output_language saknas", plus en svepande egenskapstest över hela 400-499.
3. **`classifyStatus` + `REQUEST_REJECTED`** *(villkor 1 från roll #13)* — en 4xx som inte är
   404/429 betyder att **vi** formulerade fel; det upprepas identiskt för varje återstående
   titel. Körningen stoppas på första förekomsten i stället för att bränna en kvotplats per
   titel. Det var mekanismen bakom 198 av 300 förbrukade månadsanrop.
4. **Leverantörens feltext loggas** — med nyckeln maskerad **före** trunkering *(blockerande
   fynd från säkerhetsgranskningen, runda 1)*. Samma tillägg i `leavingRollup/motnChanges.ts`,
   som hade exakt samma blindhet *(integrationsgranskningen, valfritt fynd 1)*.
5. **`isIntentTitle` avvisar ett oläsbart `tmdbId`** *(blockerande fynd från säkerhets-
   granskningen, runda 2)* — spegling av den guard `readExisting` redan har. Utan den plockas
   en post med ogiltigt id varje körning för alltid (den kan aldrig lämna tier 0 eftersom
   `readExisting` hoppar över den), och kostar ett kvotanrop varje gång. Guarden sitter i
   `logic.ts` och inte på anropsstället i `readWorkSet` just för att `logic.test.ts` ska kunna
   nagelfästa den — `index.ts` importerar firebase-admin och går inte att enhetstesta.
   Mutationstestad: tas raden bort faller två tester.

## Del 2 (2026-08-12) — Malin valde B

Hon läste förslaget och svarade **B**: en enda `status` som visar det sämsta av kapacitet och
faktiskt utfall. Handbromsen nedan är därmed lyft. Router på de nya filerna: `tier: "medium"`,
`panel: [13]`, oförändrat.

### Vad som byggs

1. **`classifyRunOutcome(attempted, sawClean, sawRateLimited)`** i `logic.ts` — `'delivered'` |
   `'no-delivery'` | `'inconclusive'`. Poängen är att skilja "vi gjorde inga anrop" från "vi
   gjorde nio anrop och alla misslyckades"; dagens `no_signal` buntar ihop dem, och det andra
   fallet är exakt det som pågick i en månad.
2. **Räknare + trösklar** — `nextRunsWithoutSuccess` nollställs bara av `'delivered'`;
   `'inconclusive'` varken höjer eller nollställer. 2 körningar i rad → `warn`, 4 → `critical`
   (jobbet kör dagligen, så det ger utrymme för ett enstaka nätfel).
3. **`worstStatus(kapacitet, flöde)`** blir `status`. Kapacitetsberäkningen är ORÖRD.
4. **Nya fält på hälsodokumentet:** `capacityStatus`, `feedStatus`, `runsWithoutSuccess`,
   `lastSuccessAt`, `lastFailureReason` — så "varför är den röd" går att svara på.
5. **Två skilda larm.** Det befintliga larmet handlar om gratistaket ("Överväg MOTN Pro") och
   får INTE avfyras för ett trasigt flöde — det vore fel råd. Kapacitetslarmet kopplas till
   `capacityStatus`, ett nytt flödeslarm till `feedStatus`.

### Fällor som är kända i förväg

- `index.ts` skriver hälsodokumentet med `.set({ ...health, lastRunAt })` **utan merge**, så
  räknaren måste ingå i payloaden eller nollas varje körning.
- 429 får inte driva flödesräknaren — kvotslut är ett normalt tillstånd med eget larm.
- `prev?.capacityStatus` är `undefined` på första körningen efter deploy; det får inte
  avfyra ett falskt larm.

## Ursprunglig parkering (lyft 2026-08-12, se ovan)

**Villkor 2 från roll #13, och medelfyndet i säkerhetsrundan:** `streamingHealth` står kvar på
`"ok"` efter en månad utan ett enda lyckat anrop, eftersom `computeHealth` bara är en funktion
av bibliotekets storlek och konstanten `PER_RUN_SELECT` — den ser aldrig utfallet. Samma hål
gör att en återkallad nyckel (401/403) skulle stoppa flödet helt utan larm.

Malin har uttryckligen bett att **få se förslaget innan den delen ändras**. Förslaget ligger i
`C:/Users/malla/claude-reports/binge/2026-08-11-streaminghealth-forslag.html` (alternativ A/B/C,
B rekommenderas).

**Handbromsens exakta omfattning:** `computeHealth`, `WARN_DAYS`/`CRITICAL_DAYS`, `HealthDoc`
och skrivningen till `streamingHealth/current` rörs INTE förrän hon svarat. Den här commiten
ändrar `logic.ts` på ett enda annat ställe — `isIntentTitle`-guarden i punkt 5 ovan — som inte
har med hälsologiken att göra. Formuleringen är avsiktligt filspecifik i stället för "logic.ts
rörs inte": den som granskar om Malins parkerade beslut respekterats ska kunna se skillnad på
ordvalsglidning och ett brutet löfte.

Not till den som bygger det sedan: `index.ts` skriver hälsodokumentet med `.set({ ...health,
lastRunAt })` **utan merge**, så en persisterad räknare måste ingå i den payloaden eller nollas
varje körning. `attempted` inkrementeras före `fetchOffers`, så BIN-856-händelsen själv ger
`attempted=1, written=0` — villkoret "attempted>0 && written===0" håller på exakt den körning
som motiverade det.

## Medvetet utelämnat

- **Extrahera `redactVendorBody()` till `functions/src/util/`** (föreslaget av både integrations-
  och testgranskaren). Bra idé, men det tar bygget till en sjätte produktionsfil för ren
  polering av ett uttryck som redan är granskat på båda ställena. **Filad som BIN-857** — inte
  bara som en rad i den här planen, som enligt `code-style.md` ska raderas när den är
  implementerad.
- **`motnChanges.ts` får ingen egen `rejected`-gren.** Den returnerar redan direkt vid varje
  icke-ok svar, så kvotläckaget finns strukturellt inte där: ett ihållande 400 kostar ett anrop
  per 96 h, inte nio per dygn.

## Acceptanskriterier

### Del 1 — MOTN-anropet (commit `d3505f8`, deployad 2026-08-11T22:55Z)

- [x] `npx tsc --noEmit -p functions/tsconfig.json` exit 0
- [x] Hela vitest-sviten grön, och `motnRequest.test.ts` syns i en ofiltrerad körning
- [x] Mutationstestat: en mutant som återinför en uppräknad 4xx-lista dödas
- [x] Alla tre grindgranskarna pass (säkerhet, test, integration) — fyra rundor
- [x] **`firebase deploy --only functions:streamingOffersRefresh,functions:leavingRollup`** —
      `deploy.yml` shippar BARA hosting, så en fix som landar på main och stannar där ser
      exakt likadan ut som en shippad. Det här steget är inte valfritt.
- [ ] **Bevis: ett HTTP 200 från MOTN i den skarpa loggen för binge-nu** — inte ett grönt test.
      Manuell körning gick inte: 20h-spärren stoppade den och en backdatering av
      `streamingHealth/current.lastRunAt` nekades av behörighetskontrollen. **Väntar på den
      schemalagda körningen 2026-08-12T19:29Z.** ENDA kvarvarande punkten i del 1.

### Del 2 — hälsomätaren (Malins B-svar 2026-08-12)

Kriteriet "`streamingHealth`s LOGIK orörd" fanns här och är **struket** — det beskrev
handbromsen som hennes B-svar lyfte. Att lämna kvar det hade gjort planbeviset till en
osann checklista, vilket är precis det BIN-472 handlade om. Ersatt av:

- [x] Kapacitetsberäkningen bit-för-bit orörd (samma `refreshIntervalDays`-stege, samma
      31/62-trösklar); `status` = `worstStatus(kapacitet, flöde)`
- [x] Mutationstestat: alla fem — 429-som-haveri, tomt-som-haveri, streak-nollning på
      `inconclusive`, båda tröskelgränserna, och `worstStatus` som returnerar den MILDARE
      (vilket skulle återinföra exakt buggen) — dödas var för sig
- [x] Kvotslut driver INTE flödesräknaren; ett 404 räknas som levererat
- [x] Två skilda larm — ett trasigt flöde kan aldrig avfyra "överväg betalplan"
- [ ] Deploy av del 2
