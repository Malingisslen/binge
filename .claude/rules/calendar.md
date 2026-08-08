---
paths:
  - "src/hooks/useCalendar.ts"
  - "src/lib/calendar/**"
  - "src/components/calendar/**"
  - "src/hooks/useAdvisorTimeline.ts"
  - "src/hooks/useUpcomingShowsForAdvisor.ts"
---

# Kalender — källor + entry-modell

`useCalendar` bygger kalendern från två källor:

- **serier i 'mina'** (inkl. ej påbörjade) → alla avsnitt (show-detail + säsong), med
  "markera sedd"-toggel för alla — att bocka av E1 från kalendern är hur man börjar på
  en ej påbörjad serie
- **filmer i 'vill_se'** → svenskt digitalt släppdatum (`release_dates`, type 4 SE), bara
  framtida datum

`CalendarEntry` (`src/lib/calendar/types.ts`) är en **diskriminerad union** över
`kind: 'episode' | 'movie'`. Per-kind-logik (nyckel, länk, badge, meta-rad,
watched-behörighet) bor i `src/lib/calendar/entry.ts` — använd `entryKey`/`entryHref`/
`entryMetaLine`/`entryBadge`/`canMarkWatched` i konsumenter istället för att gren på
`kind` direkt. Räkning (avsnitt/film/premiär/final) via `src/lib/calendar/summary.ts`.

Rådgivar-hooks (`useAdvisorTimeline`, `useUpcomingShowsForAdvisor`) filtrerar till
`kind === 'episode'` — filmsläpp hör inte hemma i prenumerations-timelines.

Kalendern är en fan-out-yta (en query per bibliotekstitel) och ska därför använda
lite-varianterna `getTVShowLite`/`getMovieLite` med `TMDB_STALE.LITE_DETAIL`, aldrig de
fulla detaljsvaren.
