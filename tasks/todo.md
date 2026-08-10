# Plan 2026-08-10b — BIN-848 (omskriven och smalnad)

## Hur biljetten kom hit

Jag filade BIN-848 som "en session som tar slut utan klick på Logga ut avregistrerar inte
push". **Malin invände, och hade rätt.** Att inte avregistrera när en session bara lapsar
är hela poängen med push — stänger man webbläsaren ska notiser fortsätta komma. Två av
mina tre exempel var dessutom samma händelse räknad flera gånger: "en annan flik loggade
ut" och "en flik startar mitt i en utloggning" betyder båda att någon FAKTISKT klickade
Logga ut, och `disablePushForUser` avregistrerar för hela webbläsaren.

Biljetten är omskriven till det som faktiskt återstår.

## Det smala fallet

Verifierat: appen har **ingen** lösenordsändring eller återställning (`updatePassword`,
`sendPasswordResetEmail`, `reauthenticate`, `revokeRefreshTokens` finns ingenstans). En
inloggning kan därför bara återkallas utifrån — i praktiken av Malin i Firebase-konsolen.

`sendPushToUser` grindar bara på profilens `notificationSettings.pushEnabled` och läser
sedan `users/{uid}/fcmTokens/*`. Den frågar aldrig Auth. Så:

- **Konsol-radering** — Auth-användaren borta, all Firestore-data kvar, push fortsätter.
- **Konsol-spärr** — allt kvar, push fortsätter.
- FCM:s självläkning slår inte till: token är fullt giltig på en levande webbläsare.

## Kritik: #27 DBA (router `medium`, panel `[27]`)

**approve-with-conditions.** Villkoren, och vad som görs med dem:

| Villkor | Status |
|---|---|
| Tre hinkar: `notFound` → radera, `disabled` → eget beslut, övriga → skippa | **Ja.** Se nedan om `disabled`. |
| En kastande `getUsers()`-batch = "skippa, radera inte" — aldrig hopblandad med notFound | **Ja**, per batch. |
| ≤100 identifierare per `getUsers()`-anrop | **Ja.** |
| Bygg uid→refs i EN paginerad `collectionGroup('fcmTokens')`-pass, uid via `d.ref.parent.parent.id` | **Ja.** |
| Rör inte `notificationSettings.pushEnabled` | **Ja.** Att radera tokens räcker; `sendPushToUser` no-oppar rent på tom `tokensSnap`. |
| Kör veckovis, inte dagligen | **NEJ — medvetet avsteg, se nedan.** |

### Avstegen, och varför

**Cadence.** #27 vill ha veckovis som `reclaimOrphanFollows`, med argumentet att
konsolåtgärder är sällsynta. Sant — men svepet läggs i `retentionCleanup`, vars egen
dokumenterade uppgift redan ÄR skyddsnätet för "konton raderade via Firebase Console, som
inte kör någon klientkaskad". Alternativet vore en femte schemalagd funktion med egen
deploy, egen post i workflow-kartans universum och eget CI-krav — mer maskineri än svepet
självt. Scanet är `collectionGroup('fcmTokens').select()`, alltså en handfull dokument i
dagsläget och bundet av samma `PAGE_SIZE` som de andra fyra. Kostnaden är brus mot
25 SEK/mån-taket. Om enhetsantalet någon gång gör scanet dyrt är rätt åtgärd att flytta
hela funktionen till en glesare kadens, inte att gömma en veckovis gren inuti en daglig.

**`disabled`-hinken byggs.** #27 vill lämna den till Malin eftersom en spärr kan vara
tillfällig och radering av token tar bort den tysta återhämtningen — personen måste öppna
appen och godkänna notiser igen efter en upplåsning. **Malin namngav "spärrat konto"
uttryckligen som fallet hon vill ha fixat**, så beslutet är redan givet. Kostnaden är
liten och gäller någon hon medvetet spärrat — men den är icke-uppenbar och rapporteras
till henne i klartext.

## Vad som byggs

`functions/src/retentionCleanup/` får ett femte svep:

1. Paginera `collectionGroup('fcmTokens')` med `.select()` (bara ref:en behövs) +
   `orderBy('__name__')` + `PAGE_SIZE`, som de fyra befintliga. Ägar-uid via
   `d.ref.parent.parent.id` — samma härledning `reclaimOrphanFollows` redan använder.
2. Bygg `Map<uid, DocumentReference[]>` under scanet.
3. `getUsers()` mot `Map.keys()` i batchar om ≤100. Svaret är
   `{ users, notFound }` — `disabled` finns i `users` med `disabled: true`, ALDRIG
   härlett ur frånvaro. En kastande batch fångas, loggas och hoppas över.
4. Radera token-doc:en för uid i `notFound` eller med `disabled: true`.
5. `docs/data-retention-policy.md` uppdateras: nytt svep, vad det täcker, och 24-timmars-
   fördröjningen.

## Acceptans (bindande)

- [x] Ett uid som Auth inte känner till → dess tokens raderas.
- [x] Ett uid vars Auth-användare är `disabled` → dess tokens raderas.
- [x] Ett levande, ospärrat uid → tokens rörs **inte**.
- [x] En `getUsers()`-batch som kastar → INGEN radering för den batchen, och de övriga
      batcharna påverkas inte. *(Testgranskaren hade rätt: detta var en
      flerbatch-utsaga som ingen test pinnade. `revokedUidsInBatches` bröts ut med en
      injicerad `lookup`-port och har nu sju egna tester + fyra dödade mutationer.)*
- [x] `notFound` läses ur svarets `notFound`-fält, inte ur "saknas i `users`".
- [x] Batchstorleken överskrider aldrig 100.
- [x] Ett Auth-fel startar aldrig de fyra befintliga svepen — de körs oberoende.
- [x] Andra körningen hittar ingenting (idempotent).

## Granskningsrunda 1 (alla fyra: pass, 0 blockerande)

Fem frivilliga fynd, fyra lagade i runda 2:
1. Retentionsdokumentet svarade **två gånger** på samma fråga — `fcmTokens` stod kvar i
   "öppen lucka, ägs av en framtida reaper" hundra rader ovanför sitt eget svep. Rättat.
2. Kryssrutan hade ljugit igen, via den andra dörren: låser man upp ett spärrat konto är
   `pushEnabled` orört och servern kan inte rensa enhetens lokala pekare, så rutan visas
   ikryssad över en enhet utan registrering. Exakt det BIN-844:s `hasLocalPushToken`
   fanns till för. Nu utskrivet i dokumentet med vad personen måste göra.
3. Körningens egen sammanfattning kunde inte skilja "ingen var återkallad" från "varenda
   `getUsers()`-batch kastade". `skippedAuthBatches` loggas nu.
4. `functions/src/index.ts` beskrev retentionCleanup som två svep. Det är fem.
5. `docs/workflow-map.html`s hygien-flöde säger fortfarande "four targets". **Inte
   lagat här** — kartändringar går aldrig i samma commit som funktionskod (lessons-
   digest 2026-07-10). Egen commit efter denna.

## Deploy

`firebase deploy --only functions:retentionCleanup`. Ingen regeländring, ingen
klientändring — alltså ingen hosting-deploy och ingen `gh workflow run` den här gången.

## Granskningsrunda 2 (alla fyra: pass, 0 blockerande)

Två fynd till, båda lagade — samma felklass som runda 1:s tredje, en gång till:
1. **Loggningen kunde avbryta svepet.** `onBatchError` anropades oskyddat i `catch`-blocket,
   så en logger som själv kastar hade avbrutit alla återstående batchar OCH kastat bort de
   uid tidigare batchar redan hunnit återkalla — tvärtemot vad funktionens egen docstring
   lovade. Nu inkapslad; en nionde mutation (ta bort skyddet) dödar testet.
2. **En total scan-krasch loggade som en ren körning.** Den yttre `.catch` returnerade
   `skippedAuthBatches: 0`, alltså exakt samma sammanfattning som "ingen var återkallad".
   Returnerar nu `-1`.

Testgranskaren rättade också min egen siffra: den fjärde mutationen dödade 3 tester, inte 4.

## Kvar efter denna commit

- Egen kart-commit: `docs/workflow-map.html`s `flow-hygiene` säger fortfarande "four
  targets" och saknar två steg (fcmTokens-scanet + `getUsers()`-uppslaget). Dessutom
  saknar `flow1` BIN-844:s utloggningssteg, som stale-flaggan pekar på.
- `docs/role-responsibilities.md:430` beskriver retentionCleanup som två svep — efter
  denna commit är den TRE svep efter (BIN-329, BIN-464, BIN-848). Inte infört här.

## Efter deployen — verifiera i loggen

Detta är **första gången någon funktion i repot anropar Auths användar-API**
(`insights/api.ts` gör bara `verifyIdToken`, som verifieras offline mot publika nycklar
och inte kräver någon Identity Toolkit-rättighet). Saknar körtidens tjänstekonto
`firebaseauth.users.get` kastar varenda batch, ingenting raderas, och svepet är tyst
verkningslöst.

Läs EN `retentionCleanup done`-rad i Cloud Logging efter första körningen och kräv
**`skippedAuthBatches: 0` OCH `checkedUids > 0`** innan svepet räknas som levande.

Båda leden behövs. Push-grinden hittade att kontrollen annars kan gå igenom tomt:
scanet returnerar tidigt när det inte finns ett enda `fcmTokens`-dokument, alltså före
`getAuth()` och före varje `getUsers()`-anrop — och loggar då `skippedAuthBatches: 0`
utan att ha frågat Auth om någonting. `checkedUids` är antalet uid som faktiskt lades
fram för Auth; är det noll har rättigheten inte prövats.

Vänta inte ett dygn: Cloud Scheduler → `firebase-schedule-retentionCleanup-europe-west1`
→ Force run, sedan `firebase functions:log --only retentionCleanup`.

Är `checkedUids: 0` **och `skippedAuthBatches: 0`** finns ingen enhet med push-token alls
— kryssa i push i Inställningar på en enhet och kör om. (`checkedUids: 0` med `-1` är
i stället att hela scanet dog.)

**Regeln bor inte här.** Den här filen raderas när planen är genomförd, så acceptansbaren
och IAM-remedyn ligger i `docs/analysis/EXTERNAL_ACTIONS.md`s post-deploy-block, där de
gäller varje framtida deploy.

Saknas rättigheten syns det som ett fel per batch (`getUsers batch failed, skipping`,
`auth/insufficient-permission`) och `skippedAuthBatches > 0`. Ingenting raderas — svepet
failar säkert, det gör bara ingenting. Botas med rollen `roles/firebaseauth.viewer` på
funktionens körtidskonto.

- Radera `tasks/todo.md` när efterkontrollen i loggen är gjord — den andra kopian av
  regeln ska inte överleva sitt fönster.

## Deployad och kontrollerad 2026-08-10

`firebase deploy --only functions:retentionCleanup` klar (revision 15). Tvingad körning
via Cloud Scheduler svarade:

`{"checkedUids":0,"skippedAuthBatches":0,...,"revokedPushTokens":0,"deletedRevokedTokens":0}`

Det är **det tomma fallet**, alltså exakt vad `checkedUids` byggdes för att avslöja: det
finns inte ett enda `fcmTokens`-dokument i produktion, så Auth fick aldrig en fråga och
körningen bevisar ingenting om rättigheten.

Rättigheten kontrollerades i stället direkt: körtidskontot är projektets default compute-SA
med `roles/editor`, och den rollen innehåller `firebaseauth.users.get`. Ingen grant behövs.

Kvar att göra en gång, av Malin: kryssa i push på en enhet, kör svepet igen och se att
`checkedUids > 0` med `skippedAuthBatches: 0`. Först då är kedjan prövad end-to-end.
