# Binge incident runbook

Playbooks för när något går fel i produktion. Organiserat per symptom — slå
upp det du ser, inte vad du misstänker.

_Version: 1.0 (2026-04-24)_

---

## 0. Quick triage

1. **Är det nere?** Testa själv: https://binge.nu + incognito.
2. **Hur många drabbas?** Kolla Plausible → idag → visitors/timme. Är det 0?
3. **Vad ser Sentry?** https://sentry.io → binge-nu → last 1h.
4. **Vad säger användaren?** Om rapport via mejl/chat: vilken webbläsare, vilken sida, vad hände?

---

## 1. "Sidan är nere"

### 1a. UptimeRobot-alert

**Symptom:** UptimeRobot mejlade att binge.nu är down.

**Felsök:**

1. Öppna https://binge.nu — laddas den?
2. Öppna https://binge-nu.web.app (Firebase direct) — laddas den?
   - Om **web.app** fungerar men **binge.nu** inte: Cloudflare-problem
   - Om **web.app** failar: Firebase Hosting-problem
3. Kolla https://status.firebase.google.com/ + https://www.cloudflarestatus.com/

### 1b. Cloudflare nere men Firebase upp

- Förbered DNS-failover: byt nameservers temporärt till Firebase direct
  (binge-nu.web.app alias). Kräver registrar-access.
- Eller vänta ut incidenten (oftast minuter, inte timmar)
- Meddela användare via Plausible-banner om det drar ut

### 1c. Firebase Hosting nere

- Extremt sällsynt. Status.firebase.google.com berättar allt.
- Ingen direkt åtgärd — vänta ut det.
- Kolla Firebase Console billing — ifall vi träffat en plan-kvot (bara om
  Blaze, vilket vi inte är på idag)

---

## 2. "Firestore-fel" / data laddas inte

### 2a. Symptom: alla reads failar

Användare ser tomma listor överallt, eller "Kunde inte ladda"-fel.

**Felsök:**

1. Kolla status.firebase.google.com för Firestore i eur3
2. Kolla Firebase Console → Firestore → Usage för spikar eller error-rates
3. Grep Sentry för `query_error` events — ser du ett mönster?

### 2b. `permission-denied` överallt

Troligen firestore.rules-bug. Vi deploy:ar precis rules? Rullback:

```bash
git log --oneline firestore.rules | head -5
git checkout <previous-sha> -- firestore.rules
firebase deploy --only firestore:rules --project binge-nu
```

Sedan: kör rules-testerna i Firebase Console → Rules Playground innan nästa
deploy. Dokumentera vad som gick fel i commit-meddelandet.

### 2c. `resource-exhausted` / rate-limit

Vi överstiger Spark-plan-kvoten:
- 50K reads/dag
- 20K writes/dag

**Immediate:** det återställs vid midnatt UTC. Användare kan fortsätta
browsa (cache:ad data).

**Prevention:**
1. Kolla `src/hooks/useFollow.ts` `useFollowerCount` — vi använder redan
   `getCountFromServer` (1 read). Verifiera att inga andra counters slukar.
2. Överväg att uppgradera till Blaze (billig för vår volym — se
   EXTERNAL_ACTIONS.md §1.2)

---

## 3. "TMDB nere"

### 3a. Symptom: title-sidor blanka

Alla `/movie/:id` + `/tv/:id` visar "Kunde inte ladda".

**Felsök:**

1. Kolla https://status.themoviedb.org/
2. Kör `curl 'https://api.themoviedb.org/3/movie/550?api_key=YOUR_KEY'` —
   svarar den?

### 3b. TMDB rate-limited oss (429)

Vår `tmdbFetch` har redan 1-retry med Retry-After-respekt +
8-concurrent-semaphore. 429 ska vara tillfälligt.

Om det håller i sig:
- Vi har krockat i deras per-key-limit (50 req/sek per API-nyckel)
- Kontrollera Sentry för burst-mönster — någon hook som fan-out:ar för
  aggressivt?
- Worst case: generera en ny TMDB-API-nyckel och rotera via
  `NEXT_PUBLIC_TMDB_API_KEY`

### 3c. Graceful degradation på gång

`useSubscriptionAdvisor` har redan ett `hasError`-state som `src/app/savings/page.tsx`
visar som "Kunde inte räkna på dina tjänster just nu" istället för tom panel (Sprint 3 12.4).

Andra komponenter bör göra liknande — Sentry-grouping `app:*` visar var
error boundaries triggas.

---

## 4. "Spam-våg av rapporter"

### 4a. Symptom: `reports/` väsen fylls på

Plötslig spike i rapport-volymen.

**Immediate:**

1. Firebase Console → Firestore → `reports` → sortera `createdAt desc`
2. Gruppera per `reporterUid` — är det 1 användare som står för > 80%?
   → falsk-flag-spam
3. Gruppera per `targetOwnerUid` — är det 1 target som rapporteras av
   många? → koordinerad attack eller legitimt outrage

### 4b. Falsk-flag-spam (1 reporter, många reports)

1. Gå till användarens profil. Verifiera: riktig användare eller bot-konto?
2. Om bot: delete:a deras konto via Authentication + manuell
   users/{uid}-cascade (använd `collectUserDataSnapshots`-flödet)
3. Lägg till i `reports/` en dismiss-batch för alla deras rapporter
4. **Om återkommande:** implementera hard-rate-limit i `firestore.rules`
   (max 10 rapporter/timme per reporterUid — TODO i Sprint 6)

### 4c. Koordinerad mass-reporting på 1 target

1. Läs innehållet — är det faktiskt problematiskt?
2. Om ja: hantera enligt `docs/moderation.md`
3. Om nej: dismiss alla rapporter, notera orsak i dismissReason

---

## 5. "Användare har försvunnen data"

### 5a. Symptom: "min watchlist är tom, var är allt?"

**Felsök:**

1. Fråga användaren: raderade du kontot? Loggade du in med fel konto?
2. Firebase Console → Authentication → hitta användaren. Finns `uid`?
3. Firestore → `users/{uid}/watchlist/` — är det tomt?

### 5b. Om kontot raderades av misstag

**Om inom 7 dagar OCH vi är på Blaze med PITR aktiverat:**

```bash
# List backup-points (kräver gcloud + Blaze)
gcloud firestore backups list --project=binge-nu

# Restore from a specific timestamp
gcloud firestore import \
  --database="(default)" \
  gs://your-bucket/backups/<timestamp>
```

**Om Spark eller utanför 7-dagars-fönstret:** Vi kan inte återställa.
Tvärtom — `deleteAccount`-cascaden är designad för att vara irreversibel
(GDPR-krav). Beklaga och guidar användaren till att börja om.

### 5c. Om user-doc existerar men watchlist är tom

- Snapshots kan ha failat silent — kolla Sentry för `query_error` kring
  watchlist
- Är `isPublic` satt till true men användaren själv ser inget? Regel-
  konflikt — testa logga in som dem (eller be dem refresh:a)

### 5d. Fastnad halvradering — vilket av tre lägen är det?

ADR 0019 villkor 9 + ADR 0020 villkor 11. Raderingen tömmer Firestore först och
tar Auth-kontot sist, så ett avbrott lämnar tre möjliga tillstånd som ser lika ut
för användaren ("jag tryckte radera och något gick fel"). Skilj dem åt i Firebase
Console, i den här ordningen:

| Läge | Auth-konto | `users/{uid}` | Underkollektioner | Vad som gäller |
|---|---|---|---|---|
| **(a) Orört** | finns | finns | fulla | Ingenting raderades. Be dem försöka igen. |
| **(b) Delvis kaskaderat** | finns | **finns** | vissa tomma | Kaskaden hann en bit. Omförsöket städar resten. |
| **(c) Helt kaskaderat, föräldralöst** | finns | **saknas** | tomma | Datan är borta, identiteten kvar. |

- **(b)** är det läge BIN-876 handlar om och det ADR 0019 villkor 9 inte nämnde:
  profil-dokumentet finns kvar, så sopningen i `retentionCleanup` rör det INTE
  (den letar efter konton *utan* profil). Bara användarens eget omförsök löser
  det. Har de stängt fliken och aldrig kommit tillbaka blir det liggande.
- **(c)** städas automatiskt: `retentionCleanup` raderar Auth-konton utan
  `users/{uid}` som är äldre än 7 dygn, och frigör deras användarnamn i **samma
  körning** (sopningarna kör sekventiellt just därför). Behöver inget
  handpåläggande — bekräfta bara datumet mot `docs/data-retention-policy.md`.
- **Notera att sopningens urval är BREDARE än avbrutna raderingar:** varje
  Auth-konto utan profil-dokument som är äldre än en vecka räknas, inklusive ett
  konto skapat för hand i Firebase Console och aldrig inloggat. Skapar du ett
  support- eller testkonto den vägen — logga in med det inom sju dygn, annars
  försvinner det utan förklaring.
- **Limbo-skärmen kan visas även i läge (a).** Faller kaskaden på sin allra
  första klump är ingenting raderat, men markören ligger nere och användaren ser
  ändå spärrskärmen. Konsolen visar då ett helt orört konto. Det är avsiktligt
  (`.claude/rules/accepted-deviations.md`, 2026-08-13) — vägen ut är samma knapp.
  Här finns inget datum att bekräfta: kontot har kvar sitt profil-dokument, så
  ingen sopning är inplanerad för det.
- Användaren ser i alla tre lägena en spärrskärm i appen med "Slutför
  raderingen". Den är enhetslokal (`localStorage`, nyckel
  `binge:deletionStarted:<uid>`), så på en annan enhet ser de en helt vanlig app
  fram till att sopningen tar kontot.
- Loggraden att leta efter: `retentionCleanup done` →
  `orphanAuthAccounts` / `deletedOrphanAuthAccounts`. **Läs den mot
  `checkedAuthAccounts` och `orphanAuthSkippedProfileBatches`** — `orphanAuthAccounts: 0`
  betyder "inga hittades" bara när `checkedAuthAccounts` är **>0** och
  `orphanAuthSkippedProfileBatches` är **0**. `-1` i någondera betyder att
  sopningen aldrig kördes.
- Står `deletedOrphanAuthAccounts: 0` medan `orphanAuthAccounts` är >0: antingen
  saknas IAM-behörigheten `firebaseauth.users.delete` (se
  `docs/analysis/EXTERNAL_ACTIONS.md`), eller så slog blast-radius-taket till —
  då finns raden `orphan auth sweep exceeded its ceiling` i loggen och INGENTING
  raderades. Taket är avsiktligt: höj det inte utan att först kontrollera varför
  kandidaterna blev så många. Två orsaker är rimliga och den andra är fientlig:
  en trasig fråga (allt läses som föräldralöst), eller att någon medvetet skapat
  en hög profillösa konton för att kila fast sopningen — ett sådant konto kostar
  en enda registrering mot den publika webbnyckeln. Radera dem för hand i
  Console, så går nästa körning igenom. Samma rad finns för användarnamnen
  (`orphan username sweep exceeded its ceiling`).
- **Saknas raden `retentionCleanup done` helt** men `retentionCleanup: scheduled
  sweeps done` finns: körningen dog i de två sista sopningarna (de kör sist inom
  300 s-budgeten). De fem första gick igenom — det är just därför den raden
  skrivs separat. Ingen larmar på detta idag (BIN-468 är öppen).

### 5e. "Mitt gamla användarnamn är upptaget av ingen"

Ett handtag kan ha blivit kvar på ett konto som inte finns (BIN-875, fixat
2026-08-13 — men reservationer skapade före dess kan ligga kvar).

**Felsök:**

1. Firestore → `usernames/{handtaget}` → läs fältet `uid`.
2. Firestore → finns `users/{uid}`? Firebase Console → Authentication → finns
   kontot?
3. **Saknas BÅDA** är det en föräldralös reservation. Radera dokumentet
   `usernames/{handtaget}` i Console — handtaget blir omedelbart claim:bart.
4. **Finns någotdera** — rör den inte. Antingen är kontot avstängt (och behåller
   sitt handtag med flit) eller så är det mitt i en radering som användarens eget
   omförsök löser.

Steg 3 sköts numera automatiskt av `retentionCleanup` (loggrad
`orphanUsernames` / `deletedOrphanUsernames`, samma läsregel som ovan). Gör det
för hand bara om någon väntar och sopningen inte hunnit köra.

---

## 6. "Bygget failar i CI"

### 6a. Lint/typecheck fel

Vanligt, fix direkt i PR:n eller lokalt. `.github/workflows/ci.yml`
kräver alla 4 (lint, typecheck, test, build) före merge.

### 6b. Build-fel

- `NODE_OPTIONS=--max-old-space-size=4096` finns redan i deploy.yml — ska
  räcka för vår nuvarande bundle
- Om OOM: kör `npm run analyze` (bundle-analyzer) och prunera stora deps

### 6c. Preview-channel timeout

`preview.yml` använder FirebaseExtended/action-hosting-deploy@v0. Om den
hänger:
- Rerun workflow från GitHub UI
- Om återkommande: kolla Firebase Hosting-kvoterna (Spark har 1 GB/mån
  storage + 360 MB/dag transfer)

### 6d. "took more than 60 seconds" / static export avbryts

Symptom: `Failed to build /{tv,movie,person}/[id]/page: /…/<id> after 3 attempts. Export encountered an error … exiting the build.`

Orsak: byggtids-TMDB-strypning fick en sida att passera Next 60s-tak. Ska inte
längre kunna fälla bygget efter 2026-06 (AbortSignal.timeout i
`src/lib/tmdb/buildFetch.ts`), men om det återkommer:
1. **Kör om** workflowen — oftast en övergående TMDB-strypning.
2. Kontrollera att `.tmdb-cache` faktiskt restoras (steget "Restore TMDB build
   cache" i deploy-loggen — "Cache restored" vs "Cache not found"). Kall cache
   = full refetch = långsam/skör build.
3. Två regimer (efter 2026-06): en **kod-deploy** (push/dispatch) re-hämtar bara
   en budgeterad andel stale titlar (`TMDB_BUILD_REFRESH_BUDGET`, default
   1500/worker) → tidsbunden, 45-min-tak. Den **veckovisa `schedule`-refreshen**
   kör med stor budget → full metadata-refresh (~1.5-2 h) och har därför ett eget
   **175-min-tak** (texten sa länge 150; `deploy.yml`s ternär ger 175). (Tidigare
   delade båda 30 min → schedule-körningen timeout:ade ALLTID; det var själva
   buggen.) Om en schedule-körning ändå röd-timeout:ar: verifiera att
   `timeout-minutes`-uttrycket i deploy.yml gav den 175, inte 45.
4. Höj inte sidantalet (`SEO_*` i `seoCoverage.ts`); sänk aldrig
   `BUILD_FETCH_TIMEOUT_MS` under ~10s (frisk fetch måste hinna klart).
5. **RÖTT bygge med `[selection]` i loggen (BIN-823).** Nytt felläge sedan
   urvals-spärrhaken. Betyder "urvalet blev för tunt", inte "koden är trasig":
   pre-rendren fick färre id:n än täckningsgolvet tillåter och bygget fälls hellre
   än att ersätta ~31 000 sidor med ~150. Felmeddelandet namnger utvägen.
   - **Vanligaste orsaken:** `.tmdb-cache` evakuerad ur actions/cache ⇒ urvalet
     måste härledas om från kallt, under 15-minuters räddningstaket. För `movie`
     och `tv` krävs att TMDB dessutom stryper; **för `person` är det aritmetik,
     inte otur** — mätt härledningstid 2 672 s mot ett tak på 900 s, så en kall
     personhärledning slår ALLTID i taket, lämnar manifestet oskrivet och fäller
     200-id-golvet. Gäller vid varje kall start, inte bara första deployen: även
     en `MANIFEST_VERSION`-bump eller ett korrupt manifest landar här.
     Åtgärd: `gh workflow run deploy.yml -f full_refresh=true` — det ger
     150-minuters härledningstak och 175-minuters steg-tak.
   - **Hinner den inte klart heller: kör den igen.** Ett lyckat delresultat
     sparas — `writeSelectionManifest` skriver till `.tmdb-cache/`, och
     deploy.yml:s "Save TMDB build cache" körs `if: always()`, så manifesten
     bör överleva även en steg-timeout. (Den överlevnaden är resonerad, inte
     observerad — deploy.yml hedgar den själv; bekräfta på nästa riktiga
     hängning innan du förlitar dig på den.)
     **Men vänta dig inte att härledningen hoppas över:** `full_refresh` sätter
     `TMDB_SELECTION_REFRESH`, och det tvingar omhärledning av ALLA tre typerna
     oavsett hur färska manifesten är. Det som sparas gör två OLIKA saker:
     manifesten för de typer som HANN klart låter deras täckningsgolv passera
     nästa gång, och detaljcachen (`.tmdb-cache/movie-*.json`, skriven av
     `fetchForBuild`) gör personens rollist-fas snabbare. Den typ som slog i
     taket har inget manifest alls — `writeSelectionManifest` nås bara när
     härledningen lyckades — så den måste hinna klart för att bygget ska bli
     grönt. Vill du hoppa över härledningen helt: kör en **vanlig** deploy utan
     `full_refresh` — den läser manifesten och gör noll listanrop.
   - **Första deployen efter BIN-823 KAN gå röd, och i så fall är det väntat.**
     Själva push:en till main triggar push-vägen automatiskt — inget
     `TMDB_SELECTION_REFRESH`, 45-minuters steg-tak, 15-minuters räddningstak —
     och den måste härleda alla tre urvalen innan någon hinner dispatcha.
     Om den går röd eller inte hänger på `.tmdb-cache`: restoras den varmt
     (`restore-keys: tmdb-cache-`) serveras personens rollistor från disk och
     härledningen krymper till ~100 listsidor, och bygget kan mycket väl bli
     grönt. Citera INTE 2 672-sekundersmätningen här — den gjordes när
     `collectPersonIds` gick förbi diskcachen, vilket är precis vad den här
     committen ändrade. Den siffran gäller fortfarande vid evakuerad cache och i
     preview (som saknar cache-steg helt). Blir den röd: behandla det som väntat,
     inte som en regression — gamla sajten ligger kvar, och åtgärden är att
     direkt köra `gh workflow run deploy.yml -f full_refresh=true`.
     Samma push är också första riktiga provet på att fasordningen
     (`Collecting page data` klar före `Generating static pages`) håller —
     CI och preview sätter båda `SELECTION_ALLOW_THIN` och kan inte falsifiera den.
   - Gamla sajten ligger kvar under tiden; ett rött bygge deployar ingenting.
   - Sätt ALDRIG `SELECTION_ALLOW_THIN` i `deploy.yml` för att komma förbi. Den
     stänger av både golvet och sitemapens kast och hör bara hemma i `ci.yml`
     och `preview.yml`.

---

## 7. "Sentry-alert triggade"

### 7a. Vad göra?

1. Öppna Sentry → rätt event
2. Kolla `tags.scope` — vilken subsystem? `app:*` = error boundary,
   `rq:query:*` = React Query-fetch, `rq:mutation:*` = mutation
3. Se stack trace — vilken fil+rad?
4. Samma error förut? Sök på error-message i Sentry
5. Om nytt: reproducera lokalt, fixa, deploy

### 7b. Noise-errors att ignorera

Redan ignoreras (se `src/lib/sentry.ts` `ignoreErrors`):
- ResizeObserver loop
- Non-Error promise rejection captured
- The operation was aborted (user navigation)
- NetworkError when attempting to fetch resource

Om du ser nya noise-patterns, lägg till dem där istället för att debugga
dom i tid och evighet.

---

## 8. "Cloudflare cache serverar gammal data"

Efter en deploy men användare ser gammal version.

**Fix:** kör `/purge`-skillen (eller `/commit` som purgar sist), annars
manuellt — det finns inget `npm run purge`-skript:

```bash
source .env.local && curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Eller Cloudflare Dashboard → Caching → Configuration → Purge Everything.

---

## 9. Blockerade features / externa dependencies

### 9a. Google SSO failar

Sannolika orsaker:
- OAuth consent screen har inte verifierade domäner (ovanligt efter launch)
- Firebase Authentication-kvot överstigen (Spark: 10K MAUs för Google/email —
  vi är långt under)

Verifikation: https://console.firebase.google.com/project/binge-nu/authentication/providers

### 9b. Email-verification når inte fram

Firebase har gratis-gräns på email-sends (10/sek, 1000/dag). Om överstiget:
- Kolla Authentication → Templates → Email verification template är OK
- Om spam-filter äter dem: be användare kolla spam, eller byt email-provider
  (Firebase tillåter custom SMTP i Blaze)

---

## 10. Generell deploy-rollback

Sista kända fungerande commit:

```bash
# Identifiera
git log --oneline main | head -20

# Rollback = revert + push (deploy.yml bygger om och deployar hosting).
# OBS: `git checkout <sha> -- out/` funkar INTE — out/ är gitignorerad
# build-output, inte incheckad, så det blir en no-op. Reverta källan istället:
git revert <bad-sha>          # enskild commit
git revert <bad-sha> -m 1     # om det var en merge-commit
git push origin main          # trigger redeploy via CI (deploy.yml)
```

Glöm inte cache-purge efter rollback (§8).

---

## 10b. Hosting-lagring: tva kopplade kostnadskontroller

Firebase Hosting debiterar **lagring**, inte bara trafik. I juli 2026 lag binge
pa **307 GB lagrat** mot 1,7 GB nedladdat - enbart kvarliggande deployer. Tva
kontroller haller nere det. **Bada maste finnas kvar**, och den forsta syns inte
i repot alls, vilket ar precis sa 307 GB kommer tillbaka.

**1. Antal sparade releaser = 3** - satt 2026-08-02, en **konto-installning, inte
kod**: Firebase console -> `binge-nu` -> Hosting -> Manage site -> *Release
storage settings* -> "Number of previous releases to keep". Rutan var **tom** =
spara varje version for alltid, och varje deploy ar ~10 GB. Tre releaser racker
for rollback i ett solo-flode som pushar direkt till main. **Andrar du den,
uppdatera den har raden** - det finns ingen annan plats dar vardet ar skrivet.

**2. `**/__next._full.txt` ignoreras vid uppladdning** (`firebase.json` ->
`hosting.ignore`, 2026-08-03). Next 16:s statiska export skriver en
`__next._full.txt` i varje sid-katalog som ar byte-identisk med grannen
`index.txt` - ~22 900 filer, ~1,5 GB per deploy. Ingen hamtar den: klient-routern
bygger sin RSC-URL som `pathname += "index.txt"`, och `_full` finns varken i
bundlen, HTML:en, `__next._tree.txt`-payloaderna, sitemap:en eller service
workern.

Den ignoreras i stallet for att raderas efter bygget, sa att **en** rad tacker
`deploy.yml`, `preview.yml` och lokala `firebase deploy` - ett raderingssteg i
deploy-flodet hade fatt previewen att servera en annan filuppsattning an prod.

Premissen ar ett Next.js-internt beteende och repot tar Next-minors via den
veckovisa dependabot-gruppen `react-next`. Steget *"Verify the ignored RSC twin
is still a duplicate"* i `deploy.yml` kollar darfor **invarianten** pa varje
farskt bygge:

- filerna **borta** -> `::warning::`, deployen fortsatter (glob:en ar en no-op,
  sajten oskadd, vi slutar bara spara - advisory av samma skal som audit-steget,
  BIN-344: enda prod-vagen far inte frysas av en kostnadsregression);
- filerna **finns men skiljer sig fran `index.txt`** -> **blockerar**, for da kan
  glob:en kasta bort riktigt innehall och `.txt` cachas ett dygn (se cache-purge
  ovan).

Ser du deployen blockera pa det steget: kolla forst om en Next-uppgradering just
landat, och avgor om filen fortfarande ar oanvand innan du ror glob:en.

---

## 11. Kontakter + resurser

- Firebase Support: https://firebase.google.com/support (Spark = community-
  only; Blaze = mejl-support)
- TMDB Support: community forum, https://www.themoviedb.org/talk
- Cloudflare Support: https://dash.cloudflare.com/support (free tier =
  community; paid = direct)
- Sentry Support: https://sentry.io/support (free = community)
- IMY (Integritetsskyddsmyndigheten): https://www.imy.se/kontakta-oss/

---

## 12. Loggbok

När du löser en incident: lägg en rad här så framtid-du minns.

| Datum | Incident | Root cause | Fix |
|-------|----------|------------|-----|
| _tomt_ | _tomt_ | _tomt_ | _tomt_ |
