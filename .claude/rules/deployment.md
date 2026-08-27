---
paths:
  - "next.config.mjs"
  - "firebase.json"
  - ".github/workflows/**"
  - "src/lib/tmdb/buildFetch.ts"
  - "src/lib/tmdb/buildCache.ts"
---

# Deployment + build-time TMDB pre-rendering

`next build` (med `NODE_OPTIONS=--max-old-space-size=4096`) → static export
till `out/` → Firebase Hosting (`public: "out"`) → Cloudflare proxy.
SPA-rewrite `**` → `/index.html`.

**Byggtids-TMDB (SEO-pre-rendering):** `/{tv,movie,person}/[id]` pre-renderas
för ~25k populära titlar (`generateStaticParams`). Varje sida gör ett
TMDB-anrop vid byggtid. Två skydd (se `src/lib/tmdb/buildFetch.ts` +
`buildCache.ts`):
- **AbortSignal.timeout (20s)** på alla byggtids-anrop → ingen sida når Next
  60s-tak; exporten kan aldrig avbrytas av en strypt fetch (otursdrabbade
  sidor får tunn metadata, bygget förblir grönt).
- **Fil-cache `.tmdb-cache/`** (mjuk refresh efter 6 dagar, `REFRESH_AFTER_MS`;
  hård TTL 30 dagar, `buildCache.HARD_TTL_MS` — stod länge "TTL 7 dagar", vilket
  var fel åt båda hållen. De 30 dagarna är dessutom det ADR 0018:s TMDB
  ToS §1.C-resonemang vilar på) persistas mellan CI-körningar via
  `actions/cache`. Kod-deployer hämtar därför nästan inga titlar (cache-träff)
  → ingen strypning, snabb deploy. Veckovis schemalagd deploy (cron i
  `deploy.yml`) sätter en stor `TMDB_BUILD_REFRESH_BUDGET` (+ längre timeout)
  och hämtar färsk metadata för alla stale titlar.

**`.tmdb-cache/` bär sedan BIN-823 även URVALET, inte bara metadatan.**
`selection-{movie,tv,person}.json` är listan över vilka id:n som pre-renderas, och
den är en SPÄRRHAKE: kod-deployer läser den och gör noll listanrop, veckobygget
härleder om och unionerar. Två regimflaggor sätts under samma villkor i
`deploy.yml` och måste följas åt — `TMDB_BUILD_REFRESH_BUDGET` (hur mycket
metadata som får uppdateras) och `TMDB_SELECTION_REFRESH` (om urvalet ska
härledas om). Förlorar man cachen kostar nästa bygge en full härledning under
fastak, och ett urval som ändå blir för tunt FÄLLER bygget (täckningsgolvet) i
stället för att deploya en förkrympt sajt. `SELECTION_ALLOW_THIN=1` stänger av
både golvet och sitemapens kast. Sedan BIN-1028 (2026-08-27) sätts den av INGEN
workflow — de två som gjorde det är raderade — så den är numera ett rent lokalt
verktyg. `deploy.yml` sätter den ALDRIG, och det är den egenskapen hela skyddet
vilar på. Hela resonemanget: ADR 0018, vars beskrivning av de två raderade
workflowsen är historik.

Skär **inte** ner pre-render-antalet för att fixa byggtid — catch-all-skalet är
`noindex` by default, så en icke-pre-renderad titel indexeras opålitligt
(endast efter JS-hydrering). Mekaniken är fixad; täckningen ska behållas.

Workflows ligger i `.github/workflows/`. Det som inte syns av filnamnen: **`deploy.yml`
deployar BARA hosting** — rules och functions kräver alltid en manuell `firebase deploy`
först. `pr-checks.yml` kör lint/typecheck/test på pull requests (dit dependabot-bumpar
landar), `secret-scan.yml` läcksökning. Ingen av dem rör rules eller functions, och ingen
av dem bygger — bara `deploy.yml` gör det, och därmed är den enda som ser en nyckel.
Härled listan i stället för att lita på den här meningen: `ls .github/workflows/`.

## Hosting-lagring: två kopplade kostnadskontroller

Firebase Hosting debiterar **lagring** (~$0.026/GB/mån), och binge lagrade
**307 GB** i juli 2026 medan besökarna laddade ner 1,7 GB. Ingen trafikkostnad
— bara kvarliggande deployer. Två kontroller håller nere det, och **båda måste
finnas kvar**; den ena syns inte i repot alls, vilket är precis så 307 GB kommer
tillbaka.

**1. Antal sparade releaser = 3** (satt 2026-08-02). Firebase console →
`binge-nu` → Hosting → Manage site → *Release storage settings* → "Number of
previous releases to keep". Rutan var **tom** = spara varje version för alltid,
och varje deploy är ~10 GB. Detta är en **konto-inställning, inte kod** — den
finns ingenstans i `firebase.json` eller i någon workflow. Ändrar du den, notera
det här. Tre releaser räcker för rollback i ett solo-flöde som pushar direkt till
main.

**2. `**/__next._full.txt` i `firebase.json` → `hosting.ignore`.** Next 16:s
statiska export skriver en `__next._full.txt` i varje sid-katalog som är
**byte-identisk** med grannen `index.txt` — ~22 900 filer, ~1,5 GB per deploy.
Ingen hämtar den: klient-routern bygger sin RSC-URL som
`pathname += "index.txt"`, och `_full` förekommer varken i bundlen, HTML:en,
`__next._tree.txt`-payloaderna, sitemap:en eller service workern.

Den **ignoreras vid uppladdning, raderas inte efter bygget**. En delete-step i
`deploy.yml` hade missat varje lokal `firebase deploy` — och då hade det man testar
för hand serverat en annan filuppsättning än prod, vilket gör repetitionen otrogen
för exakt den här klassen av ändring. En rad i `firebase.json` gäller båda vägarna.

Premissen är ett Next.js-**internt** beteende, och repot tar Next-minors via den
veckovisa dependabot-gruppen `react-next`. Därför verifierar steget *"Verify the
ignored RSC twin is still a duplicate"* i `deploy.yml` invarianten på varje
färskt bygge, med två olika svar:

- **Filerna är borta** (Next har döpt om eller slutat skriva dem) → `::warning::`
  och deployen fortsätter. Glob:en är då bara en no-op; sajten är oskadd, vi
  slutar bara spara. Advisory av samma skäl som audit-steget (BIN-344): det här
  är enda prod-vägen och en kostnadsregression får inte frysa en akut hotfix.
- **Filerna finns men är inte längre identiska tvillingar** → **blockerar**.
  Då kan glob:en kasta bort riktigt innehåll, och `.txt` cachas ett dygn av
  header-regeln i `firebase.json`, så ett felaktigt bygge kostar en ombyggnad
  plus en Cloudflare-purge.

Vakten kollar **invarianten**, inte filnamnet. Ett namnkontrolls-test hade
missat "Next behöll namnet och ändrade innebörden".
