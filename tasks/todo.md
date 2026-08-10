# Plan 2026-08-09b — BIN-817 + BIN-814

Två oberoende ändringar, två commits. Båda har gått genom rollpanel/kritik före planen
(router kördes på faktiska filer, se nedan). Malins beslut: 817 → väg A via panel;
814 → alternativ (a) bred definition + laga rådgivarhaken nu, med ett nytt fält.

---

## BIN-817 — hasha profil-signaturen (commit 1)

**Router:** `node docs/org/route.mjs src/lib/firebase/publicProfile.ts src/app/integritet/page.tsx`
→ `tier: medium`, panel [4]. Malin begärde panel → 5 stolar: #4 Security Architect,
#5 Legal/GDPR Counsel, #6 DPO, #27 DBA + Codebase Archaeologist (blindspot).
Utfall: **enhälligt approve-with-conditions, väg A (hasha)**. Inga blockeringar.
Bortvalda: #18 Community Manager (stake är lokal lagring, inte community-yta).

### Vad som byggs
`src/lib/firebase/publicProfile.ts:86` `cardSignature()` returnerar idag
`JSON.stringify([displayName, username, photoURL, bio, isPublic])`, som skrivs i klartext
till `binge:pubprofile-sig:{uid}`. Den ska returnera en hash i stället.

1. **Synkron, icke-kryptografisk hash** (FNV-1a → base36). INTE `crypto.subtle`:
   - `syncMyPublicProfile` bailar synkront på rad 105 *före* `await fsdb()`; en async hash
     drar in en await i den billiga vägen (#27, Arkeologen).
   - `publicProfile.test.ts` stubbar `window` utan `crypto.subtle` (Arkeologen).
   - Ingen säkerhetsgräns: värsta kollisionsfall är en utebliven kosmetisk no-op-write,
     vilket filens egen kommentar redan accepterar (#4, #6 säger uttryckligen "no
     crypto-grade requirement", #27 "small inline sync string hash").
2. **Exakt samma fältuppsättning och ordning** som idag. `createdAt` ingår INTE (Arkeologen:
   avsiktligt uteslutet, får inte smygas in).
3. **Utdatakodning får aldrig börja med `[`** — det är hur gammalt format känns igen.
4. **Legacy-jämförare, inte tvångsomskrivning.** Nuvarande JSON-logik behålls verbatim som
   `legacySignature()` (döps om, skrivs inte om från minnet — Arkeologen). Läsordning:
   lagrat värde matchar ny hash → returnera; matchar `legacySignature()` → **ingen
   Firestore-write**, men uppgradera nyckeln till hashformatet; annars skriv.
   Detta uppfyller biljettens acceptanskriterium "utan att orsaka en onödig omskrivning för
   varje befintlig användare". (#4 och #27 accepterade en engångs-write per användare som
   alternativ; jämföraren är fem rader och slipper den helt.)
5. **Rensa nyckeln vid kontoradering.** Ny export `clearPublicProfileSignature(uid)` i
   publicProfile.ts (nyckelnamnet bor på ett ställe). Anropas i `AuthContext.deleteAccount`
   **efter** `await deleteUser(currentUser)`, bredvid `clearFirestorePersistence()` —
   aldrig före point-of-no-return (Arkeologen; ordningen är återuppbyggd efter en verklig
   incident 2026-08-05). Try/catch enligt husets private-mode-mönster.
6. **INTE vid utloggning.** Nyckeln är uid-namnrymdad → ingen korsanvändarläcka, och när
   värdet är en hash finns ingen persondata kvar att rensa. (#4 ville ha det, Arkeologen
   avrådde, #27 kallade det en petitess. Avgjort: hashningen tar bort själva skälet.)
7. **Uppdatera den nu felaktiga kommentaren** publicProfile.ts:141-143 — den säger att
   raderingskaskaden räcker, vilket bara gäller Firestore-doc:et.
8. **`docs/data-retention-policy.md`:** en rad som namnger nyckeln och dess radering (#6 —
   dokumentet har idag inga localStorage-poster alls).
9. **Ingen ändring i integritetspolicyn §8**, och `§8`:s "listan är inte uttömmande"-brasklapp
   ska stå kvar orörd (#5 — den är det som gör en lucka till ett förbiseende och inte en
   felaktig utsaga).

### Acceptans (bindande)
- [ ] `binge:pubprofile-sig:{uid}` innehåller inget läsbart namn, användarnamn, bild-URL eller bio.
- [ ] Oförändrad profil → noll Firestore-writes. Ändrad profil → exakt en.
- [ ] Nyckel i gammalt JSON-format med oförändrade fält → **ingen** write, men nyckeln
      uppgraderas till hash.
- [ ] Nyckel i gammalt format med ändrat fält → en write, ny hash lagras.
- [ ] `deleteAccount` tar bort nyckeln, men **bara** på lyckad väg — inte när
      freshness-porten eller nätet kastar.
- [ ] Hashen är deterministisk för identisk indata (inga Date/locale-beroenden).

### Uppföljning (egen biljett, byggs inte här)
De fem övriga oredovisade localStorage-nycklarna. #5 och #4 är eniga om att
`binge:groupInvite:{groupId}` (levande inbjudningstoken) och `binge-session-pid-*` är en
**säkerhetsfråga, inte en policytext-fråga**, och inte får buntas in i ett copy-ärende.
ADR: #5:s tolkningsfråga (räknas en icke-reversibel hash av persondata fortfarande som
persondata som måste redovisas i §8?) skrivs som daterad intern position, inte som fastslagen
rätt.

---

## BIN-814 — en definition för providers + laga rådgivarhaken (commit 2)

**Router:** `node docs/org/route.mjs src/lib/taste/backfill.ts src/lib/tmdb/seProviderIds.ts`
→ `tier: medium`, panel [28]. Kritik från #28 Recommendations/Scoring-Integrity: inhämtad,
**approve-with-conditions**. Planen nedan bär dess villkor.

**Malins beslut:** (a) bred definition vinner + laga hyr-haken nu + spara båda svaren
(nytt fält), inte extra TMDB-anrop.

### Varför ett fält inte räcker (verifierat, inte antaget)
#28 flaggade att rådgivaren redan filtrerar ankare på `getProvider(pid).type === 'flatrate'`
och bad om verifiering av Amazon-sömmen mot skarp data. Jag körde fyra titlar mot TMDB SE:
- **Amazon: sömmen är stängd.** `119 Amazon Prime Video` ligger under `flatrate`,
  `10 Amazon Video` under `rent`/`buy`. Skilda id:n.
- **Viaplay: sömmen är ÖPPEN och bekräftad.** `76 Viaplay` returneras under `rent` och `buy`
  på alla fyra titlarna — och 76 är typad `flatrate` i `SWEDISH_PROVIDERS`. Samma sak gäller
  `489/1944 TV4 Play`. En flat `number[]` kan därför aldrig skilja "ingår" från "går att hyra",
  och alternativ (a) ensamt gör den bristen konsekvent i stället för nyckfull.

### Vad som byggs
1. **`firestore.rules`** — lägg `subscriptionProviders` i `isValidWatchlistItem`s `hasOnly`,
   med samma EN-VÄGS-SPÄRR-varning som `tmdbFieldsRefreshedAt` (ADR 0009): ta aldrig bort
   posten medan en prod-doc bär fältet — rulla tillbaka klientskrivaren först.
   **Deployas FÖRE klienten.** Merge-writes utvärderas mot hela post-merge-doc:et, så en
   klient som skriver fältet mot gamla regler får permission-denied på varje watchlist-write.
2. **`src/lib/tmdb/seProviderIds.ts`** — andra hjälparen `seSubscriptionProviderIdsForRefresh`
   (flatrate + free + ads) bredvid den befintliga breda, med **samma undefined-kontrakt**:
   saknat SE-block → `undefined` ("lärde mig ingenting"), närvarande men tomt → `[]`.
   Skriv om filens "får inte slås ihop"-kommentar: frågan är avgjord, de är nu två
   avsiktliga svar på två olika frågor, inte en olöst dubblett.
3. **`src/lib/tmdb/providers.ts`** — `extractSEProviders` utgår. Den var den smala
   definitionen med fel tomvärde (`[]` vid saknat block = klobbrar en bra array). Enda
   produktionsanropet är backfillen. Testerna flyttas till seProviderIds-syskonet.
4. **`src/lib/taste/backfill.ts` + `backfill.helpers.ts`** — backfillen skriver båda fälten
   från samma TMDB-svar, med undefined-kontraktet: returnerar hjälparen `undefined` skrivs
   fältet **inte** (idag skulle den skriva `[]` och radera en bra array).
   `providersCheckedAt` stämplas **ändå** (#28:s uttryckliga rekommendation: punkt 2 skyddar
   redan arrayen, och att inte stämpla bränner bara TMDB-budget på titlar vars saknade
   SE-block sällan ändras).
5. **`src/lib/watchlist/tmdbFieldsRefresh.ts` + `WatchlistContext.tsx` + titelsidorna** —
   samma två fält i providers-gruppen, samma stämpel, samma färskhetsgrind.
6. **`src/types/domain.ts`** — `subscriptionProviders: number[] | null`.
7. **`src/hooks/useSubscriptionAdvisor.ts`** — filmankare läser
   `subscriptionProviders ?? providers`. Fallbacken är avsiktlig: en doc som ännu inte
   backfillats beter sig som idag (för generöst) i stället för att tappa ankaret helt och
   föreslå paus på fel grund under utrullningen.
8. **ProviderChips/visning rör inte** — den ska fortsätta visa den breda listan.

### Acceptans (bindande — #28:s villkor inbakade)
- [ ] Regression: en `vill_se`-film med `subscriptionProviders` som **inte** innehåller en
      abonnerad tjänst sätter **inte** `hasWillSeeAnchor` för den tjänsten, även om
      `providers` gör det. (Detta är #28:s must-have, pinnad mot Viaplay-fallet.)
- [ ] Backfill och titelsida producerar identiska `providers` för samma TMDB-svar.
- [ ] Saknat SE-block → varken `providers` eller `subscriptionProviders` skrivs; en bra
      befintlig array överlever.
- [ ] Saknat SE-block → `providersCheckedAt` stämplas ändå.
- [ ] Doc utan `subscriptionProviders` → rådgivaren faller tillbaka på `providers`.
- [ ] `npm run test:rules` grön med det nya fältet i hasOnly.

### Vad integrationsgranskningen hittade — och vad som gjordes

Första bygget var **inte** komplett. Fyra av sex blockerande fynd var äkta och tre av dem
var regressioner jag själv införde. Alla lagade före commit:

1. **Fixen träffade inte sitt eget huvudfall.** `addItem` skrev bara `providers` och
   stämplade `providersCheckedAt` — och titelsidans reparation är grindad på just den
   stämpeln, så det nya fältet kunde inte landa på 60 dagar. Att lägga till en hyr-bara-
   film (det vanligaste sättet en titel kommer in) hade alltså lämnat rådgivaren på den
   breda fallbacken. Fältet bärs nu genom `buildAddPayload`, `StatusButton`,
   `QuickAddButton` och `useMarkSeen`.
2. **Tre pengaskärmar blev SÄMRE.** `spendSnapshot`, `householdAggregate` och
   `serviceValue` läser `providers`, och backfillen skriver nu rent/buy dit där den
   förut skrev den smala listan — så en hyrfilm hade börjat räknas som "aktiv utgift"
   och skyddat tjänsten från dödvikts-domen. Regeln bor nu i
   `src/lib/watchlist/subscriptionProviders.ts` och alla fyra ytorna delar den.
3. **ToS-svepet rörde inte det nya fältet.** TMDB-härledd data utan TTL bryter §1.C, och
   ett svep som bara rensade `providers` hade lämnat `providers: []` bredvid en
   månadsgammal abonnemangslista — samma drift som biljetten skulle avsluta.
   `PROVIDERS_GROUP.fields` täcker båda nu. **Kräver manuell functions-deploy.**
4. **Backfillen kunde aldrig konvergera.** Urvalet gick på fält-frånvaro, men ett svar
   utan SE-block skriver inget fält — så titeln hade hämtats om varje körning i
   evighet. Urvalet går nu på stämpeln (`needsBackfill`, utbruten och testad).

Två fynd var inte äkta: en mutant och två röda tester som redan var lagade i arbetsträdet
när granskarna läste — de såg ett träd i rörelse.

**Fjärde rundan hittade den femte ytan.** `pickBacklogResurface` +
`BacklogResurfaceTile` — Hem-brickan som ordagrant säger *"finns nu på din tjänst"* och
sätter etiketten *"finns på Viaplay"* — läste den breda arrayen. Före den här ändringen
skrev backfillen den SMALA listan dit, så brickan hade råkat ha rätt; efter den hade en
hyr-bara-film dykt upp på Hem som "ingår i din tjänst". Det är den enda av alla fynd som
var direkt synligt ljugande för användaren. Lagad, plus `VillSePickerPage`s "kan ses
direkt"-sortering. Samma runda: TV-sidans test mockade `StatusButton` blint precis som
filmsidans gjorde — den mocken registrerar propparna nu på båda sidor.

**Tredje rundan hittade fyra till** — samma defektklass som runda två, i syskonfiler:
`MoviePageClient`s egen `<StatusButton>` (appens vanligaste sätt att lägga till en film)
skickade bara det breda fältet medan TV-tvillingen skickade båda; backfillens
migrationsgren satte `contentChanged` och hade därmed bumpat `updatedAt` på HELA
biblioteket i första körningen (fyra läsare faller tillbaka på den stämpeln — "Fortsätt
titta"-sorteringen, taste/stats, "din senaste 5★" och `addedAt`-reparationen som
PERSISTERAR värdet); och `spendSnapshot` + `householdAggregate` hade ingen enda test som
band det nya beteendet — att backa dem till den breda arrayen var grönt.

Två strukturella åtgärder togs så klassen inte kan återkomma: provider-listorna härleds
nu **en gång** på filmsidan och delas av alla skrivvägar (som TV-sidan redan gjorde), och
`shouldStampProvidersAtAdd` kräver **paret** — en add som bara bär det breda fältet
stämplar inte alls, vilket gör utelämnandet självläkande i stället för att göra varje
anropsställe ansvarigt för att minnas. Filmsidans knapp mockades dessutom till `() => null`
i testet, vilket är exakt varför proppen kunde försvinna obemärkt; mocken registrerar
propparna nu.

**Andra granskningsrundan hittade ett femte:** `useMarkSeen` tog emot
`subscriptionProviders` i sin input-typ men skickade det aldrig vidare till
`buildAddPayload` — sämre än att inte ta emot det alls, eftersom anroparen tror att
fältet landade. Min egen tidigare ändring hade inte applicerats och jag såg det inte i
grep-utdatat. Lagat i båda grenarna (film + serie) och pinnat med tre tester; mutanten
som återinför tappet dödar två av dem. Ingen påstådd täckning i den här filen är kvar
oprövad.

### Deployordning (ej förhandlingsbar — FYRA steg, inte tre)
1. `firebase deploy --only firestore:rules`
   Måste ligga före klienten. `hasOnly`-posten är en envägsspärr: när en prod-doc väl bär
   fältet faller varje efterföljande merge-write utan den, även en orelaterad betygsättning.
2. `firebase deploy --only functions:tmdbFieldsSweep`
   **Funktionen heter `tmdbFieldsSweep`** — `tmdbTosSweep` är katalogen (`functions/src/index.ts:274`).
   Ett filter som namnger katalogen matchar ingen funktion och deployar tyst noll, varpå
   svepet fortsätter köra den gamla fältlistan och `subscriptionProviders` skulle sakna TTL
   helt (TMDB ToS §1.C). Detta står här för att jag först skrev fel namn.
3. `git push`
4. `gh workflow run deploy.yml`
   Push ensamt räcker INTE för den här leveransen. `deploy.yml`s spärr avbryter varje
   push-triggad deploy där `firestore.rules` eller `functions/**` ändrats (rad 40–55), så
   hosting skulle aldrig gå ut: koden låg i main medan binge.nu serverade det gamla bygget,
   och deploy-signalen lyste rött utan att något var fel. `workflow_dispatch` hoppar över
   spärren.

---

### Medvetet INTE gjort — en egen biljett
`functions/src/streamingOffers/logic.ts` grindar MOTN-arbetsmängden på
`providers.length > 0`. Nu när `providers` bär rent/buy växer den mängden (nästan allt
går att hyra), och budgeten är hårda 300 anrop per faktureringscykel med 9 per körning.
Effekten är inte högre kostnad utan ett längre full-refresh-intervall. Att smalna av
grinden till abonnemangsdelmängden skulle samtidigt ta bort erbjudanden från hyr/köp-
raderna på titelsidorna, så det är ett produktval — inte en självklar fix. Samma familj,
och biljetten ska ta alla tre i ETT beslut: `functions/src/insights/rollup.ts` räknar nu
in hyr/köp i `topProviders`, och det gör `src/app/stats/page.tsx:40` också (både staplarna
och "N av M med streamingdata"-raden). Ingen av de tre påstår något om abonnemang, så
ingen av dem ljuger — men de svarar nu på en bredare fråga än förut.

Två mindre saker som granskningen namngav och som medvetet lämnas: samma prick-komponent
betyder nu "ingår i abonnemanget" på `/my/vill-se` och "finns att få tag på" på de andra
biblioteksflikarna (varje sida har en egen ärlig bildtext, men en användare som växlar
flik ser samma prick betyda två saker), och 60-dagarsfönstret finns som två skilda
konstanter med samma värde i `backfill.helpers.ts` och `tmdbFieldsRefresh.ts` — prosan i
båda filerna argumenterar numera utifrån att de är lika.

## Kvarstående för Malin
Inget blockerande. Två uppföljningsbiljetter skapas efter commit:
de fem övriga localStorage-nycklarna (säkerhet, inte policytext) och ADR:n för #5:s
tolkningsfråga.
