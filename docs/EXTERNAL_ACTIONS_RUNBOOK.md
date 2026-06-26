# Extern infra-runbook

**Syfte:** exakta, kopiera-och-kör-steg för det som **inte** kan göras i repot —
manuella deploys, secrets, Firebase Console-inställningar och tredjepartstjänster.
`deploy.yml` (push → main) deployar **bara hosting**; functions, rules och index
kräver manuell `firebase deploy`. Kör stegen i ordning efter att
`remediation-roadmap`-grenen mergats till main.

> Källa: `docs/analysis/EXTERNAL_ACTIONS.md` + remediation/roadmap-genomförandet
> 2026-06. Varje steg: kommando → förväntat utfall → verifiering.

---

## 1. Secrets (krävs före functions-deploy)

Cloud Functions läser dessa via `defineSecret`. Sätt alla innan du deployar
functions, annars startar de men no-op:ar / loggar fel.

```bash
firebase functions:secrets:set INSIGHTS_TOKEN      # bearer-token för /api/insights (admin-bypass)
firebase functions:secrets:set PLAUSIBLE_API_KEY   # Plausible Stats API-nyckel
firebase functions:secrets:set PLAUSIBLE_SITE_ID   # t.ex. binge.nu
firebase functions:secrets:set TMDB_API_KEY        # NYTT (Fas 6) — episodeReleaseNotify pollar TMDB
```

- **Förväntat:** varje kommando promptar efter värdet och bekräftar `✔ Created a new secret version`.
- **Verifiera:** `firebase functions:secrets:access TMDB_API_KEY` (m.fl.) returnerar värdet.
- **Notis:** `TMDB_API_KEY` är samma nyckel som frontend använder (`NEXT_PUBLIC_TMDB_API_KEY`) — men i functions måste den ligga som secret, inte som klient-env.

## 2. Deploya functions + rules + index

Deploya **alla** functions i ett svep (inte en namngiven delmängd — den listan
har glidit isär från koden förut och tappade bl.a. `retentionCleanup` +
`reclaimOrphanFollows`, så schemalagd städning aldrig gick live):

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes
```

- **Förväntat:** samtliga exporterade functions (se `functions/src/index.ts`)
  deployas till `europe-west1`; rules kompilerar och publiceras; collectionGroup-
  indexen byggs.
- **Verifiera:**
  - `firebase functions:list` visar alla functions. Kontrollera särskilt de
    **schemalagda** (annars körs ingen bakgrundsjobb): `rollupInsights`,
    `episodeReleaseNotify`, `showReturnNotify`, `availableNotify`,
    `retentionCleanup` (daglig — GDPR-retention), `reclaimOrphanFollows`
    (veckovis), `streamingOffersRefresh`, `cineasternaCatalogSync`.
  - Cloud Scheduler Console listar ett jobb per schemalagd function ovan.
  - Firestore Console → Indexes: collectionGroup-indexen har status **Enabled**
    (bygget kan ta några minuter).
- **Notis:** index-bygget är asynkront — schemalagda jobb som läser ett ännu ej
  Enabled-index loggar fel. Vänta tills indexet är klart (eller kör jobbet
  manuellt en gång efteråt, se steg 11).
- **Secrets-beroende:** flera av de nyare functions (`streamingOffersRefresh`,
  `titleRatings`, `askBingeParse`, m.fl.) no-op:ar tyst utan sina secrets — sätt
  alla i steg 1 / `docs/analysis/EXTERNAL_ACTIONS.md` innan deploy.

## 3. Plausible — registrera mål (goals)

Registrera custom-event-målen som koden nu skickar (Fas 1 + Fas 3) i Plausible →
Site settings → Goals → Custom event:

- `providers_selected`
- `advisor_viewed`
- `advisor_action_taken`
- `search_submitted`
- `status_changed`
- `error_boundary_triggered`

(Befintliga sedan tidigare: `title_added_watchlist` m.fl. — lämna orörda.)

- **Verifiera:** målen syns i Goals-listan; efter någon dags trafik dyker
  konverteringar upp.

## 4. Admin-flagga (för /insikter + /admin/reports)

I Firestore Console → `users/{ditt-uid}` → lägg till fält:

```
isAdmin: true   (boolean)
```

- **Verifiera:** `binge.nu/insikter` laddar dashboarden (inte token-gate);
  `binge.nu/admin/reports` är åtkomlig.

## 5. Sentry DSN

Provisionera ett Sentry-projekt (Browser/React) och sätt hosting-env:

```
NEXT_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/...
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_GIT_SHA=<sätts av CI vid build>
```

- **Notis:** utan DSN är Sentry no-op (säker default). Bygg om/​deploya hosting
  efter att env satts.
- **Verifiera:** trigga ett testfel → eventet dyker upp i Sentry inom ~1 min.

## 6. Firebase App Check (reCAPTCHA v3)

1. Registrera reCAPTCHA v3-sitekey (Google reCAPTCHA admin).
2. Firebase Console → App Check → registrera webb-appen med sitekeyn.
3. Sätt hosting-env: `NEXT_PUBLIC_APP_CHECK_SITE_KEY=<sitekey>`.
4. Sätt enforcement på Firestore (efter att ha verifierat att riktig trafik passerar).

- **Notis:** utan sitekey är App Check no-op. Aktivera enforcement först när du
  ser att legitima requests får tokens (annars låser du ut användare).

## 7. Firestore PITR + schemalagda backups (Blaze)

Firebase Console → Firestore → Backups:
- Aktivera **Point-in-time recovery** (7 dagars fönster).
- Skapa ett **backup schedule** (dagligt, t.ex. 14 dagars retention).

- **Verifiera:** Backups-fliken visar PITR = On och ett aktivt schema.

## 8. Branch protection på `main`

GitHub → Settings → Branches → Add rule för `main`:
- Require status checks to pass (välj `ci` — lint/typecheck/test/build/audit).
- Require a pull request before merging.

- **Verifiera:** direkt-push till `main` avvisas; PR krävs.

## 9. Billing-alert + UptimeRobot

- **Billing:** Firebase Console → Usage and billing → Budgets & alerts:
  bekräfta 25 SEK/mån-budget med 50/90/100%-alerts (finns enligt CLAUDE.md —
  verifiera att den lever och pekar på rätt mejl).
- **UptimeRobot:** skapa en HTTP(s)-monitor mot `https://binge.nu` (5 min interval),
  larm till din mejl.

## 10. Officiell TMDB-logo

Ersätt eventuell platshållar-attribution med den officiella TMDB-logotypen
(ladda ner från TMDB:s brand-sida). Attributionstexten finns redan i
`src/lib/tmdb/attribution.ts` — det är bildtillgången som ska bytas.

## 11. Verifiering efter deploy

```bash
# Säkerhetsheaders (REMEDIATION 1.4)
curl -I https://binge.nu | grep -iE "content-security-policy|strict-transport|x-content-type|x-frame|referrer-policy|permissions-policy"

# Insikter
# → öppna https://binge.nu/insikter inloggad som admin: dashboarden laddar med data.

# Episod-push (Fas 6) — kör jobbet en gång manuellt och kolla loggen:
# Cloud Scheduler Console → episodeReleaseNotify → "Force run"
firebase functions:log --only episodeReleaseNotify
# → loggrad "episodeNotify done { followedTvDocs, uniqueShows, notified }".
```

---

## Kända undantag / noteringar (från genomförandet)

- **npm audit:** `npm audit --audit-level=high` ger **0 HIGH**. Två **moderate**
  postcss-relaterade advisories kvarstår — fix kräver en major-nedgradering av
  `next` och är därför ett **medvetet accepterat undantag** (REMEDIATION 1.1 /
  A2.2). CI-grinden (`--audit-level=high`) failar inte på moderate.
- **C More provider-id (1759):** TMDB har helt pensionerat C More (uppgått i TV4
  Play) och listar det inte längre på något endpoint, så id:t kunde **inte
  live-bekräftas**. 1759 är det dokumenterade historiska id:t och **inget aktivt
  provider-id använder det**, så aliaset `1759 → 489` är noll-kollisionsrisk och
  ofarligt (fångar bara ev. gamla lagrade `watch/providers`-payloads). Inget att
  åtgärda om du inte hittar id:t i en gammal lagrad payload som motsäger det.
- **Firestore rules + index kräver manuell deploy** — `deploy.yml` rör dem inte.
  Glöm inte steg 2 efter varje ändring i `firestore.rules` / `firestore.indexes.json`.
