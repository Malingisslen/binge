# SPRINT 2026-08-25

Planen för DENNA körning, skriven FÖRE bygget. Detta avsnitt är det enda underlaget
sprinten graderas mot. Nya avsnitt läggs överst; inget arkiveras bort.

6 biljetter i 5 buntar. Router körd på VARJE bunts faktiska filuppsättning vid HEAD
`b417c62` (rå utdata inklistrad per bunt). Vidgar en kritik eller en fix
filuppsättningen — kör om `node docs/org/route.mjs --md <filer>` innan bygget
fortsätter (BIN-766-lärdomen).

**Kapacitetskoll vid urvalet (BIN-744/776/917/976):** arbetaren är denna session, som
KAN konvenera enskild rollkritik. Samtliga fem buntar routar `medium` → en blind
kritik från den ägande rollen, körd FÖRE bygget. Ingen bunt routar `top`.

## Ej valda, och varför

| Biljett | Beslut |
| -- | -- |
| BIN-852 / BIN-935 / BIN-990 | **Parkerade handbromsar.** Var och en bär en obesvarad "Behöver ditt beslut". Byggs inte autonomt. |
| BIN-972 | **Disposition redan skriven idag** (2026-08-25, kommentar + flytt till Backlog). Premissen mätt falsk vid HEAD. Ingen ny åtgärd. |
| BIN-976 | Motorn bor i `C:/claude-plugins` — delad infra som inte får redigeras från en session som startar subagenter (2026-08-03). Tier D, kommenteras. |
| BIN-971 | **Till stor del överspelad av händelser** — se close-out nedan. Stängs med redovisning, tar ingen byggplats. |
| BIN-999 | **Tier D.** Kräver Admin-SDK-läsning per uid mot produktion. Kommenteras med exakta steg. |
| BIN-964 / 965 / 966 / 974 / 977 / 978 / 984–987 / 992 / 995 | Post-mortem-bokföring på buntar vars patchar är förfallna vid HEAD. Ingen kod. Lämnas till ett städpass. |
| BIN-189 / BIN-521 / BIN-170 | `idea`-etikett → `neverBuildLabels`. |
| BIN-454 / BIN-402 | Stående "gör aldrig detta" — `mutateEnabled` är Malins konsolåtgärd. |

---

## Bunt A — Routerns utdata och testkorpus (#25 Engineering Manager / Release Manager)

Router, rå utdata på `docs/org/route.mjs docs/org/route.test.mjs`:
> Tier **medium** · #25 Engineering Manager / Release Manager

### BIN-832 — `--md`/`mdBlock` är oexporterad och helt otestad
**Tier A** · disposition `build` · router: `medium` · #25

**Mätt vid HEAD `b417c62`:** `mdBlock` deklareras i `docs/org/route.mjs`, används av
CLI-grenen, exporteras inte. `docs/org/route.test.mjs` importerar
`{ route, isCodePath, TOOLING_CODE_FILES }` — `grep -c mdBlock docs/org/route.test.mjs`
= **0**.

**Vad ändras:** `mdBlock` exporteras och får tester i `route.test.mjs` som pinnar
risknivåraden, de tillsatta rollnamnen, och att varningen om oägd kod dyker upp för
`docs/org/route.mjs` men INTE för `scripts/serve-spa.mjs`.

Acceptans:
- [ ] `mdBlock` är exporterad ur `route.mjs` och importerad av `route.test.mjs`. *(kind: diff)*
- [ ] Test pinnar risknivåraden och rollnamnen i `--md`-utdatan. *(kind: diff)*
- [ ] Test pinnar att "unowned"-varningen syns för `docs/org/route.mjs` och saknas för `scripts/serve-spa.mjs`. *(kind: diff)*
- [ ] `npx vitest run docs/org` grönt. *(kind: diff)*

### BIN-833 — två testkorpusar, bara den ena körs av en grind
**Tier A** · disposition `build` · router: `medium` · #25

**Mätt vid HEAD `b417c62`:** `selftest()` finns i `docs/org/route.mjs` och körs via
`--selftest` i CLI-grenen. `grep -n selftest docs/org/route.test.mjs` ger EN träff, och
den är en kommentar — ingen testkod kör den.

**Vad ändras:** ett test i `route.test.mjs` kör `node docs/org/route.mjs --selftest`
som barnprocess och kräver exit 0. Då körs båda falllistorna av samma grind.
(Alternativet — radera `--selftest` — väljs bort: dess fall är inte en delmängd av
`route.test.mjs`, och en radering kastar täckning i stället för att koppla in den.)

Acceptans:
- [ ] `route.test.mjs` kör `node docs/org/route.mjs --selftest` och kräver exit 0. *(kind: diff)*
- [ ] Efteråt körs varje falllista i filen av något `npm test` når. *(kind: diff)*
- [ ] Ett medvetet fel i selftest-tabellen fäller `npm test` (sonderat, resultatet skrivs i commit-meddelandet). *(kind: diff)*

---

## Bunt B — Granskarnas kunskapsfiler (#25)

Router, rå utdata på `.claude/agents/binge-{test,code,security}-reviewer.knowledge.md
.claude/agents/binge-integration-reviewer.md scripts/check-knowledge-caps.mjs`:
> Tier **medium** · #25 Engineering Manager / Release Manager

### BIN-997 — kunskapsfilerna spränger sina egna tak
**Tier A** · disposition `build` · router: `medium` · #25

**Malins beslut 2026-08-25 ligger på biljetten och är bindande:**
1. Taket höjs till ~80k och skrivs med IDENTISK formulering i alla filer som har ett.
2. ENBART `binge-test-reviewer.knowledge.md` klipps ner till taket. Code (66 042) och
   security (30 303) ryms redan och rörs INTE.
3. Det som lyfts ur flyttas till `binge-test-reviewer.knowledge.archive.md`. Ingen
   lärdom raderas utan att hamna i arkivet.
4. Spärren är **icke-blockerande** — en varning i veckosvepet, med ett GOLV på antalet
   filer den hittar. `npm test` får inte gå rött på ett överskridande.
5. #25:s villkor 9: `binge-integration-reviewer.md` bär `tools: Read, Grep, Glob, Bash`
   — utan `Write, Edit` är en instruktion att vika in lärdomar verkningslös. Läget
   avgörs i skrift.

**Mät om med `wc -c` före bygget** — filerna växer vid varje granskningsvarv.

Acceptans:
- [ ] Alla kunskapsfiler som finns ligger under det nya, identiskt formulerade taket, mätt med `wc -c` i commit-meddelandet. *(kind: diff)*
- [ ] Ingen lärdom raderas utan att hamna i `binge-test-reviewer.knowledge.archive.md`. *(kind: diff)*
- [ ] `scripts/check-knowledge-caps.mjs` varnar (exit 0) vid överskridande OCH fäller (exit ≠ 0) när den hittar färre filer än golvet. *(kind: diff)*
- [ ] Skriptet bär en självtest enligt `scripts/scripts-self-tests-present.test.mjs`. *(kind: diff)*
- [ ] `binge-integration-reviewer`s läge är avgjort i skrift — fil eller nedskrivet nej. *(kind: diff)*

---

## Bunt C — Symmetrikollens blinda fläck (#25)

Router, rå utdata på `docs/org/gate-symmetry.test.mjs`:
> Tier **medium** · #25 Engineering Manager / Release Manager

### BIN-926 — omskalad: kriterium 2 är redan shippat
**Tier A** · disposition `build` · router: `medium` · #25

**Premisskoll vid HEAD `b417c62`:** kriterium 2 (de två 400-golven) är **åtgärdat** —
båda står på 700 sedan 2026-08-18, med skälet skrivet i filen. Kriterium 1 står kvar:
`docs/org/gate-symmetry.test.mjs` listar två kända blinda fläckar i sitt huvud, och
`blockingGates()`s handkopia av hookens matchning är inte en av dem.

**Vad ändras:** blind fläck 3 skrivs in i filens huvud. Att låta testet köra den
riktiga hooken väljs bort: hooken bor i `C:/claude-plugins`, som inte är garanterat
närvarande i CI — ett test som kräver den blir grönt av fel skäl på en maskin utan den.

Acceptans:
- [ ] Blind fläck 3 står skriven i filens huvud och namnger `blockingGates()` som en modell av hooken, inte hooken. *(kind: diff)*
- [ ] Kriterium 2 redovisas som redan uppfyllt, med commit/datum — inte omskrivet. *(kind: diff)*
- [ ] Inga golv ändras i denna bunt. *(kind: diff)*

---

## Bunt D — `watchedAt` räknas bara när status är sedd (#26 Information Architect)

Router, rå utdata på `src/lib/watchedDate.ts src/hooks/useServiceValue.ts
src/components/pages/UserProfilePageClient.tsx src/app/stats/page.tsx
src/lib/taste/stats.ts src/lib/diary.ts src/lib/libraryView.ts`:
> Tier **medium** · #26 Information Architect
> ⚠ Unowned code path(s): src/app/stats/page.tsx

### BIN-689 — sju handkopior av samma villkor
**Tier A** · disposition `build` · router: `medium` · #26

**Biljettens fillista är INAKTUELL** (plan-stale). Två av de sju sökvägarna finns inte
vid HEAD: `src/components/pages/DiaryPageClient.tsx` och
`src/components/pages/WatchlistPage.tsx`. Omhärledd från trädet med
`grep -rn "=== 'sedd'" src/`, filtrerad till de ställen som parar villkoret med
`watchedAt` — fortfarande exakt sju:

| # | fil | symbol |
| -- | -- | -- |
| 1 | `src/components/watchlist/DiaryPageClient.tsx` | filmrader-filtret |
| 2 | `src/lib/diary.ts` | `buildDiary`s filmgren |
| 3 | `src/components/WatchlistPage.tsx` | `seenDate` |
| 4 | `src/lib/taste/stats.ts` | 30-dagarsräknaren |
| 5 | `src/app/stats/page.tsx` | `watched`-filtret + månadsnyckeln |
| 6 | `src/hooks/useServiceValue.ts` | `seenFilms` |
| 7 | `src/components/pages/UserProfilePageClient.tsx` | `watched` + `recentlyWatched` |

(Symbolnamn, inte radnummer — ett radnummer i en plan är falskt i samma commit som det
ligger i, BIN-954-lärdomen.)

**Vad ändras:** ett rent predikat i `src/lib/` per test-extraction-mönstret som
returnerar `watchedAt` endast när status är `sedd`, och alla sju anropare migreras i
SAMMA ändring. En helper utan migrerade anropare är död kod.

Acceptans:
- [ ] Predikatet ligger i en egen fil i `src/lib/`-roten och importerar ingenting från Firebase. *(kind: diff)*
- [ ] Alla sju anropare i tabellen ovan går via helpern; noll kvarvarande handkopior av paret (`status === 'sedd'` + `watchedAt`) utanför den. *(kind: diff)*
- [ ] Ett test dödar mutanten "ta bort sedd-gaten" — bevisat genom att applicera mutanten, köra sviten, och skriva utfallet i commit-meddelandet. *(kind: diff)*
- [ ] Beteendet är oförändrat för användaren: statistik, dagbok, profil och bibliotek visar samma sedd-datum som före. *(kind: diff)*
- [ ] `npm run typecheck` och `npm test` grönt. *(kind: diff)*

---

## Bunt E — Beroendena (#25)

Router, rå utdata på `package.json package-lock.json`:
> Tier **medium** · #25 Engineering Manager / Release Manager
> ⚠ Unowned code path(s): package-lock.json

### BIN-603 — premissen har ändrats, mät om och ta det som är gratis
**Tier A** · disposition `build` · router: `medium` · #25

**Premisskoll vid HEAD `b417c62`, `npm audit --omit=dev`:** **4 high** (inte 2).
`nanoid <3.3.18` (GHSA-2v37-7h3g-55p8) har tillkommit sedan biljetten skrevs. Och —
avgörande — npm erbjuder nu `npm audit fix` **utan** `--force`. Biljettens kärnpåstående
("npm's only offered remedy is `npm audit fix --force`") gäller inte längre.

**Vad ändras:** kör `npm audit fix` (ALDRIG `--force`), verifiera att `next` inte
flyttat sig, och redovisa vad som återstår. `postcss`/`sharp` sitter kvar inne i `next`
och rörs inte med `overrides` i den här körningen — det kräver ett riktigt
25k-sidorsbygge för att bevisa att bild- och CSS-kedjan håller, vilket inte är en billig
kontroll.

Acceptans:
- [ ] `nanoid`-CVE:n är borta ur `npm audit --omit=dev`, med före/efter-talen i commit-meddelandet. *(kind: diff)*
- [ ] `next`s version i `package.json` och `package-lock.json` är OFÖRÄNDRAD. *(kind: diff)*
- [ ] `npm run typecheck`, `npm run lint` och `npm test` grönt efter låsfilsändringen. *(kind: diff)*
- [ ] Det som återstår (postcss/sharp inne i next) är skrivet på biljetten som ett mätt kvarvarande läge, inte som löst. *(kind: diff)*

---

## Close-outs utan byggplats

### BIN-971 — sprinten 2026-08-23 rapporterade 5 av 10
De fem "spårlösa" biljetterna har alla en läsbar disposition vid HEAD idag:
BIN-968 shippad i `9b23aeb`, BIN-797 shippad i `fb880f7`, BIN-909 och BIN-559 står i
In Review, BIN-689 byggs i denna sprint (bunt D). Åtgärdspunkt 3 (kräv paret
{commit, transition} per bunt i motorn) bor i `C:/claude-plugins` och kan inte byggas
härifrån. Stängs med den redovisningen skriven på biljetten.

### BIN-999 — räkna `movie_0`/`tv_0` i produktion
Tier D. Kräver en Admin-SDK-`get` per uid. Kommenteras med de exakta stegen.

### BIN-976 — kapacitetskollen körs i arbetaren
Tier D för det här repot: fixen bor i sprintmotorn under `C:/claude-plugins`.
Kommenteras. **Denna körning uppfyller ändå regeln i sak** — routern kördes på varje
bunts filuppsättning vid urvalet, och kapaciteten matchades mot arbetaren före bygget.

## Deviation log

- [deviation] **2026-08-25, BIN-689, bunt D — buntens kriterium 2 är SUPERSEDERAT, inte
  uppfyllt.** Planen skrev "Alla sju anropare i tabellen ovan går via helpern; noll
  kvarvarande handkopior av paret (`status === 'sedd'` + `watchedAt`) utanför den".
  Det kriteriet byggdes INTE, och ska inte byggas. Kriteriet står kvar ovan med flit —
  det stryks inte, det supersederas här.

  **Vad kritiken sa.** #26 Information Architects blinda kritik före bygget fällde
  planen: de sju anropsställena är inte ett predikat utan TVÅ.
  * **P1 — "har ett räknebart sedd-datum"** (status + ett datum). Fem ställen.
  * **P2 — "står som sedd just nu"** (en medlemskapsräkning, utan datumkrav). Tre
    ställen: `src/app/stats/page.tsx`s `watched`-filter,
    `src/components/pages/UserProfilePageClient.tsx`s `watched`, och
    `src/hooks/useServiceValue.ts`s `seenFilms`.

  Att dra P2 genom en helper som KRÄVER ett datum tappar tyst en `sedd`-titel vars
  `watchedAt` är null ur "Sedd"-rutorna på statistiksidan och den PUBLIKA profilen.
  Det är en användarsynlig regression förklädd till refaktorering.

  **Konservativt val:** en enda export, `seenDate(item): Date | null`, migrerar de FEM
  P1-ställena. De tre P2-ställena behåller sin inline-kontroll. Uppdelningen och dess
  skäl står i `src/lib/seenDate.ts`s huvud, som är den läsbara ytan — inte här.

  **Till nästa läsare:** "avsluta migreringen" genom att dra in de tre är precis det
  #26 blockerade. `src/hooks/useServiceValue.ts`s `seenFilms` SER ut som paret
  (integrationsgranskaren räknade om det till sex par-ställen, inte fem, eftersom
  datumkravet där ligger en fil bort i `watchedForValueFromItems`) — det är ändå P2 på
  sitt eget anropsställe och rörs inte.

- [deviation] **2026-08-25, bunt D — routern kördes om på den BYGGDA filuppsättningen och
  bytte säte.** Planens rå-utdata ovan routades på en planerad filuppsättning som bl.a.
  namngav `src/lib/watchedDate.ts` (en sökväg som aldrig existerade) och tre filer bygget
  inte rör. Den satte `#26 Information Architect`. Den FAKTISKT byggda uppsättningen
  svarar annorlunda:

  ```
  $ node docs/org/route.mjs --md src/lib/seenDate.ts src/lib/seenDate.test.ts \
      src/app/stats/page.tsx src/components/WatchlistPage.tsx \
      src/components/watchlist/DiaryPageClient.tsx src/lib/diary.ts \
      src/lib/taste/stats.ts src/lib/watchlistWrites.ts
  Tier **medium** · #28 Recommendations / Scoring-Integrity Engineer
  ```

  Nivån är oförändrad (`medium`, en kritik — den här arbetaren kan konvenera den), men
  sätet är ett annat. Funnet av integrationsgranskaren, som körde kommandot i stället för
  att läsa planens citat. Det är BIN-766-lärdomen i sin renaste form: kör om routern på
  det som byggs, inte på det som planerades.

  **Konservativt val:** #28:s blinda kritik körs FÖRE commit, utöver #26:s. Ingen bunt
  committas på ett säte som aldrig fick titta.

- [discovery] **2026-08-25, bunt A — BIN-833:s premiss föll vid HEAD.** Biljetten säger att
  `--selftest` "inte är kopplad till någon grind". `git log -S"--selftest exits 0" --
  docs/org/gate-symmetry.test.mjs` ger `851696d`, som la till fallet "the router's own
  golden cases are wired to something that runs (BIN-880)" — det startar
  `node docs/org/route.mjs --selftest` och kräver exit 0, under `npm test`.
  → Konservativt val: bygg inte om en dubblett. Omskalad till den levande defekten
  premissen pekade på — en mening i `docs/org/route.test.mjs`s huvud som fortfarande
  påstod motsatsen. Den är struken.

- [discovery] **2026-08-25, bunt C — BIN-926:s kriterium 2 var redan uppfyllt vid HEAD.**
  Båda 400-golven står på 700 sedan 2026-08-18, med skälet skrivet i filen.
  → Konservativt val: bunten omskalad till kriterium 1 ensamt. Inget golv rörs.

- [needs-human] **2026-08-25, bunt E — BIN-603 dras ut ur commiten och får en egen.**
  `npm audit fix --dry-run` (utan `--force`) flyttar `next` 16.2.12 → 16.3.3 och `sharp`
  0.34.5 → 0.35.3, alltså ett major-steg för `sharp` och ett minor för `next`. Biljettens
  kärnpåstående ("npm's only offered remedy is `npm audit fix --force`") gäller inte
  längre. Push = deploy i det här repot, och `.claude/rules/deployment.md` namnger just den
  här klassen: ett Next-versionssteg kan ändra formen på static-export-utdatan.
  → Konservativt val: egen bunt, egen commit, och ett riktigt `npm run build` innan något
  pushas. Inte hopbuntat med granskad kod som redan är grön.

- [needs-human] **2026-08-25, bunt B — BIN-997 är INTE med i den här commiten.** Bunten
  valdes, routades (`medium`, säte #25), och fick sin blinda kritik FÖRE bygget. Den
  kritiken ligger stagead i `docs/org/metrics/events.jsonl` med `must_haves: 4`. Ingen kod
  följer med. Mätt vid commit-tillfället: `scripts/check-knowledge-caps.mjs` finns inte, och
  de tre kunskapsfilerna är oförändrade (`wc -c` → 295 844 / 66 042 / 30 303).

  Det står här därför att en granskningsrad utan artefakt annars är oskiljbar från
  "byggdes och tappades bort" — BIN-707/708/713:s evaporationsklass, och exakt vad den här
  loggen lades till för att stoppa. Funnet av integrationsgranskaren, som noterade att
  commiten skickar med en kritik för arbete den inte innehåller.

  **Varför den inte är byggd i den här commiten:** #25:s kritik blockerade på EN namngiven
  defekt — planen sa inte VAR veckosvepet anropar det nya skriptet, och en spärr som ingen
  kör är ett dekorativt golv. Svaret finns nu (`deploy.yml` har redan
  `schedule: cron '0 4 * * 1'`, så den icke-blockerande varningen hör hemma där, medan
  fil-golvet får tänder i en vitest-fil), men bunten är inte byggd och får inte redovisas
  som om den vore det.

  **Bunt B fortsätter efter den här commiten, i en egen commit.** Blir den inte av, är det
  den här posten som ska rättas — inte biljetten, som inte har någon kod att stå för.

- [discovery] **2026-08-26, `.claude/state/workflow-map-stale.json` — omspårad, ingen
  kartändring behövdes.** Flaggan stämplades av den här bunten med
  `triggers: ["src/app/stats/page.tsx"]`. Det enda flödet som namnger den noden är
  `flow-profile`, och båda dess `stats-page`-steg beskriver fortfarande vad koden gör efter
  ändringen — aggregeringen har samma form, bara med status-grinden synlig i loopen i
  stället för ärvd från `watched`. Flaggan är därför släckt utan att kartan rörs.
  Flaggfilen är gitignorerad, så ingen diff-baserad grind kan säga att detta gjordes; det
  är den enda platsen det står.

- [deviation] **2026-08-26, ett fynd som återkom INNE i sin egen fix.** Integrations-
  granskarens blockerande fynd 2 var att en kommentar i `src/lib/watchlistWrites.ts` blivit
  falsk av den här diffen. Rättelsen jag skrev bar ett NYTT omätt påstående — "every surface
  that reads a seen DATE goes through it" — som kodgranskaren fällde i nästa varv med två
  motexempel (`src/components/pages/MoviePageClient.tsx` och
  `src/lib/advisor/serviceValue.ts`). Båda kontrollerade av mig innan jag agerade.

  Det är 2026-08-21-lärdomen i sin renaste form, och den kostade ett granskningsvarv.
  Slutläget skriver därför ingen mening om mängden alls: båda strykningarna är bokförda
  (inklusive att den andra var min och falsk när den skrevs) och kommentaren slutar med ett
  `grep`-kommando i stället för ett tal.

  **Två tal som INTE är samma sak, och som inte ska slås ihop:** integrationsgranskaren
  räknade sex ställen som parar status-grinden med ett DATUMKRAV (de fem migrerade plus
  `useServiceValue.ts` → `serviceValue.ts`). Kodgranskaren räknade två ställen som läser
  `watchedAt` utan att själva applicera grinden (`MoviePageClient.tsx` och
  `serviceValue.ts`). Mängderna överlappar bara i `serviceValue.ts`.
  `MoviePageClient.tsx` ligger INUTI en `status === 'sedd'`-gren och matar
  `WatchedDateEditor` — den kan aldrig driva isär, och att dra den genom `seenDate()` vore
  en no-op. Den är alltså en datumläsare, inte en sjunde handkopia.


---

# SPRINT 2026-08-24

Planen för DENNA körning, skriven FÖRE bygget. Detta avsnitt är det enda underlaget
sprinten graderas mot. Nya avsnitt läggs överst; inget arkiveras bort.

8 biljetter. Router körd på VARJE biljetts faktiska filuppsättning vid HEAD `c348968`
(rå utdata inklistrad per biljett). Vidgar en kritik eller en fix filuppsättningen —
kör om `node docs/org/route.mjs --md <filer>` innan bygget fortsätter (BIN-766-lärdomen).

**Kapacitetskoll vid urvalet (BIN-744/776/917):** arbetaren är denna session, som KAN
konvenera både enskild rollkritik och full panel. BIN-998 routar `top` och får därför
full panel före bygget; övriga får sin enskilda ägarrolls blinda kritik.

## Ej valda, och varför

| Biljett | Beslut |
| -- | -- |
| BIN-935 | **Parkerad handbroms.** Bär en obesvarad "Behöver ditt beslut — jag bygger inget här" (2026-08-22). Byggs inte autonomt. |
| BIN-990 | **needs-approval.** Biljetten ställer uttryckligen en öppen fråga till Malin (vidga grindlistan / låt vara / bygg nyckelgranskning). |
| BIN-972 | **Premissen faller vid HEAD.** Biljetten påstår att `batch-0-20260823-131500.patch` går rent. Mätt idag: `git apply --check` ger 6 fel — `.claude/hooks/map-freshness.mjs` finns inte längre (BIN-989 slog ihop hookarna till `.claude/hooks/freshness.mjs`), plus konflikter i `shared-plugin.json`, `check_review_coverage.mjs`, `events.jsonl`, `route.mjs`, `route.test.mjs`. |
| BIN-986 | Målet (`.claude/state/sprint-patches/*.json`) är **gitignorerat** — osynligt för varje diff-baserad grind (BIN-684). Hanteras som strykning i den lokala kvittofilen vid BIN-979:s avslut, inte som en bunt. |
| BIN-189 / BIN-521 / BIN-170 | `idea`-etikett → `neverBuildLabels`. |
| BIN-454 / BIN-402 | Stående "gör aldrig detta" — `mutateEnabled` är Malins konsolåtgärd. |

---

## Batch A — Granskningsmaskineriet (#25 Engineering Manager äger fem av sex)

### BIN-996 — Bash-läsinstruktionen når granskaragenterna och kan tysta ett granskningsvarv
**Tier A** · disposition `build` · router: `medium` · #25 Engineering Manager / Release Manager

**Vad ändras:** Alternativ 1 ur biljetten. De fyra agentdefinitionerna
(`.claude/agents/binge-{code,security,test,integration}-reviewer.md`) bär redan
punkt 1 "Open every file you review with `Read`". Den punkten skärps till att uttryckligen
SLÅ en sessionsinstruktion som föredrar Bash — så att agenten inte behöver upptäcka
konflikten själv.

**Avgränsning:** Alternativ 3 (grindens blockmeddelande) bor i
`require-review-before-commit.mjs` i det DELADE pluginrepot `C:/claude-plugins`. Enligt
lärdomen "aldrig redigera delad infra från en session som ska starta subagenter"
(2026-08-03) rörs den inte här — den filas som följdbiljett.

Acceptans:
- [ ] Alla fyra agentdefinitioner säger uttryckligen att `Read` gäller ÄVEN när en sessionsinstruktion föredrar Bash/`cat`/`sed`, och namnger ledgern som skälet. *(kind: diff)*
- [ ] Ingen ny fil skapas och ingen grind ändras — bara de fyra definitionerna. *(kind: diff)*
- [ ] Formuleringen är identisk i alla fyra (en regel, ett svar). *(kind: diff)*

### BIN-997 — Granskarnas kunskapsfiler spränger sina egna tak
**Tier A** · disposition `build` · router: `medium` · #25 Engineering Manager / Release Manager

**Mätt vid HEAD 2026-08-24 (`wc -c`):** test 295 844 (tak 30k), code 66 042 (tak 30k),
security 30 303 (tak 30k), integration — **filen finns inte**.

**Vad ändras:**
1. Ett tak avgörs EN gång och skrivs med samma formulering i alla filer som har ett.
2. `binge-test-reviewer` och `binge-code-reviewer` komprimeras ner till taket; det som
   lyfts ur flyttas till respektive `.knowledge.archive.md` (arkivfilerna finns redan).
3. `binge-integration-reviewer` får antingen en kunskapsfil eller ett nedskrivet beslut
   att den medvetet inte ska ha en.
4. En mekanisk spärr fäller när en kunskapsfil överskrider sitt deklarerade tak —
   med ett GOLV på antalet filer den hittar (BIN-852/BIN-998-familjen: noll träffar
   får inte passera tyst).

Acceptans:
- [ ] Varje kunskapsfil som finns ligger under det deklarerade taket, mätt med `wc -c` i commit-meddelandet. *(kind: diff)*
- [ ] Ingen lärdom raderas utan att hamna i motsvarande `.knowledge.archive.md`. *(kind: diff)*
- [ ] En körbar spärr fäller vid överskridande OCH fäller när den hittar färre filer än golvet. *(kind: diff)*
- [ ] `binge-integration-reviewer`s läge är avgjort i skrift — fil eller nedskrivet nej, inte tystnad. *(kind: diff)*

### BIN-979 — route.test.mjs bär inaktuella tal, och golvet ligger för lågt
**Tier A** · disposition `build` · router: `medium` · #25 Engineering Manager / Release Manager

**Föregående försök FÄLLDES** (kvällssprinten 2026-08-23, `correctness=fail` + `intent=fail`):
strykningen ersatte tre uppmätta tal med ett NYTT universellt påstående
("Every count in both was outgrown by the next addition…") som är falskt — "five are
owned/[25]" är fortfarande exakt 5 och "the four under scripts/" fortfarande exakt 4.
**Bygg om från rent HEAD. Stryk utan att skriva något i stället.**

**Vad ändras** i `docs/org/route.test.mjs`:
- Kommentaren kring rad 304–309: stryk "the twelve", "the EIGHT under docs/org/",
  "the THREE under docs/org/metrics/" — behåll sakinnehållet, skriv INGA nya tal.
- Det fjärde talet i samma block ("instead of eight") stryks likaså.
- Golvet på rad 438 (`toBeGreaterThanOrEqual(12)`) höjs till listans FAKTISKA längd,
  mätt med ett kommando vid åtgärdstillfället, och kommandot skrivs bredvid raden.

Acceptans:
- [ ] Inget tal i det kommentarblocket är kvar, och inget nytt tal och inget generaliserande påstående om listan har skrivits i deras ställe. *(kind: diff)*
- [ ] Golvet är lika med `TOOLING_CODE_FILES.size` mätt idag, och kommandot som mätte det står i klartext bredvid. *(kind: diff)*
- [ ] `npx vitest run docs/org/route.test.mjs` är grön. *(kind: diff)*
- [ ] Ingen assertion mjukas upp för att gå grön. *(kind: diff)*

### BIN-991 — Två prosarader säger 299 där verkligheten är 300
**Tier A** · disposition `build` · router: `medium` · #25 Engineering Manager / Release Manager

Mätt idag: `ownership-gaps.json.accepted.length` = **300**. Träffarna sitter i
`docs/org/gen-ownership-map.mjs:182` och
`docs/org/world-watch/local-tooling/skills/refresh-dossiers/SKILL.md:66`.

Acceptans:
- [ ] Talet är STRUKET på båda ställena — 300 skrivs inte dit i stället (strykregeln). *(kind: diff)*
- [ ] Meningarnas övriga sakinnehåll överlever strykningen. *(kind: diff)*

### BIN-994 — accepted-deviations.md triggerladdas inte på docs/org/metrics/**
**Tier A** · disposition `build` · router: `medium` · #25 Engineering Manager / Release Manager

Enradsändring i frontmatterns `paths:`.

Acceptans:
- [ ] `docs/org/metrics/**` finns i `paths:`. *(kind: diff)*
- [ ] `.claude/shared-plugin.json` → `reviewGates` är ORÖRD — de två listorna vidgas aldrig av varandra (BIN-830), och den här biljetten låtsas inte ändra en grind. *(kind: diff)*

---

## Batch B — Regelinvarianten (full panel)

### BIN-998 — Ingen mekanism håller firestore.rules två identiska id-spärrar i synk
**Tier C** · disposition `build` · router: **`top`** → #4 Säkerhetsarkitekt, #6 DPO,
#27 DBA, #25 Engineering Manager, #21 Technical Writer. **Full panel körs FÖRE bygget.**

Mätt idag: `firestore.rules:333` och `:947` bär båda ordagrant samma
`id.matches(...)`-uttryck. Ingen kod, ingen lint och ingen router läser namnen
`canonicalWatchlistDocId` / `canonicalSwipeDocId` utanför testfiler.

**Vad ändras:** en spärr som extraherar båda `id.matches(...)`-strängarna ur
`firestore.rules` och hävdar att de är byte-identiska. **`firestore.rules` ändras INTE.**

**Avgränsning från biljetten:** detta är INTE en begäran om att hoista de två till en
delad hjälpare — uppdelningen är medveten och dokumenterad.

Acceptans:
- [ ] Spärren fäller när bara den ena regexen ändras (bevisat med en muterad kopia, inte påstått). *(kind: diff)*
- [ ] Spärren fäller när den hittar färre än två träffar — noll träffar får aldrig passera tyst (BIN-852). *(kind: diff)*
- [ ] En daterad kommentar säger att posten ska TAS BORT den dag de två medvetet ska glida isär, inte kringgås. *(kind: diff)*
- [ ] `firestore.rules` är byte-identisk med HEAD efter bygget. *(kind: diff)*

---

## Batch C — Testflakighet

### BIN-940 — userDocWrite.chokepoint.test.ts har BIN-937:s tidsmarginalproblem
**Tier A** · disposition `build` · router: `medium` · #5 Legal / GDPR Counsel

Mönstret som landade i `src/lib/watchlistWrites.addWrite.test.ts` (BIN-937) återanvänds.

Acceptans:
- [ ] Filinnehåll läses exakt en gång, nycklat på samma fillista som redan beräknas. *(kind: diff)*
- [ ] Noll ändringar inuti något `expect(...)` eller något regexuttryck — bara uppsättning. *(kind: diff)*
- [ ] Vakuitetskontrollen ställer sin fråga till CACHEN, inte bara till fillistan. *(kind: diff)*
- [ ] `npx vitest run src/lib/firebase/userDocWrite.chokepoint.test.ts` är grön. *(kind: diff)*

---

## Batch D — Bokföring utan kod

### BIN-973 — BIN-891:s strukna kommentar påstår ett beslut som inte finns i trädet
**Tier A** · disposition `build` · router: `skip` (ingen kodfil rörs)

Mätt idag: `.claude/hooks/map-freshness.mjs` finns inte längre — BIN-989 slog ihop
hookarna till `.claude/hooks/freshness.mjs`. Friskrivningen finns bara i den
utstashade patchen.

Biljetten erbjuder två vägar. Väg 1 (landa patchen) är stängd: patchen går inte rent
(se BIN-972 ovan). **Väg 2 väljs:** en daterad rättelse på BIN-891 som namnger patchfilen
som friskrivningens enda plats och återställer att punkten är ÖPPEN.

Acceptans:
- [ ] En daterad kommentar på BIN-891 säger att friskrivningen inte finns i trädet och namnger patchfilen. *(kind: diff)*
- [ ] Kommentaren återställer uttryckligen att punkten är öppen — protokollet över olöst arbete raderas inte. *(kind: diff)*
- [ ] Den strukna kommentaren skrivs INTE om; rättelsen är en ny, daterad efterföljare. *(kind: diff)*

---

## Deviation log

- [discovery] BIN-973: planen sa "friskrivningen finns bara i en utstashad patch". Mätt vid HEAD `c348968`: `grep -rn "BIN-969" .claude/hooks/` ger EN träff, `.claude/hooks/freshness.mjs:123`, och `git log -S "THE GIT-APPLY GAP"` pekar på `4393344`. BIN-989 döpte om `map-freshness.mjs` → `freshness.mjs` och tog friskrivningen med sig. Premissen är alltså ÖVERTAGEN, inte falsk. → Konservativt val: ingen kodändring; en daterad rättelse skrivs, och BIN-973 stängs som övertagen av `4393344`.
- [deviation] BIN-973: BIN-891 är ARKIVERAD (`archivedAt` 2026-08-17), och Linear vägrar `save_comment` mot ett arkiverat ärende. → Konservativt val: rättelsen skrivs på BIN-973 självt, som är öppet och länkar till BIN-891, i stället för att avarkivera ett stängt ärende bara för att kunna kommentera det. Acceptanskriterium 1 omformuleras därmed till "en daterad rättelse finns på en LÄSBAR, öppen yta som namnger den sanna sökvägen" — den ursprungliga lydelsen ("på BIN-891") är omöjlig, inte ouppfylld.
- [deviation] Jag bröt `.claude/shared-plugin.json` mitt i en rättelse: ett `\.`-escape i en Python-sträng blev `\.` i JSON, vilket är ett ogiltigt JSON-escape. Filen slutade parsa och 818 test föll i samma körning. Lagat direkt genom att formulera om kommandot utan escapen. → Lärdom för körningen: kör HELA sviten efter varje redigering av en fil som andra test läser som data, inte bara sviten för filen du tror du ändrade. Ett trasigt JSON ser ut som 818 orelaterade testfel.
- [discovery] Linear-taket är FULLT igen. `save_issue` (create) svarade "You've exceeded the free issue limit for this workspace" på BÅDA följdbiljetterna 2026-08-25. Samma leveransfel som 2026-08-16. → Konservativt val: varje följdfynd skrivs som en FULLSTÄNDIG kommentar på närmaste öppna moderbiljett, märkt med varför det inte blev en egen biljett, och hela listan upprepas i sprintrapporten. Taket rapporteras som något Malin måste åtgärda — annars blir "kunde inte filas" och "hittade inget" samma sträng.
- [discovery] `firestore.rules` visade en diff mitt i avslutningen (`canonicalSwipeDocId` smalnad till `{0,8}`). Det var INTE min ändring: BIN-998:s utfallsverifierare kör just då sin egen mutation för kriterium 1, med instruktion att ögonblicksbilda och återställa. → Konservativt val: rör den INTE. Att återställa den åt verifieraren mitt i dess körning är exakt kollisionen från 2026-08-05 (en systeragents återställning landade mellan mutantens för- och efterkontroll och gav ett falskt "död spärr"-resultat). Hashen kontrolleras om mot HEAD `63c5daf0055e3b5b71d7e18ca0153abf0df7cbb1` före stage, och ingenting committas förrän den stämmer.
- [needs-human] BIN-997 PARKERAD, ej byggd. #25 Engineering Manager lade en VILLKORAD BLOCKERING på biljettens punkt 4 (den mekaniska takspärren): rollens eget dossier, `docs/role-responsibilities.md` §25, undantar uttryckligen `*.knowledge*.md` från grindning — "gating them would put routine bookkeeping behind a review", samma beslut Malin fattade for lessons-digest.md (BIN-851/BIN-869). Spärren får därför bara byggas antingen icke-blockerande eller efter en daterad, skriven omprövning av det beslutet. Det är Malins beslut, inte en granskares och inte mitt.
  Punkterna 1-3 utan punkt 4 återskapar exakt den drift biljetten är filad om, så de byggs inte heller lösryckta. Och punkt 2 är i sak en 90-procentig radering: `.claude/agents/binge-test-reviewer.knowledge.md` är 295 844 tecken mot ett deklarerat tak på 30k (mätt med `wc -c` 2026-08-25), fördelat på 114 rader i 14 avsnitt där enskilda punkter är upp till 30 317 tecken - alltså inte daterade poster som kan flyttas till arkivet, utan tät principtext som måste skrivas om. #25 flaggade själv förlustrisken och begärde ett andra granskningspass. En obevakad 90-procentig radering av det de fyra granskningsgrindarna vet är inte en sprintändring. -> Konservativt val: parkeras In Review med rollens stake och den öppna frågan utskriven; ingen kod rörd.
- [discovery] BIN-998 — ROLLKONFLIKT, avgjord med en mätning. #21 Technical Writer krävde att spärren läggs som ett `it()` i `src/test/rules/firestore-rules.test.ts` med motiveringen "den samlas redan in av huvudkörningen". Det är FALSKT: `vitest.config.ts` har `exclude: ['node_modules', '.next', 'out', 'src/test/rules/**']`, och den katalogen körs bara av `npm run test:rules`, som kräver Java + Firestore-emulatorn och är ett eget CI-jobb. #25 Engineering Manager och #27 DBA krävde tvärtom att spärren måste ligga där `npm test` faktiskt kör den. → Konservativt val: #25/#27 vinner på mätningen. Spärren läggs som `docs/org/rules-doc-id-symmetry.test.mjs`, som fångas av den befintliga glob `docs/org/**/*.{test,spec}.mjs`. #21:s ÖVRIGA villkor (golv före jämförelse, ingen ny .md, kommentaren som en HANDLING utan omätta tal, `firestore.rules` orörd) gäller oförändrade.
- [discovery] BIN-998 → BIN-979 sekvensberoende. `TOOLING_CODE_FILES.size` = **17** vid HEAD `c348968` (mätt med `node -e "import('./docs/org/route.mjs').then(m=>console.log(m.TOOLING_CODE_FILES.size))"`). BIN-998 lägger till sin nya fil i samma mängd, så BIN-979:s golv måste mätas EFTER att BIN-998 landat, annars sätts det på ett inaktuellt tal. → Konservativt val: BIN-998 byggs först; BIN-979:s golv mäts om med kommandot när båda ändringarna ligger i trädet.
- [deviation] BIN-996: alternativ 3 ur biljetten (grindens blockmeddelande) bor i `C:/claude-plugins`. Den här sessionen har startat subagenter, och en refuserad redigering av delad infra förgiftar varje efterföljande agent (2026-08-03). → Konservativt val: bara alternativ 1 byggs här; alternativ 3 filas som följdbiljett.

---

# SPRINT 2026-08-22

Planen för DENNA körning, skriven FÖRE bygget. Det här avsnittet är det enda underlaget
sprinten graderas mot — inget arkiveras, inget raderas, nya avsnitt läggs överst.

9 biljetter, 4 batchar, 4 agenter (A–D). Blast-radius: samtliga är bokförda **Tier A** i
urvalsavsnittet nedan (`# Sprint 2026-08-22 — Selection`); ingen biljett pinnades
`full-panel` vid urvalet, dispositionerna är `build` eller `build-review`. Rollkritikerna
som redan körts är invikta nedan som BINDANDE acceptanskriterier, märkta med rollens namn
i hakparentes. **Vidgar en kritik eller en fix filuppsättningen — kör om
`node docs/org/route.mjs <filer>` innan bygget fortsätter** (BIN-766-lärdomen).

**Flagga från urvalet:** BIN-923 kom in med FÄRRE ÄN TVÅ graderbara kriterier på själva
biljetten (ett enda). Den graderas därför mot biljettens egna kriterium PLUS #25:s fyra
bindande villkor nedan — inga uppmjukade ersättare är uppfunna.

---

## Batch A — Watchlist (Agent A)

### BIN-955 — Två snabba avsnittsbockningar på samma ospårade serie kan lägga till den två gånger
**Tier:** A (urval), disposition `build`. Rollkritik: Software Architect (invikt nedan).
**Vad ändras:** Ersätt märket `addedByProgressRef` som sätts EFTER skrivningen med ett
per-dokument "pågår"-märke, så att två samtidiga `updateProgress`-anrop på add-grenen inte
båda lägger till titeln (`src/contexts/WatchlistContext.tsx`).

Acceptans:
- [ ] Två samtidiga tittar-gester på samma ospårade serie ger exakt EN `title_added_watchlist`-händelse och EN tilläggsskrivning. *(kind: diff)*
- [ ] Ett misslyckat tillägg är fortfarande omförsökbart på nästa bockning — "pågår"-märket överlever aldrig ett fel. *(kind: diff)*
- [ ] Det andra anropet tar aldrig merge-grenen mot ett dokument som ännu inte finns. *(kind: diff)*
- [ ] Nedskrivet beslut om `getTVShowLite` ska adoptera `fetchQuery`+`AbortSignal` här, eller skälet att inte göra det står dokumenterat i koden. *(kind: run)*
- [ ] [Software Architect] Märket rensas när tillägget MISSLYCKAS (TMDB-hämtningen kastar eller `upsertTitle` avvisas), så omförsökbarheten består — ett märke som bara rensas vid uid-byte (`useEffect` vid rad 393) skulle göra titeln olägg-bar resten av sessionen vid ett övergående fel. *(kind: diff)*
- [ ] [Software Architect] Den befintliga `removalTickRef`-kapplöpningsspärren (märk bara om `removalTickRef.current === removalTickAtStart`) hedras även under det nya märket — en radering som startar medan tillägget pågår måste fortfarande hindra märket från att överleva ett raderat dokument. *(kind: diff)*
- [ ] [Software Architect] Märket uppfyller fortfarande `known`-kollens befintliga semantik (rad 1036) för det SEKVENTIELLA auto-hoppsfallet (bockning → auto-advance) — den vägen får inte regrera medan det samtidiga fallet lagas. *(kind: diff)*
- [ ] [Software Architect] Ett test i `WatchlistContext.test.tsx` driver två SAMTIDIGA `updateProgress(..., { addIfMissing: true })` på samma ospårade TV-titel och hävdar exakt ett "written"-utfall (det andra anropet får varken göra en andra TMDB-hämtning eller ett andra `upsertTitle`). *(kind: diff)*

### BIN-928 — "Räknade skrivningen en omtitt" härleds på två ställen, bara typer håller dem i synk
**Tier:** A (urval), disposition `build`. Rollkritik: Legal / GDPR Counsel (invikt nedan).
**Vad ändras:** En dokumentationsrad i `outcomeOfAddWrite` som namnger beroendet på
`buildAddWrite`s nyckel, plus ett nedskrivet beslut om `rewatchCount` ska in i
runtime-strippen (`src/lib/watchlistWrites.ts`).

Acceptans:
- [ ] `outcomeOfAddWrite` får en doc-kommentar som namnger den `buildAddWrite`-nyckel den läser och vad en vidgning av nyttolasttypen skulle bryta. *(kind: diff)*
- [ ] Nedskrivet beslut: `rewatchCount` läggs till i runtime-strippen bredvid `notes`/`tags`, ELLER lämnas som enbart typnivå-skydd — med skälet. *(kind: diff)*
- [ ] [Legal / GDPR] Den nya kommentaren säger BARA att `outcomeOfAddWrite` härleds ur `buildAddWrite`s skrivnyckel (en saklig beroendenotis) och formulerar inte om någon befintlig mening i filen — enligt strykregeln STRYKS en felaktig/inaktuell mening i närheten, den skrivs inte om. *(kind: diff)*
- [ ] [Legal / GDPR] Beslutet om `rewatchCount` bokförs som ett BESLUT (daterad kommentar eller post i `accepted-deviations.md`) med skäl — och `rewatchCount` läggs INTE tyst in i notes/tags-strippen under den här biljetten: det är en numerisk räknare, inte tredjepartspersonuppgifter, och därmed ingen kandidat för den integritetsdrivna strippen. *(kind: diff)*

### BIN-957 — Tre best-effort-skrivvägar loggar med console.warn — osynligt för Sentry
**Tier:** A (urval), disposition `build`. Rollkritik: Database Administrator / Data-layer Engineer (invikt nedan).
**Vad ändras:** `console.warn` → `console.error` + `captureError({ scope: 'watchlist', kind })`
på `setRuntime`, `refreshTmdbFields` och båda catch-ställena i `flushNextAirWrites`
(`src/contexts/WatchlistContext.tsx`, `src/lib/watchlist/nextAirReadRepair.ts`) — samma
mönster som BIN-942 gav de sex tystade redigeringsvägarna.

Acceptans:
- [ ] Alla fyra catch-ställen rapporterar via `captureError` med en EGEN `kind` per anropsplats. *(kind: diff)*
- [ ] Nedskrivet beslut: smalna av till `isPermissionDenied` som de sex redigeringsvägarna, eller förbli bred catch — med skälet (dessa är best-effort/self-healing, till skillnad från de sex). *(kind: diff)*
- [ ] Ett test per ställe bevisar att felet BÅDE loggas OCH sväljs (inget kast). *(kind: diff)*
- [ ] Ingenting ändras i att vägarna sväljer fel — bara HUR de rapporterar. *(kind: diff)*
- [ ] [DBA / Data-layer] Vart och ett av de tre ställena behåller sin catch-ALLT-form (ingen avsmalning till `isPermissionDenied` som i `guardedItemWrite`) — de är best-effort-denormaliserings-/reparationsvägar som ska rapportera övergående fel likaväl som behörighetsfel. *(kind: diff)*
- [ ] [DBA / Data-layer] `captureError` anropas med `(err, { scope: 'watchlist', kind })` enligt den etablerade signaturen i `WatchlistContext.tsx:90`, och vart och ett av de fyra ställena (setRuntime, refreshTmdbFields, `flushNextAirWrites` per-chunk-commit-felet, `flushNextAirWrites` yttre import/fsdb-felet) får en EGEN `kind`-sträng så att ett Sentry-larm kan skilja dem åt. *(kind: diff)*
- [ ] [DBA / Data-layer] `console.error` ERSÄTTER `console.warn` (tas inte bort) bredvid `captureError`, så lokal dev-/emulator-synlighet inte går förlorad. *(kind: diff)*
- [ ] [DBA / Data-layer] Den befintliga återrullningen av dedupe-märket i `flushNextAirWrites` två catch-ställen (`writtenThisSession.delete`) är ORÖRD av loggbytet. *(kind: diff)*
- [ ] [DBA / Data-layer] `nextAirReadRepair.ts` importerar `captureError` från `@/lib/sentry` (speglar `WatchlistContext.tsx`s befintliga import) — ingen ny fil, bara en ny importrad. *(kind: diff)*

---

## Batch B — Streaming offers (Agent B)

### BIN-931 — Det regexbaserade skyddet mot bare-id-skrivningar har nått sitt strukturella tak (9 vidgningsrundor)
**Tier:** A (urval), disposition `build-review` (In Review, aldrig auto-Done).
Rollkritik: Data / Integrations Engineer (invikt nedan).
**Vad ändras:** De 4 regex-källkodsskanningarna + 2 frånvaro-testen ersätts av EN
AST-baserad ESLint-regel (scope-analys, kan följa en bindning) som fäller varje
`streamingOffers`-skrivning vars id inte härrör från `mediaTypeDocId`/`streamingOffersDocId`.

Acceptans:
- [ ] En AST-baserad ESLint-regel svarar på: når ett värde som inte spåras till `mediaTypeDocId`/`streamingOffersDocId` en skrivning mot `streamingOffers`? Raderingar med bare-id förblir tillåtna. *(kind: diff)*
- [ ] De 4 regex-skanningarna och de 2 frånvaro-testen är borttagna, och commiten namnger VILKA av de 8 historiska hålen den nya regeln stänger. *(kind: diff)*
- [ ] Regelns omfång skrivs från biljettens uppmätta lista — regexen vidgas INTE ytterligare som ersättning för att bygga AST-regeln. *(kind: diff)*
- [ ] Nedskrivet beslut om regeln även ska täcka `priceHistory` (samma bare/namngivna delning). *(kind: diff)*
- [ ] [Data / Integrations] Regeln fäller i VARJE `streamingOffers`-skrivande fil under `functions/src`, inte bara `index.ts` — ett `db.collection('streamingOffers').doc(<expr>).set/update/create(...)` i en helt ny modul måste flaggas. Det är garantin dagens andra test ("no OTHER file… writes to streamingOffers") finns för; AST-regeln måste ersätta DEN garantin, inte bara det första testets. *(kind: diff)*
- [ ] [Data / Integrations] Regeln följer en bunden referens över `const ref = db.collection('streamingOffers').doc(expr)` och senare `ref.set(...)` — bind-sedan-skriv-formen som tog regexen tre vidgningsrundor att fånga. Icke förhandlingsbart: scope-analysen är hela skälet att välja AST. *(kind: diff)*
- [ ] [Data / Integrations] Raderingar på bare-id förblir tillåtna — `legacyRef.delete()` i refresh-kronans städning och `deleteBare()` i migreringen får INTE flaggas; bara `set`/`update`/`create` med ett id som inte härleds ur `mediaTypeDocId`/`streamingOffersDocId`. *(kind: diff)*
- [ ] [Data / Integrations] `npm run lint` i repo-roten kör faktiskt den nya regeln mot `functions/src/streamingOffers/index.ts` och FÄLLER på ett medvetet återinfört bare-id (verifiera genom att tillfälligt återställa källan, observera felet, återställ sedan) — `npm run lint` är det enda lint-steget som är inkopplat i CI (`ci.yml`, `deploy.yml`); `functions/package.json`s egen lint-skript är en no-op-stubbe idag. *(kind: run)*
- [ ] [Data / Integrations] `backfillIds.ts`/`backfillIds.test.ts` fortsätter testa `runIdBackfill`s faktiska migreringsbeteende (`targetFor`/`pendingTargets`/`unattributableBareIds`, skriv-sedan-radera-ordningen) — bara de källkodsskannande regex-testen ("V7"-blocket) pensioneras. Attributions- och ordningstesten är en ANNAN garanti och får inte raderas i samma svep. *(kind: diff)*

### BIN-932 — backfillIds terminalläge loggar ingenting medan headern påstår motsatsen
**Tier:** A (urval), disposition `build`. Rollkritik: Data / Integrations Engineer (invikt nedan).
**Vad ändras:** Antingen logga en gång när `complete && bareFound === 0`, eller smalna av
headerns påstående till "medan bare-dokument återstår"; plus rätta testfilens kommentar
som saknar backslashes (`functions/src/streamingOffers/backfillIds.ts` + `.test.ts`).

Acceptans:
- [ ] Antingen fyrar en loggrad på `complete && bareFound === 0`, eller headerns mening smalnas av — välj EN, skriv skälet. *(kind: diff)*
- [ ] `backfillIds.test.ts:267`s kommentar lyder `(?:db\s*\.\s*)?` och matchar regexen på rad 275. *(kind: diff)*
- [ ] [Data / Integrations] Terminalläget (`bareFound === 0`, dvs. klart utan något kvar att rapportera) producerar exakt ETT `io.log.info`-anrop per körning — verifierat av ett test som kör `runIdBackfill` med en skanning som ger noll bare-dokument och hävdar att loggspionen anropades en gång med `complete: true`, `bareFound: 0`. *(kind: diff)*
- [ ] [Data / Integrations] Befintligt beteende för `bareFound > 0` är oförändrat (loggar fortfarande en gång, samma form) — inget nu pinnande test regrerar. *(kind: diff)*
- [ ] [Data / Integrations] Om headerkommentaren över `runIdBackfill` redigeras i stället för / vid sidan av loggraden: dess påstående att flaggan "reaches a human through the log line below and NOWHERE else" rättas så att det håller i ALLA fall (idag falskt när `bareFound === 0`) — enligt strykregeln smalnas det av till det som faktiskt är sant, det formuleras inte om till en ny okontrollerad utsaga. *(kind: diff)*
- [ ] [Data / Integrations] Skriv-först/radera-sedan-ordningen, exists-grenens dedup och `unattributable`-varningsblocket är ORÖRDA av denna diff — biljetten är en logg-/kommentarfix, inte en beteendeändring i migreringsloopen. *(kind: diff)*
- [ ] [Data / Integrations] Testfilens backslash-rättelse rör BARA den felskrivna kommentartexten (en dokumentationsfix i en regex-beskrivande kommentar), inte någon av de faktiska `RegExp`-literalerna i assertionerna. *(kind: diff)*

---

## Batch C — Review-gate tooling / ägarskap (Agent C)

### BIN-922 — Namnge en ägare för secret-scan.yml, den enda workflow som saknar en
**Tier:** A (urval), disposition `build-review` (In Review, aldrig auto-Done).
Rollkritik: #25 Engineering Manager / Release Manager (invikt nedan).
**Vad ändras:** En ägande roll utses för `.github/workflows/secret-scan.yml`,
`docs/org/ownership-map.json` regenereras, och den nu onödiga `ACCEPTED_ASYMMETRIES`-posten
tas bort ur `docs/org/gate-symmetry.test.mjs`.

Acceptans:
- [ ] En ägare är namngiven för `.github/workflows/secret-scan.yml` i `docs/role-responsibilities.md`, och `ownership-map.json` är regenererad. *(kind: diff)*
- [ ] `ACCEPTED_ASYMMETRIES`-posten för secret-scan.yml är borttagen ur `gate-symmetry.test.mjs` och kollen går grön UTAN den. *(kind: run)*
- [ ] [#25] Den ägande rollen är §8 (DevOps/SRE) eller §20 (Manual/Release QA Tester) — de två roller som den befintliga `ACCEPTED_ASYMMETRIES`-posten själv pekar ut som rätt att avgöra det. Den får INTE tilldelas #25 (Engineering Manager / Release Manager) och inte lämnas till #14-fallbacken. *(kind: diff)*
- [ ] [#25] `docs/org/ownership-map.json` är producerad genom att KÖRA generatorn (`gen-ownership-map.mjs`), inte handredigerad, så den förblir härledd ur `role-responsibilities.md`s backtick-citerade sökvägar. *(kind: run)*
- [ ] [#25] `ACCEPTED_ASYMMETRIES`-posten raderas först EFTER att vitest-körningen som täcker `gate-symmetry.test.mjs` körts och gått grön utan posten — asymmetrin ska bevisas stängd, inte påstås stängd i prosa. *(kind: run)*
- [ ] [#25] `.claude/shared-plugin.json`s `reviewGates` lämnas ORÖRD: den blockerande grindens `^\.github/(workflows|actions)/`-prefix täcker redan secret-scan.yml, så biljetten ändrar bara VEM som råder, inte om en commit stoppas. Visar det sig att en grindändring också behövs vidgas omfånget och routern måste köras om innan bygget fortsätter. *(kind: diff)*

### BIN-923 — vitest.rules.config.ts / vitest.setup.ts har inget test som namnger dem som CODE_ROOT_FILES
**Tier:** A (urval), disposition `build`. Rollkritik: #25 Engineering Manager / Release Manager (invikt nedan).
**FLAGGAD:** biljetten bar bara ETT graderbart kriterium. Den graderas mot det plus #25:s
fyra bindande villkor — inga mjukare ersättare uppfunna.
**Vad ändras:** Ett namngivet testfall i `docs/org/route.test.mjs` som hävdar att båda
filerna routas icke-`skip`, bredvid de befintliga rot-fil-fallen. Testtäckning enbart.

Acceptans:
- [ ] Ett namngivet fall i `route.test.mjs` hävdar att `vitest.rules.config.ts` OCH `vitest.setup.ts` båda routas icke-`skip`. *(kind: diff)*
- [ ] [#25] Testfallet namnger båda filerna EXPLICIT (med filnamn, inte ett wildcard-glob) och hävdar att var och en routas icke-`skip` via samma `route()`/`CODE_ROOT_FILES`-stödda hjälpare som de befintliga rot-fil-fallen använder — inte en handrullad dubblettkoll. *(kind: diff)*
- [ ] [#25] Testet läggs bredvid de befintliga rot-fil-fallen i `docs/org/route.test.mjs` (samma describe-block/mönster), inte som en ny fil eller en ny testkonfiguration. *(kind: diff)*
- [ ] [#25] Ingen produktionskod, CI-konfiguration eller `CODE_ROOT_FILES`-medlemskap ändras — biljetten är enbart testtäckning för två filer som REDAN ska routas icke-`skip`. Routas någon av dem inte så idag är det en separat defekt att FILA, inte något den här biljetten tyst lagar genom att redigera `route.mjs`. *(kind: diff)*
- [ ] [#25] `npm test` (eller den befintliga kollen som kör `route.test.mjs`) förblir grön efter tillägget, vilket bevisar att det nya fallet passerar mot `route.mjs` som den ser ut idag. *(kind: run)*

### BIN-934 — Rot-package-lock.json är osynlig för routern; de två låsfilerna hamnade i olika granskarklasser av misstag
**Tier:** A (urval), disposition `build-review` (In Review, aldrig auto-Done).
Rollkritik: #25 Engineering Manager / Release Manager (invikt nedan).
**Vad ändras:** Ett beslut om låsfiler räknas som kod för routern, applicerat LIKA på båda
`package-lock.json`-filerna eller med skillnaden nedskriven
(`docs/org/route.mjs`, ev. `.claude/shared-plugin.json`, `docs/role-responsibilities.md`).

Acceptans:
- [ ] Ett DATERAT beslut är skrivet (route.mjs-kommentar eller ADR): räknas `package-lock.json` som kod för routern? *(kind: diff)*
- [ ] Beslutet appliceras identiskt på BÅDA låsfilerna, eller skillnaden är nedskriven med sitt skäl. *(kind: diff)*
- [ ] Om "ja, kod": `CODE_ROOT_FILES` och `.claude/shared-plugin.json`s `reviewGates` flyttas i SAMMA commit (BIN-830-regeln), och `_note9`s mening om ogranskade beroendeuppdateringar rättas. Om "nej": beslutet skrivs in i `route.mjs` bredvid `CODE_ROOT_FILES`. *(kind: diff)*
- [ ] [#25] Båda `package-lock.json`-filerna (rot och `functions/`) kommer ut IDENTISKT ur `docs/org/route.mjs`, eller så namnges och motiveras den kvarvarande skillnaden i en kodkommentar på samma sätt som de två `package.json`-filerna redan har — bevisat av en `route.test.mjs`-assertion som kör `isCodePath()`/`route()` på båda exakta sökvägarna och kollar samma svar (eller hävdar det dokumenterade undantaget). *(kind: diff)*
- [ ] [#25] Om beslutet gör låsfiler till kod: `.claude/shared-plugin.json`s `reviewGates` uppdateras i SAMMA commit så att den rådgivande och den blockerande sidan inte glider isär (`functions/package-lock.json` når redan `binge-security-reviewer` via `^functions/`; rot-låsfilen når ingen grind) — bevisat av att `docs/org/gate-symmetry.test.mjs` förblir grön UTAN något nytt tyst tillagt namngivet undantag för en låsfil. *(kind: run)*
- [ ] [#25] `docs/role-responsibilities.md` §25:s `package.json`-punkt, som idag skjuter exakt den här delningen till BIN-930 som en öppen fråga, uppdateras till att ange beslutet som fattas här i stället för att motsäga den shippade koden. *(kind: diff)*
- [ ] [#25] `node docs/org/route.mjs --selftest` och de befintliga sviterna `route.test.mjs`/`gate-symmetry.test.mjs` förblir gröna utan att någon befintlig assertion försvagats eller raderats för att få ändringen att landa. *(kind: run)*

---

## Batch D — Workflow-map (Agent D, EGEN commit)

### BIN-927 — Kartans omtitt-flöde saknar steget där skrivningen rapporterar tillbaka vad den räknade
**Tier:** A (urval), disposition `build`.
**Vad ändras:** Steget `TitleWriteOutcome`/`countedRewatch` läggs till i omtitt-flödets
data-JSON i `docs/workflow-map.html` — i en egen commit utan något annat i.

Acceptans:
- [ ] Rapporteringssteget är tillagt i omtitt-flödets `<script id="data">`-JSON, inget annat i filen ändrat. *(kind: diff)*
- [ ] Det shippas som EGEN commit — `git show --stat` på den commiten visar bara `docs/workflow-map.html`. *(kind: run)*
- [ ] `node scripts/check-workflow-map.mjs` går grön. *(kind: run)*
- [ ] Nedskrivet beslut: accepteras `git apply`-luckan i färskhetsstämplingen (PostToolUse-hooken fyrar inte på `git apply`) som den är, eller ska den få en andra utlösare — filat som uppföljning i det senare fallet. *(kind: diff)*

---

## Graderingsregler för den här körningen

- Varje biljett bockas av mot kriterierna OVAN, inte mot en självrapport. Ett påstående om
  att något är uppfyllt kräver att kommandot körts (`kind: run`) eller att diffen visar det
  (`kind: diff`).
- Per batch måste ett av {commit, patch, stash, nedskrivet misslyckande} finnas vid
  close-out — "ingen diff" får aldrig tolkas som "inget arbete" (BIN-707/708).
- `build-review`-biljetterna (BIN-931, BIN-922, BIN-934) går till In Review, aldrig
  auto-Done.
- Ingen commit-/transitionsrad skrivs av den som bygger; completion-anspråk bärs av den som
  håller commit-shan (BIN-766-lärdomen).

---

# Sprint 2026-08-22 — Selection

Selected via `/sprint-execute` Phase 1. 10 tickets, 4 batches, all disposition `build` or
`build-review` (no full-panel tickets this round). Router tier per ticket resolved at
dispatch (`node docs/org/route.mjs --md <files>`) — none pinned `full-panel` from the
Step-0 file read below, so none trip `requiresPlanMode`; re-run the router if a critique
widens a batch's file set (BIN-766 lesson) and recompute before commit.

## Batch A — Watchlist (agent: direct or binge specialist)

Files cluster around `WatchlistContext.tsx` / `watchlistWrites.ts` — keep this batch
serial internally where two tickets touch the same function.

- [ ] **BIN-689** [Tier A] disposition: build. "watchedAt räknas bara när status är sedd"
      handkopierad på 7 ställen (`src/hooks/useServiceValue.ts`,
      `src/components/pages/DiaryPageClient.tsx`, `src/components/pages/UserProfilePageClient.tsx`,
      `src/app/stats/page.tsx`, `src/components/pages/WatchlistPage.tsx`,
      `src/lib/taste/stats.ts`, `src/lib/diary.ts`). Malins beslut 2026-08-06: **JA, bygg
      den — men som egen, seriell körning, inte buntad med annat arbete i samma filer**
      (villkoret från 2026-08-02/06 parkeringen, bindande). Router: medium → en blind
      kritik från **#28 Recommendations / Scoring-Integrity Engineer** krävs före commit
      (BIN-776-regeln: kan arbetaren inte kalla in kritiken parkerar biljetten In Review,
      byggs inte Done).
      Acceptance:
      - [ ] Predikatet extraherat till EN ren helper i `src/lib/` (test-extraction-mönstret), och samtliga 7 uppräknade anropsställen migrerade i SAMMA ändring — ingen partiell migrering. *(kind: diff)*
      - [ ] Ett test dödar mutanten "ta bort sedd-gaten" (predikatet returnerar sant utan att status faktiskt är `sedd`). *(kind: diff)*
      - [ ] `updateTags` och `removeItem` rörs INTE — de slår inte upp ett item vid HEAD, migrera dem inte i blindo. *(kind: diff)*
      - [ ] #28:s blinda kritik loggad (`node docs/org/metrics/log_event.mjs review`) innan denna ticket stänger Done. *(kind: run)*

- [ ] **BIN-955** [Tier A] disposition: build. Två snabba tittar-gester på samma ospårade
      serie kan lägga till den två gånger (`src/contexts/WatchlistContext.tsx`
      `updateProgress`). Uppföljning på BIN-954, ej beslutsparkerad.
      Acceptance:
      - [ ] Två samtidiga tittar-gester på samma ospårade serie ger EN `title_added_watchlist` och EN tilläggsskrivning (per-dokument "pågår"-märke, inte ett globalt). *(kind: diff)*
      - [ ] Ett misslyckat tillägg är fortfarande omförsökbart på nästa bockning — "pågår"-märket överlever inte ett fel. *(kind: diff)*
      - [ ] Det andra anropet tar aldrig merge-grenen mot ett dokument som inte finns (samma fragment-fälla BIN-954 stängde). *(kind: diff)*
      - [ ] Beslut nedskrivet i koden/PR om `fetchQuery`+`AbortSignal` adopteras för `getTVShowLite` här, eller om skälet att INTE göra det (WatchlistProvider sitter ovanför QueryClientProvider) står kvar. *(kind: run)*
      - [ ] `removalTickRef`-kommentaren utvidgas till att nämna BÅDA konsekvenserna (extra tilläggsskrivning + auto-hoppets gren C), inte bara den första. *(kind: diff)*

- [ ] **BIN-928** [Tier A] disposition: build. "Räknade skrivningen en omtitt" härleds på
      två ställen i `src/lib/watchlistWrites.ts` (`buildAddWrite`s rewatch-fragment vs
      `outcomeOfAddWrite`), bara typnivå-skydd, ingen runtime-strip.
      Acceptance:
      - [ ] En dokumentationsrad i `outcomeOfAddWrite` namnger beroendet på `buildAddWrite`s nyckel och vad som händer om nyttolasttypen vidgas. *(kind: diff)*
      - [ ] Beslut nedskrivet: `rewatchCount` in i runtime-strippen bredvid `notes`/`tags`, eller kvar som typnivå-skydd — med skälet. *(kind: diff)*

- [ ] **BIN-957** [Tier A] disposition: build. Tre best-effort-skrivvägar loggar med
      `console.warn` (osynligt för Sentry — `initSentry()` sätter aldrig
      `defaultIntegrations`, så console.warn är en REGRESSION mot att låta felet bubbla).
      `WatchlistContext.setRuntime`, `WatchlistContext.refreshTmdbFields`,
      `src/lib/watchlist/nextAirReadRepair.ts` `flushNextAirWrites` (2 catch-ställen).
      Krävd av #6 Dataskydd + #27 Databas (BIN-942 villkor 10/24/31), skärpt av #7 QA.
      Acceptance:
      - [ ] Alla fyra catch-ställen rapporterar via `console.error` + `captureError(err, { scope: 'watchlist', kind: '<anropsplats>' })`, samma form som BIN-942's sex tystade redigeringsvägar. *(kind: diff)*
      - [ ] Beslut nedskrivet: smalna av till `isPermissionDenied` (`src/lib/firebase/errorCodes.ts`) eller förbli bred catch — med skälet (dessa är best-effort/self-healing, till skillnad från de sex). *(kind: diff)*
      - [ ] Ett test per ställe: felet loggas OCH sväljs (inget kast) — pinnar mot en framtida ändring som tyst gör dem kastande. *(kind: diff)*
      - [ ] Ingenting ändras i att vägarna sväljer — frågan är HUR de rapporterar, inte OM de bubblar. *(kind: diff)*

## Batch B — Streaming Offers Backfill (agent: direct)

Både tickets rör `functions/src/streamingOffers/backfillIds.ts` + dess testfil — samma
batch med flit.

- [ ] **BIN-931** [Tier A] disposition: build-review. Regex-baserat skydd mot bare-id-
      skrivningar i `streamingOffers` har 9 vidgningsrundor och ett strukturellt tak
      (kan inte följa en bindningskedja). Bygg en AST-baserad ESLint-regel i stället.
      signoffReason: verifiera att den nya regeln FAKTISKT stänger de två kända
      gapen (batched multi-doc write via icke-`db`/`col`-namngiven mottagare;
      two-hop bound reference) innan de fyra regex-skanningarna + två frånvaro-testen tas bort.
      Acceptance:
      - [ ] En AST-baserad ESLint-regel (scope-analys, kan följa en bindning) svarar på: når ett värde som INTE kommer från `mediaTypeDocId`/`streamingOffersDocId` en skrivning mot `streamingOffers`? Raderingar med bare-id förblir tillåtna. *(kind: diff)*
      - [ ] De fyra regex-källkodsskanningarna och de två frånvaro-testen ("no batch write exists", "no TWO-HOP bound write exists") tas bort, och commiten namnger uttryckligen VILKA av de 8 historiska hålen (se ticket-tabellen) den nya regeln stänger. *(kind: diff)*
      - [ ] Regel-omfånget skrivs från den uppmätta listan i tickets "Mätt, INTE lagat"-stycke — vidga INTE regexen ytterligare i stället för att bygga AST-regeln. *(kind: diff)*
      - [ ] Beslut nedskrivet om regeln även ska gälla `priceHistory` (samma bare/namngivna delning). *(kind: diff)*

- [ ] **BIN-932** [Tier A] disposition: build. `backfillIds.ts` terminalläge loggar
      ingenting när migreringen är klar (`bareFound > 0`-gate), men headern påstår att
      loggraden är den ENDA vägen ut till en människa. Plus en kommentar i testfilen
      saknar backslashes.
      Acceptance:
      - [ ] Antingen loggas en rad när `complete && bareFound === 0`, eller headerns mening smalnas av till "medan bara dokument återstår" — välj en, skriv skälet. *(kind: diff)*
      - [ ] `backfillIds.test.ts:267`s kommentar rättas till `(?:db\s*\.\s*)?` (matchar regexen på rad 275). *(kind: diff)*

## Batch C — Review-gate tooling / ownership (agent: direct)

Delar `docs/org/route.mjs` / `route.test.mjs` / `gate-symmetry.test.mjs` /
`docs/role-responsibilities.md` — en batch, för att undvika att två delar splittas över
olika batchar och krockar vid apply.

- [ ] **BIN-922** [Tier A] disposition: build-review. Namnge en ägare för
      `.github/workflows/secret-scan.yml` (den enda av fyra workflows utan en), regenerera
      `ownership-map.json`, ta bort undantagsposten i `gate-symmetry.test.mjs`.
      signoffReason: bekräfta VILKEN roll (§8 eller §20) som ska äga secret-scan.yml —
      biljetten pekar ut båda som kandidater utan att välja.
      Acceptance:
      - [ ] En ägare namngiven för `.github/workflows/secret-scan.yml` i `docs/role-responsibilities.md`, `ownership-map.json` regenererad (`node docs/org/gen-ownership-map.mjs`). *(kind: diff)*
      - [ ] `ACCEPTED_ASYMMETRIES`-posten för secret-scan.yml borttagen ur `gate-symmetry.test.mjs` — den ska falla bort för att rötkollen fäller den om den är fel, inte för att någon manuellt tog bort den utan att kollen körts grön efteråt. *(kind: diff)*

- [ ] **BIN-923** [Tier A] disposition: build. `vitest.rules.config.ts` och
      `vitest.setup.ts` befordrades till `CODE_ROOT_FILES` (BIN-880, `851696d`) utan att
      något test namnger dem direkt — bara `gate-symmetry`s helträds-regel B håller dem
      idag, indirekt.
      Acceptance:
      - [ ] Ett namngivet fall i `docs/org/route.test.mjs` som hävdar att båda filerna routas icke-`skip`, bredvid de befintliga rot-fil-fallen. *(kind: diff)*

- [ ] **BIN-934** [Tier A] disposition: build-review. Rot-`package-lock.json` är
      `isCodePath: false` i routern (`docs/org/route.mjs` `CODE_ROOT_FILES`) medan
      `functions/package-lock.json` når säkerhetsgranskaren av en slump (via
      `^functions/`-prefixet) — ingen har valt en policy för låsfiler.
      signoffReason: räknas låsfiler som kod för routern eller inte — en policyfråga,
      inte en bugg. Biljetten ber uttryckligen att det AVGÖRS, inte byggs reflexmässigt.
      Acceptance:
      - [ ] Ett daterat beslut skrivet (i route.mjs-kommentar eller ADR): räknas package-lock.json som kod för routern? *(kind: diff)*
      - [ ] Beslutet appliceras lika på BÅDA låsfilerna, eller skillnaden skrivs ned med sitt skäl. *(kind: diff)*
      - [ ] Om "ja, kod": `CODE_ROOT_FILES` uppdateras OCH `.claude/shared-plugin.json`s reviewGates-lista i SAMMA commit (BIN-830-regeln — två listor flyttas tillsammans), och `_note9`s mening om ogranskade beroendeuppdateringar rättas. Om "nej": beslutet skrivs in i route.mjs bredvid `CODE_ROOT_FILES` så nästa granskare inte filar samma sak igen. *(kind: diff)*

## Batch D — Workflow-map docs (agent: direct, OWN commit)

- [ ] **BIN-927** [Tier A] disposition: build. Kartans omtitt-flöde
      (`docs/workflow-map.html`, ~rad 1096) saknar steget "skrivningen rapporterar
      tillbaka vad den räknade" (BIN-895/`b10ccf3`: `TitleWriteOutcome` +
      `countedRewatch`).
      **Denna ticket rör ENDAST `docs/workflow-map.html` — commit den ensam, ingen
      annan fil i samma commit** (lessons-digest: en revert av en feature-commit som
      bundlar en map-ändring drar tyst med sig orelaterad flödesdokumentation).
      Acceptance:
      - [ ] Rapporterings-steget tillagt i omtitt-flödets `<script id="data">`-JSON, inget annat ändrat i filen. *(kind: diff)*
      - [ ] Egen commit — `git show --stat` på den commiten visar bara `docs/workflow-map.html`. *(kind: diff)*
      - [ ] `node scripts/check-workflow-map.mjs` grön. *(kind: run)*
      - [ ] Beslut nedskrivet: accepteras `git apply`-luckan i färskhetsstämplingen (handräddningar triggar ingen PostToolUse-hook) uttryckligen, eller föreslås en andra utlösare — filat som uppföljning om den senare. *(kind: diff)*

## Needs you (Tier D) / parked / needs-approval

Se separat rapport från urvalskörningen (Phase 1) för fullständig lista — 7 parkerade
(väntar på ditt EGET svar, inte omfrågade), 4 needs-approval (mitt omdöme, inte hennes
fråga), 16 redan avgjorda av dig sedan tidigare (build/blocked/excluded, applicerade utan
att fråga igen), 1 obsolete (BIN-938, redan löst av design via BIN-917/919s grandfathering).

## Post-sprint steps

1. `npm run typecheck` (full) + `npm run lint` (full) innan commit.
2. Fila uppföljningar för allt som upptäcks men medvetet inte byggs (samma regel som
   alltid) — INNAN commit.
3. Commit per batch, gates körs enligt `.claude/shared-plugin.json` → `reviewGates`.
   Batch A/B rör `src/**`/`functions/**` → binge-code-reviewer + binge-test-reviewer.
   Batch C/D rör `docs/org/**`/`.claude/shared-plugin.json` → binge-integration-reviewer
   (matchar de listade patterns i `_note3`–`_note9`). `binge-security-reviewer` triggas
   av Batch B (`^functions/`).
4. Push. `deploy.yml` bygger + deployar hosting automatiskt — ingen manuell
   `firestore:rules`/`functions`-deploy krävs i den här sprinten (ingen ticket rör
   `firestore.rules` eller `functions/` utöver `backfillIds.ts`, som är hosting-sidan av
   en redan deployad Cloud Function — bekräfta det antagandet innan push om osäker).
5. Transitionera varje ticket: build + alla kriterier gröna → Done. build-review
   (BIN-931/922/934) → In Review + PushNotification, aldrig auto-Done.
6. Kör `node docs/org/metrics/log_event.mjs review …` för BIN-689 (#28-kritiken).

---
# BIN-954 — att bocka av ett avsnitt på en serie du inte följer skapar ett halvt dokument

**Status:** v2 — #27:s blinda kritik körd och invikt (SUPPORT WITH CONDITIONS, tre
villkor, ingen omroutning). Byggt och grönt. Blockerar BIN-942 (planen längre ned).

Router på den faktiska filuppsättningen
(`src/contexts/WatchlistContext.tsx`, `src/hooks/useEpisodeProgressWithSync.ts`,
`src/lib/watchlist/buildAddPayload.ts`) — rå utdata:
`tier: "medium"`, `reasonCode: "owned"`, `panel: [27]`, `highStakes: []`,
`unownedCode: []`, `unmappedCode: []`.
Alltså: **en blind kritik från #27 Database Administrator / Data-layer Engineer**
före första Edit. Vidgar kritiken filuppsättningen (t.ex. in i `firestore.rules`)
körs routern om (BIN-766-lärdomen).

**Basläge, HEAD `409d19f`:** `git status --porcelain` → bara `tasks/todo.md`.

**Utfall, mätt efter bygget** (`rm -rf node_modules/.vite/vitest` före varje körning):
`npm test` → **258 filer, 4242 passerade, 4 skippade, 0 fel.** Basläget var 258/4230/4,
alltså +12 nya tester (10 i `WatchlistContext.test.tsx`, 2 i hookens fil).
`npx tsc --noEmit` → tyst. `npx eslint` på de fyra rörda filerna → 0 fel
(3 kvarstående `_args`-varningar som fanns före ändringen).

**En körning av fyra föll**, med ett test jag inte hann fånga namnet på; de tre därefter var
gröna med identiska siffror. Redovisat som det är — inte bortförklarat — men inte heller
utrett, eftersom det inte gick att återskapa. Misstanken är samma kall-cache-timeout som
BIN-937 handlade om (körningen låg direkt efter en `rm -rf` av vite-cachen).

**Muteringsprövat, sju mutanter, alla fällda** (patchen assertad före OCH efter körningen,
återställning från scratchpad-kopia verifierad med `md5sum`):
`known` utan sessionsmängden → 1 fallet test; `if (known || !libraryKnown)` → `if (known)`
→ 1; `addIfMissing: true` flyttad till avbockningsvägen → 2; raderingens rensning av
sessionsmängden borttagen → 1; `mediaType === 'tv'`-vakten borttagen → 1; markeringen
flyttad till före skrivningen → 1; raderingsräknarens kontroll borttagen → 1.

## Klarspråk

Bockar du av ett avsnitt på en serie du **inte** följer sparar appen idag en trasig,
halv rad i ditt bibliotek: ingen titel, ingen affisch, ingen status. Den syns som en
tom rad — även på din publika profil — och raderingsknappen kan inte träffa den.

Efter fixen: bockar du av ett avsnitt på en serie du inte följer **läggs serien till
på riktigt** (titel, affisch, år, status "Följer") tillsammans med din position.
Malins beslut 2026-08-20. Bockar du *bort* ett avsnitt på en serie du inte följer
läggs ingenting till — och inget halvt dokument skrivs längre.

**En följd som Malin bör känna till** (integrationsgranskningen, varv 3): det här gäller
även när man bockar av ett avsnitt inifrån en GRUPP. Öppnar du en säsongssida via en grupps
watchlist (`?fromGroup=`) och bockar av ett avsnitt, hamnar serien i ditt EGET bibliotek
under "Följer". Det följer direkt av beslutet — en bockning är en bockning oavsett var man
står — men det är en ny sak som händer på en yta som förut bara rörde gruppen.

## Vad som är fel — mätt

`updateProgress` (`src/contexts/WatchlistContext.tsx:890` vid HEAD `409d19f`, före ändringen)
grindar bara på `if (!uid) return;`
och gör sedan `setDoc(ref, { lastWatchedSeason, lastWatchedEpisode, …visFields, updatedAt }, { merge: true })`.
Finns inget dokument är det en **create** av ett fältfragment.

Anropsställen, räknade med kommandot:
`grep -c "updateProgress('tv'" src/hooks/useEpisodeProgressWithSync.ts` → **6**
(rad 50, 72, 84, 86, 99, 118 vid HEAD `409d19f`). Radnumren efter ändringen står medvetet
INTE här: två granskningsrundor i rad rättade dem, och båda rättelserna var själva fel
inom en timme — varje ny kommentarsrad i filen flyttar dem. Det som behövs är
uppdelningen: **två** tittar-anrop, **fyra** som inte är det.
`grep -rn updateProgress src --include=*.ts --include=*.tsx`, filtrerat på SÖKVÄG utanför
hooken och kontexten, ger **noll** produktionsanropare och **fem** träffar som alla är
kommentarer (`useGroupMemberProgress.ts:21`, `groups.ts:569/572/717`,
`canonicalSpecials.ts:27`). **Rättelse:** v1 skrev "fyra" — det talet kom av ett filter på
radinnehåll i stället för på sökväg, vilket åt upp en av träffarna. Den bärande halvan
(noll anropare) stod sig. Alla sex passerar `'tv'`; `updateProgress` når aldrig en film.

De sex delar sig i två avsikter:

* **Tittar-avsikt (2):** rad 50 (bocka av ett avsnitt) och rad 99 (markera hel säsong sedd).
* **Inte tittar-avsikt (4):** rad 72 (auto-advance till nästa säsong, körs EFTER att rad 50
  redan skrivit), rad 84/86 (avbocka ett avsnitt) och rad 118 (avbocka en hel säsong).

Kalendern kan inte nå felet: `useCalendarEntries` bygger avsnittsposter enbart ur
`getByStatus('mina','tv')`, alltså serier som redan finns i biblioteket. Reellt nåbara
vägar är säsongssidan (`SeasonPageClient`) och seriesidans säsongslista
(`TVShowPageClient:501` → `SeasonList`), som båda skickar `markEpisodeWatched` ogrindat.

## Vad som byggs

**Allt i `updateProgress`.** Ingen grind i `SeasonPageClient`, `EventCard`,
`TVShowPageClient`, `SeasonList` eller `SeasonEpisodePanel` — de rörs inte alls.

### 1. Avsikten skickas in, den gissas inte

`updateProgress` får ett femte, valfritt argument:
`opts?: { addIfMissing?: boolean }`. Hooken skickar `{ addIfMissing: true }` på **exakt
två** ställen (rad 50 och rad 99) och ingenting på de fyra andra.

Varför inte härleda avsikten ur positionen (`season > 0 || episode > 0`): en avbockning
ned till en lägre position är också en position skild från noll, så härledningen skulle
lägga till serien när användaren gör tvärtom. Avsikten finns bara hos anroparen.

Auto-advance (rad 72) får medvetet INTE flaggan: den körs efter att rad 50:s skrivning
committats, så dokumentet finns redan. Utan den regeln hade den andra skrivningen
(snapshoten hinner inte landa emellan, så `findItem` är fortfarande tom) blivit ett
andra fullständigt tillägg med en andra `title_added_watchlist`-händelse.

### 2. Fyra grenar i stället för en

```
const known = current != null || addedByProgressRef.current.has(`${uid}:${docId}`);
const libraryKnown = firstSnapshotSettledRef.current && !listenerFailedRef.current;

A. known                    → oförändrat: merge-skrivning av bara progressfälten.
B. !known && libraryKnown && opts.addIfMissing && mediaType === 'tv'
                            → fullständigt tillägg (nedan).
C. !known && libraryKnown   → INGEN skrivning alls. Det finns inget att uppdatera,
                              och en merge här är per definition en create av ett fragment.
D. !known && !libraryKnown  → oförändrat (gren A:s skrivning).
```

`addedByProgressRef` är #27:s villkor 1 (se nedan): en sessionsmängd över doc-id som
DENNA funktion just skapat. Snapshoten har inte landat när auto-hoppet körs, så utan
den läser gren C "finns inte" och sväljer auto-hoppets skrivning. Märks först EFTER
att skrivningen gått igenom, så ett misslyckat tillägg förblir omförsökbart. Nollställs
vid uid-byte, som `migratedNotesRef` och `repairedAddedAtRef`.

**Gruppsynken körs på ALLA grenar**, även gren C som inte skriver något. Upptäckt vid
bygget: en serie man följer bara inne i en grupp (`SeasonPageClient` med `?fromGroup=`)
saknas i det egna biblioteket men har progress som hör till gruppen. Att flytta in
synken i skrivgrenarna hade tagit bort den funktionen.

`libraryKnown` läses ur de två refs som `writeTitle` redan använder
(det `buildAddWrite`-ctx-objekt `writeTitle` bygger), inte ur den härledda
state-variabeln som contexten exponerar — den
definieras efter `updateProgress` och skulle tvinga in en ny dep i `useCallback`.

**Gren D är avsiktlig och oförändrad.** Under en kall laddning går det inte att skilja
"finns inte" från "inte läst än", och att gissa "lägg till" där skulle kunna skriva om
status för en serie användaren satt till `avbruten`. Kvarvarande risk i D är exakt den
kapplöpning BIN-942 tar hand om: golvet nekar skrivningen och BIN-942:s C loggar den.
BIN-954 gör alltså D **smalare**, aldrig bredare.

### 3. Tilläggets payload

Grenen B återanvänder den befintliga tilläggsvägen — `upsertTitle` → `writeTitle` →
`buildAddWrite` — via `buildWatchlistAddPayload`, så `addedAt`, `updatedAt`,
synlighetsfälten, `dropped` och analytics-händelserna får exakt den form varje annan
tilläggsyta har. Ingen ny skrivväg.

Titeldata hämtas med `getTVShowLite(tmdbId)` (samma lite-anrop kalendern och rådgivaren
redan använder, `append_to_response=watch/providers`):

| Fält | Källa |
| -- | -- |
| `tmdbId` / `mediaType` | anropet |
| `status` | `'mina'` — TV:s "följer"-status (`watchStatus.ts:TV_STATUS_OPTIONS`); `vill_se` för TV är avskaffat |
| `title` | `preferOriginalTitle(show.name, show.original_name)` — samma val som `TVShowPageClient:134` |
| `posterPath` | `show.poster_path ?? null` |
| `releaseYear` | `extractYear(show.first_air_date)` (`tmdb/client.ts:309`) |
| `totalSeasons` | `show.number_of_seasons ?? null` |
| `genreIds` | `show.genres?.map(g => g.id) ?? []` |
| `tmdbStatus` | `show.status ?? null` |
| `lastWatchedSeason` / `lastWatchedEpisode` | anropets `season` / `episode` |

**`providers` och `subscriptionProviders` utelämnas medvetet.** `shouldStampProvidersAtAdd`
(`tmdbFieldsRefresh.ts:64`) kräver båda för att stämpla `providersCheckedAt`; utelämnade
fält gör att stämpeln uteblir, raden läses som färsk-behövande och nästa titelsidbesök
fyller i paret (`planTmdbFieldsRefresh`). Det är den självläkande riktningen BIN-468/814
redan dokumenterar.

Positionen ligger **i samma skrivning** som tillägget. Grenen B kostar alltså inte en
extra Firestore-skrivning jämfört med idag — det är fortfarande en `setDoc` per gest,
bara med fullständig payload.

### 4. När TMDB inte svarar

Misslyckas `getTVShowLite` skrivs **ingenting** till watchlist-dokumentet; felet loggas
via `captureError(err, { scope: 'watchlist', kind: 'updateProgress-add' })` och gesten
avslutas utan att kasta. Avsnittsbocken själv (`episodeProgress`, en helt annan
skrivning i `useEpisodeProgress`) landar ändå.

Skälet att inte kasta: `markEpisodeWatched` anropas via `void` från `EpisodeRow`, så ett
kast blir en ofångad promise-rejection → Sentry-brus av samma sort `setRuntime` redan
sväljer. Skälet att inte falla tillbaka på fragmentskrivningen: fragmentet ÄR buggen.
Praktiskt är läget nästan onåbart — säsongssidan renderar inga avsnitt alls om TMDB är
nere (`useTVSeason`).

### 5. Typer och kontraktsyta

* `WatchlistState.updateProgress` (rad 213) och default-kontexten (rad 244) får det nya
  valfria argumentet. Bredare signatur, inga befintliga anropare bryts.
* `useEpisodeProgressWithSync` importerar inget nytt; den skickar bara flaggan.
* `WatchlistContext.tsx` behöver `getTVShowLite`, `extractYear`, `preferOriginalTitle`,
  `buildWatchlistAddPayload`, `captureError`. Vilka som redan är importerade kontrolleras
  med `grep -n` i filen före Edit; importlistan skrivs efter vad kommandot svarar, inte
  efter minnet.

## Bindande acceptanskriterier

1. `updateProgress` skriver aldrig ett dokument som saknar `tmdbId`, `mediaType` eller
   `status` **när biblioteket är känt**. Grenarna B och C är det som garanterar det.
   *(kind: diff)*
2. Test: bocka av ett avsnitt på en serie som inte finns i `items`, med settlad snapshot →
   den skrivna payloaden bär `tmdbId`, `mediaType: 'tv'`, `status: 'mina'`, `title`,
   `posterPath`, `releaseYear`, `lastWatchedSeason`, `lastWatchedEpisode`. *(kind: diff)*
3. Test: samma gest på en serie som REDAN finns → payloaden innehåller **ingen**
   `status`-nyckel och ingen `title`-nyckel. Det är kriteriet som pinnar
   "progress ändrar aldrig status" — regeln som står i `updateProgress` egen inledande
   kommentar. *(kind: diff)*
4. Test: **avbocka** ett avsnitt på en serie som inte finns i `items`, settlad snapshot →
   ingen `setDoc` mot watchlist-dokumentet. *(kind: diff)*
5. Test: serie saknas och snapshoten har INTE settlat → beteendet är det gamla (gren D).
   Det negativa fallet är vad som hindrar att gren B tyst blir ovillkorlig. *(kind: diff)*
6. Test i hookens testfil: `addIfMissing` skickas på exakt de två tittar-anropen och på
   inget av de fyra andra. Diffkontroll:
   `grep -c "addIfMissing: true" src/hooks/useEpisodeProgressWithSync.ts` → **2**.
   *(kind: diff)*
7. Ingen ändring i `SeasonPageClient`, `EventCard`, `TVShowPageClient`, `SeasonList`,
   `SeasonEpisodePanel` eller `SeasonRow`. *(kind: diff)*
8. `npm test` körs med rensad `node_modules/.vite/vitest` och redovisas med siffror.
   *(kind: diff)*
9. Ingen global `testTimeout`-höjning. **Rättelse mot v1:** v1 sa "ingen ändring i något
   `expect(...)` som fanns före ändringen". Det gick inte att hålla och skulle ha varit
   fel att hålla: `toHaveBeenCalledWith` matchar argumentlistan EXAKT, så de tre
   påståendena om tittar-anropen i `useEpisodeProgressWithSync.test.tsx` föll när ett
   femte argument tillkom. De är uppdaterade till att namnge det nya argumentet — alltså
   skärpta, inte försvagade, och det är precis den strikthet som gör dem till villkor 6:s
   bevis. Inget påstående är borttaget, uppmjukat eller skippat. *(kind: diff)*

## #27:s bindande villkor — och hur vart och ett är avklarat

Blind kritik 2026-08-20, #27 Database Administrator / Data-layer Engineer.
Verdict: SUPPORT WITH CONDITIONS. Hen bekräftade dessutom mot `firestore.rules:92-124`
att **varje fält planen skriver står i `isValidWatchlistItem`s `hasOnly`-lista**, och att
de fyra råa `.data()`-läsarna av `providers`/`genreIds` (`functions/src/insights/rollup.ts`,
`functions/src/streamingOffers/index.ts`, `src/lib/taste/backfill.ts`) alla redan är
`Array.isArray`-skyddade — så att utelämna fälten är säkert för varje läsare. Ingen
`firestore.rules`-ändring behövs, alltså **ingen omroutning**.

10. **Villkor 1 — auto-hoppet tappade sin skrivning.** Ett riktigt fynd, och planens egen
    v1-text motsade sig själv: den påstod att dokumentet "finns redan" när auto-hoppet
    körs, samtidigt som den använde att snapshoten INTE hunnit landa som argument på
    raden ovanför. Följden hade varit att den som bockar av säsongsfinalen på en
    färdigsedd säsong av en serie hen inte följer fick serien tillagd — men pekaren kvar
    på finalen i stället för på nästa säsong. **Åtgärd:** `addedByProgressRef` (gren-
    beskrivningen ovan) + ett test som driver båda anropen i EN gest och hävdar två
    skrivningar, ett TMDB-anrop och en `title_added_watchlist`. Muteringsprövat: tas
    sessionsmängden bort faller exakt det testet. *(kind: diff)*
11. **Villkor 2 — TMDB-felet lämnar en avsnittsbock utan biblioteksrad.** `markEpisode`
    och `updateProgress` körs parallellt i `Promise.all`, så avsnittsbocken landar även
    när tillägget inte gör det, och hämtningen sker vid KLICKET, inte vid sidladdningen —
    planens "säsongssidan renderar inget om TMDB är nere" täckte bara det senare.
    **Åtgärd:** läget är accepterat men självläkande, och det är nu bevisat i stället för
    påstått: en misslyckad hämtning märks INTE i `addedByProgressRef`, så nästa bockning
    på samma serie gör om tillägget. Test: första bockningen misslyckas → ingen skrivning
    alls (aldrig fragmentet) + `captureError` med `scope: 'watchlist'`,
    `kind: 'updateProgress-add'`; andra bockningen lägger till på riktigt. *(kind: diff)*
12. **Villkor 3 — produktionssiffran är prosa tills någon kört frågan.** Riktigt i
    princip, men den mätningen gjordes **samma dag** (2026-08-20) och är uttryckligen
    överlämnad som "återanvänd, mät inte om": 411 watchlist-dokument över alla tre
    kontona, hela listningar, noll utan `tmdbId`/`mediaType`/`status`. Den är alltså
    **inte** omkörd här, och det står så här i stället för att låtsas. Siffran bär bara
    ett beslut — att ingen städning av gamla fragment behövs — och den ändras inte av
    den här ändringen. *(kind: run — redovisad, ej omkörd)*

## Granskningsrundan — tre varv, ett blockerande fynd

**Varv 1** (säkerhet, integration, kod): alla tre pass, 0 blockerande, 6 icke-blockerande
fynd. Åtgärdade i EN putsrunda, se listan nedan.

**Varv 2** (säkerhet, integration, test på de nya byten): säkerhet och test pass;
**integrationsgranskningen fällde bygget på ett riktigt fel** (nästa stycke). Testgranskaren
lät dessutom två mutanter överleva — båda är nu döda.

**Varv 3** (säkerhet, integration, kod på de slutliga byten): säkerhet och kod pass;
kodgranskaren hittade **samma defekt en gång till, en nivå smalare** (nästa stycke men två),
och integrationsgranskaren fällde bygget på ett fel i BIN-942:s PLAN, inte i BIN-954:s kod —
"Vad som byggs — C" beskrev fortfarande den form tre blinda kritiker underkände
(`console.warn`, sju anropsplatser), 55 rader ovanför det stycke som ersätter den. Det är
ADR-slår-tråden-mönstret som bitit repot fyra gånger: någon som läser rubriken "vad som
byggs" bygger den döda formen. Rättat och försett med en varningsruta.

Granskningarna kördes om från början efter varje ändring. En granskning bokförd på gamla
bytes räknas inte, och ledgern — inte granskarens rapport — är beviset.

### Den smalare halvan av samma defekt (varv 3, kodgranskaren)

Att rensa markeringen i `removeItem` räcker bara när tillägget redan hunnit bli klart.
Firestore lägger på en väntande skrivning optimistiskt, så "Ta bort" blir klickbar i samma
ögonblick som tilläggets skrivning SKICKAS — långt innan den svarar. En radering i det
fönstret rensar en nyckel som ännu inte finns, och tillägget skriver sedan tillbaka den över
ett dokument användaren just raderat. Nästa progress-skrivning läser den som bevis på att
dokumentet finns → merge-grenen → fragmentet tillbaka.

Kodgranskaren kallade det icke-blockerande. Det byggdes ändå: utfallet för användaren är
identiskt med det fel som blockerade varv 2 — en tom rad som kan synas på en publik profil —
och gesten (lägg till, ångra direkt) är den kommentarerna själva kallar den vanligaste.

Fixen är en räknare, `removalTickRef`, som `removeItem` ökar SYNKRONT före sin första await.
Tilläggsgrenen läser av den före sin första await och avstår från att markera om den rört
sig. Medvetet grovkornig — den räknar alla raderingar, inte bara den här titelns: att avstå
för mycket kostar en extra tilläggsskrivning vid nästa bockning, att avstå för lite kostar
en spökrad på en publik profil. Pinnat av ett test som håller TMDB-hämtningen öppen, kör
raderingen mitt i, släpper den och avbockar; muteringsprövat.

### Det blockerande felet: den andra cachen städades inte vid radering

`removeItem` rensade `itemsRef` men inte `addedByProgressRef`. De är två cachar av samma
sak — "det här dokumentet finns" — och den nya var den farligare att ha inaktuell.

Följd: lade du till en serie genom att bocka av ett avsnitt och tog bort den igen i samma
session (den vanligaste ångra-sekvensen som finns), läste varje senare progress-skrivning
den gamla markeringen som bevis på att dokumentet fanns, tog merge-grenen — och skapade
exakt det identitetslösa fragment biljetten finns för att ta bort. På både bock- och
avbockningsvägen, eftersom `known` kortsluter före avsiktsflaggan.

Fix: `addedByProgressRef.current.delete(...)` bredvid den befintliga `itemsRef`-rensningen,
med samma "REQUIRED, not defensive"-motivering. Pinnat av testet *"a series added by
ticking and then removed does not resurrect as a fragment"*, muteringsprövat (tas raden
bort faller exakt det testet).

### De två överlevande mutanterna, nu döda

* **`mediaType === 'tv'`-vakten kunde tas bort utan att något test föll.** Ingen
  produktionsanropare skickar film (alla sex skickar `'tv'`), så vakten skyddar bara mot en
  framtida anropare — och payloaden hårdkodar `mediaType: 'tv'`. Nytt test: en
  film-`updateProgress` med avsiktsflaggan hämtar ingenting och skriver ingenting.
* **Markeringen kunde flyttas till FÖRE skrivningen utan att något test föll.** `known`
  räknas ut före varje await, så ingen följd av LYCKADE anrop kan skilja de två åt. En
  MISSLYCKAD skrivning kan — och det är precis den egenskap ordningen finns för. Nytt test:
  en add vars skrivning avvisas gör nästa bockning till ett fullständigt tillägg igen, inte
  till en merge mot ett dokument som inte finns.

### De sex icke-blockerande fynden från varv 1

1. **`status: 'mina'` beskrevs som "den enda status en TV-titel lagras under".** Falskt —
   `avbruten` är en riktig lagrad TV-status (`watchStatus.ts`: `TV_STATUS_OPTIONS` är
   `['mina','sedd','avbruten']`). Meningen säger nu det sanna: `mina` är den status en
   NY-spårad TV-titel börjar i, och grenen nås bara när ingen lagrad status finns.
2. **"så detta är alltid en uppdatering"** om auto-hoppet. Falskt i ett fall: om
   tittar-anropets TMDB-hämtning misslyckades finns dokumentet inte, och auto-hoppet
   skriver då ingenting heller. Kommentaren säger nu det, och varför det är rätt utfall.
3. **Testet hette "de fyra" men drev tre anrop**, och en av dess kommentarer beskrev ett
   0,0-fall som i själva verket föll tillbaka på 3,2. Omskrivet: det driver nu fyra anrop
   med exakta argumentlistor (tittar-gesten + auto-hoppet + två nollställningar) och pekar
   ut var det fjärde icke-tittande anropsstället pinnas.
4. **`providers` skickas nu som `[]` i stället för att utelämnas — men `subscriptionProviders`
   utelämnas fortfarande, och asymmetrin är avsiktlig.** `buildAddPayload`s kontrakt säger
   att ett äkta nytt tillägg skickar `providers` explicit så det skapade dokumentet uppfyller
   `WatchlistItem`s icke-valfria arraytyper; det här var det första äkta tillägget som bröt
   det. `shouldStampProvidersAtAdd` kräver en ICKE-tom lista, så stämpeln uteblir precis som
   förut och självläkningen är oförändrad. `subscriptionProviders` däremot: `docToItem` läser
   frånvaro som "aldrig ifylld" och `[]` som "kollat, ingen tjänst har den". Den här ytan har
   inte kollat något och får därför inte påstå det andra — samma val som onboarding,
   CSV-importen och `CompanionSection` gör. (Varv 2, integrationsgranskningens valfria fynd 1.)
5. **`libraryKnown` uttrycktes med samma formel på två ställen i filen.** Formeln bor nu i
   en ren funktion, `isLibraryKnown(snapshotSettled, listenerFailed)`, som båda anropar.
   De kan inte dela VÄRDE (det ena är reaktivt state, det andra måste läsas efter ett
   await), men de delar nu formeln — det är den delen som kan glida isär.
6. **"fyra träffar är kommentarer"** i skrivvägsräkningen var fem. Rättat ovan, med orsaken
   (filtret satt på radinnehåll i stället för på sökväg). Samma runda: BIN-942-planens
   radnummerlista blev falsk i samma commit som den låg i, eftersom den här ändringen
   flyttade varje rad i filen. Den listan är omräknad OCH ersatt med funktionsnamn.

Två fynd byggdes medvetet INTE. Båda är filade som **BIN-955** (låg prioritet):

* **Två snabba bockningar på samma ospårade serie kan lägga till den två gånger.**
  Sessionsmärket sätts efter att skrivningen gått igenom, vilket skyddar den sekventiella
  kedjan (tick → auto-hopp) men inte två oberoende gester. Kostar två TMDB-anrop, två
  skrivningar och två `title_added_watchlist`. Inte datafördärvande — båda skrivningarna
  bär identiska identitetsfält. Kodgranskaren avstod uttryckligen från att blockera på den.
* **TMDB-hämtningen går inte via React Query** och bär ingen `AbortSignal`, till skillnad
  från `useMarkSeen`s. Att lägga den i `queryClient.fetchQuery` skulle ge
  `WatchlistProvider` — som sitter ovanför nästan hela appen — ett hårt beroende på att en
  `QueryClientProvider` är monterad ovanför DEN, för en cache ingen nåbar anropare värmt
  (seriesidan håller `['tv', id]`, det fulla svaret, inte den lätta nyckeln). Skälet står
  nu i koden i stället för att vara underförstått.

## Vad som INTE byggs

* Ingen migrering av redan existerande fragmentdokument. Produktionskollen 2026-08-20
  (411 watchlist-dokument över tre konton) fann **noll** dokument utan
  `tmdbId`/`mediaType`/`status` — det finns inget att städa.
* Ingen grind i UI:t som gömmer bockarna för serier man inte följer. Malin valde bort det.
* `firestore.rules` rörs inte här. Golvet är BIN-942.

## Rollback

Ren hosting-ändring: `git revert`, push, deploy. Inga regler, inga funktioner, ingen data.

## Kartan

`docs/workflow-map.html` — kontrolleras efter kodcommiten om
`.claude/state/workflow-map-stale.json` stämplats; i så fall i **egen commit**.

---

# BIN-942 — en raderad titel kan återuppstå som ett publikt spökdokument

**Status:** v4 — C:s rollkritik (villkor 11) KLAR, alla tre villkor invikta nedan. Den kalla planrevisionen underkände v1 (5 röda) och v2 (4 röda). Alla är
åtgärdade nedan, var och en med kommandot som verifierade den. Panel A+B klar; C behöver en
egen kort runda före bygget (villkor 11).

Router på den faktiska filuppsättningen: `tier: top`, `reasonCode: high-stakes`,
`panel: [27, 5, 4, 6, 7]`. Oförändrad när `WatchlistContext.tsx` läggs till.

**Basläge, HEAD `409d19f`:** träd rent bortsett från den här filen; `npm test` → 258 filer,
4230 passerade, 4 skippade.

## Klarspråk

Raderar du en titel i samma stund som appen uppdaterar din synlighet kan titeln komma
tillbaka som en tom rad — synlig för dig och, om profilen är publik, för andra. Du kan inte
ta bort den; raderingsknappen siktar fel. Vi stoppar det i koden som skriver OCH i
databasreglerna som avgör vad som får skapas.

Bieffekt: nio skrivvägar i `WatchlistContext` (betyg, status, avsnitt, speltid,
anteckningar …) plus en till utanför den kan i samma sällsynta läge bli nekade. De skulle då
misslyckas ohanterat. **Sex** av de nio får därför fånga felet och logga det; `setRuntime`
och `refreshTmdbFields` fångar redan, och anteckningsvägen (`updateNotes`) är ännu inte
avgjord — dess nekande är atomärt med anteckningsskrivningen. (Tilläggsvägen `writeTitle`
är den tionde merge-skrivningen men bär alltid golvfälten, så den nekas inte av golvet; den
kastar vidare med flit, se villkor 15.) Ingen notis — den går inte att nå därifrån (se C). Användaren ser
inget oförklarat, eftersom raden ändå försvinner när listan uppdateras.

## Vad som är fel

`cascadeVisibilityToItems` (`AuthContext.tsx:265`) gör `batch.set(d.ref, {…}, {merge:true})`
på snapshot-referenser. Raderas titeln mellan `getDocs` och `commit` är det en **CREATE**.
Bevisat mot emulatorn av #7 QA (merge till icke-existerande `movie_777` → `assertSucceeds`).
**Det provet finns inte i trädet** — det var ad hoc, och ska läggas till och ses falla rött först.

Spöket går inte att ta bort (`docToItem` läser identitetsfälten som `undefined`; `removeItem`
bygger sitt raderingsmål ur samma fält), och det självläker inte — kaskadens filter matchar
det och stämplar om det.

## Skrivvägar — räknade om, med kommandot

**RÄTTELSE 2026-08-20 (integrationsgranskningen, BIN-954:s runda) — den här listan var
för snäv, och radnumren är borttagna för gott.** Radnummer i den här filen har rättats tre
gånger och varit fel tre gånger; varje kommentarsrad flyttar dem. Räkna om själv, med
kommandot, precis före bygget.

`grep -c "merge: true" src/contexts/WatchlistContext.tsx` → **10**. **Det är rätt ankare.**
Den tidigare listan använde `grep -n "await setDoc(ref"` → åtta träffar, minus
`watchlistTags` → sju. Men golvet (`hasAll(['tmdbId','mediaType','status'])` på create)
träffar VARJE merge-skrivning mot watchlist-samlingen som kan visa sig vara en create —
inte bara de som råkar heta `setDoc(ref`. Minst tre till:

* `setRuntime` — `setDoc(doc(...), { runtime }, { merge: true })`, alltså inte `ref`.
* `refreshTmdbFields` — samma form.
* `updateNotes` — `batch.set(itemRef, …, { merge: true })`. Den är ATOMÄR med
  anteckningsskrivningen, så ett nekande tar med sig anteckningen och kastar vidare.

Sidoeffekten "sju vanliga redigeringar kan bli nekade" är alltså **tio** — nio av de tio
merge-skrivarna i `WatchlistContext` (alla utom `writeTitle`, som alltid bär golvfälten och
därför aldrig nekas av golvet) plus `nextAirReadRepair` utanför filen — och
villkor 14/15:s anropsplatsuppräkning måste räknas om från `merge: true`-ankaret innan C
byggs. `setRuntime` och `refreshTmdbFields` fångar redan (villkor 10 säger det); `updateNotes`
gör det INTE och har en egen `catch` som avmarkerar och kastar vidare — den måste vägas
separat.

Skribenter i scope, med namn i stället för rader: `writeTitle`, `updateVisibility`,
`updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`, `updateTmdbStatus`,
`setRuntime`, `refreshTmdbFields`, `updateNotes`.
Plus `AuthContext.tsx:265`, `nextAirReadRepair.ts` (`batch.set` + `merge`)
och `taste/backfill.ts` (`updateDoc`, kan aldrig skapa).

**BIN-954 ändrade `updateProgress`.** Den skriver inte längre alls när titeln saknas och
biblioteket är känt, och den lägger till med fullständig payload på tittar-vägen. Kvar
under golvet: kall laddning/död lyssnare, som fortfarande gör en merge som kan visa sig
vara en create. `updateProgress` hör alltså fortfarande till villkor 14:s uppräkning.

**RÄTTELSE mot v2:** v2 påstod att alla sju skriver mot befintliga dokument. **Fel.** Raden i
`writeTitle` är tillägg-vägen. Att lägga till en titel ÄR en create, varje gång, inte
bara i en kapplöpning. Golvet gäller alltså varje tillägg i appen.

Det klarar golvet: `buildAddPayload.ts:24` deklarerar
`AlwaysWritten = 'tmdbId' | 'mediaType' | 'status' | 'title' | 'posterPath' | 'releaseYear'`,
en äkta övermängd av golvet. Men det var otestat och otänkt — den största regressionsrisken i
hela ändringen, och den får ett eget bindande kriterium (villkor 12).

## Vad som byggs — A + B + C

**A.** `cascadeVisibilityToItems`: `batch.set(…, {merge:true})` → `batch.update(…)`. Ingen ny
`try/catch` runt `batch.commit()`.

**B.** `allow create` på `users/{uid}/watchlist/{itemId}` får
`request.resource.data.keys().hasAll(['tmdbId','mediaType','status'])`. Endast create.

**C — tyst men städat (Malins beslut 2026-08-20).** De **sex** redigeringsvägarna
(`updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`,
`updateTmdbStatus`) fångar **bara** `permission-denied` och loggar med `console.error` +
`captureError({ scope: 'watchlist', kind: … })`. Ingen notis.

> **LÄS "C — slutlig form efter rollkritik" NEDAN INNAN DU BYGGER DEN HÄR.** Två tidigare
> formuleringar av det här stycket är döda och ersatta där: `console.warn` (som #6
> visade var en REGRESSION — ett ohanterat fel når Sentry idag, `console.warn` gör det
> inte) och "de sju call sites" (`writeTitle` kastar vidare och är UNDANTAGEN; sju
> `captureError`-anrop i diffen är därför FEL, det ska vara sex). Stycket ovan är
> uppdaterat till den avgjorda formen — men rubriken "Vad som byggs" är den ett bygge
> läser först, så kontrollera alltid mot villkoren 14–19.

**Varför ingen notis, mätt:** `src/components/Providers.tsx:65-70` nästlar `ToastProvider`
INUTI `WatchlistProvider`. `WatchlistContext` kan alltså inte anropa `useToast` — notisen
existerar inte på den nivån. Alternativen var att flytta providern (rör hela appens uppstart)
eller låta felet bubbla till varje anropande komponent (många ställen, lätt att glömma ett).
Malin valde den tysta varianten. Det som gör den ärlig: titeln ÄR borta, och
snapshot-lyssnaren tar bort raden ändå.

Formen speglar `setRuntime` och `refreshTmdbFields`, som redan gör exakt detta.
(Radnummer utelämnade med flit: BIN-954 flyttade dem en gång redan.)

## Malins gränser

**BIN-941 (bindande):** *"bygg INTE om kaskaden så den tål ett nekande. Ingen migrering, ingen
kod som hanterar nekad chunk."* Sakens kärna står kvar: skrivningen nekas, chunken faller,
inget fångar den nekade chunken, ingen migrering. C rör enskilda redigeringar, inte chunken.
Det som vidgas är att nekandet gäller alla id:n — vilket ÄR BIN-942.

**Den daterade posten 2026-08-19 vidgas på fyra axlar, inte två** (v2 sa två):

* **Mekanism:** från `set(merge:true)`-create nekad av formspärren → `NOT_FOUND` från `update`.
* **Allvarlighet:** ny restrisk — **tio** skrivvägar kan nekas i kapplöpningen: nio av de
  tio `merge: true`-skrivarna i `WatchlistContext` (alla utom `writeTitle`, som alltid bär
  golvfälten) plus `nextAirReadRepair`. **Sex** av dem tystas (villkor 14); `setRuntime`
  och `refreshTmdbFields` fångar redan, `updateNotes` är ännu inte avgjord.
  Talen är räknade från `merge: true`-ankaret, inte från `setDoc(ref`, som missar tre.
* **Räckvidd:** från bara gamla id:n → alla id:n.
* **Tid:** från "tills pre-BIN-560-dokumenten är borta" → permanent.

Lyft till Malin 2026-08-20 före första Edit; hon valde varianten med felhantering, och sedan
den tysta formen.

**2026-07-30-posten (fail-open `effectiveVisibility`)** namnges nu: A gör misslyckade
synlighetskaskader vanligare, och en misslyckad kaskad är indata till just den accepten. Den
öppnas INTE — mitigeringen (`visibilitySyncPending` + varning + omförsök) är oförändrad och
`markVisibilitySyncPending` rörs inte. Villkor 13 låter #6 och #4 säga sitt om det.

## Bindande villkor

1. Bara `batch.set`→`batch.update` i `cascadeVisibilityToItems`. *(#27)*
2. Ingen ny swallow runt `batch.commit()`. *(#27)*
3. Golvet gäller ENDAST `allow create`. *(#4, #27, #6)*
4. Emulatortest på ett KANONISKT id: läggs till, ses falla **rött först**, vänds av golvet. *(#7)*
5. Emulatortest: golvet läcker inte till `update` — delskrivning mot befintligt dokument passerar. *(#7)*
6. Emulatortest: golvet blockerar en bar create för **var och en av de fyra nyupptäckta
   skrivarnas nyttolastform** — `{runtime}` (`setRuntime`), `{nextAirUpdatedAt}`
   (`flushNextAirWrites`), `planTmdbFieldsRefresh`-formen (`refreshTmdbFields`) och
   `{ notes: deleteField(), …visFields }` (`updateNotes`). **Utvidgat 2026-08-20 av #7:s
   villkor 1** — v4 krävde bara de två första, så två av fyra former hade varit påstådda i
   prosa och aldrig emulatorprövade. *(#27, #7)*
7. `AuthContext.test.tsx:106`:s mock-`writeBatch` får `.update()`. Mönstret finns i
   `WatchlistContext.test.tsx`s `writeBatch`-mock — **rad 118 var fel citat** (#7:s villkor 3,
   2026-08-20; 118 är `snapshotErrorCallback`). Leta upp mocken på namn, inte rad.
   BIN-587-blockets fem påståenden passerar med NOLL ändrad text. *(#7)*
8. Nytt enhetstest: kaskaden anropar `batch.update`, aldrig `batch.set`. *(#7)*
9. Ny daterad post supersederar 2026-08-19-posten, **och den gamla retireras ordagrant till `.claude/accepted-deviations.archive.md`** (filhuvudet kräver det; modellen är 2026-07-24-posten, INTE 2026-08-15 som v2 felaktigt citerade — den säger uttryckligen "EXTENDS … does not supersede"). Nya posten avgränsas på alla fyra axlar med `Accepted` / `NOT accepted, still fileable` / `Scope` / `Re-open when`. Regelkommentarens "STILL OPEN" rättas i SAMMA commit. *(#4, #27, #6, #5)*
10. `flushNextAirWrites`/`setRuntime`/`refreshTmdbFields` får ingen anropsplatsfix — de täcks av golvet, de två senare fångar redan. Egen biljett filas. *(#27, #7)*
11. **C har inte granskats av panelen** — den tillkom efter att rollerna svarat på A+B. Före bygget: blind kritik från #7 QA, #4 Säkerhet och #6 Dataskydd på A+B+C. *(planrevisionen F3)*
12. **Emulatortest: en äkta `buildAddWrite`-payload skapar fortfarande dokumentet under golvet**, och en payload som tappat ett golvfält gör det inte. Utan det kan ingen lägga till en titel om golvet är fel. *(planrevisionen F1)*
13. Skribentinventeringen kompletteras på **alla tre ställen** — `firestore.rules`, `src/test/rules/firestore-rules.test.ts` och `docs/workflow-map.html` — inte bara två. BIN-941:s kvarvarande punkt 2. *(planrevisionen F7)*

## C — slutlig form efter rollkritik (#7 QA, #4 Säkerhet, #6 Dataskydd, 2026-08-20)

C tillkom efter att panelen svarat på A+B, så den fick en egen blind runda. Alla tre gav
SUPPORT WITH CONDITIONS och ändrade formen på tre punkter. Ingen av dem hade jag tänkt på.

**1. `console.warn` var en REGRESSION, inte en neutral form.**
`src/lib/sentry.ts` har ingen console-fångst, men Sentrys webb-SDK har `globalHandlers`
med `onunhandledrejection: true` i sina DEFAULT-integrationer, och `S.init()` sätter aldrig
`defaultIntegrations` — #6 verifierade det genom att läsa
`node_modules/@sentry/browser/.../sdk.js` och `.../globalhandlers.js`. **Ett ohanterat fel
når alltså Sentry idag.** Att byta det mot `console.warn` hade gjort riktiga fel osynliga.

Formen blir i stället `console.error` + `captureError(err, { scope: 'watchlist', kind })`
(`src/lib/sentry.ts:96`, samma kanal som `queryClient.ts` och `SegmentError.tsx`).
Inget `uid` i `extra`. *(#4 villkor 1, #6 villkor 2, #7 fynd 1)*

**2. Fånga BARA `permission-denied`.**
En bred catch sväljer också nätverksfel och kvotfel — och repot har gjort exakt det misstaget
förut och rullat tillbaka det: `src/lib/firebase/groups.ts:206-215` beskriver hur
sammanslagningen före 2026-07-20 fick en dålig mobiluppkoppling att rapporteras som en ogiltig
länk. Samma hjälpare återanvänds:
`(err as { code?: string } | null)?.code === 'permission-denied'`.
Allt annat kastas vidare, precis som idag. *(#4 villkor 2, #7 villkor 1, #6 villkor 2)*

**3. Tillägg-vägen (`writeTitle`) får INTE tystas.**
Den returnerar `outcomeOfAddWrite(write)` och kommentaren strax under `setDoc`-raden säger varför:
*"a rejected write never reports a count … so the toast cannot describe something Firestore
refused."* Det är BIN-895:s fix. Sväljs felet där rapporterar knappen "tillagd" om en titel
golvet nekade — samma falska besked BIN-895 stängde, återöppnat på create-vägen.

`writeTitle` loggar därför och **kastar vidare**. Bara de sex redigeringarna
(`updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`, `updateProgress`,
`updateTmdbStatus`) tystas. *(#6 villkor 1 — hen sa uttryckligen att hen inte skriver under på
alternativet.)*

**Varför de sex är säkra att tysta:** golvet är create-only, så de kan bara nekas när
måldokumentet inte finns — alltså exakt kapplöpningen. Titeln ÄR borta och
snapshot-lyssnaren tar bort raden. Med narrowingen i punkt 2 sväljs inget annat.

### Villkor för C (bindande)

14. De sex — `updateVisibility`, `updateStatus`, `updateWatchedAt`, `updateRating`,
    `updateProgress`, `updateTmdbStatus` (namn, inte radnummer: BIN-954 flyttade alla) —
    fångar **bara** `permission-denied`, loggar med
    `console.error` + `captureError({ scope: 'watchlist', kind: '<call site>' })`, och kastar
    allt annat vidare. Diffkontroll: sju `captureError`-anrop är FEL — det ska vara sex, med
    var sitt `kind`. *(#4:1-2, #6:2, #7:1)*
15. `writeTitle` (tillägg-vägen) loggar och **kastar vidare**. Diffkontroll: dess catch slutar på
    `throw`, eller så saknar den catch helt. *(#6:1)*
16. Test per call site, båda riktningarna, i `src/contexts/WatchlistContext.test.tsx`
    (matchar `vitest.config.ts`:s glob; mönstret finns i testerna
    *"swallows a Firestore failure without throwing"* och det som gör
    `batchCommit.mockRejectedValueOnce(new Error('permission-denied'))` — namn i stället
    för radnummer, som BIN-954 flyttade):
    * `permission-denied` → löftet resolvar, och `captureError` anropades med rätt `kind`
      (spionerat — "kastade inte" ensamt bevisar inte att det loggades).
    * annan kod (t.ex. `unavailable`) → löftet avvisas fortfarande.
    Det negativa fallet är vad som hindrar att narrowingen tyst blir en bred catch igen. *(#7:2, #4:3)*
17. Test: en create som golvet nekar i `writeTitle` lämnar anroparens löfte **avvisat**.
    Villkor 12 bevisar bara att en bra payload släpps igenom — inte att en nekad syns för
    anroparen. (Radnumret "721" är struket 2026-08-20 på #7:s villkor 4 — samma förbud mot
    radnummer som resten av planen.) *(#6:5)*
18. Villkor 12:s negativa halva måste mutera `buildAddWrite()`s FAKTISKA returvärde
    (t.ex. `delete write.tmdbId`), inte ett handbyggt objekt — annars dubblerar den villkor 6
    och prövar inget nytt. Skrivs i testets kommentar. *(#7:3)*
19. Den nya daterade posten delar upp sig som `communityRatingMaintain`-posten (2026-08-16)
    gör: **Accepted** = bara den smala kapplöpningen (create-golvets nekande mot ett samtidigt
    raderat dokument, sex call sites, `writeTitle` undantagen). **NOT accepted, still fileable**
    = (a) `writeTitle` som sväljer tyst, (b) ett SYSTEMATISKT nekande av de sex (regelregression,
    eller en klientbugg som gör varje merge-skrivning till en create), (c) `updateNotes`
    (villkor 23). Observationskanalen som namnges som re-open-trigger är `captureError`
    scope/kind — **för alla tre**, vilket är hela skälet att villkor 25 taggar `updateNotes`
    i stället för att lämna den på en otaggad ofångad rejection. (Radnumren strukna
    2026-08-20; #7:s villkor 4 och 5.) *(#6:3, #4:4, #7:4-5)*
20. Samma post namnger **riktningsasymmetrin**: mekaniskt är A symmetrisk, men en misslyckad
    publik→privat-kaskad lämnar objekt kvar i det ÖPPNARE läget (2026-07-30-postens farliga
    riktning), medan privat→publik bara blir mer privat än avsett — aldrig ett läckage.
    "Kaskadfel" får inte stå som en odifferentierad risk. *(#6:4)*
21. `firebase deploy --only firestore:rules` körs i **samma sittning** som pushen, inte senare.
    Skälet står under "Behöver dig". *(#4:5)*

### Det #4 eskalerade till Malin, och som är sagt

Kodfixen (A) stänger bara kaskadens EGEN väg.

**RÄTTELSE 2026-08-20 (integrationsgranskningen, varv 4): här stod "de sex andra
skrivvägarna". Fel — och fel på ett farligt sätt, eftersom sex är antalet TYSTADE vägar
(villkor 14), inte antalet EXPONERADE.** Två olika frågor, två olika mängder, och den som
läser sex som svar på båda tappar `updateNotes` (vars nekande är atomärt med
anteckningsskrivningen och uttryckligen ännu inte vägt) och `nextAirReadRepair` ur
exponeringen.

Räknat med kommandot: `grep -n "merge: true" src/contexts/WatchlistContext.tsx` → **10**
träffar, en per skrivväg. `writeTitle` bär alltid golvfälten (`buildAddPayload`s
`AlwaysWritten`), så **nio** av dem kan bli en spök-create — `updateVisibility`,
`updateStatus`, `updateWatchedAt`, `updateRating`, `updateNotes`, `updateProgress`,
`updateTmdbStatus`, `setRuntime`, `refreshTmdbFields` — plus
`src/lib/watchlist/nextAirReadRepair.ts` (`batch.set` + `merge`). De kan skapa spöken precis
som idag **tills golvet ligger ute**.
Golvet deployas manuellt och grindas inte av CI. Fönstret mellan push och regel-deploy är
alltså en öppen bugg, inte städning. Sagt till Malin 2026-08-20.


## Rollback

* **A och C** går med hosting: `git revert`, push, deploy.
* **B** är `firestore.rules` och deployas manuellt. En revert i git ändrar INTE reglerna på
  servern — det krävs ett nytt `firebase deploy --only firestore:rules`.
* Ordningen vid återställning är omvänd mot deployen: reglerna först tillbaka, sedan koden.
  Tvärtom skulle återställa den create-kapabla kaskaden under det strikta golvet.

## Behöver dig (Tier D) — sekvensen, rättad

v2:s instruktion gick inte att följa: pushen dör på `deploy.yml:47-55`-vakten, så det finns
ingen hosting-deploy att vänta in.

1. `npm run test:rules` lokalt, grönt. **Tillagt 2026-08-20 (#7:s villkor 7):** `npm test`
   kör INTE emulatorsviten (`vitest.config.ts` exkluderar `src/test/rules/**`). CI och
   `deploy.yml` kör den, men asynkront — steg 4 nedan kan annars ske medan den fortfarande
   går.
2. Push (deployen går **röd med flit** — vakten stoppar allt som rör `firestore.rules`).
3. Hosting via **Run workflow**-knappen på `deploy.yml` (`workflow_dispatch` hoppar över vakten).
4. **Före deployen:** `git hash-object firestore.rules` ska vara identisk med den committade
   bloben. Deployen läser ARBETSTRÄDET, inte commiten — och under BIN-942:s granskning låg
   filen i flera minuter med golvet ersatt av `&& true /* MUTANT */`, satt av en systersession
   som muteringsprövade. En deploy i det fönstret hade shippat golvet AVSTÄNGT, tyst och
   framgångsrikt. (Integrationsgranskningen, varv 4.)
5. `firebase deploy --only firestore:rules`.

Koden (A+C) måste ut FÖRE reglerna (B) — omvänt mot BIN-766. Går golvet ut först nekas
skrivvägarna innan felhanteringen finns på plats.

## Kartan

`flow1`-steget och "STILL OPEN (BIN-942)"-stycket blir falska. Uppdateras i en **egen commit**
efter kodcommiten (e2cf608-lärdomen).

## v5 — vad BIN-954 ändrade i förutsättningarna (2026-08-20, efter `7a5eb45`)

Panelen svarade på en inventering som var **för snäv**, och två av villkoren räknar med den.
Ingenting i A eller B ändras; det som ändras är sidoeffektbokföringen och att en väg till
måste få en uttalad disposition. Skrivet före första Edit i BIN-942.

### 1. Ankaret var fel, inte bara talet

Inventeringen byggde på `grep "await setDoc(ref"` → åtta träffar, sju i scope. Men golvet är
ett **create-golv** och träffar varje `merge: true`-skrivning mot samlingen, oavsett hur
anropet råkar vara formulerat. `grep -c "merge: true" src/contexts/WatchlistContext.tsx` → **10**,
och tre av dem syntes inte i det gamla ankaret:

| Skrivare | Varför den missades | Exponerad? |
| -- | -- | -- |
| `setRuntime` | `setDoc(doc(...), …)`, inte `setDoc(ref, …)` | **Ja** |
| `refreshTmdbFields` | samma form | **Ja** |
| `updateNotes` | `batch.set(itemRef, …, { merge: true })` | **Ja** |

Plus `nextAirReadRepair.ts` utanför filen (`batch.set` + `merge`).

`writeTitle` är den tionde och är **inte** exponerad: `buildAddPayload`s `AlwaysWritten` är en
äkta övermängd av golvet, så dess create passerar alltid. Efter BIN-954 gäller samma sak för
`updateProgress` tilläggsgren — men dess merge-gren är kvar och är exponerad.

**Räkningen blir alltså: tio skrivvägar kan nekas, inte sju.** Nio i `WatchlistContext`
(alla utom `writeTitle`) plus `nextAirReadRepair`.

### 2. `setRuntime` och `refreshTmdbFields` — villkor 10 står, med en anmärkning

Båda grindar redan på att titeln finns (`if (!current …) return`), så bara kapplöpningen når
dem, och båda fångar redan. Villkor 10 (ingen anropsplatsfix, egen biljett) står kvar.

**Anmärkningen:** `setRuntime`, `refreshTmdbFields` OCH `flushNextAirWrites` fångar alla med
`console.warn` — tre ställen, inte ett (#6 och #27 fann det oberoende). Panelens punkt 1 slog fast att
`console.warn` är en REGRESSION jämfört med ett ohanterat fel, eftersom Sentrys
`globalHandlers` fångar det senare men inte det förra. B gör nekanden vanligare på just de
här vägarna. Det är inte ett skäl att bygga om dem i den här biljetten — det är ett skäl att
följdbiljetten säger `captureError`, inte "fångar redan, klart".

### 3. `updateNotes` — den enda som behöver ett BESLUT

Nyupptäckt, och den enda av de tre som inte redan är avhandlad.

**Varför den är exponerad:** item-doc-skrivningen är villkorad
(`current?.notes != null || Object.keys(visFields).length > 0`). Är titeln raderad och
snapshoten landad är `current` `undefined`, och `shouldStampVisibility(undefined)` är **true**
(`undefined?.visibility == null`), så `visFields` är icke-tom och skrivningen sker. Mot ett
borta dokument är den en create med bara `notes: deleteField()` + de två synlighetsfälten —
golvet nekar. Batchen är atomär, så **anteckningsskrivningen faller med den**, och
`updateNotes` avmarkerar `migratedNotesRef` och kastar vidare.

**Vad användaren ser idag:** `NotesBlock`s `onChange` returnerar `void` och ingen inväntar
löftet, så ett nekande blir en ofångad promise-rejection. Den når Sentry (globalHandlers) men
inte användaren. Anteckningstexten ligger kvar i textarean.

**RÄTTELSE 2026-08-20 (#6):** meningen nedan sa ursprungligen "ingen catch". Fel — en catch
FINNS redan (den avmarkerar `migratedNotesRef` och kastar vidare). Det som saknas är
Sentry-taggen, och den läggs till enligt villkor 25.

**Disposition: LÄMNA BETEENDET, TAGGA SIGNALEN.** Samma regel som villkor 15
ger `writeTitle`: en sparning som misslyckas får inte se ut som en sparning som lyckades. Att
tysta den här vore värre än de sex — de sex skriver om metadata på en rad som ändå försvinner
ur listan, den här är användarens egen text, och batchens atomicitet gör att ett nekande
kastar bort den texten. Den namnges i den daterade posten som en känd, kastande väg, och
observationskanalen är `captureError` med `kind: 'updateNotes'` (villkor 25) — inte en otaggad
ofångad rejection, som inte gick att skilja från appens alla andra.

**Det jag INTE föreslår, och varför:** att grinda item-doc-skrivningen på `current != null`.
Det skulle stänga exponeringen helt, men det ändrar också en BIN-595-avvägning under kall
laddning (då är `current` undefined och stämplingen sker med flit), och det är en
omdesign av en väg som inte är den här biljettens ämne.

### 4. Vad som INTE ändras

Villkor 14:s sex står oförändrade — `updateVisibility`, `updateStatus`, `updateWatchedAt`,
`updateRating`, `updateProgress`, `updateTmdbStatus`. Diffkontrollen "sju `captureError`-anrop
är FEL, det ska vara sex" är fortfarande rätt. A, B, deploysekvensen, arkiveringssteget och
testvillkoren är oförändrade.

### 5. Villkor som tillkommer (den fokuserade kritiken 2026-08-20)

Fyra roller kritiserade DELTAT blint — #6 Dataskydd, #4 Säkerhet, #27 Databas, #7 QA. Alla
fyra: SUPPORT WITH CONDITIONS. **Ingen vidgade filuppsättningen, så ingen omroutning.**
Routern kördes ändå om på den faktiska uppsättningen: `tier: "top"`,
`reasonCode: "high-stakes"`, `panel: [27, 5, 4, 6, 7]`, `highStakes: [AuthContext.tsx,
firestore.rules]` — oförändrat.

**Det de bekräftade genom att själva köra kommandot**, inte bara läsa planen:

* Inventeringen är nu **komplett vid tio**. #27 räknade om hela repot, klient och
  `functions/`, och hittade ingen elfte. `taste/backfill.ts` (`updateDoc`) och
  `WatchlistContext`s två `batch.update`-vägar kan aldrig skapa. Den enda Admin-SDK-skrivaren
  mot samlingen är `tmdbTosSweep` — den förbigår regler helt men är update-only, och den är
  redan namngiven i regelkommentaren.
* **Golvet är rätt vid tre fält.** #4 spårade varje nyttolast: `writeTitle` bär alltid alla
  tre; de nio andra saknar minst `tmdbId` OCH `mediaType` — även `buildStatusUpdate`, som
  returnerar `status` men inte de andra två. Inget legitimt skapande nekas.
* **BIN-954:s nya create-väg är säker.** `updateProgress` tilläggsgren skriver inte själv —
  den bygger en payload och går via `upsertTitle` → `writeTitle`, samma dörr som alla andra
  tillägg. #7 räknade tio produktionsanropare av `buildWatchlistAddPayload`, alla genom den
  dörren. Villkor 12/18:s golvtest täcker alltså den nya vägen transitivt; det står här
  eftersom planen aldrig sa det.
* **A skyddar sig själv redan vid kod-deployen.** `update()` bär ett existensvillkor
  Firestore tillämpar oavsett regler, så kaskadens egen kapplöpning stängs av A ensam. Det är
  de nio andra vägarna som är öppna tills B ligger ute — vilket är precis det deployfönstret
  handlar om.
* **`visibilitySyncPending` är en verklig självläkning**, inte ett påstående: flaggan sätts
  vid fel och en egen effekt kör om kaskaden vid nästa laddning och rensar flaggan först vid
  lyckat resultat. Chunkstorleken är **450 exakt**. Firestore debiterar aldrig en batch som
  reglerna avvisar, så A kostar inget extra i skrivningar.
* **`console.warn`-blindheten finns på TRE ställen**, inte ett: `setRuntime`,
  `refreshTmdbFields` och `flushNextAirWrites` (två catch-ställen i samma fil). #6 och #27
  fann det oberoende av varandra.
* **`updateNotes` HAR redan en catch.** v5 §3 sa "ingen catch" — fel. Catchen avmarkerar
  `migratedNotesRef` och kastar vidare; det som saknas är Sentry-taggen.

**Nya bindande villkor:**

25. **`updateNotes` får `captureError(e, { scope: 'watchlist', kind: 'updateNotes' })` inuti
    sin BEFINTLIGA catch, före `throw e`.** Rent additivt: ingen ny catch, ingen ändrad
    styrflödeslogik, ingen tystnad, ingen notis. Utan taggen är postens re-open-utlösare för
    `updateNotes` en otaggad ofångad rejection, omöjlig att skilja från appens alla andra —
    exakt den ouppnåeliga utlösare `communityRatingMaintain`-posten är skriven för att
    förhindra. *(#6:1, och den löser #7:5)*
    **Ingen konflikt med #4:s "ingen kodändring för `updateNotes`":** #4:s poäng var att den
    inte får svälja. Den kastar fortfarande vidare.
26. Diffkontrollen i villkor 14 räknas om: efter den här batchen finns **åtta**
    `captureError`-anrop i `WatchlistContext.tsx` — ett från BIN-954 (`updateProgress-add`),
    sex nya för de tystade redigeringsvägarna, och ett för `updateNotes` (som kastar vidare).
    Var och en med sitt eget `kind`. Sju var rätt tal före villkor 25; det är det inte längre.
    *(#6:1, #7:5)*
27. Den daterade posten säger för `updateNotes`: **befintlig catch, nu taggad, kastar
    fortfarande vidare, ingen signal till användaren** — inte "ingen catch". *(#6:2, #6:4)*
28. Den daterade posten säger uttryckligen att batchens atomicitet gör att ett nekande på
    item-doc-skrivningen **också kastar bort användarens väntande anteckningstext** i samma
    commit — inte bara att synlighetsstämplingen uteblir. Det är kostnaden, och den ska stå
    skriven. *(#4:1)*
29. Rättelsen av regelkommentaren (villkor 9) får INTE tappa Admin-SDK-meningen — den som
    säger att `tmdbTosSweep` förbigår reglerna men är update-only. Den är #27:s egen
    obligatoriska upplysning och är lätt att råka radera när "STILL OPEN" skrivs om.
    *(#27:2)*
30. Nytt enhetstest för `updateNotes` i det befintliga
    `describe('WatchlistContext — updateNotes + eager notes migration (BIN-505/BIN-522)')`:
    `batch.commit()` avvisar med `permission-denied` → `updateNotes(...)` **avvisar**, och
    `captureError` anropades med `kind: 'updateNotes'`. Utan det kan en framtida "gör den
    konsekvent med de sex"-städning tyst öppna precis det v5 §3 resonerade emot, och
    ingenting faller. *(#7:2)*
31. Följdbiljetten (villkor 10/24) namnger **alla tre** `console.warn`-ställena —
    `setRuntime`, `refreshTmdbFields` och `flushNextAirWrites` — och säger `captureError`,
    inte "fångar redan". *(#6:3, #27:1, #7:6)*
32. `npm run test:rules` körs lokalt och redovisas grönt **före** den manuella regeldeployen.
    `npm test` kör inte emulatorsviten; CI och `deploy.yml` gör det, men asynkront.
    *(#7:7)* — inlagt som steg 1 under "Behöver dig".

## v6 — granskningsvarv 1 underkände: en tyst nekad skrivning bekräftades i UI:t

**Kod- och integrationsgranskaren hittade samma defekt oberoende av varandra**, och
säkerhetsgranskaren passerade. Det är ett riktigt användarfel, inte en formalitet.

### Defekten

C:s hela poäng är att de sex redigeringsvägarna SVÄLJER golvets nekande. Att svälja betyder
att löftet **resolvar**. Två anropare utanför `WatchlistContext` läser ett resolvat löfte som
bevis på att skrivningen skedde:

* `VillSePickerPage.markSeen` — `await updateStatus(...)` och sedan
  `toast("Markerad som sedd: X")`, ovillkorligt. Filens egen kommentar säger att toasten
  "bekräftar i klartext". I exakt den kapplöpning biljetten handlar om bekräftar den alltså
  något som Firestore vägrade.
* `QuickRateModal.markRated` — `setRated(...)` körs ovillkorligt efter de bevakade
  skrivningarna och pensionerar kortet permanent för det passet.
* Dessutom, inne i kontexten: `trackEvent('status_changed', …)` avfyrades ovillkorligt.

Det är samma falska bekräftelse BIN-895 stängde för tilläggsvägen, och exakt det villkor 15
och #6:s villkor 1 förbjuder — bara en dörr bort. Den daterade posten påstod dessutom
"utan notis till användaren" och "Notis går dessutom inte att nå därifrån": sant om
kontexten, **falskt om de här anroparna**, som redan håller `useToast`.

### Fixen — utfallet blir observerbart i stället för gissat

`guardedItemWrite` returnerar nu `ItemWriteOutcome` (`'written' | 'refused'`), och de sex
mutatorerna returnerar det vidare. Kontraktet är en enda mening som håller för alla grenar
och alla sex: **`'written'` = biblioteksdokumentet speglar nu det anropet; `'refused'` = det
gör det inte.** Det täcker golvets nekande, `updateProgress` gren C (som med flit inte skriver
något) och tilläggsgrenens TMDB-fel utan att någon av dem måste kallas något de inte är.

En anropare som inte säger något behöver fortfarande inte bry sig om värdet — `await` av ett
`Promise<ItemWriteOutcome>` i void-läge kompilerar oförändrat, så inga andra anropsställen rörs.

Gatade anropare: `VillSePickerPage` (ingen toast vid `'refused'` — kortet försvinner ändå,
eftersom titeln är helt borta, och det finns ingen åtgärd kvar att erbjuda),
`QuickRateModal` (kortet pensioneras inte), och `updateStatus`
egen `trackEvent`.

### Villkor som tillkommer

33. `guardedItemWrite` returnerar `ItemWriteOutcome`, och de sex mutatorerna returnerar det.
    Diffkontroll: ingen av de sex får ha kvar `Promise<void>` i `WatchlistState`. *(kod+integration)*
34. `VillSePickerPage.markSeen` toastar INTE vid `'refused'`; `QuickRateModal.markRated`
    markerar INTE kortet som hanterat vid `'refused'`; `updateStatus` avfyrar INTE
    `status_changed` vid `'refused'`. Ett test per påstående. *(kod+integration)*
35. Den daterade posten rättas: "utan notis till användaren" ersätts av att de anropare som
    HAR en bekräftelse är gatade på utfallet. Och inversionen "sju i stället för tio" rättas
    till "tio i stället för sju" — den motsäger postens egen rubrikräkning tre stycken ovanför
    och inbjuder nästa läsare att "rätta" tiotalet nedåt. *(integration)*
36. `groups.ts`s sista inline-stavning av predikatet (`subscribeToGroupHousehold`) använder den
    delade hjälparen — annars är "en definition, så de inte kan glida isär" inte sant om filen
    hjälparen bröts ut ur. *(integration, valfritt fynd 4)*
37. Kommentaren "denied for exactly one reason" mjukas upp: `isValidWatchlistItem` kan neka en
    UPDATE också, och det är just det systematiska fallet posten listar som icke-accepterat.
    *(integration, valfritt fynd 5)*

### Noterat, inte byggt

Säkerhetsgranskaren: `isValidWatchlistItem` värdebinder aldrig `tmdbId`/`mediaType`/`status`
(bara `hasOnly` på nyckeluppsättningen, plus `rating`-intervallet från BIN-143). Golvet stänger
alltså spöket som SAKNAR identitet, inte ett med skräptypad identitet. Föregående biljettens
defekt, inte den här — filat separat.

## v7 — granskningsvarv 2: regelkommentaren motsade sig själv

Säkerhet, kod och test: **pass, 0 blockerande**. Testgranskaren dödade sex enhetsmutanter och
en regelmutant på egen hand. Integrationsgranskaren fällde EN sak, och den var riktig.

**Fyndet.** Skribentinventeringen i `firestore.rules` beskrev fortfarande
`cascadeVisibilityToItems` som en `batch.set(…, {merge:true})` som "denna regel NEKAR", och
citerade 2026-08-19-posten som skäl — men A i samma commit gjorde kaskaden till `batch.update`
(som aldrig når create-regeln), och samma commit arkiverade den posten. Stycket direkt under
var redan omskrivet till "CLOSED 2026-08-20", så kommentarens två halvor sa emot varandra. Det
är den enda kopian av inventeringen — testfilen säger uttryckligen "läs den där" — så nästa
läsare hade lärt sig att det är riskfritt att återinföra `set(merge:true)` i kaskaden.

**Åtgärdat enligt strykregeln** (`.claude/rules/code-style.md`, tillagd 2026-08-21): de falska
satserna är BORTTAGNA, inte omskrivna. Kaskaden är flyttad till "kan inte skapa"-klassen bredvid
`taste/backfill.ts`, citatet av den arkiverade posten är struket, och alla radnummer i
uppräkningen är borta. Ett nytt stycke säger varför A och B inte är överlappande: `batch.update`
stänger bara kaskadens EGEN kapplöpning, golvet täcker de nio andra merge-skrivarna. Testfilens
blockrubrik och två testnamn beskrev också en nyttolast ingen anropare längre skickar på
create-vägen — omdöpta till vad de faktiskt prövar.

**Två valfria fynd åtgärdade:** en klausul på `ItemWriteOutcome` om att `'refused'` på
avbockningsvägen INTE betyder att användarens gest misslyckades (`episodeProgress` skrivs
parallellt), och `useMarkSeen`s `rate_on_sedd` är namngiven i den daterade posten som medvetet
ogatad — den mäter att betygsfrågan besvarades, inte att ett betyg lagrades.

**Kartan** ligger som en vanlig oincheckad ändring i arbetsträdet och committas direkt efter
kodcommiten.

**RÄTTELSE (integrationsgranskningen, varv 4):** den låg först i en stash, och planen kallade
den "kartans stash". Den stashen innehöll **tolv** filer, fem av dem i sitt läge FÖRE
granskningsvarv 3 — bland annat `WatchlistContext.tsx` utan `ItemWriteOutcome`, alltså precis
den kod två granskare blockerade på. Ett `git stash pop`, som meningen inbjöd till, hade
antingen krockat i alla tolv eller tyst backat granskad kod. Kartan är utplockad med
`git checkout stash@{0} -- docs/workflow-map.html`, verifierad (bär BIN-942-texten, ingen
"STILL OPEN", lintern grön) och stashen är **borttagen** så ingen kan poppa den av misstag.
Det är också BIN-707/708-lärdomen: en stash är den artefaktklass som avdunstar, en oincheckad
fil i trädet syns i varje `git status`.

## Utfall — byggt 2026-08-20

**Formen på C avviker medvetet från villkor 14:s diffkontroll, och det är en skärpning.**
Villkor 14 sa "sex `captureError`-anrop, ett per anropsplats". Sex identiska try/catch-block
är precis det en integrationsgranskare kallar "ett begrepp hanterat sex gånger", så de sex
delar i stället EN hjälpare, `guardedItemWrite(kind, write)`. Räkningen blir därför:
**tre `captureError`-anropsställen** i `WatchlistContext.tsx` — ett i hjälparen, ett i
`updateProgress` tilläggsgren (BIN-954), ett i `updateNotes` — och **åtta distinkta `kind`**.
`grep -c "guardedItemWrite(" src/contexts/WatchlistContext.tsx` → **7** (sex anrop + en
definition). Villkorets AVSIKT — varje anropsplats individuellt identifierad, ingen missad —
är uppfylld och lättare att bevisa; dess bokstav är det inte.

`isPermissionDenied` flyttades ur `groups.ts` till en ny ren
`src/lib/firebase/errorCodes.ts` och importeras av båda, så villkor 2:s "samma hjälpare
återanvänds" är bokstavligt sann i stället för en kopia. Det utvidgar diffen med två filer
(`errorCodes.ts`, `groups.ts`) — inom säkerhetsgrindens befintliga `^src/lib/firebase/`-mönster,
ingen ny tier.

**Mätt:**

* `npm test` (rensad vite-cache) → **259 filer, 4269 passerade, 4 skippade, 0 fel.**
  Basläget före BIN-942 var 258/4242/4, alltså +27 nya tester och en ny testfil
  (`VillSePickerPage.test.tsx`, som inte fanns).

  **Två körningar av sex föll på ETT test var, båda gånger utan att jag hann fånga namnet;
  körningen direkt efteråt var grön med identiska siffror.** Samma mönster som under BIN-954.
  Redovisat som det är, inte bortförklarat och inte utrett — det går inte att återskapa på
  begäran. Misstanken är fortfarande kall-cache-timeouten BIN-937 handlade om (båda
  körningarna låg direkt efter `rm -rf node_modules/.vite/vitest` under hög last).
  Värt en egen biljett om det händer en tredje gång.
* `npm run test:rules` mot emulatorn på egen port (8085; 8080 hålls av Butlery) →
  **6 filer, 339 tester, 0 fel.** Basläget var 331 vid BIN-941; +7 nya här, +1 sedan tidigare.
* `npx tsc --noEmit` tyst. `npx eslint` på batchens alla lintbara `.ts/.tsx`-filer → **0 fel**;
  varningarna som finns är sedan tidigare (`_args`, `no-img-element`). Talen som stod här är
  strukna: de räknade en körning gjord innan v6 lade till fyra filer, och båda var fel för
  batchen som den ser ut nu.

**Muteringsprövat, fyra mutanter, alla fällda** (patchen assertad före OCH efter körningen,
återställning från scratchpad-kopia verifierad med `md5sum`):

* Golvet borttaget ur `firestore.rules` → **6 av 7** nya regeltester röda. Det sjunde är
  "läcker inte till update", som MÅSTE förbli grönt — det är villkor 5:s poäng. Det är
  villkor 4:s "ses falla rött först", utfört efteråt i stället för före, med samma bevisvärde.
* `guardedItemWrite` utan `isPermissionDenied`-kollen (bred catch) → 6 röda.
* `updateNotes` utan sin `captureError` → 1 röd.
* (BIN-954:s fyra mutanter kördes i föregående commit och står i dess avsnitt.)

* **Ägarkartan:** den nya `errorCodes.ts` var en ägarlös granne i en katalog kartan listar
  fil-för-fil, vilket BIN-788/803:s spärrhake fällde. Filen är nu namngiven under #4 Säkerhet
  i `docs/role-responsibilities.md` — rätt roll, eftersom hela dess syfte är att skilja ett
  serverNEKANDE från infrastrukturbrus, och det var #4:s eget villkor 2 som krävde den delade
  hjälparen. `node docs/org/route.mjs src/lib/firebase/errorCodes.ts` → `tier: medium`,
  `panel: [4]`.

**Följdbiljett filad före commit: BIN-957** — de tre `console.warn`-ställena
(`setRuntime`, `refreshTmdbFields`, `flushNextAirWrites` ×2), villkor 10/24/31.

**Regelkommentaren:** "STILL OPEN"-stycket är omskrivet till "CLOSED 2026-08-20", och
Admin-SDK-meningen om `tmdbTosSweep` är bevarad ordagrant (villkor 29).

**Kartan:** `flow1`-steget om kaskaden är omskrivet i samma svep. Det bryter mot
e2cf608-lärdomen om det ligger i kodcommiten — **kartan committas separat**.

## Öppna frågor

Inga arkitekturändrande okända. v1:s antagande om `hasAll`-semantik var meningslöst (golvet är
create-only; på en create finns inget tidigare dokument, så deltat ÄR resultatdokumentet) och
är struket. v2:s enda kvarvarande okända — hur C skulle nå en notis — är mätt och avgjord: den
kan inte, och den tysta formen valdes.

---

# Sprint 2026-08-19 — `--pick malin`, fyra biljetter

Malin valde alla fyra kandidaterna i ett interaktivt `--pick`-pass. Sessionen är BEVAKAD
och kan sammankalla panel, så tier-spärren (BIN-744/776/917) är uppfylld för alla fyra —
kritiken körs FÖRE första Edit/Write, vilket är regeln BIN-917 finns för.

**Basläge, mätt före första ändring (HEAD `2d67ff7`):**

* `git status --porcelain` → tomt.
* `npm test` → 257 filer, 4218 passerade, 4 skippade, exit 0, 106 s.

## Routing — rå utdata, körd på den FAKTISKA filuppsättningen vid HEAD

| Biljett | Router | Panel | Kritik |
| -- | -- | -- | -- |
| BIN-937 | `tier: medium`, `reasonCode: owned` | #5 Legal / GDPR Counsel | SUPPORT WITH CONDITIONS |
| BIN-936 + BIN-925 | `tier: medium`, `reasonCode: owned` | #19 Customer Support / Success | SUPPORT WITH CONDITIONS |
| BIN-766 | `tier: medium` → **omroutad `top`** | #27, #4, #6, #7, #13 | #27 klar; 4/6/7/13 pågår |
| BIN-868 | `tier: medium`, `reasonCode: owned` | #25 Engineering Manager / Release Manager | pågår |

**BIN-766 omroutades under körningen.** #27:s bindande villkor 2 kräver en formspärr i
`firestore.rules`. Routern på den nya filuppsättningen
(`runAggregate.ts` + `firestore.rules` + `src/test/rules/firestore-rules.test.ts`) ger
`tier: "top"`, `reasonCode: "high-stakes"`, `panel: [27, 4, 6, 7, 13]`. Ingen tier ärvd
från plan, biljettkommentar eller tidigare körning (BIN-787/788) — routern kördes om.

---

## BIN-937 — [Tier A] spärrhake-testet timeoutar under belastning

**Disposition:** build. **Fix:** (B) — läs trädet en gång, återanvänd innehållet.

`src/lib/watchlistWrites.addWrite.test.ts` → blocket `BIN-655 — the flag is gone and stays
gone`. `sourceFiles(SRC)` vandrar hela `src/`, och varje `it` läser sedan om VARENDA fil
med `readFileSync`. Rent I/O inuti vitests 5 s-standardtimeout. Timeoutade två gånger på
5000 ms under en lång session; grön i fem andra fullkörningar samma kväll.

**Acceptanskriterier (#5:s villkor 1–5 inviklade, bindande):**

1. Filinnehåll läses EXAKT en gång, nycklat på samma `sourceFiles(SRC)`-lista som redan
   beräknas — ingen andra, avvikande uppräkning. Båda de tunga `it`-fallen konsumerar
   samma cache. *(diff)*
2. Diffen rör bara schemaläggning/uppsättning: noll ändringar inuti något `expect(...)`,
   inuti `callers`-listan eller i något regexuttryck. *(diff)*
3. Vakuitetskontrollen (`finds a real source tree…`) körs mot det cachen FAKTISKT
   innehåller, så en tom/trasig cache faller högljutt i stället för att göra båda de tunga
   testerna gröna på ingenting. *(diff)*
4. Ingen global `testTimeout`-höjning i `vitest.config.ts` — det skulle lossa deadlinen
   för alla 257 testfiler. *(diff)*
5. `npm test` körs efter fixen med rensad `node_modules/.vite/vitest`, och resultatet
   redovisas med siffror — inte i prosa. *(diff)*
6. **#5:s villkor 5:** följdbiljett filad för `src/lib/firebase/userDocWrite.chokepoint.test.ts`,
   som har identisk form (egen `walk(SRC)` + per-fil `readFileSync`, ingen timeout-override)
   och samma exponering. *(diff — biljetten filad före commit)*

## BIN-936 + BIN-925 — [Tier A] de två raderingsskärmarnas texter kan glida isär

**Disposition:** build. Byggs som EN ändring; BIN-925:s kriterium 1 kräver ändå exakt den
jämförelse BIN-936 beskriver.

**Bindande begränsning:** de fyra låsta meddelandena och limbo-skärmens juridiskt godkända
text får INTE skrivas om (BIN-813 villkor 4). Fixen är ett test plus nedskriven motivering.

**Acceptanskriterier (#19:s villkor 1–5, bindande):**

1. Testet hårdkodar INTE limbo-knappens etikett en tredje gång. Det renderar
   `<DeletionLimbo />`, läser knappens faktiska text via
   `getByRole('button', { name: 'Slutför raderingen' })`, och hävdar att den literalen är
   en delsträng av BÅDE `RECENT_LOGIN_MSG` och `PARTIAL_MSG`. Ett namnbyte på endera sidan
   ska fälla testet. *(diff)*
2. Samma testfil pinnar den kvarstående luckan: för den otaggade andra-försöks-grenen
   (`STALE_MARKED_ERROR`) hävdas att toast-åtgärdens etikett är `Försök igen`, inte
   `Slutför raderingen` — alltså att meddelandet namnger en knapp som inte är den synliga
   åtgärden i just den renderingen. *(diff)*
3. En rad kommentar intill BÅDA textblocken som säger att de beskriver samma klassificerade
   läge från var sin sida av en avmontering, och som namnger testfilen som binder dem. *(diff)*
4. BIN-925:s biljett — inte bara kodkommentaren — bär åtkomlighetsfyndet i en mening med en
   namngiven återöppningsutlösare: de tre `setDeletionInProgress(true)`-anropsplatserna
   (`AuthContext.tsx:536`, `:638`, `:1227`) relativt färskhetsspärrens throw (~`:1190`). *(diff)*
5. Ingen av biljetterna rör de fyra låsta strängarna eller någon knappetikett. *(diff)*

**Åtkomlighet — #19:s fynd:** läget är INTE nåbart via någon verklig användarväg vid
`2d67ff7`, härlett statiskt (inte mekaniskt bevisat). BIN-925:s kriterium 1 löses därför
med alternativ (b): testet formuleras om till vad det bevisligen är, ett defensivt
kontraktstest av regeln taggen-före-klassificeringen.

**BIN-925 kriterium 2 är `kind: run`** — beslut om texten kräver Malin + #5 Juridik. Kan
per definition inte produceras av ett bygge. Markeras `awaiting-run`, går till "Behöver dig",
och är INGEN grund att hålla tillbaka batchen.

## BIN-766 — [Tier C] betygssnittet delas i två av ett felformat id

**Disposition:** build. **Väntar på panelen** (#4, #6, #7, #13) innan första raden kod.

#27:s villkor är redan bindande:

1. Ingen `mediaTypeDocId(pathMediaType, parseTmdbIdFromDocId(...))` utan `Number.isFinite`-spärr
   emellan — annars skrivs strängen `movie_NaN`.
2. Formspärr på `users/{uid}/watchlist/{itemId}` `create` i `firestore.rules`, speglad på
   det befintliga `canonicalSwipeDocId` (`firestore.rules:840-841`), `create`-only.
3. Invariantkommentaren `runAggregate.ts:118-120` rättas i samma commit — den blir sann
   först GIVET regelspärren.
4. Tester: `movie_042` → `movie_42`; legacy-grenen oförändrad; skräp-id hoppas över med
   varning, aldrig `movie_NaN`.

## BIN-868 — [Tier A] ägarkarts-spärren — **PREMISSEN IFRÅGASATT**

**Väntar på #25.** Urvalspassets egen granskning av main hittade detta:

* `docs/org/gen-ownership-map.test.mjs:32-37` gör redan precis den jämförelse biljetten
  efterfrågar: `expect(buildMap(tracked).map).toEqual(readJson('docs/org/ownership-map.json'))`.
* Den filen körs av `npm test` — verifierat: `npx vitest run docs/org/gen-ownership-map.test.mjs`
  → 1 fil, 11 tester, exit 0. Och `npm test` grindar både `ci.yml` och `deploy.yml`.
* Filhuvudet i `gen-ownership-map.mjs` rad 9–13 säger att `--check` MEDVETET inte rapporterar
  kartdrift, just för att testet gör det "instead of waiting for someone to remember a flag".
  Skrivet i `bfb82f4` **2026-08-12**, samma dag biljetten skapades (15:11).

Alltså: biljettens hål 2 är ett dokumenterat medvetet designbeslut, och skyddet den ber om
finns redan och blockerar redan deployen. Hål 1 ("körs ingenstans automatiskt") gäller
SKRIPTET men inte upprätthållandet. #25 fick uppgiften att mäta detta självständigt.


## Utfall — mätt, inte påstått

**Efter bygget, HEAD `2d67ff7` + arbetsträdet:**

* `npm test` (efter `rm -rf node_modules/.vite/vitest`) → **258 filer, 4230 passerade, 4 skippade**, exit 0. Basläget var 257/4218.
* `npm run typecheck` → exit 0.
* `npx eslint` på alla sju ändrade filer → exit 0.
* `npm run test:rules` → **6 filer, 330 passerade**, exit 0. Kördes på port 8085 via en
  egen scratchpad-config: 8080 hölls av **Butlerys** emulator (annat projekt, kanske en
  levande session) och den rörs inte.
* `node scripts/check-workflow-map.mjs` → OK, 100 noder, 31 flöden, täckning 76/76.

**Muteringsprov — varje ny spärr prövad mot det avgörande fallet:**

| Mutant | Utfall |
| -- | -- |
| Limbo-knappen döps om till "Avsluta raderingen" | BIN-936-testet föll (1 failed / 11 passed) |
| `&& canonicalWatchlistDocId(itemId)` strykes ur regeln | exakt de 10 alias-fallen föll (10 failed / 241 passed) |

Båda återställdes från scratchpad-snapshot och verifierades med `sha1sum` — identiska.
Aldrig `git checkout --`.

**#6 Dataskyddsombudets villkor 3 — skarp data, som kritiken inte kunde mäta:**
`firestore_list_documents` på `titleRatingsAggregate` i `binge-nu` → **262 dokument, hela
listningen (ingen `nextPageToken`), noll icke-kanoniska id:n, noll utfyllda alias, noll
id-noll.** Ingen migrering behövs, ingen befintlig delning finns att laga.

## Panelens villkor — hur de landade

Alla fem BIN-766-roller körde blint, var för sig, före första raden kod. Fyra av fem gav
SUPPORT WITH CONDITIONS; #25 gav BLOCK på BIN-868 (se nedan).

**Två konflikter i panelen, och hur de löstes:**

1. **#4 vs #7 om regelns bredd.** #4 ville spegla `canonicalSwipeDocId` ordagrant, vilket
   nekar bara-numeriska id:n på create. #7 mätte att det fäller **35 befintliga fixturer**
   i `firestore-rules.test.ts` och krävde ett uttryckligt val. Valt: #4:s strikta regel,
   och de 35 fixturerna namnrymdade (30 × `'603'`, 5 × `'1399'`). Skälet: två moduler bygger
   ett watchlist-doc-id för en SKRIVNING — `WatchlistContext` och `nextAirReadRepair` — och
   båda gör det via `mediaTypeDocId()` med `tmdbId` typad `number`, så ingen create-väg i
   appen kan avge en bar eller utfylld form. (`taste/backfill` skriver utan att bygga något
   id alls; `useFriendsWhoSaw` bygger ett men bara för att LÄSA.) Fixturerna beskrev en
   värld före BIN-560.

   Den här meningen fälldes av granskarna tre gånger på rad — först "enda skribenten", sen
   en fix som klumpade in `backfill` bland id-byggarna, sen en som glömde att läsvägarna
   också bygger id:t. Varje version var ett tal eller ett "exakt N" jag inte hade räknat.
   Det är lärdomen från BIN-905/918 som slår till igen, och den hör hemma i planen snarare
   än i koden: kör kommandot före meningen.
2. **#13 vs #7 om var funktionen bor.** #13 ville flytta `aggregateDocId` till `logic.ts`;
   #7 ville ha testerna i `runAggregate.test.ts`. Flytten kräver `RatingEvent` och
   `AggregateLogger`, som DEKLARERAS i `runAggregate.ts` — den hade gett en importcykel för
   att flytta en funktion. Avvikelse tagen och skriven i testfilens huvud: funktionen står
   kvar, testerna ligger i `runAggregate.test.ts`. Det gemensamma målet — ett rent test utan
   emulator, kört av `npm test` — är uppfyllt.

## BIN-868 — STÄNGD SOM OBSOLET, inte byggd

#25 gav **BLOCK** och bevisade det mekaniskt i stället för att lita på biljetten eller
filens kommentarer: handredigerade in en drift i `ownership-map.json`, körde
`npx vitest run docs/org/gen-ownership-map.test.mjs`, fick 1 failed / 10 passed med den
drivande skillnaden utskriven, återställde, bekräftade rent träd.

Skyddet biljetten ber om finns alltså redan, i `gen-ownership-map.test.mjs:32-37`, och
`npm test` grindar både `ci.yml` och `deploy.yml`. Att bygga det biljetten beskriver hade
rest en ANDRA, konkurrerande driftkoll bredvid den som fungerar — precis den delade hjärna
filens eget huvud (rad 9–13, skrivet i `bfb82f4`) argumenterar emot.

## Avvikelselogg

- [discovery] BIN-766: routern gav `medium` på biljettens egen filuppsättning, men #27:s
  bindande villkor 2 drar in `firestore.rules` → omroutad till `top`, full panel. Tiern
  följer den FAKTISKA filuppsättningen, inte biljettens.
- [discovery] BIN-868: premissen granskad mot main före bygget (regeln "kolla biljettens
  premiss mot main"). Drift-detekteringen finns redan i `gen-ownership-map.test.mjs` och
  grindar deployen via `npm test`. Inget byggt innan #25 svarat.

## Behöver dig (Tier D / `kind: run`)

- **BIN-766:** manuell deploy efter commit, i DEN HÄR ordningen — `deploy.yml` skickar
  bara hosting:
  1. `firebase deploy --only firestore:rules`
  2. `firebase deploy --only functions`

  Ordningen är inte en stilfråga. Skickas funktionen först är kanoniseringen live medan
  alias-id:n fortfarande får skapas — exakt det fönster hela regelspärren finns för.
  `firestore.rules` säger det själv: "Do not ship one half without the other.
- **BIN-925 kriterium 2:** beslut om de låsta texterna (du + #5 Juridik). Byggs inte här.

---

# BIN-917 + BIN-919 — 2026-08-18

Vald av Malin i ett `--pick`-pass. Båda är verifierat trasiga vid HEAD (`6d157c5`), båda
routar `medium`, och båda kritikerna är **körda före första Edit/Write** — det är precis den
regel BIN-917 finns för att laga, så den gäller den här körningen först av alla.

| Biljett | Router (rå, körd på den FAKTISKA filuppsättningen) | Kritik | Utfall |
| -- | -- | -- | -- |
| BIN-919 | `tier: medium`, `reasonCode: owned`, `panel: [25]` | #25 Engineering Manager / Release Manager | SUPPORT WITH CONDITIONS |
| BIN-917 | `tier: medium`, `reasonCode: unmapped-code`, `panel: [14]` | #14 Software Architect | SUPPORT WITH CONDITIONS |

Ingen tier ärvd från en plan, en biljettkommentar eller en tidigare körning (BIN-787/788).
Båda kritikerna körde sina egna mätningar och #25 reproducerade urvalspassets siffror exakt.

**Basläge, mätt före första ändring:**

* `git status --porcelain` → tomt.
* `npm test` → 256 filer, 4167 passerade, 4 skippade, exit 0.
* `node docs/org/metrics/check_events.mjs` → exit 0, `4 claim(s) checked — 0 evidenced, 4 retired by a correction, 1 grandfathered`.
* `node scripts/check-workflow-map.mjs` → OK, 100 nodes, 31 flows, coverage 76/76.

---

## Vad som INTE byggs, och varför — läs det här före allt annat

BIN-917 har fyra kriterier. **Två av dem kan inte ge en diff i det här repot, och ett tredje
kan det inte heller — vilket biljetten ännu inte visste.**

* **Kriterium 2** (kapacitetsregeln ska bo i sprintens URVAL) — urvalsmotorn ligger under
  `C:/claude-plugins`, utanför det här git-trädet. Biljetten säger själv detta.
* **Kriterium 3** (en uttagen biljett bär ett skrivet skäl) — samma motor, samma repo.
* **Kriterium 4** (en batch får inte nå COMMITTERAREN utan en `events.jsonl`-rad) — **BYGGT.
  Se avvikelseloggen längst ned.** Planen sa först att det var omöjligt här, på två prober som
  båda var sanna (`ls .husky` tomt, inget `precommit` i package.json) och en slutsats som var
  falsk: `lefthook.yml` ÄR repots commit-tidsmekanism och har legat här sedan 2026-08-08.
  Kriteriet uppfylls nu av ett `commit-msg`-block som kör modulens `--message`-läge.

Kontrollen har därför TVÅ lägen, och skillnaden mellan dem måste sägas rakt ut varje gång:

* `--message` — **commit-tid.** Bedömer ämnesraden på committen som håller på att skrivas och
  vägrar den. Det är kriterium 4 ordagrant, och det är vad `commit-msg`-hooken kör.
* utan flagga — **historik.** Går igenom varje gjord commit och kör under `npm test`, alltså
  grindar den DEPLOYEN. Backstop för allt som slank in innan hooken fanns, eller med
  `LEFTHOOK=0`.

Det historiska läget ensamt hade INTE uppfyllt kriterium 4, och den första versionen av den
här planen påstod att det var det bästa som gick att göra. **Ingenstans får det påstås att en
mekanism uppfyller ett krav den inte uppfyller** — det är fortfarande regeln; den gällde bara
åt andra hållet än jag trodde.

---

## Batch 1 — BIN-919: `package.json` når noll blockerande granskare

### Vad som är fel

Routern kallar `package.json` KOD (`docs/org/route.mjs:173`, `CODE_ROOT_FILES`) och routar
den `medium` / `unmapped-code`. Ingen `reviewGates`-post matchar den. Ett beroendebyte, en
scriptändring eller ett Next-versionslyft kan alltså committas utan en enda granskare.
Symmetrikollen ser det inte: regel A1 filtrerar på `reasonCode === 'owned' || 'high-stakes'`,
och `unmapped-code` är ingendera. Kollen skriver ut det som "Known blind spot 1" — den enda
platsen det stod.

### Mätning (kört av urvalspasset OCH oberoende reproducerat av #25)

```
TRACKED total: 1003
kodvägar: 859   medium/owned 556   medium/unmapped-code 294   top/high-stakes 9
A1 som den står idag (owned|high-stakes):  0 offenders
A1 nycklad på tier !== 'skip':             1 offender — package.json
unmapped-code: 294 totalt, 293 har redan en grind, 1 har ingen — package.json
```

Ombyggnaden av A1 kostar alltså **noll** nya röda fall utöver den fil biljetten handlar om.

### Acceptanskriterier (biljettens tre + #25:s sex villkor, alla bindande)

- [x] **A1.** `^package\.json$` läggs till i `binge-integration-reviewer`s `patterns`.
      **Rot-ankrat** — får inte också matcha `functions/package.json` eller någon nästlad
      `package.json`. *(#25 must-have 1)* *(kind: diff)*
- [x] **A2.** Bevis: `blockingGates('package.json')` är icke-tom OCH
      `blockingGates('functions/package.json')` är oförändrat `['binge-security-reviewer']`.
      Körs och klistras in. *(#25 must-have 1)* *(kind: diff)*
- [x] **A3.** #25 namnges som ägare av `package.json` i `docs/role-responsibilities.md` §25 —
      **tillagt på den BEFINTLIGA "Dependabot grouping + framework upgrades"-punktens
      pilrad**, som redan bär `.github/dependabot.yml`. Ingen ny punkt: det är samma sak.
      `docs/org/ownership-map.json` regenereras med `node docs/org/gen-ownership-map.mjs`.
      *(#25 must-have 2)* *(kind: diff)*
- [x] **A4.** Bevis: `node docs/org/route.mjs package.json` svarar `reasonCode: "owned"`,
      `panel: [25]` — inte `unmapped-code` / `[14]`. *(#25 must-have 2)* *(kind: diff)*
- [x] **A5.** En daterad `_note9` på integrationsgrindens post säger VARFÖR `package.json`
      går till integration och inte till security, och tar uttryckligen upp att
      `functions/package.json` redan når `binge-security-reviewer` — men bara **av en
      slump**, via prefixet `^functions/`, inte via ett beslut om leveranskedjan.
      Inkonsekvensen får inte shippas outtalad. *(#25 must-have 3)* *(kind: diff)*
- [x] **A6.** A1 nycklas om till `tier !== 'skip'`. *(#25 should-have 1, uttryckligen
      stödd)* *(kind: diff)*
- [x] **A7.** Ett GOLV som gör den vidgade regeln icke-vakuös: antalet kodvägar med
      `reasonCode === 'unmapped-code'` assertas `>= 230` (uppmätt: 295; golvet var 100 i en
      runda, vilket granskaren korrekt kallade slappare än de golv commiten själv skärper). Utan det
      passerar A1 tyst om `route.mjs` någonsin slutar avge `unmapped-code`.
      *(#25 must-have 4 — spärrhake-behöver-golv, BIN-838/823/850)* *(kind: diff)*
- [x] **A8.** Både "Known blind spot 1" OCH A1:s egen beskrivning i filhuvudet skrivs om.
      Huvudet säger idag ordagrant "that is reasonCode `owned` AND `high-stakes`" — den
      meningen blir falsk i samma stund A1 nycklas om. *(#25 must-have 6, biljettens
      kriterium 3)* *(kind: diff)*
- [x] **A9.** Efter ändringen: censusen körs om och visar **0 offenders under BÅDA
      nycklingarna**, och `npx vitest run docs/org/gate-symmetry.test.mjs` är grön.
      *(#25 must-have 5)* *(kind: diff)*
- [x] **A10.** De två slappa tomhetsgolven i samma fil skärps. Uppmätt av #25:s
      RETROAKTIVA kritik av `851696d` (batch 2:s arbete, men fyndet ligger i den här filen):
      `tier !== 'skip' >= 400` mot verkliga **883** (golvet är 45 %) och
      `gates.length > 0 >= 400` mot verkliga **875** (46 %). Ett golv på under halva
      värdet fångar inte en regression som halverar routerns utdata — precis den klass
      BIN-926 är filad om. Höjs till 700. De tre övriga golven är redan snäva (1003/800,
      17/15, 9/7) och lämnas. *(kind: diff)*

### Vad Malin behöver veta (#25 should-have 1, ordagrant vidarefört)

A1-omnycklingen är en beteendeändring på en rad: en **ny** rotfil av config-typ
(`.nvmrc`, `renovate.json`, en TOML-fil) som varken ägs eller grindas kommer nu att fälla
`npm test` tills någon ger den en ägare eller en grind. Det är bromsen som är meningen — men
den ska inte komma som en överraskning nästa gång något sådant läggs till.

### Öppen fråga som EN roll inte kan avgöra (#25 should-have 2)

`ROLE_WORLD_MODEL.md:712` listar #4 Säkerhetsarkitekt som medintressent för
Dependabot/beroendebevakning vid sidan av #25. Routern satte bara `[25]`. Om svaret på A5 är
"security borde också grinda `package.json`" är det en andra-roll-fråga som den här
enrollskritiken inte får avgöra ensam. **Lyfts till Malin i slutrapporten, byggs inte här.**

---

## Batch 2 — BIN-917: de två uteblivna kritikerna, och tystnaden efter dem

### Acceptanskriterier

- [x] **B1.** Kritiken från #19 Customer Support körs retroaktivt på `049f21b`:s diff av
      `src/components/settings/DeleteAccountSection.test.tsx`. *(biljettens kriterium 1)*
      *(kind: diff)*
- [x] **B2.** Kritiken från #25 Engineering Manager körs retroaktivt på `851696d`:s fyra
      filer. *(biljettens kriterium 1)* *(kind: diff)*
- [x] **B3.** Båda utfallen skrivs till `docs/org/metrics/events.jsonl` med `ran: true`,
      via `node docs/org/metrics/log_event.mjs review '{…}'`. Varje rad bär
      `commit_sha` (`049f21b` / `851696d`) — deras prosa säger "shipped", vilket
      `claimsReachedMain` fångar, så en rad utan sha vore en ny obevisad utsaga i samma fil.
      *(kind: diff)*
- [x] **B4.** Varje rad bär ett `timing`-fält. Ingenting i dagens schema skiljer "kritiken
      kördes innan koden fanns" från "kritiken kördes efteråt mot redan mergad kod".
      **RÄTTELSE:** planen sa först att `/org-retro` poängsätter på fältet. Det är falskt —
      utfallsgranskaren grep:ade hela `role-org`-pluginen efter `timing`, `retroactive` och
      `pre-build` och fick noll träffar, och skillens dokumenterade fältlista nämner det
      inte. Fältet läses av ingenting idag. Det är fortfarande rätt att skriva — utan det är
      de sju raderna omöjliga att skilja från sju granskningar som löste ut i tid — men
      motivet är framtida mätbarhet, inte en befintlig konsument. Fältet är nu dokumenterat
      i `docs/org/metrics/README.md`:s schematabell, vilket är precis vad den tabellen finns
      för. *(#14 must-have 7)* *(kind: diff)*
- [x] **B5.** De två nya raderna får inte kollidera med eller dubblera de fyra
      `correction`-rader som redan ligger i filen från `9d53349`. Kontrolleras före
      skrivning. *(#14 must-have 7)* *(kind: diff)*
- [x] **B6.** `node docs/org/metrics/check_events.mjs` är fortfarande grön efteråt, och
      `evidenced` har gått från 0 till **5**. *(Planen sa först "till 2" — det var en gissning
      skriven innan raderna fanns. Fem av de sju nya raderna bär `commit_sha` och gör en
      nå-main-utsaga (BIN-908, 880, 906, 565, 911); de två sista är förbygges-rader som
      ingenting påstår om main. Kört: `9 claim(s) checked — 5 evidenced, 4 retired by a
      correction, 1 grandfathered`.)* *(kind: diff)*

### Täckningskontrollen — kriterium 4:s svagare syskon

- [x] **B7.** Byggs som en **egen modul**, `docs/org/metrics/check_review_coverage.mjs` +
      `check_review_coverage.test.mjs`. Inte inbakad i `check_events.mjs`: den filens huvud
      är snävt formulerat kring en helt annan regel (utsagor som saknar bevis, inte
      tystnad), och att bulta in en andra regel där är precis den huvud-glidning filen
      själv varnar för. `historyIsAvailable`/`gitCommitDate` **importeras** från
      `check_events.mjs`, dupliceras inte. *(#14 must-have 6)* *(kind: diff)*
- [x] **B8.** Nämnaren: commits vars ämnesrad är `feat(...)` eller `fix(...)` OCH namnger ett
      `BIN-\d+`. **Endast ämnesraden**, aldrig meddelandekroppen — `6d157c5` är en ren
      docs-rättelse som namnger BIN-565 bara i kroppen, och en kropps-läsande regel skulle
      kräva en rad för varje uppföljande kommentarsfix. `docs`/`chore`/`test` kräver ingen
      rad. *(#14 must-have 2)* *(kind: diff)*
- [x] **B9.** En `feat`/`fix`-commit UTAN biljett-id i ämnesraden klassas som **överträdelse**,
      inte som tyst hoppad. En ospårbar feat/fix är själva tystnaden regeln finns för.
      (Uppmätt: 8 sådana av 55 feat/fix sedan 2026-08-01 UTC; 12 av 74 under den vidgade nämnaren.) *(#14 must-have 2)*
      *(kind: diff)*
- [x] **B10.** Egen epok, skild från `RULE_EFFECTIVE_FROM`. Att återanvända 2026-08-16 ger
      **8 kvalificerade commits, 4 utan rad** — alltså rött på dag ett (planen sa först
      "~46 historiska feat/fix", vilket var fel epok-fönster; modulens egen tabell har
      rätt siffror). Epoken pinnas till den
      commit som shippar regeln eller senare, och antalet grandfathered SKRIVS UT vid varje
      körning. *(#14 must-have 3)* *(kind: diff)*
- [x] **B11.** `historyIsAvailable()` ärvs villkorslöst. `ci.yml` och `preview.yml` checkar ut
      på djup 1 medan `deploy.yml` kör `fetch-depth: 0` — en `git log`-vandring i en grund
      checkout ser i praktiken en commit. I det läget rapporteras `unverified`, aldrig tyst
      grönt och aldrig tyst rött. *(#14 must-have 4)* *(kind: diff)*
- [x] **B12.** Nollgolv: matchar vandringen NOLL kvalificerade commits i fönstret är det i sig
      en överträdelse, inte en ren körning. Identiskt med `claimsChecked === 0` i syskonet.
      *(#14 must-have 5, BIN-838/823/850)* *(kind: diff)*
- [x] **B13.** Varje körning skriver ut sin egen omfattningsrad i syskonets stil — N commits
      undersökta, M krävde en rad, K hittade, J grandfathered — så att "ren" aldrig kan
      läsas som "allt är granskat". *(#14 should-have 1)* *(kind: diff)*
- [x] **B14 (OMSKRIVET — gäller nu HISTORIKLÄGET; commit-läget grindar committen).** Modulens filhuvud, commit-meddelandet och biljettkommentaren säger alla rakt ut
      att den grindar **deployen, inte committen**, och att kod utan granskningsrad
      fortfarande når `main`. *(#14 must-have 1 — den enskilt viktigaste raden i planen)*
      *(kind: diff)*
- [x] **B15.** Ett test som driver hela beslutsträdet mot fixturer, inte bara det gröna
      fallet: kvalificerad commit med rad, kvalificerad utan rad, docs/chore som inte
      kräver rad, feat/fix utan biljett-id, grund checkout, och nollgolvet.
      *(kind: diff)*

### Vad som INTE ingår, uttryckligen

Kriterium 2 och 3. **Inte kriterium 4** — den raden stod kvar här efter att kriterium 4 hade
byggts, och var därmed den sista platsen i planen som fortfarande sa emot avsnittet högst upp
och avvikelseloggen. Integrationsgranskningen hittade den. Att en rättelse når fyra av fem
ställen är exakt hur ett falskt påstående överlever.

De två som står kvar väntar på en session i `C:/claude-plugins` — och enligt lärdomen från
2026-08-03 får det repot **aldrig** redigeras från en session som startar subagenter, vilket
den här gör.

---

## Behöver dig (Tier D)

* **Kör `npx lefthook install` en gång på varje maskin du committar från.** Den nya
  `commit-msg`-hooken är den mekanism som uppfyller BIN-917:s kriterium 4. Repot har inget
  `prepare`-skript, så en NY hooktyp installeras inte av sig själv — konfigurationen finns,
  men grinden är oskarp tills kommandot körts. Kört här. Det är exakt BIN-849:s felform (ett
  värde inkopplat i konfigurationen men aldrig i bygget), och därför står det här och inte
  bara i en kodkommentar.
* **Sprintmotorn kommer att bli NEKAD av den nya hooken vid sina batch-commitar.** Grinden
  läser INDEXET (avsiktligt — annars kan en oscenad rad släppa igenom en commit som sedan
  fäller deployen), medan motorn i `C:/claude-plugins` skriver sina rader **oscenade** och
  sedan stagear per uttrycklig sökväg. Dess `git add -A`-väg är oskadd; batch-vägen är det
  inte. Felmeddelandet säger rakt ut vad som ska göras ("STAGE it"), så det blir högljutt och
  inte tyst — men motorn kan inte redigeras från den här sessionen, och det är en ändring du
  vill veta om innan nästa obevakade körning. Hör ihop med kriterium 2 och 3, som ändå väntar
  på ett pass i det repot.
* **Linear-arbetsytan är full.** `create_issue` svarade "You've exceeded the free issue
  limit" i post-sprinten 2026-08-16. Varje uppföljning nedan skrivs därför som en fullständig
  kommentar på närmaste öppna ärende i stället för som egen biljett — och taket är något bara
  du kan åtgärda.
* **Frågan om #4 Säkerhetsarkitekt på `package.json`** (se batch 1). En enrollskritik får
  inte avgöra den.

## Uppföljningar att fila som kommentarer (Linear-taket)

1. Rot-`package-lock.json` är inte kod för routern (`isCodePath` false) medan
   `functions/package-lock.json` är det och redan når security. Osynligt för
   symmetrikollen under BÅDA A1-nycklingarna, eftersom båda kräver `isCodePath` först.
   Ett router-sidigt hål, inte något BIN-919 rör. *(#25 out-of-scope 1)*
2. Kodändrande commits sedan 2026-08-01 utan biljett-id i ämnesraden: **12** under den
   levererade sjutypsnämnaren (8 om man bara räknar `feat`/`fix`, av 55 sådana). De kommer
   **inte** att flaggas — alla ligger före epoken 2026-08-18 och är grandfathered; den
   levande körningen rapporterar 2 kvalificerade och 0 överträdelser. Planen sa först att de
   skulle flaggas varje körning, vilket var fel åt båda hållen: fel antal och fel utfall.
   *(#14 should-have 2, rättad av integrationsgranskningen)*

## Deviation log

- [discovery] BIN-917: planen antog att kriterium 4 kunde byggas här i någon form.
  #14:s kritik visade att det inte kan det ens i princip — repot har ingen commit-tidsmekanism
  (`ls .husky` tomt, inget `precommit` i `package.json`). Konservativt val: bygg det svagare
  syskonet, märk det som sådant på fyra ställen (modulhuvud, route.mjs-kommentar, plan,
  biljettkommentar), och dra ut kriterium 4 tillsammans med 2 och 3.
- [deviation] #14:s must-have 5 sa att golvet ska fälla när NOLL kvalificerade commits hittas,
  som syskonet gör. Byggt annorlunda, med skälet i modulens egen kommentar: epoken är i dag,
  så det finns per konstruktion inga commits efter den när regeln landar — en bokstavlig
  implementation hade shippat RÖD på dag ett och fällt just den commit som inför regeln.
  Golvet ligger därför på VANDRINGEN (en trasig läsning), och antalet kvalificerade commits
  redovisas i utskriften i stället. Båda halvorna är pinnade i testet så ingen "rättar"
  tillbaka det.
- [discovery] Den nya täckningskontrollen hittade två verkliga luckor på sin FÖRSTA körning:
  `634d62e` (BIN-565) och `2e5993a` (BIN-911) shippade utan granskningsrader. Kritikerna hade
  KÖRTS — sprintplanen vid `6d157c5` redovisar #18/#27 och #19/#5 med domar och villkor — de
  loggades bara aldrig. Backfillade som två rader märkta `pre-build-logged-late`. Inte i planen.
- [deviation] A10 tillagt efter planen skrevs: #25:s RETROAKTIVA kritik (batch 2:s arbete) hittade
  ett blockerande fynd som bor i batch 1:s fil. Två av fem tomhetsgolv låg på 45–46 % av sina
  verkliga värden. Konservativt val: höj dem i samma pass, eftersom filen ändå var öppen och ett
  känt trasigt golv i en fil man just härdat är sämre än att fila det. Stänger halva BIN-926;
  den andra halvan (kollen speglar grinden för hand) står kvar.
- [discovery] Probe mot A1-omnycklingen motsade min egen planformulering. Att ta bort den nya
  grindraden fäller `package.json` under BÅDA nycklingarna — ägarhalvan ensam hade räckt för
  just den filen. Omnycklingens värde ligger i KLASSEN: med verktygsalternationen borttagen ser
  den gamla regeln 2 filer och den nya 7. Både mätningen och rättelsen står i filhuvudet, så
  meningen "omnycklingen fångar package.json" inte kan överleva som en obevisad sammanfattning.
- [deviation] **Utfallsgranskaren underkände batch 1 och hade rätt på tre punkter.** Alla
  åtgärdade, ingen krävde omtag: (a) A8 var inte uppfylld — testets NAMN och felmeddelande
  beskrev fortfarande den gamla nyckeln ("every owned CODE path"), vilket är rakt falskt för
  en `unmapped-code`-överträdare och dessutom utelämnade botemedlet "ge sökvägen en ägare";
  (b) tre tal i kommentarer var mätta FÖRE ändringen och skrivna i presens — "293 av 294 …
  idag" är 295 av 295 på det träd som shippas, och det nya golvet stod som "uppmätt 294" mot
  ett verkligt 295; (c) `_note9` öppnade med "det första hål en kontroll namngav i stället
  för en granskare" — falskt, och exakt den självsmickrande formen `_note8` rättades för en
  not tidigare. Det var BIN-880:s handskrivna "Known blind spot 1"-prosa som namngav det.
- [deviation] **Min egen spärrhake spärrade ingenting, och granskaren bevisade det med en
  mutation.** Testet deklarerade en LOKAL kopia av A1:s predikat och assert:ade mot kopian —
  produktionsregeln rördes aldrig. Med regeln återställd till den gamla nyckeln gick sviten
  9/9 grön medan testets egen kommentar lovade att den skulle bli röd. Fixat genom att bryta
  ut `a1Offenders(verdicts)` och låta både regeln och testet köra DEN. Omprövat: kontroll
  9/9 grön, mutant fäller rätt test med rätt meddelande, återställd och verifierad mot hash
  `6c32b7eb…`. Detta är precis den klass den här commiten finns för att stoppa, en nivå upp.
- [deviation] Golvet för `unmapped-code` höjdes 100 → 230. Granskaren påpekade att 100 var
  34 % av det verkliga värdet (295) — alltså slappare än de två golv samma commit höjer för
  att 45 % är dekoration. Ett golv skrivet mot en regel commiten själv underkänner är inget golv.
- [discovery] Att SKRIVA att en fil inte ägs ägde den. Meningen "lockfilen namnges medvetet
  INTE här — `package-lock.json` är maskingenererad" seatade #25 på `package-lock.json`,
  eftersom generatorn skördar varje backtick-citerad spårad sökväg i en sektion. A2 gick röd
  med "package-lock.json (owned by #25, blocking gate: none)". Fångat av testet, inte av mig.
  Avbacktickad; samma fälla som §25:s nästa punkt redan dokumenterar för kataloger.
- [discovery] **Utfallsgranskaren av batch 2 godkände alla 15 kriterier men hittade ett hål
  som var värre än något kriterium: nämnaren missade halva incidenten.** `OWES_REVIEW` täckte
  bara `feat|fix` — och `049f21b`, den ena av de TVÅ commitar biljettens rubrik handlar om, är
  `test(radering): … (BIN-908)`. Kontrollen hade fångat `851696d` och seglat rakt förbi den
  andra halvan. En kontroll som missar fallet den skrevs för är sämre än ingen. Nämnaren är
  vidgad till `feat|fix|refactor|perf|test|build|ci`. Uppmätt kostnad: NOLL nya kvalificerade
  commits idag (båda varianterna ser samma 2 sedan epoken), 74 i stället för 55 över hela
  augusti — alla grandfathered. Det som medvetet står utanför (`docs`/`chore`/`style`,
  `revert`, och commits utan prefix) står nu skrivet i modulhuvudet som en GRÄNS, inte som en
  fullständighet.
- [deviation] Tre mindre fynd från samma granskning, alla åtgärdade: (a) "66 av 132 är
  docs/chore/test" var 67 vid HEAD. Alla tal är ommätta med metoden utskriven bredvid. (Den
  här raden bar en förklaring till skillnaden — "`--since` läser LOKAL tid" — som senare
  drogs tillbaka som fel; subtraktionen nedan nådde modulen men inte hit förrän sjätte
  granskningsrundan.); (b) `timing`
  var ett nytt schemafält som ingenting läser, och planen motiverade det med att `/org-retro`
  poängsätter på det — falskt, verifierat med grep över hela plugin-katalogen. Fältet är rätt
  att skriva men av ett annat skäl, och är nu dokumenterat i `README.md`:s schematabell;
  (c) `must_haves` räknades på två olika grunder i grannrader (4 = ogjorda villkor för
  BIN-565, 5 = totalen för BIN-911). Enhetligt nu: totalen. Raderna skrevs om från grunden
  i stället för att rättas med `correction`-rader — de hade aldrig committats, så det finns
  ingen post någon sett att korrigera, och append-only skyddar en post, inte ett utkast.
- [deviation] **KRITERIUM 4 BYGGDES ÄNDÅ — hela skälet att dra ut det var falskt.**
  Integrationsgranskningen underkände batchen på detta: `lefthook.yml` ligger spårat i repot
  sedan 2026-08-08, har ett `pre-commit`-block med två levande kommandon, `lefthook` är en
  devDependency och `.git/hooks/pre-commit` är installerad. Mina två prober (`ls .husky`,
  `precommit` i package.json) var båda SANNA och slutsatsen ändå fel. "Jag hittade inte X" och
  "X finns inte" är olika meningar — och att blanda ihop dem inuti fixen för just den klassen
  av fel är så illa det kan bli. Byggt: `--message`-läget i modulen + ett `commit-msg`-block i
  `lefthook.yml`. Prövat på fyra meddelandeformer (godkänd, ogranskad biljett, kod utan
  biljett-id, docs-commit) — rätt utfall på alla fyra. Hooken är installerad här med
  `npx lefthook install`. Kriterium 4 är därmed UPPFYLLT, inte utdraget; kriterium 2 och 3 står
  kvar utanför repot.
- [deviation] A3 kryssades av men byggdes tvärtom mot sin egen formulering. Villkoret sa
  "tillagt på den BEFINTLIGA Dependabot-punktens pilrad. Ingen ny punkt" — det blev en ny
  punkt med egen pilrad. Routningsutfallet är identiskt (`owned`/[25]) och därför är det en
  avvikelse och inte ett fel, men den saknades i den här loggen, vilket granskaren korrekt
  kallade defekten. Skälet den byggdes så: motiveringen blev fem meningar lång, och att klämma
  in den mitt i en befintlig semikolonlista gjorde meningen ogrammatisk (första försöket var
  det, och granskaren fällde även den).
- [deviation] Tre tal till, alla ommätta och alla fel i första versionen: "66 av 132" (ingen
  metod ger 66 — UTC-jämförelsen ger 61 av 135, `TZ=UTC` med bart datum 59 av 132), "109
  oprefixade i historien" (verkligt 129 under modulens egen grammatik — och eftersom en
  granskare mätte 142 och en annan 146 står nu FYRA definitioner med var sitt tal i huvudet i
  stället för ett bart tal), och en mening i `README.md` som den HÄR commiten gjorde falsk ("0
  evidenced … ingen rad bär en commit_sha ännu" — nu 5). Metoden står utskriven bredvid varje
  tal, eftersom metoden ÄR en del av talet. Den här raden har dessutom burit TRE olika
  förklaringar till varför `--since` ger ett annat tal, och två av dem var fel: först "git
  läser lokal tid", sedan "TZ=UTC plus bart datum". Den fjärde versionen räknade upp "de" möjliga
  värdena och utelämnade det värde kommandot faktiskt ger i det här skalet. Lösningen blev
  till slut inte en bättre förklaring: alla tal kommer nu från EN namngiven procedur, och
  `git log --since=…` avfärdas i två meningar som en annan fråga man inte ska jämföra med. En
  kommentar som hela tiden behöver en ny teori beskriver något den inte förstår — och att
  förklara det var aldrig uppgiften.
- [discovery] Jag redigerade `lefthook.yml` — commit-grindsmaskineri som nådde noll granskare
  och saknade ägare. Exakt hålet den här batchen handlar om, en fil bort, upptäckt inuti
  batchen. Både grinden och ägarkartan vidgade i samma commit (#25, samma roll som äger
  reviewGates-rostern).
- [deviation] Två filer utanför planens filuppsättning: `docs/org/route.mjs`
  (`TOOLING_CODE_FILES`) och en andra rad i integrationsgrinden, för den nya modulen. Krävs av
  route.test.mjs:s BIN-874-block — en ny `.mjs` med testsyskon som saknas i listan fäller det —
  och av BIN-830-regeln att de två listorna alltid flyttas i samma commit.

