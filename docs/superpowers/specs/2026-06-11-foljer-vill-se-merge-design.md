# Design: "Vill se" och "Följer" slås ihop för serier

**Datum:** 2026-06-11
**Status:** Godkänd design, väntar på implementationsplan

## Sammanfattning

Den lagrade statusen `vill_se` avskaffas för TV-serier. En serie har efter
ändringen exakt en huvudstatus — `mina` ("Följer") — och frågan "har jag
börjat titta?" blir ett *härlett läge* (`ej_paborjad`), precis som "Ligger
efter"/"Ikapp"/"Avslutad" redan härleds idag. Film påverkas inte: `vill_se`
blir en ren filmstatus.

Vyn `/my/vill-se` behåller namn och route men byter jobb: från statuslista
till **väljare** — en mixad "vad ska du se ikväll?"-yta som visar filmer i
`vill_se` plus serier i `mina` med läget ej påbörjad.

### Varför

1. **Begreppen skaver.** "Vill se en serie" *är* att börja följa den — man
   har bara inte startat. Auto-promote (`vill_se` → `mina` vid första
   avsnittet) är ett osynligt statusbyte som bara kompenserar för att vi
   lagrar något som egentligen är härledbart.
2. **Datamodellen förenklas.** "Har inte börjat" = 0 markerade avsnitt — helt
   härledbart från `episodeProgress`/`lastWatched`, samma princip som övriga
   sub-states ("lagra intention, härled tillstånd").
3. **UI:t blir helt.** Seriens hela liv bor i serie-vyn, från ostartad till
   avslutad. `/my/series` har redan en `ej_paborjad`-bucket
   (`LibrarySubState`) — den börjar bara användas på riktigt.

## Mål

- En serie har en huvudstatus: `mina`. `vill_se` skrivs aldrig för TV.
- Sub-state-modellen får fyra lägen: **ej påbörjad → ligger efter → ikapp →
  avslutad** (härledda, aldrig sparade).
- Knappen på seriesidor blir **"Följ"** (imperativ CTA). Status-chipen förblir
  "Följer".
- `/my/vill-se` blir en väljare: filmer (`vill_se`) + serier (`mina` +
  ej påbörjad), en enda handling per kort, ingen statushantering.
- Befintligt beteende i rådgivare, Tillsammans, taste-vikter och push-notiser
  bevaras avsiktligt (se Konsekvensbeslut).

## Icke-mål

- Filmflödet ändras inte (`vill_se` → `sedd`, terminal).
- Inga nya lagrade fält eller statusar.
- Ingen batch-migrering av Firestore — lazy migration på läsning, som alltid.
- Ingen ny route. `/my/vill-se` behåller URL:en.

## Datamodell

### Statusar (lagrade)

| Status | Film | TV |
|---|---|---|
| `vill_se` | ✅ vill se | ❌ skrivs aldrig (migreras vid läsning) |
| `mina` | ❌ (defensivt → `sedd`) | ✅ enda huvudstatusen, UI "Följer" |
| `sedd` | ✅ terminal | ❌ (UI-genväg som översätts, som idag) |
| `avbruten` | ✅ | ✅ |

### TV-lägen (härledda, aldrig sparade)

`TvSubState` i `src/types/domain.ts` utökas:

```
'ej_paborjad' | 'aktiv' | 'ikapp' | 'avslutad'
```

`tvSubState()` i `src/lib/watchStatus.ts` prövar **ej påbörjad först**: om
`lastWatchedSeason == null` (ingen progress) → `'ej_paborjad'`, oavsett
TMDB-data. Därefter dagens logik (behind → `aktiv`, ended → `avslutad`,
annars `ikapp`). `SUB_STATE_LABELS` får `ej_paborjad: 'Ej påbörjad'`.

Detta löser också det gamla fantom-"aktiv"-problemet: en `mina`-serie utan
progress härledde tidigare `aktiv` i fallbacken, vilket var skälet till att
okända statusar defaultade till `vill_se` i migrationen.

`LibrarySubState` (`src/lib/libraryView.ts`) har redan `ej_paborjad` — ingen
typändring där. De två systemen (TMDB-live resp. persisted-fields-only)
behåller sina roller.

### Migration (lazy, vid läsning)

`migrateStatus()` i `src/lib/watchStatus.migration.ts`:

- `'vill_se'` / `'want_to_watch'` + **TV** → `'mina'` (landar som ej
  påbörjad eftersom progress saknas). Film → `'vill_se'` som idag.
- Okänd/trasig status + **TV** → `'mina'` (nu säkert tack vare
  `ej_paborjad`); film → `'vill_se'` som idag.

Firestore-docs skrivs aldrig om enbart för migration. `docToItem`
(WatchlistContext) och `mapWatchlistDoc` (usePublicProfile) normaliserar vid
läsning; nästa användarändring skriver nya schemat. Firestore kan innehålla
`vill_se`-serier under lång tid — alla läsare ser dem som `mina`.

### Auto-promote tas bort

`WatchlistContext.updateProgress` (rad ~183): promote-grenen
(`vill_se` → `mina`/`sedd` vid första avsnittet) **raderas**. Efter
migration-på-läsning kan en TV-titel aldrig vara `vill_se` i minnet, så
grenen är död kod. Progress-markering ändrar aldrig status — bara läget.

## UI

### Knappar och statusmeny (`QuickAddButton`)

- **Primär CTA på seriesidor: "Följ"** → `addItem(status: 'mina')`.
  Imperativ verb i CTA, substantiv i chip ("Följer") — per voice-and-tone.
- `TV_STATUS_OPTIONS` blir `['mina', 'sedd', 'avbruten']` där `mina` får
  CTA-/menylabel "Följ". "Sedd (alla avsnitt)"-genvägen och "Avbruten"
  kvarstår oförändrade.
- `MOVIE_STATUS_OPTIONS` oförändrad: `['vill_se', 'sedd', 'avbruten']`.

### `/my/vill-se` — väljaren

Behåller route och rubriken "Vill se". Ny PageHeader-copy:

```
BIBLIOTEK            (crumb)
Vill se              (page-h1)
Vad ska du se ikväll? Filmer du vill se och serier du följer
men inte börjat.     (stand)
```

- **Innehåll:** filmer med `status === 'vill_se'` + serier med
  `status === 'mina'` och librarySubState `ej_paborjad`.
- **Jobb: välja, inte förvalta.** Ingen statusdropdown, inga bulk-actions.
  Varje kort har en handling ("Börja titta" → titelsidan).
- **Sortering/filter** på det som spelar roll i valögonblicket: finns på
  dina tjänster (default), genre, medietyp.
- Implementeras som egen vy-komponent (ersätter `WatchlistPage`-anropet i
  `src/app/my/vill-se/page.tsx`); `WatchlistPage` behåller övriga routes.
- Bulk-action "Markera som tittad" försvinner med väljaren (fanns på
  vill-se-vyn); "Flytta till Vill se" på `/my/films` är film-only och
  kvarstår.

### `/my/series` — fjärde sektionen aktiveras

`FollowingCardSections` bucketar redan på `LibrarySubState` inkl.
`ej_paborjad` ("Ej påbörjade"). Inga strukturella ändringar — sektionen
befolkas naturligt när serier landar i `mina` direkt. Sektionsordningen
`['ligger_efter', 'paborjad', 'ej_paborjad', 'avslutad']` behålls: det du
ligger efter på överst (mest angeläget), backloggen näst sist.

### Kalendern

- `useCalendar`: `getByStatus('vill_se', 'tv')`-källan tas bort. All följd TV
  går genom en pipeline.
- `CalendarEntry.source` (`'mina' | 'vill_se'`) **tas bort** ur entry-modellen.
  `canMarkWatched(e)` blir `e.kind === 'episode'` — toggeln visas för alla
  följda serier, även ej påbörjade. Att markera ett avsnitt från kalendern på
  en ej påbörjad serie flyttar den bara till "Ligger efter"/"Ikapp" (härlett).
- Filmsläpp (`vill_se`-filmer) oförändrade; `buildMovieEntries` slutar stämpla
  `source`.

## Konsekvensbeslut

Ställen där `vill_se`-TV idag avsiktligt beter sig annorlunda än `mina`.
Principen: **bevara dagens beteende** genom att nyckla på läget
(ej påbörjad) istället för på den försvunna statusen — utom där
specialfallet bara fanns för statusskillnadens skull (kalendertoggeln ovan).

| Yta | Idag | Efter | Motivering |
|---|---|---|---|
| **Tillsammans** (`libraryExclusionIds`, `src/lib/together/candidates.ts`) | `vill_se` är prima kandidater; `mina` exkluderas | Exkludera bara `mina` **med progress**; ej påbörjade serier förblir kandidater | En serie ingen börjat är fortfarande perfekt för en gemensam sessionskväll |
| **Rådgivaren** (`useSubscriptionAdvisor`) | `vill_se`-serier är "upcoming"-ankare (hindrar paus-rek), `mina` driver prenumerations-rek inom lookahead-fönstret | `mina`-poolen delas på sub-state: `ej_paborjad` → will-see-ankare, övriga → following-pool. `willSeeByProvider` räknar ej påbörjade serier som TV-vill-se | Bevarar rekommendationslogiken exakt; en backlog-serie ska inte trigga "prenumerera nu" |
| **Taste-vikter** (`src/lib/taste/vector.ts`, `stats.ts`) | `vill_se` 0.25/0.3, `mina` 0.75/0.6 | `mina` utan progress får vill_se-vikten; med progress dagens mina-vikt | Att följa utan att ha börjat är fortfarande "planerad, inte bevisad" smak |
| **Push-notiser** (`functions/src/episodeNotify/logic.ts`) | `vill_se`-serier notifieras aldrig | `deriveSubState` skippar serier utan progress → ej påbörjade notifieras inte | Pushar är störande på ett sätt kalenderposter inte är; "nytt avsnitt av serie du aldrig startat" varje vecka är brus. (Premiär-notis för ej påbörjade är en möjlig framtida feature — utanför scope.) |
| **Onboarding** (`OnboardingFlow.handleAdd`) | intent `plan` → `vill_se` (båda medietyper) | intent `plan` + TV → `mina`; film → `vill_se` | Följer nya skrivvägen |
| **Feed** (`src/app/feed/page.tsx`) | `mina` visas "lade till i biblioteket", `vill_se` visas "vill se" | TV-tillägg visas "följer" | Liten copy-justering; "vill se" förblir filmernas etikett |
| **Insikter/analytics** | `statusDistribution` har alla fyra nycklar | Oförändrat — `vill_se`-TV-andelen sjunker organiskt i takt med lazy migration | Ingen kodändring; nyckeluppsättningen är fortsatt giltig (film) |
| **Firestore rules / functions aggregate** | `vill_se` giltigt statusvärde | Oförändrat | Gamla docs + filmer använder det fortfarande |

`functions`-ändringen (episodeNotify-guarden) kräver manuell
`firebase deploy --only functions` — deploy.yml täcker bara hosting.

## Dokumentation som uppdateras

- **CLAUDE.md** — WatchStatus-avsnittet: ny status/läges-tabell,
  auto-promote-stycket tas bort, kalenderkällorna.
- **docs/voice-and-tone.md** — statusvokabulär-tabellen (`vill_se` =
  film-only), sub-state-tabellen (+ Ej påbörjad), CTA "Följ".
- Minnesanteckning om statussystemet uppdateras.

## Testning

- `watchStatus.test.ts` — nya `TV_STATUS_OPTIONS`, `tvSubState` med
  `ej_paborjad`-fall (ingen progress slår TMDB-data), `SUB_STATE_LABELS`.
- `watchStatus.migration.test.ts` — TV `vill_se` → `mina`; okänd status TV →
  `mina`; film oförändrad; idempotens.
- `calendar/buildEntries.test.ts`, `entry.test.ts`, `summary.test.ts` —
  `source` bort; `canMarkWatched` = kind-check.
- `together/candidates.test.ts` — `mina` utan progress inkluderas, med
  progress exkluderas.
- `taste/*.test.ts` — viktning per progress.
- `useSubscriptionAdvisor`-helpers — pooldelning på sub-state.
- `functions/episodeNotify/logic.test.ts` — ej påbörjad → `'none'`.
- Design-guard-testet (`consistency.test.ts`) — väljarens nya vy-komponent
  följer PageHeader/LoadingView/EmptyState-receptet.

## Öppna frågor

Inga — alla designbeslut ovan är godkända i brainstorming-sessionen
2026-06-11 (knappverb "Följ", kalendertoggel för alla följda serier,
väljar-konceptet för `/my/vill-se`, namnbeslutet "Vill se" som vy-namn).
