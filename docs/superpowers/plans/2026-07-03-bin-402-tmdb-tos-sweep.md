# BIN-402 — TMDB ToS-svep: refresha/rensa denormaliserade TMDB-fält > 6 mån

**Status:** PLAN — parkerad i In Review, väntar Malins skriftliga go-ahead.
**Tier:** C (riskabel migration/mass-write) + D (kräver manuell `firebase deploy --only functions` + ev. rules-push).
**Route:** `top` — full panel (Legal #5, DPO #6, DBA #27) konvenerad 2026-07-03, blint, före plan. ADR: `docs/org/adr/0009-bin402-tmdb-tos-sweep.md`.
**Prioritet:** Low. Kompenserande kontroll för en risk Malin redan accepterat (instant-week gate:ades INTE).

> **Varför detta ALDRIG auto-shippas:** första Cloud Function som skriver till *varje* användares
> watchlist-docs på schema. Blast radius = hela databasen i en körning, inte en TTL-skiva. En bugg i
> stale-filtret eller clear-grenen kan tyst blanka `title`/`posterPath`/`providers` för hela
> användarbasen. Detta är exakt CLAUDE.md:s "riskabel migration"-undantag → skriftlig plan + go-ahead
> före kod. Denna fil ÄR den planen.

## Bakgrund

TMDB:s API-villkor **§1.C** förbjuder caching av API-härledd data längre än 6 månader. Binge
denormaliserar TMDB-fält på `users/{uid}/watchlist/{tmdbId}` utan TTL:
`title`, `posterPath`, `providers`/`providersCheckedAt`, `genreIds`, `tmdbStatus`, `runtime`, och
sedan instant-week även `nextAirDate`/`nextAirCode`/`nextAirProvider`/`nextAirUpdatedAt`/`digitalReleaseDate`.
Dormanta konton refreshas aldrig av klient-sidig read-repair → en schemalagd server-svep behövs.

## Kärnbeslut (panel-syntes)

1. **Default-åtgärd = CLEAR (nulla fälten), INTE re-fetch.** (DBA #2, Legal #2)
   Re-fetch per stale titel är obegränsad fan-out: kostnad skalar med biblioteksstorlek × stale-rate,
   utan tak mot 25 SEK-cap:en. Clear är en bounded Firestore-only write. **Refresh sker lazy vid nästa
   titelsidesvisning** (befintligt mönster — sidorna anropar TMDB ändå), aldrig proaktivt i batch-jobbet.
   Detta uppfyller Legal §1.C (clear = compliant, ingen "timestamp-laundering") OCH håller kostnaden
   bounded. *(Enda design-spänningen i panelen, reconcilierad — se ADR.)*

2. **En enda färskhetsstämpel `tmdbFieldsRefreshedAt`** (timestamp, nullable) på doc-nivå. (DBA #1)
   Ingen per-fält-historik (inget att backfilla från). **Saknad stämpel = stale** (safe default,
   matchar episodeNotifys null-safe-mönster). Lägg till i `firestore.rules` `hasOnly()`-whitelist
   (idag 22 fält) + typbind `is timestamp` nullable som `ratedAt`/`nextAirUpdatedAt` — så en framtida
   *klient*-refreshknapp inte tyst `permission-denied`:as. (Admin SDK kringgår rules; whitelisten är
   för framtida klient-skrivvägar.)

3. **Query-then-filter, ingen ny composite index.** (DBA #4)
   `tmdbFieldsRefreshedAt < femMånaderSedan` är en single-field range → inget nytt i
   `firestore.indexes.json`. Modelleras exakt på `retentionCleanup`/`collectStaleNotifications`:
   `.collectionGroup('watchlist').select('tmdbFieldsRefreshedAt').orderBy('__name__').limit(PAGE_SIZE)`,
   filtrera i minne, paginera med `startAfter`-cursor.

## Form

- Ny modul `functions/src/tmdbTosSweep/index.ts` (`onSchedule('every 720 hours' ~månadsvis, europe-west1)`),
  re-exporterad från `functions/src/index.ts`. Modell: `retentionCleanup` + `episodeNotify`.
- **Ren logik i `functions/src/tmdbTosSweep/logic.ts`** (firebase-admin-fri) — `isTmdbFieldsStale(stampMs, nowMs)`,
  `buildClearedPayload()`, `allTargetFieldsAlreadyNull(doc)`. Krävs pga functions-test-import-gotchan
  (root vitest saknar firebase-admin i CI → pure helpers MÅSTE ligga admin-fritt).
- `BATCH_SIZE = 450`, `PAGE_SIZE = 2000` (matchar retentionCleanup).
- **Cross-invocation-resumability:** persistera senaste `__name__`-cursor till kontroll-doc
  `sweepState/tmdbFieldsSweep` efter varje committad sida → en timeout (300s-tak) eller budget-throttle
  återupptar nästa körning istället för att rescanna från doc 0. (DBA #5 — nytt vs syskonen, motiverat
  av att working set = ALLA watchlist-docs.)
- **Dry-run-läge först:** första schemalagda körningen loggar bara counts (skulle-rensa/skulle-hoppa),
  skriver INGET. Flippas till mutate efter att Malin sett siffrorna. (DBA-invändning — spegling av hur
  retentionCleanup kunde no-op-logga innan den wire:ades in.)

## Bindande acceptanskriterier (panel-must-haves infällda)

**Compliance (Legal #5):**
- [ ] **Trigger-tröskel = 5 månader, inte 6.** §1.C är ett tak, inte ett mål; månads-cadence +
      budget-throttling kan annars låta docs åldras till 6mo+ innan de fångas. 5mo ger en månads slack.
- [ ] Refresh (om någonsin) = äkta TMDB-läsning; klockan (stämpeln) nollställs BARA vid faktisk fetch —
      aldrig stämpel-bump utan läsning. Misslyckad fetch → fall through till **clear**, aldrig lämna
      stale fält med bumpad stämpel. (v1 = clear-only, så detta gäller den framtida lazy-refresh-vägen.)
- [ ] **Audit trail (hårt krav):** varje körning skriver en liten completion-record (timestamp,
      docs-scanned, docs-cleared, docs-skipped, budget-abort ja/nej, **full-pass-completed ja/nej**) till
      ett durabelt billigt summary-doc (`sweepState/tmdbFieldsSweep.lastRun`) — inte per-user-loggar.
      Detta ÄR beviset att kontrollen körs; en grön CI-badge bevisar inte att jobbet kört mot prod i
      månader N, N+1, N+2. Ofullständig/failad körning flaggas där Malin ser det (inte tyst no-op).
- [ ] Alla listade fält i scope; ingen tyst carve-out (`genreIds` känns oskyldig men är TMDB-härledd).
- [ ] Clear-vägen lämnar ingen fantom-"senast kända provider"-sträng i UI utan re-check; JustWatch-credit
      renderas inte när det inte finns provider-data att attribuera.

**Data protection (DPO #6):**
- [ ] **Hård field-allowlist i kod + unit-test** som asserterar att update-payloadens nyckelset exakt
      matchar allowlisten. ALDRIG read-modify-write eller merge byggd från befintlig doc — får aldrig röra
      `rating`/`ratedAt`/`status`/`watchedAt`/`isPublic`/`lastWatched*` eller annat user-authored fält.
      (Doc:en blandar TMDB-härlett + user-authored side-by-side → osäker update är #1-sättet detta går fel.)
- [ ] Planen anger **explicit** att sveper säkert kör mot ev. föräldralösa docs (Console-bypass-delete
      lämnar cascade-data utan `users/{uid}`): vi joinar INTE mot user-existens — jobbet rör bara
      TMDB-cache-fält, aldrig identitetsdata, så en clearad poster på en orphan-doc är harmlös.
- [ ] Art. 30 processing-record-rad: syfte (TMDB ToS-compliance), scope (endast denormaliserade
      TMDB-fält), frekvens (månadsvis), retention-trigger (>5mo stale). Ingen DPIA (ej high-risk/profiling).

**Data-layer / kostnad (DBA #27):**
- [ ] **Läs/skriv-budget beräknad FÖRE kod:** hämta N = antal watchlist-docs (Firestore console eller
      engångs-count-query). Varje scannad doc = 1 billed read oavsett `.select()`. Ange faktiska N + SEK-
      estimat i ticketen innan bygge. Detta är Financial Controller-gaten; DBA levererar formeln:
      `månad-kostnad ≈ N reads + (clearade docs) writes`, båda mot free-tier (50k reads, 20k writes/dag)
      och 25 SEK-cap:en. **Om N gör en full scan för dyr:** throttla via cursor-resumability över flera
      körningar (redan i designen).
- [ ] Idempotens: hoppa write helt om alla target-fält redan är null (spar writes på redan-clearad doc);
      stämpla `tmdbFieldsRefreshedAt` vid varje touch så nästa scan inte re-selectar samma doc.
- [ ] **`updatedAt` bumpas ALDRIG** — regression-test, inte bara kommentar. Driver `continueWatching`-sort
      (`continueWatching.ts:108`); en tyst bump ser ut som "användaren re-engagerade" = data-accuracy-bug
      (GDPR Art. 5(1)(d)) utan felsignal. Modell: `nextAirReadRepair` (tyst repair, rör aldrig updatedAt).

## Tier-D ops (Malins hand — kan inte automatiseras)
- Manuell `firebase deploy --only functions:tmdbFieldsSweep` (deploy.yml deployar BARA hosting).
- Om `tmdbFieldsRefreshedAt` läggs i rules-whitelist: manuell `firebase deploy --only firestore:rules` FÖRST.
- Cloud Scheduler-jobbet skapas av function-deployen; verifiera i Console att det är enabled.

## Öppen fråga till Malin (i ticketen)
- **Produkt-call, inte teknisk:** en dormant användare som återvänder ser en lista med blanka rader
  (clearad `title`/`posterPath`) tills lazy-refresh vid klick fyller dem. Acceptabelt, eller ska v1
  istället lazy-refresha hela `mina`-vyn vid load? (DPO + DBA flaggar detta som Produkt/Designs beslut.)
