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

`SubscriptionAdvisorWidget` har redan ett `hasError`-state som visar
"Kunde inte räkna ut ditt tips" istället för tom panel (Sprint 3 12.4).

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

---

## 6. "Bygget failar i CI"

### 6a. Lint/typecheck fel

Vanligt, fix direkt i PR:n eller lokalt. `.github/workflows/ci.yml`
kräver alla 4 (lint, typecheck, test, build) före merge.

### 6b. Build-fel

- `NODE_OPTIONS=--max-old-space-size=4096` finns redan i deploy.yml — ska
  räcka för vår nuvarande bundle
- Om OOM: gör `npx @next/bundle-analyzer` och prunera stora deps

### 6c. Preview-channel timeout

`preview.yml` använder FirebaseExtended/action-hosting-deploy@v0. Om den
hänger:
- Rerun workflow från GitHub UI
- Om återkommande: kolla Firebase Hosting-kvoterna (Spark har 1 GB/mån
  storage + 360 MB/dag transfer)

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

**Fix:** `npm run purge` om skriptet finns, annars:

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

# Rollback till tidigare commit
git checkout <sha> -- out/  # bara build-output
firebase deploy --only hosting --project binge-nu

# Eller full revert-commit
git revert <bad-sha> -m 1  # om merge-commit
git push origin main  # trigger redeploy via CI
```

Glöm inte cache-purge efter rollback (§8).

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
