# Render-frys-utredning — T7/X6 (QA-audit 2026-06-09)

Auditen rapporterade två ~30s "renderer-frysar" under CDP-automation
(Claude-in-Chrome/screenshot-baserad QA): en vid säsongspanel-expansion på en
serie med 100+ avsnitt (Silo, Säsong 3), en vid interaktion med gruppmodalen.

## X6 — gruppmodal-frysen: nativ `window.confirm` (åtgärdad i WP7)

**Rotorsak (bekräftad i kod):** vid audit-tillfället (commit `c8ec17b`) fanns
fem nativa `confirm()`-anrop i gruppdomänen:

- `GroupSettingsModal.tsx:148` ("Radera gruppen permanent?")
- `GroupMembersPanel.tsx:68` ("Ta bort X från gruppen?")
- `GroupSidePanels.tsx:154, 265` (inaktivera länk / lämna grupp)
- `GroupWatchlistTable.tsx:139` (ta bort titel)

Nativ `confirm()` blockerar renderer-processens main thread tills dialogen
stängs. CDP-screenshotverktyg kan inte se eller interagera med nativa dialoger
— resultatet är exakt symptomet auditen såg: sidan "fryser" tills automationens
timeout slår till (~30s). En riktig användare ser bara en vanlig OS-dialog.

**Status: sannolikt åtgärdad.** WP7/G1 (commits `52d6dc0` + `b80a43b`)
ersatte samtliga fem sajter med den designade `ConfirmDialog`-komponenten
(React-renderad, blockerar inte main thread). `git grep "confirm("` mot
arbetsträdet hittar inga kvarvarande nativa confirm/alert i `src/`.

## T7 — säsongspanel-frysen: ingen 30s-tung kodväg hittad

**Genomgång av hela expansionsvägen** (`SeasonRow` → `SeasonEpisodePanel` →
`EpisodeRow`):

- Endast den expanderade säsongens panel monteras (`SeasonRow` renderar
  `SeasonEpisodePanel` bara när `expanded` — inte alla säsonger).
- Expansion = en TMDB-säsongshämtning (`useTVSeason`, abortbar, cachad via
  `TMDB_STALE.SEASON`) + rendering av ~10–22 `EpisodeRow`-rader (Silo S3 har
  10 avsnitt; "100+" i auditen avser hela serien). Inga O(n²)-loopar, inga
  synkrona layout-läsningar, ingen tung CSS (inga filter på raderna).
- React-rendering av ~22 grid-rader med lazy-laddade stillbilder tar
  ensiffriga millisekunder — det kan inte förklara 30s main-thread-block.

**Slutsats:** frysen är med stor sannolikhet ett automationsmiljö-artefakt
(samma CDP-session som även frös på den nativa confirm-dialogen i X6 —
screenshot-pipelinen, inte appen). Ingen riskabel omskrivning motiverad.

**Riktade förbättringar applicerade ändå** (billiga, eliminerar de re-render-
mönster som *skulle* skala dåligt på serier med stora säsonger):

1. `EpisodeRow` är nu `memo`-ad — varje episodeProgress-onSnapshot
   re-renderade tidigare hela detaljsidan inkl. alla avsnittsrader.
2. `SeasonEpisodePanel` fick en `PanelEpisodeRow`-wrapper med stabila
   callbacks (`useCallback`) — tidigare byggdes `onToggle`/`onMarkUpTo` som
   inline-closures per rad och render, vilket hade gjort memo:n verkningslös.
3. `useEpisodeProgressWithSync.markEpisodeWatched` läser progress via ref
   istället för closure-dep — callbacken byter inte längre identitet vid varje
   snapshot (och sekventiella loopar läser färsk progress istället för stale).
4. `SeasonList` memoiserar `previousSeasonsMeta` — tidigare en ny array per
   `SeasonRow` och render, vilket bröt memo-kedjan via `markUpTo`-deps.

## Kvarvarande känd långsam väg (utanför scope, rekommendation)

**"Avmarkera alla"** (`SeasonEpisodePanel`) loopar sekventiellt över säsongens
sedda avsnitt och gör per avsnitt 1–2 Firestore-writes + väntar in varje.
För en fullsedd 22-avsnittssäsong: ~40+ sekventiella nätverks-round-trips,
var och en följd av en onSnapshot-driven re-render. Det är inte en renderer-
frys men kan kännas hängt i flera sekunder på långsam uppkoppling.

**Rekommendation:** batcha till en enda `setDoc` med `watched: false` för
säsongens alla sedda avsnitt (spegelbild av `markSeasonWatched`), följt av en
`updateProgress`-omräkning. Kräver ny hook-metod (`unmarkSeasonWatched`) +
sync-wrapper — gör som egen, testad ändring.
