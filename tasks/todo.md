# Plan 2026-08-10 — BIN-844 + BIN-845

Två uppföljningar på gårdagens leverans. Malin bad om dem "i en ny sprint"; de går inte att
sprinta — BIN-844 routar `top` (full panel, rör grupper + auth) och en obemannad sprint får
inte röra den, och båda biljetterna var skrivna som frågor. Hon är närvarande, så panelen
konvenerades här och besluten togs live.

---

## Panelen (BIN-844, tier `top`)

`node docs/org/route.mjs src/lib/groupInviteCache.ts src/lib/firebase/groups.ts
src/hooks/useSession.ts src/lib/firebase/messaging.ts src/contexts/AuthContext.tsx`
→ `tier: top`, high-stakes på `groups.ts` + `AuthContext.tsx`, panel `[27, 5, 4, 6, 18]`.

Fyra roller seatade + Codebase Archaeologist: **#4 Säkerhetsarkitekt, #5 Juridik/GDPR,
#6 DPO, #18 Community Manager**. Bortvald: **#27 DBA** — ändringen rör enhetslokal lagring,
ingen Firestore-struktur, inget datalager. Ingen blockering; fyra approve-with-conditions.

### Vad panelen ändrade i biljetten

**1. Biljettens premiss höll inte.** BIN-844 antog att `binge:groupInvite:{groupId}`
överlever en kontoradering som en levande nyckel. Den gör inte det: bara en grupps ÄGARE
cachar klartexten, och raderingskaskaden raderar hela den ägda gruppen — token pekar på
något som inte finns. Den verkliga exponeringen är **utloggning på delad dator**.

**2. Och den verkliga läckan var en annan.** DPO och Arkeologen fann oberoende att
`disablePushForUser` bara anropas från reglaget i inställningarna. Utloggning avregistrerar
INTE push. Loggar du ut på en delad dator fortsätter dina notiser komma dit — med innehåll.
Malins ursprungliga val ("rensa inbjudningslänken + push-token") hade tagit bort en
*pekare* till token-doc:et utan att stoppa en enda notis. Etiketten lovade något koden inte
kunde leverera; det lades tillbaka till henne.

**3. En äkta konflikt, eskalerad.** #4 ville rensa inbjudningslänken vid utloggning
(devtools når klartexten oavsett vad UI:t visar). #18 och Arkeologen visade kostnaden:
panelen är ägargrindad, så nästa inloggade person ser den aldrig via appen — men ägaren
förlorar sin egen länk, och enda vägen tillbaka är "Generera ny", som ogiltigförklarar den
länk hen redan skickat till folk som inte klickat än. Interpretativt och användarpåverkande
→ Malins beslut, inte mitt.

### Malins beslut 2026-08-10
- **Push stängs av på riktigt vid utloggning.** Hon tar priset: inget slår på push igen
  automatiskt, så hon måste kryssa i det i Inställningar efter varje inloggning, på varje
  enhet.
- **Inbjudningslänken rensas bara vid radering**, inte vid utloggning.

---

## BIN-844 — vad som byggs

1. **`AuthContext.signOut` anropar `disablePushForUser(uid)` FÖRE `firebaseSignOut`.**
   Två ordningar är bindande och ingen är uppenbar:
   - `auth.currentUser` är null i samma stund `firebaseSignOut` resolvar → uid måste fångas
     synkront först (Arkeologens landmina; `deleteAccount` gör redan rätt, `signOut` inte).
   - `disablePushForUser` RADERAR `users/{uid}/fcmTokens/{id}`. När Auth-användaren är borta
     har klienten ingen token och `firestore.rules` avvisar skrivningen. Det är
     `deleteAccount`s ordningsregel åt andra hållet: där måste den lokala städningen ligga
     EFTER point-of-no-return, här måste den serversidiga ligga FÖRE.
   - Följd som skrivs in i koden: cleanup:en kan därför **inte** ligga i auth-lyssnarens
     `uid→null`-gren där resten av utloggningshygienen bor (BIN-732). En session som tar
     slut via tyst utgång eller återkallelse fortsätter pusha hit. Känd lucka, inte ett
     förbiseende.
   - Best-effort: offline eller nekad skrivning lämnar token registrerad. Blockera aldrig
     utloggningen — en användare som inte kan logga ut är värre än en vars notiser följer med.
2. **`clearAllInviteTokens()`** i `groupInviteCache.ts` — prefix-svep, collect-then-remove
   (en index-loop med `removeItem` inuti hoppar över varannan nyckel; det finns inget annat
   prefix-svep i repot att kopiera, så det här blir referensen). Anropas **bara** från
   `deleteAccount`, efter `deleteUser`.
3. **`clearLocalPushTokenId(uid)`** i `messaging.ts` — bara den dinglande lokala pekaren, för
   raderingsvägen där `disablePushForUser` inte går att använda (kaskaden har redan raderat
   doc:et). Aldrig vid utloggning: den tar bort pekaren utan att avregistrera något, vilket
   är exakt förvirringen den här biljetten fick reda ut.
4. **Lämnas orörda, som beslutat:** `binge-session-pid-*` / `binge-my-sessions`,
   `binge:wasLoggedIn`, `binge:rec-rotation:*`.

### Dokumentation (villkor från #5 och #6, i SAMMA commit)
- `docs/data-retention-policy.md`: flytta `groupInvite` och `fcm:tokenId` ur
  "överlever också raderingen … ännu inte genomgångna" till en beskrivning som matchar vad
  som nu gäller. Namnge de tre kvarlämnade med den faktiska motiveringen. Skriv rakt ut att
  rensning av `fcm:tokenId` är dinglande-pekare-städning, inte ny Art. 17-täckning — den
  serversidiga doc:en tas redan av kaskaden.
- Korsreferens till **ADR 0015** för `binge-session-pid-*`: att den överlever utloggning är
  inte ett nytt beslut utan samma avvägning Malin redan ratificerade mot full panel
  2026-07-16. Ska vara spårbar som en sammanhängande position, inte återupptäckas som en
  öppen fråga.
- **#5:s tolkningsposition om hashning** (öppen sedan BIN-817) skrivs ned daterad: en
  icke-reversibel hash är inte automatiskt anonym data; frågan avgörs per fält av indatans
  entropi, inte av att hashning skett. Hög entropi (uid, genererad token) → inte persondata.
  Låg entropi (visningsnamn, användarnamn, fritext) → fortfarande persondata.
  `binge:pubprofile-sig` hamnar på den senare sidan. Formuleras som arbetsposition, inte
  som fastslagen rätt.
- §8:s "listan är inte uttömmande"-brasklapp rörs INTE. Tre av sex nycklar står kvar utanför
  den itemiserade listan, så den är fortfarande sann och fortfarande bärande.

### Acceptans (bindande)
- [ ] Utloggning avregistrerar push serversidigt, och uid:t fångas före `firebaseSignOut`.
- [ ] En kastande `disablePushForUser` stoppar aldrig utloggningen.
- [ ] Prefix-svepet tar ALLA `binge:groupInvite:*` och inget annat, och överlever ett
      localStorage som kastar.
- [ ] Svepet körs vid radering, och **inte** när freshness-porten eller `deleteUser` kastar.
- [ ] Inget anropar `clearLocalPushTokenId` från utloggningsvägen.
- [ ] Retentionsdokumentet beskriver det som faktiskt gäller efter ändringen.

---

## BIN-845 — vad som byggs

Router: `medium`, panel `[3]`. Kritik från **#3 Financial Controller**: approve-with-conditions.

1. `src/app/stats/page.tsx` och `functions/src/insights/rollup.ts` läser
   abonnemangsdelmängden. Malins val: staplarna ska svara på "vad kan jag se på det jag
   betalar för". Ren fältbyte, noll marginalkostnad (samma dokumentantal, samma schema).
2. **#3:s villkor:** raden "N av M titlar med streamingdata" (`stats/page.tsx`) räknas idag
   på det breda fältet. Smalnar staplarna men inte raden överdriver den hur många titlar som
   är representerade — den måste följa med.
3. `functions/src/streamingOffers/logic.ts` lämnas orörd.

### #3 korrigerade biljettens kostnadsbeskrivning — och den ska rättas
Jag skrev att arbetsmängden "växer" som en kostnad den här biljetten tar på sig. Fel:
`isIntentTitle` ändras inte, så det är **status quo som ratificeras**, ingen marginalkostnad.
Skillnaden spelar roll för hur det loggas senare.

Och en tröskel jag inte kände till: `computeHealth(workSetSize, 9, …)` slår till `warn` över
279 och `critical` över 558, och critical-notisen till admin föreslår ordagrant **MOTN Pro
($39/mån)** — ~15× taket på 25 SEK/mån. Att lämna `isIntentTitle` bred håller mätvärdet
närmare den tröskeln.

**Mätt 2026-08-10, före commit** (`streamingHealth/current` i produktion):
`workSetSize: 24`, `refreshIntervalDays: 3`, `status: ok`. Warn börjar vid 280
(`ceil(280/9) = 32 > 31`), critical vid 559. Vi ligger på 8,6 % av warn-golvet — det
krävs ungefär tolv gångers tillväxt av arbetsmängden för att ens nå varning, och
admin-notisen med MOTN Pro-förslaget avfyras bara vid en statusövergång. Villkoret är
därmed uppfyllt och "lämna `isIntentTitle` bred" är säkert på dagens siffror.

Ursprunglig formulering av villkoret, för spårbarhet: kontrollera nuvarande
`workSetSize` före commit; är den redan nära
279 ska det stå i biljetten, för då kan naturlig biblioteks-tillväxt avfyra uppsäljningen
utan en enda kodändring. Rekommendationen är aldrig sprintens att acceptera.

---

## Vad integrationsgranskningen hittade — fyra blockerande, alla äkta

Första bygget var inte klart. Alla fyra lagade före commit:

1. **Utloggning hade kunnat hänga för alltid, tyst.** `deleteDoc` mot
   `persistentLocalCache` resolvar först på server-ack — offline settlar den aldrig.
   Ett bart `await` hade alltså låst utloggningen, utan spinner och utan felmeddelande
   (båda anropsställena är `void signOut()`), för exakt de användare som HAR push på.
   Att fånga en rejection täcker inte en hängning. Nu `Promise.race` mot 2 sekunder,
   och anropet hoppas helt över när enheten inte har någon token.
2. **Bildtexten överdrev fortfarande.** Varje skrivare som sätter
   `subscriptionProviders` stämplar `providersCheckedAt` i samma payload — så en
   hyr-bara-titel är `[]` MED stämpel, och disjunktionen `|| providersCheckedAt`
   räknade in precis de rader som inte ritar någon stapel. Villkoret som #3 ställde
   hade alltså inverterats till sin motsats. Disjunktionen borttagen; mitt eget test
   pinnade en form produktionen aldrig skriver och är omskrivet.
3. **Din uppgörelse gick inte att hålla.** Kryssrutan läste `pushEnabled`, som är
   KONTO-nivå. Efter en utloggning och ny inloggning hade den visats **ikryssad** över
   en enhet som inte fick något — så "kryssa i det igen" var inte tillgängligt. Rutan
   speglar nu både kontoflaggan och att enheten faktiskt har en token
   (`hasLocalPushToken`).
4. **Det fanns en TREDJE sammanställning.** `taste/stats.ts` (publika profilens
   "Topp-tjänster") låg kvar på det breda fältet, så samma bibliotek hade rapporterat
   olika siffror på /stats och på profilen. Nu samma regel.

Testgranskningen bidrog med två: svep-testet påstod att det pinnade
"nycklar som bara innehåller prefixet" utan att göra det (decoy tillagd), och
`signOutMock` var den enda mocken i filen som aldrig rensades mellan tester.

## Deploy — och en halv landning tills den körs

`deploy.yml` skickar bara hosting. `functions/src/insights/rollup.ts` ändras här, så:

1. `firebase deploy --only functions:rollupInsights`
   Namnet är verifierat mot `functions/src/index.ts:154` — **`rollupInsights`**, inte
   `insightsRollup`. Kontrollen är inte formalia: förra leveransen namngav en katalog i
   stället för en funktion och hade deployat noll funktioner utan att säga till.
2. push
3. `gh workflow run deploy.yml` — spärren avbryter varje push som rör `functions/**`.

Tills steg 1 körts visar `/stats` och den publika profilen abonnemangsdelmängden medan
`/insikter` fortsätter räkna det breda fältet. Ingen larmar på det, men de dagsdaterade
`insights/{YYYY-MM-DD}`-doc:en får ett hack i kurvan som är en definitionsändring, inte
en dataförändring — värt att veta innan någon tolkar den som ett tapp.

## En optimering som togs tillbaka

Integrationsgranskningen föreslog (som valfritt) att även `useFcmToken` skulle grinda
på `hasLocalPushToken`, så att en återvändande användare slipper ladda
messaging-chunken och prenumerera på en kanal som inte kan leverera. Jag byggde det —
och kodgranskningen visade att det införde en riktig bugg: effektens beroenden är
`[uid, pushEnabled, toast]`, och inget av dem ändras när en token dyker upp. På en
ANDRA enhet för ett konto som redan har push på skriver kryssrutan token:en men lämnar
`pushEnabled` på `true` — inget beroende ändras, effekten körs aldrig om, och
förgrundslyssnaren saknas tills sidan laddas om.

Optimeringen är borttagen igen. Att byta en verklig bugg mot en effektivisering ingen
bett om är fel väg. En riktig fix kräver en signal hooken kan prenumerera på (en
token-version som enable/disable räknar upp) — filad, inte improviserad.

## Två nyanser granskningen namngav och som lämnas

- **De tre sammanställningarna matchar på FÄLTET, inte på alias-hopslagning.** Rollupen
  canonicaliserar (Max = 384/1899/1825 blir en rad); `/stats` och den publika profilen
  gör det inte. Skillnaden är äldre än den här biljetten och oförändrad av den, men
  kommentarerna säger "samma regel" — det gäller vilket fält som räknas, inte hur
  alias viks ihop.
- **`NotificationsSection`s egen `disablePushForUser`-anrop har ingen timeout.** Samma
  aldrig-settlar-risk som utloggningen fick en spärr mot: kryssar man av push offline
  blir rutan permanent inaktiverad tills sidan laddas om. Mildare (användaren står
  kvar på sidan och ser att inget händer) och äldre än biljetten — men regeln är
  nedskriven på ett ställe nu och inte på dess tvilling.

## Kvar för Malin
Inget blockerande. En egen biljett skapas för den kända luckan: en session som tar slut via
tyst utgång eller återkallelse (inte ett klick på Logga ut) avregistrerar inte push, eftersom
den städningen kräver en autentiserad skrivning som lyssnargrenen inte kan göra.
