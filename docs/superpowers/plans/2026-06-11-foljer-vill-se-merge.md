# Följer/Vill se-merge för TV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avskaffa `vill_se` som lagrad status för TV — serier får en huvudstatus (`mina`/"Följer") med ett nytt härlett läge `ej_paborjad`, och `/my/vill-se` blir en mixad väljare (filmer i vill_se + ej påbörjade serier).

**Architecture:** Lazy migration på läsning (befintligt mönster i `migrateStatus`), härledda sub-states (aldrig sparade), och bevarat beteende i rådgivare/Tillsammans/taste/notiser genom att nyckla på progress istället för den försvunna statusen. Spec: `docs/superpowers/specs/2026-06-11-foljer-vill-se-merge-design.md`.

**Tech Stack:** Next.js 16 (static export), React 19, TypeScript, Firestore, Vitest.

**Viktigt — ingen functions-ändring behövs:** `functions/src/episodeNotify/logic.ts:45` returnerar redan `'none'` för items utan progress (test på `logic.test.ts:38`). Ej påbörjade serier får alltså inga pushar utan kodändring. Ingen `firebase deploy --only functions` krävs.

**Verifieringskommandon** (körs per task där angivet):
- `npx vitest run <fil>` — enskild testfil
- `npm test` — hela sviten (93+ tester)
- `npm run typecheck` && `npm run lint` — efter varje task som ändrar typer

---

### Task 1: `TvSubState` får `ej_paborjad` + nytt CTA-verb "Följ"

**Files:**
- Modify: `src/types/domain.ts:18-20`
- Modify: `src/lib/watchStatus.ts`
- Test: `src/lib/watchStatus.test.ts`

- [ ] **Step 1.1: Uppdatera testerna (failing first)**

I `src/lib/watchStatus.test.ts`, ersätt `statusOptionsFor`-describen:

```ts
describe('statusOptionsFor', () => {
  it('TV menu offers mina (CTA "Följ"), sedd (genväg → mina+lastWatched), avbruten', () => {
    expect(statusOptionsFor('tv')).toEqual(['mina', 'sedd', 'avbruten']);
    // 'vill_se' är avskaffat för TV — att vilja se en serie ÄR att följa den
    // (läget 'ej_paborjad' härleds från avsaknad av progress).
  });

  it('Movie menu offers vill_se, sedd, avbruten — never mina (mina är TV-only)', () => {
    expect(statusOptionsFor('movie')).toEqual(['vill_se', 'sedd', 'avbruten']);
    expect(MOVIE_STATUS_OPTIONS).not.toContain('mina');
  });
});
```

Lägg till en describe för `statusMenuLabel` (importera den i importblocket):

```ts
describe('statusMenuLabel', () => {
  it('uses the verb "Följ" for mina on TV (CTA), noun elsewhere', () => {
    expect(statusMenuLabel('mina', 'tv')).toBe('Följ');
    expect(statusMenuLabel('sedd', 'tv')).toBe('Sedd (alla avsnitt)');
    expect(statusMenuLabel('vill_se', 'movie')).toBe('Vill se');
    expect(statusMenuLabel('avbruten', 'tv')).toBe('Avbruten');
  });
});
```

I `tvSubState`-describen: ändra sista testet och lägg till två nya:

```ts
  it('returns "ej_paborjad" when no progress at all, regardless of TMDB data', () => {
    const item = makeItem({ lastWatchedSeason: null, lastWatchedEpisode: null });
    const show = makeShow({ last_episode_to_air: makeEp(2, 3), status: 'Returning Series' });
    expect(tvSubState(item, show)).toBe('ej_paborjad');
  });

  it('returns "ej_paborjad" without TMDB show when no progress (ersätter gamla aktiv-fallbacken)', () => {
    const item = makeItem({ lastWatchedSeason: null, lastWatchedEpisode: null, tmdbStatus: 'Ended' });
    expect(tvSubState(item, undefined)).toBe('ej_paborjad');
  });
```

(Det gamla testet `'falls back to "aktiv" when no progress at all on an Ended show (L8)'` tas bort — det testade exakt fallet som nu blir `ej_paborjad`.)

Ersätt `SUB_STATE_LABELS`-describen:

```ts
describe('SUB_STATE_LABELS', () => {
  it('has Swedish labels for each sub-state', () => {
    expect(SUB_STATE_LABELS).toEqual({
      'ej_paborjad': 'Ej påbörjad',
      'aktiv': 'Ligger efter',
      'ikapp': 'Ikapp',
      'avslutad': 'Avslutad',
    });
  });
});
```

- [ ] **Step 1.2: Kör testet — ska faila**

Run: `npx vitest run src/lib/watchStatus.test.ts`
Expected: FAIL (statusOptionsFor, statusMenuLabel saknas, tvSubState, SUB_STATE_LABELS)

- [ ] **Step 1.3: Implementera**

`src/types/domain.ts` rad 18–20 — ersätt:

```ts
// Härleds från progress + TMDB-data — aldrig sparad i Firestore. 'ej_paborjad'
// = ingen progress alls (serien följs men inget avsnitt är markerat). Används
// av /my/series sub-sektioner, advisor-räkningar, och badges i kort/tabeller.
export type TvSubState = 'ej_paborjad' | 'aktiv' | 'ikapp' | 'avslutad';
```

Uppdatera även fil-kommentaren ovanför `WatchStatus` (rad 6–15): stryk meningen om
auto-promote om den nämns, och lägg till att `vill_se` är film-only sedan
2026-06 (TV-`vill_se` i Firestore lazy-migreras till `mina`).

`src/lib/watchStatus.ts` — ersätt `TV_STATUS_OPTIONS`-blocket (rad 16–27):

```ts
// Status-alternativ som visas i StatusButton-dropdown per mediaType.
//
// TV: 'mina' (menylabel "Följ") är huvudvalet — att vilja se en serie ÄR att
// följa den; "har inte börjat" härleds som sub-state 'ej_paborjad' från
// avsaknad av progress. 'vill_se' skrivs aldrig för TV (lazy-migreras vid
// läsning, se watchStatus.migration.ts).
//
// 'sedd' i TV-menyn är en genväg som översätts till status='mina' +
// lastWatched satt till sista aireade avsnittet (sub-state derives till
// 'ikapp'/'avslutad'). 'sedd' lagras aldrig som status på en TV-titel.
export const TV_STATUS_OPTIONS: WatchStatus[] = ['mina', 'sedd', 'avbruten'];
export const MOVIE_STATUS_OPTIONS: WatchStatus[] = ['vill_se', 'sedd', 'avbruten'];
```

Lägg till efter `statusLabel`:

```ts
// Menyer/CTA:er använder verb där statusen är substantiv (voice-and-tone:
// "verb i CTAs, substantiv i statusar"). Knappen heter "Följ"; chipen "Följer".
export function statusMenuLabel(status: WatchStatus, mediaType?: MediaType): string {
  if (mediaType === 'tv' && status === 'mina') return 'Följ';
  return statusLabel(status, mediaType);
}
```

Ersätt `tvSubState` (rad 43–61):

```ts
// Sub-state för TV-shows i 'mina'. Härleds — aldrig sparat.
// 'ej_paborjad' prövas först: utan progress finns inget att vara "bakom" på,
// oavsett TMDB-data. (== null, inte falsy: säsong 0/Specials är giltig
// progress.) Därefter behövs TMDB-data för aktiv/ikapp/avslutad; fallback
// till tmdbStatus-only om showen inte är i cachen ännu.
export function tvSubState(item: WatchlistItem, show: TMDBTVShow | undefined): TvSubState {
  if (item.lastWatchedSeason == null) return 'ej_paborjad';
  if (show) {
    const behind = isUserBehindOnAired(item, show);
    if (behind) return 'aktiv';
    return isEndedStatus(show.status) ? 'avslutad' : 'ikapp';
  }
  // Fallback utan TMDB i cachen: progress finns (guarden ovan), så gissa
  // från lagrad tmdbStatus. Ended → avslutad, annars konservativt "aktiv"
  // (driver användaren till att titta).
  if (item.tmdbStatus && isEndedStatus(item.tmdbStatus)) return 'avslutad';
  return 'aktiv';
}

export const SUB_STATE_LABELS: Record<TvSubState, string> = {
  'ej_paborjad': 'Ej påbörjad',
  'aktiv': 'Ligger efter',
  'ikapp': 'Ikapp',
  'avslutad': 'Avslutad',
};
```

OBS: den gamla fallbacken kollade `item.lastWatchedSeason != null` — den
kollen är nu redundant (guarden överst) och ska bort.

- [ ] **Step 1.4: Kör testet — ska passera**

Run: `npx vitest run src/lib/watchStatus.test.ts` → PASS
Run: `npm run typecheck` → OK (Record-typen tvingar fram nya nyckeln)

- [ ] **Step 1.5: Commit**

```bash
git add src/types/domain.ts src/lib/watchStatus.ts src/lib/watchStatus.test.ts
git commit -m "feat(status): TvSubState får ej_paborjad + mina ersätter vill_se i TV-menyn"
```

---

### Task 2: Lazy migration — TV `vill_se` → `mina`

**Files:**
- Modify: `src/lib/watchStatus.migration.ts`
- Test: `src/lib/watchStatus.migration.test.ts`

- [ ] **Step 2.1: Uppdatera testerna (failing first)**

I `src/lib/watchStatus.migration.test.ts`:

Schema v3-describen — ersätt `'passes vill_se / sedd / avbruten unchanged'`:

```ts
    it('vill_se (TV) → mina — vill_se är avskaffat för TV (2026-06)', () => {
      expect(migrateStatus('vill_se', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('passes vill_se (film) / sedd / avbruten unchanged', () => {
      expect(migrateStatus('vill_se', 'movie')).toEqual({ status: 'vill_se', dropped: false });
      expect(migrateStatus('sedd', 'movie')).toEqual({ status: 'sedd', dropped: false });
      expect(migrateStatus('avbruten', 'movie')).toEqual({ status: 'avbruten', dropped: false });
    });
```

Schema v1-describen — ersätt `want_to_watch`-testet:

```ts
    it('want_to_watch (TV) → mina, (film) → vill_se', () => {
      expect(migrateStatus('want_to_watch', 'tv')).toEqual({ status: 'mina', dropped: false });
      expect(migrateStatus('want_to_watch', 'movie')).toEqual({ status: 'vill_se', dropped: false });
    });
```

Idempotens-describen — lägg till:

```ts
    it('vill_se (TV) är idempotent efter migration', () => {
      const once = migrateStatus('vill_se', 'tv');
      const twice = migrateStatus(once.status, 'tv');
      expect(twice).toEqual(once);
    });
```

Okända värden-describen — ersätt hela:

```ts
  describe('okända värden', () => {
    // TV: okänd status → 'mina'. Säkert numera: mina utan progress härleds
    // till 'ej_paborjad' (inte 'aktiv' som i M2-buggen), så ingen fantom-
    // nudge uppstår. Film: → 'vill_se' (motsatsen av terminal).
    it('TV → mina (landar som ej_paborjad utan progress)', () => {
      expect(migrateStatus('garbage', 'tv')).toEqual({ status: 'mina', dropped: false });
    });
    it('film → vill_se som säker default', () => {
      expect(migrateStatus('garbage', 'movie')).toEqual({ status: 'vill_se', dropped: false });
    });
  });
```

- [ ] **Step 2.2: Kör — FAIL.** `npx vitest run src/lib/watchStatus.migration.test.ts`

- [ ] **Step 2.3: Implementera**

I `src/lib/watchStatus.migration.ts` — ersätt `want_to_watch`/`vill_se`-caset
och default-caset:

```ts
    case 'want_to_watch':
    case 'vill_se':
      // TV: vill_se är avskaffat som lagrad status (2026-06) — serien följs
      // och hamnar i läget 'ej_paborjad' (ingen progress). Film behåller
      // vill_se. Firestore-docs med TV-vill_se kan ligga kvar länge; alla
      // läsare normaliserar hit.
      return { status: isTv ? 'mina' : 'vill_se', dropped: false };
```

```ts
    default:
      // Okänd/oväntad status (handredigerad doc, framtida schema, typo):
      // film → 'vill_se'. TV → 'mina' — säkert numera eftersom mina utan
      // progress härleds till 'ej_paborjad' (M2-fantombuggen som motiverade
      // vill_se-defaulten är borta i och med ej_paborjad-läget).
      return { status: isTv ? 'mina' : 'vill_se', dropped: false };
```

Uppdatera även schemakommentaren i filhuvudet: v3-raden blir
`vill_se (film) | mina (TV) | sedd (film) | avbruten`.

- [ ] **Step 2.4: Kör — PASS.** `npx vitest run src/lib/watchStatus.migration.test.ts`

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/watchStatus.migration.ts src/lib/watchStatus.migration.test.ts
git commit -m "feat(migration): TV vill_se lazy-migreras till mina (ej_paborjad-läge)"
```

---

### Task 3: Ta bort auto-promote ur `WatchlistContext.updateProgress`

**Files:**
- Modify: `src/contexts/WatchlistContext.tsx:183-216`

- [ ] **Step 3.1: Ersätt `updateProgress`**

Efter migration-på-läsning (Task 2) kan en TV-titel aldrig vara `vill_se` i
minnet — promote-grenen är död kod. Progress ändrar aldrig status längre.

```ts
  const updateProgress = useCallback(async (tmdbId: number, season: number, episode: number) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    // Progress ändrar aldrig status: TV bor redan i 'mina' (vill_se för TV är
    // avskaffat och normaliseras vid läsning), och sub-state (ej_paborjad →
    // aktiv/ikapp) härleds — inget statusbyte behövs när första avsnittet
    // markeras. (Gamla auto-promote-flytten vill_se→mina togs bort 2026-06.)
    const current = items.find(i => i.tmdbId === tmdbId);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, {
      lastWatchedSeason: season,
      lastWatchedEpisode: episode,
      ...visFields,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    // Fire-and-forget: sync progress till alla grupper jag är medlem i där
    // titeln finns. Block:ar inte UI:n om en grupp är flaky — fel slukas i
    // syncProgressToGroups.
    void import('@/lib/firebase/groups').then(({ syncProgressToGroups }) =>
      syncProgressToGroups({
        uid,
        tmdbId,
        lastWatchedSeason: season,
        lastWatchedEpisode: episode,
        status: current?.status ?? null,
      }),
    );
  }, [uid, items, effectiveVisibilityNow]);
```

OBS: `WatchStatus`-importen i filen används fortfarande av interfacet — rör
inte importerna.

- [ ] **Step 3.2: Verifiera.** Run: `npm run typecheck && npm test` → PASS

- [ ] **Step 3.3: Commit**

```bash
git add src/contexts/WatchlistContext.tsx
git commit -m "refactor(watchlist): ta bort auto-promote — progress ändrar aldrig status"
```

---

### Task 4: Kalendern — ta bort `source`, toggel för alla följda serier

**Files:**
- Modify: `src/lib/calendar/types.ts`
- Modify: `src/lib/calendar/entry.ts:41-45`
- Modify: `src/lib/calendar/buildEntries.ts`
- Modify: `src/hooks/useCalendar.ts`
- Test: `src/lib/calendar/entry.test.ts`, `src/lib/calendar/buildEntries.test.ts`, `src/lib/calendar/summary.test.ts`

- [ ] **Step 4.1: Uppdatera testerna (failing first)**

`src/lib/calendar/entry.test.ts` — ta bort `source` ur båda fixtures och
`villSeEpisode`-konstanten; ersätt `canMarkWatched`-testet:

```ts
  it('canMarkWatched for episodes, never for movie releases', () => {
    expect(canMarkWatched(episode)).toBe(true);
    expect(canMarkWatched(movie)).toBe(false);
  });
```

`src/lib/calendar/buildEntries.test.ts` — ta bort hela testet
`'defaults source to "mina" and stamps "vill_se" when asked'` (rad 82–90).
Inga fixtures sätter `source` (byggaren stämplade den) — inga andra ändringar.

`src/lib/calendar/summary.test.ts` — ta bort `source: 'mina'` resp.
`source: 'vill_se'` ur `episode()`/`movie()`-fixtures.

- [ ] **Step 4.2: Kör — FAIL** (typfel + borttagna fält):
`npx vitest run src/lib/calendar/`

- [ ] **Step 4.3: Implementera**

`src/lib/calendar/types.ts` — ta bort `CalendarSource`-typen (rad 11–13) och
`source: CalendarSource;` ur `CalendarEntryBase` (rad 24). Uppdatera
filhuvudet:

```ts
// Kalenderns entry-modell. Kalendern visar två slags händelser:
//   1. Avsnitt av serier du följer ('mina') — inkl. ej påbörjade; toggeln
//      "markera sedd" gäller alla (att bocka av första avsnittet från
//      kalendern flyttar bara läget ej_paborjad → aktiv/ikapp).
//   2. Digitala filmsläpp för filmer du vill se ('vill_se', media 'movie')
//
// Avsnitt och filmsläpp har olika form, så CalendarEntry är en diskriminerad
// union på `kind`. Delade fält ligger i CalendarEntryBase; per-kind-logik
// (nyckel, länk, badge) bor i `entry.ts` så konsumenterna slipper sprida
// `if (kind === ...)` överallt.
```

`src/lib/calendar/entry.ts` — ersätt `canMarkWatched`:

```ts
/** True om vi ska visa "markera sedd"-toggeln. Alla avsnitt (även i ej
 *  påbörjade serier — att bocka av E1 från kalendern är hur man börjar),
 *  aldrig filmsläpp. */
export function canMarkWatched(e: CalendarEntry): boolean {
  return e.kind === 'episode';
}
```

`src/lib/calendar/buildEntries.ts`:
- Ta bort `CalendarSource` ur type-importen.
- `buildCalendarEntries(seasonData: SeasonDatum[])` — ta bort `source`-parametern
  och `source,`-raden i push-objektet. Uppdatera docbloken (stryk stycket om
  source-stämpling).
- `buildMovieEntries` — ta bort `source: 'vill_se',`-raden.

`src/hooks/useCalendar.ts`:
- Ta bort `CalendarSource` ur re-exporten (rad 16).
- Ersätt TV-delen (rad 34–47): en källa, inga specs med source:

```ts
  // Kalendern visar avsnitt för alla serier du följer ('mina') — inklusive
  // ej påbörjade (premiärbevakning är ett kärnvärde). Filmer i 'vill_se'
  // bidrar med digitala släppdatum längre ner.
  const minaTV = getByStatus('mina', 'tv');
  const tmdbIds = useMemo(
    () => minaTV.map(i => i.tmdbId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minaTV.map(i => i.tmdbId).join(',')]
  );
```

- `showQueries` mappar nu över `tmdbIds` direkt (`tmdbIds.map(id => ({ queryKey: ['tv', id], queryFn: ({ signal }) => getTVShow(id, { signal }), staleTime: TMDB_STALE.TV_DETAIL }))`).
- `shows`-memon förenklas (ingen source-tagg):

```ts
  const shows = useMemo(
    () => showQueries.map(q => q.data).filter((d): d is TMDBTVShow => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(',')]
  );
```

- `seasonSpecs` utan source: `shows.map(show => ({ showId: show.id, seasonNum: show.next_episode_to_air?.season_number ?? show.number_of_seasons, show }))`.
- `entries`-memon (rad 148–158) blir:

```ts
  const entries: CalendarEntry[] = useMemo(() => {
    return [
      ...buildCalendarEntries(seasonData),
      ...buildMovieEntries(movies),
    ];
  }, [seasonData, movies]);
```

- [ ] **Step 4.4: Kör — PASS**

Run: `npx vitest run src/lib/calendar/ && npm run typecheck`
Typecheck fångar ev. kvarvarande `.source`-läsare — det ska inte finnas några
(verifierat med grep: bara useCalendar/buildEntries/entry/types + tester).

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/calendar/ src/hooks/useCalendar.ts
git commit -m "feat(kalender): source-fältet bort — markera sedd-toggel för alla följda serier"
```

---

### Task 5: QuickAddButton "Följ" + onboarding en knapp för TV

**Files:**
- Modify: `src/components/title/QuickAddButton.tsx`
- Modify: `src/components/onboarding/OnboardingFlow.tsx:226-235, 318-331`

- [ ] **Step 5.1: QuickAddButton**

- Importera `statusMenuLabel` från `@/lib/watchStatus` (bredvid `statusLabel`).
- Menyknapparnas text (rad 116): byt `{labelFor(status)}` mot
  `{statusMenuLabel(status, mediaType)}` — dropdownen visar nu
  "Följ / Sedd (alla avsnitt) / Avbruten" för TV.
- Toast efter generiska vägen (rad 80) behåller `labelFor(status)` —
  "Severance — Följer" (substantiv i bekräftelsen är rätt).
- Ingen ny handler behövs: `'mina'` går genom den befintliga generiska
  `addItem`-vägen (bevarar ev. befintlig progress via `current?.…`-fallbacks).

- [ ] **Step 5.2: OnboardingFlow**

Ersätt status-mappningen i `handleAdd` (rad 226–235):

```ts
  // TV: en väg — "Följ" (status mina; ej påbörjad tills första avsnittet
  // markeras). Film: intent 'plan' → vill_se, 'engage' → sedd.
  const handleAdd = async (
    result: TMDBSearchResult & { media_type: 'movie' | 'tv' },
    intent: 'plan' | 'engage',
  ) => {
    const title = getDisplayTitle(result);
    const status: WatchStatus = result.media_type === 'tv'
      ? 'mina'
      : (intent === 'plan' ? 'vill_se' : 'sedd');
```

Ersätt knapparna (rad 318–331). TV har efter mergen ingen meningsfull
plan/engage-skillnad (båda skulle skriva mina utan progress) — en knapp:

```tsx
                  ) : r.media_type === 'tv' ? (
                    <button
                      onClick={() => handleAdd(r, 'engage')}
                      className="text-xxs px-2 py-[3px] bg-accent text-white rounded-sm cursor-pointer"
                    >
                      Följ
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAdd(r, 'plan')}
                        className="text-xxs px-2 py-[3px] border border-border-main rounded-sm bg-white cursor-pointer"
                      >
                        Vill se
                      </button>
                      <button
                        onClick={() => handleAdd(r, 'engage')}
                        className="text-xxs px-2 py-[3px] bg-accent text-white rounded-sm cursor-pointer"
                      >
                        Sedd
                      </button>
                    </div>
                  )}
```

Uppdatera även beskrivningstexten (rad 259–262) till:
`Sök efter en film eller serie. Serier följer du; filmer markerar du som vill se eller sedda.`

- [ ] **Step 5.3: Verifiera.** `npm run typecheck && npm run lint && npm test` → PASS

- [ ] **Step 5.4: Commit**

```bash
git add src/components/title/QuickAddButton.tsx src/components/onboarding/OnboardingFlow.tsx
git commit -m "feat(ui): CTA-verbet Följ för serier i statusmeny + onboarding"
```

---

### Task 6: Rådgivaren — dela mina-poolen på progress

**Files:**
- Modify: `src/hooks/useSubscriptionAdvisor.helpers.ts` (ny export)
- Modify: `src/hooks/useSubscriptionAdvisor.ts:43-50`
- Test: `src/hooks/useSubscriptionAdvisor.test.ts`

- [ ] **Step 6.1: Skriv failing test**

I `src/hooks/useSubscriptionAdvisor.test.ts`, importera `splitTvByProgress`
från `./useSubscriptionAdvisor.helpers` och lägg till (använder befintliga
`makeWatchlistItem`):

```ts
describe('splitTvByProgress', () => {
  it('delar mina-TV i started (har progress) och unstarted (ej påbörjad)', () => {
    const started = makeWatchlistItem({ tmdbId: 1, lastWatchedSeason: 2, lastWatchedEpisode: 3 });
    const specials = makeWatchlistItem({ tmdbId: 2, lastWatchedSeason: 0, lastWatchedEpisode: 1 });
    const unstarted = makeWatchlistItem({ tmdbId: 3, lastWatchedSeason: null });
    const result = splitTvByProgress([started, specials, unstarted]);
    expect(result.started.map(i => i.tmdbId)).toEqual([1, 2]);
    expect(result.unstarted.map(i => i.tmdbId)).toEqual([3]);
  });

  it('tom lista → två tomma listor', () => {
    expect(splitTvByProgress([])).toEqual({ started: [], unstarted: [] });
  });
});
```

- [ ] **Step 6.2: Kör — FAIL.** `npx vitest run src/hooks/useSubscriptionAdvisor.test.ts`

- [ ] **Step 6.3: Implementera helpern**

I `src/hooks/useSubscriptionAdvisor.helpers.ts` (importera `WatchlistItem`-typen
om den inte redan finns i filens type-import):

```ts
// 'mina'-TV delas på progress: påbörjade serier är följer-ankare (driver
// prenumerations-råd inom lookahead-fönstret), ej påbörjade behandlas som
// vill se-ankare ("upcoming" — hindrar paus-råd men får inget datumfönster).
// Bevarar exakt beteendet från när ej påbörjade serier låg i vill_se-statusen.
// == null (inte falsy): säsong 0/Specials är giltig progress.
export function splitTvByProgress(
  items: WatchlistItem[],
): { started: WatchlistItem[]; unstarted: WatchlistItem[] } {
  const started: WatchlistItem[] = [];
  const unstarted: WatchlistItem[] = [];
  for (const item of items) {
    (item.lastWatchedSeason == null ? unstarted : started).push(item);
  }
  return { started, unstarted };
}
```

- [ ] **Step 6.4: Koppla in i hooken**

I `src/hooks/useSubscriptionAdvisor.ts`, ersätt rad 43–50:

```ts
  // 'mina'-TV utan progress (ej påbörjad) behandlas som vill se-ankare —
  // samma roll som TV-vill_se hade före mergen (2026-06). Påbörjade serier
  // är följer-ankare. willSeeItems = vill_se-filmer + ej påbörjade serier.
  const tvInMina = useMemo(
    () => getByStatus('mina', 'tv').filter(i => !i.dropped),
    [getByStatus]
  );
  const { started: followingTV, unstarted: unstartedTV } = useMemo(
    () => splitTvByProgress(tvInMina),
    [tvInMina]
  );
  const willSeeItems = useMemo(
    () => [...getByStatus('vill_se').filter(i => !i.dropped), ...unstartedTV],
    [getByStatus, unstartedTV]
  );
```

Importera `splitTvByProgress` i helpers-importblocket (rad 13–21). Allt
nedströms är oförändrat: `tmdbIds` (rad 53–59) unionerar redan followingTV +
willSee-TV; `willSeeIds`/`followingIds` (rad 121–122) bygger på samma listor;
`unfinishedTmdbIds`-loopen (rad 340) går över `followingTV` där inget item
saknar progress.

- [ ] **Step 6.5: Kör — PASS.** `npx vitest run src/hooks/useSubscriptionAdvisor.test.ts && npm run typecheck`

- [ ] **Step 6.6: Commit**

```bash
git add src/hooks/useSubscriptionAdvisor.helpers.ts src/hooks/useSubscriptionAdvisor.ts src/hooks/useSubscriptionAdvisor.test.ts
git commit -m "feat(advisor): ej påbörjade serier är will see-ankare — pooldelning på progress"
```

---

### Task 7: Tillsammans — ej påbörjade serier förblir kandidater

**Files:**
- Modify: `src/lib/together/candidates.ts:12-26`
- Test: `src/lib/together/candidates.test.ts:20-38`

- [ ] **Step 7.1: Uppdatera testet (failing first)**

Ersätt `libraryExclusionIds`-describen:

```ts
describe('libraryExclusionIds', () => {
  it('exkluderar sedd/avbruten/påbörjad mina men behåller vill_se + ej påbörjad mina', () => {
    const ids = libraryExclusionIds([
      { tmdbId: 1, status: 'mina', lastWatchedSeason: 2 },
      { tmdbId: 2, status: 'sedd', lastWatchedSeason: null },
      { tmdbId: 3, status: 'avbruten', lastWatchedSeason: null },
      { tmdbId: 4, status: 'vill_se', lastWatchedSeason: null },
      { tmdbId: 5, status: 'mina', lastWatchedSeason: null },
      { tmdbId: 6, status: 'mina', lastWatchedSeason: 0 },
    ]);
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
    expect(ids.has(4)).toBe(false);
    expect(ids.has(5)).toBe(false); // ej påbörjad — prima sessionskandidat
    expect(ids.has(6)).toBe(true);  // säsong 0 (Specials) är progress
  });

  it('tom lista → tom mängd', () => {
    expect(libraryExclusionIds([]).size).toBe(0);
  });
});
```

- [ ] **Step 7.2: Kör — FAIL.** `npx vitest run src/lib/together/candidates.test.ts`

- [ ] **Step 7.3: Implementera**

Ersätt funktionen + docblok i `src/lib/together/candidates.ts`:

```ts
/**
 * Tmdb-ids ur ett bibliotek som INTE ska föreslås i en session (G4):
 * 'sedd' (redan sedd), 'avbruten' (gav upp) och påbörjade 'mina'-serier
 * (tittar redan). 'vill_se'-filmer och ej påbörjade 'mina'-serier behålls
 * medvetet — titlar man vill se men inte börjat är prima gemensamma
 * kandidater; att de dyker upp i sviparkortleken är önskat, inte buggen.
 * (== null, inte falsy: säsong 0/Specials räknas som påbörjad.)
 */
export function libraryExclusionIds(
  items: ReadonlyArray<{ tmdbId: number; status: WatchStatus; lastWatchedSeason?: number | null }>,
): Set<number> {
  const out = new Set<number>();
  for (const item of items) {
    if (item.status === 'vill_se') continue;
    if (item.status === 'mina' && item.lastWatchedSeason == null) continue;
    out.add(item.tmdbId);
  }
  return out;
}
```

Callers (`GroupPageClient.tsx:181`, `tillsammans/ny/page.tsx:78`) skickar hela
`WatchlistItem`-arrayer — strukturell typning täcker det nya optionella fältet,
inga caller-ändringar.

- [ ] **Step 7.4: Kör — PASS.** `npx vitest run src/lib/together/candidates.test.ts && npm run typecheck`

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/together/candidates.ts src/lib/together/candidates.test.ts
git commit -m "feat(tillsammans): ej påbörjade följda serier förblir sessionskandidater"
```

---

### Task 8: Taste-vikter — ej påbörjad väger som vill_se

**Files:**
- Modify: `src/lib/taste/vector.ts:8-14`
- Modify: `src/lib/taste/stats.ts:13-19`
- Test: `src/lib/taste/vector.test.ts`

- [ ] **Step 8.1: Skriv failing test**

Lägg till i `src/lib/taste/vector.test.ts`:

```ts
describe('buildTasteVector — mina viktas på progress', () => {
  it('ej påbörjad mina-serie väger som planerad (0.25), påbörjad som samling (0.75)', () => {
    const unstarted = buildTasteVector([
      mkItem({ status: 'mina', mediaType: 'tv', lastWatchedSeason: null, genreIds: [18] }),
    ]);
    expect(unstarted.genres[18]).toBe(0.25);
    const started = buildTasteVector([
      mkItem({ status: 'mina', mediaType: 'tv', lastWatchedSeason: 1, lastWatchedEpisode: 2, genreIds: [18] }),
    ]);
    expect(started.genres[18]).toBe(0.75);
  });
});
```

- [ ] **Step 8.2: Kör — FAIL.** `npx vitest run src/lib/taste/vector.test.ts`

- [ ] **Step 8.3: Implementera**

`src/lib/taste/vector.ts` — ersätt `weightForItem`:

```ts
// Viktning per WatchlistItem när vi bygger smakvektorn.
// Baseline: items med rating räknas som 2×rating/10, items utan rating
// räknas som en mild positiv signal om användaren har titeln i samlingen.
// Ej påbörjade 'mina'-serier är planerade (inte bevisad smak) — samma
// vikt som 'vill_se', där de bodde före mergen (2026-06).
function weightForItem(item: WatchlistItem): number {
  if (item.rating != null) return (item.rating / 10) * 2;
  if (item.status === 'avbruten') return -0.5;
  if (item.status === 'sedd') return 1;
  if (item.status === 'mina') return item.lastWatchedSeason == null ? 0.25 : 0.75;
  return 0.25;
}
```

`src/lib/taste/stats.ts` — ersätt `weightForItem`:

```ts
// Ej påbörjade 'mina'-serier viktas som planerade (vill_se-nivån) — se
// taste/vector.ts för resonemanget.
function weightForItem(item: WatchlistItem): number {
  if (item.rating != null) return item.rating / 10;
  if (item.status === 'avbruten') return 0;
  if (item.status === 'sedd') return 0.8;
  if (item.status === 'mina') return item.lastWatchedSeason == null ? 0.3 : 0.6;
  return 0.3;
}
```

- [ ] **Step 8.4: Kör — PASS.** `npx vitest run src/lib/taste/`

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/taste/vector.ts src/lib/taste/stats.ts src/lib/taste/vector.test.ts
git commit -m "feat(taste): mina utan progress viktas som planerad smak"
```

---

### Task 9: Feed-copy — `mina` visas som "följer"

**Files:**
- Modify: `src/app/feed/page.tsx:199-205`

- [ ] **Step 9.1: Ändra etiketten**

```ts
  // 'mina' (TV) → "följer" (socialt språk); film 'sedd' → "markerade som
  // sedd"; vill_se (film) → "vill se".
  const statusLabel =
    item.status === 'mina' ? 'följer'
    : item.status === 'sedd' ? 'markerade som sedd'
    : item.status === 'vill_se' ? 'vill se'
    : 'uppdaterade';
```

- [ ] **Step 9.2: Verifiera + commit**

Run: `npm run typecheck` → OK

```bash
git add src/app/feed/page.tsx
git commit -m "fix(feed): mina-tillägg visas som 'följer'"
```

---

### Task 10: `/my/vill-se` blir väljaren

**Files:**
- Create: `src/components/watchlist/VillSePickerPage.tsx`
- Modify: `src/app/my/vill-se/page.tsx`
- Modify: `src/components/WatchlistPage.tsx` (exportera `LibrarySubnav`; ta bort död bulk-action)

- [ ] **Step 10.1: Exportera `LibrarySubnav` ur WatchlistPage**

I `src/components/WatchlistPage.tsx:593`: `function LibrarySubnav` →
`export function LibrarySubnav`.

- [ ] **Step 10.2: Ta bort död "Markera som tittad"-bulk-action**

`/my/vill-se` renderar inte längre WatchlistPage, så bulk-knappen
"Markera som tittad" (rad 351–370, villkor `status === 'mina' || status === 'vill_se'`)
saknar användningsfall: för `mina`-TV är target `mina` (no-op) och `vill_se`
nås aldrig. Ta bort hela det villkorade blocket (behåll "Flytta till Vill se"
för `sedd` och "Ta bort"/"Avmarkera").

- [ ] **Step 10.3: Skapa väljaren**

`src/components/watchlist/VillSePickerPage.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { PosterProviderDots } from '@/components/watchlist/WatchlistProviderDisplay';
import { LibrarySubnav } from '@/components/WatchlistPage';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { toneForId } from '@/lib/duotone';
import type { WatchlistItem } from '@/types';

type MediaFilter = 'all' | 'tv' | 'movie';

// Väljaren — "vad ska du se ikväll?". Visar filmer i 'vill_se' + följda
// serier utan progress (läget ej påbörjad). Jobbet är att VÄLJA, inte
// förvalta: ingen statushantering, inga bulk-actions — varje kort är en
// länk till titelsidan där man börjar titta. Förvaltning bor i /my/series
// (serier) och /my/films (filmer). Att samma serie även syns under
// Följer → Ej påbörjade är avsiktligt: olika vyer, olika jobb.
export default function VillSePickerPage() {
  const { items, loading } = useWatchlist();
  const { user } = useAuth();
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const myProviders = useMemo(
    () => new Set(user?.myProviders ?? []),
    [user?.myProviders]
  );

  const picks = useMemo(() => {
    const base = items.filter(i =>
      i.mediaType === 'movie'
        ? i.status === 'vill_se'
        : i.status === 'mina' && !i.dropped && i.lastWatchedSeason == null
    );
    const filtered = mediaFilter === 'all' ? base : base.filter(i => i.mediaType === mediaFilter);
    // Valögonblickets sortering: det du kan se direkt (finns på dina
    // tjänster) överst, därefter senast tillagd.
    const onMine = (i: WatchlistItem) => i.providers.some(p => myProviders.has(p));
    return [...filtered].sort((a, b) => {
      const am = onMine(a) ? 0 : 1;
      const bm = onMine(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return b.addedAt.getTime() - a.addedAt.getTime();
    });
  }, [items, mediaFilter, myProviders]);

  const header = (
    <PageHeader
      crumb="Bibliotek · vill se"
      title="Vill se"
      standfirst="Vad ska du se ikväll? Filmer du vill se och serier du följer men inte börjat."
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <LibrarySubnav status="vill_se" />
        <LoadingView variant="grid" label="Laddar biblioteket…" />
      </>
    );
  }

  return (
    <>
      {header}
      <LibrarySubnav status="vill_se" />

      <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
        {(['all', 'tv', 'movie'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setMediaFilter(f)}
            className={`chip${mediaFilter === f ? ' is-on' : ''}`}
          >
            {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
          </button>
        ))}
      </div>

      {picks.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <EmptyState
            title="Inget att välja på."
            body="Här samlas filmer du vill se och serier du följer men inte börjat. Hitta något via Rekommendationer."
            action={
              <Link href="/recommendations/" className="chip no-underline">
                Till rekommendationer
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px]"
            style={{ marginTop: 18 }}
          >
            {picks.map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              const href = titleHref(item.mediaType, item.tmdbId);
              const Icon = item.mediaType === 'tv' ? Tv : Film;
              return (
                <Link key={`${item.mediaType}-${item.tmdbId}`} href={href} className="no-underline text-text-primary">
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                    {poster ? (
                      <img src={poster} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
                        <Icon size={20} className="text-ink-3 opacity-40" />
                        <span className="text-[10px] text-ink-3 text-center line-clamp-3 leading-tight">{item.title}</span>
                      </div>
                    )}
                    <PosterProviderDots providers={item.providers} myProviders={user?.myProviders ?? []} />
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.title}
                  </div>
                  <div className="text-xxs text-text-muted">
                    {item.mediaType === 'tv' ? 'Serie' : 'Film'}{item.releaseYear ? ` · ${item.releaseYear}` : ''}
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-xxs text-text-muted">
            Prickar på postern = streamingtjänst (färg per tjänst, hovra för namn). Fylld prick = tjänst du har. Titlar på dina tjänster visas först.
          </p>
          <div style={{ marginTop: 16 }}>
            <JustWatchCredit />
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 10.4: Byt ut sid-komponenten**

`src/app/my/vill-se/page.tsx`:

```tsx
'use client';

import AuthGuard from '@/components/AuthGuard';
import VillSePickerPage from '@/components/watchlist/VillSePickerPage';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function VillSePage() {
  usePageMeta({ title: 'Vill se' });
  return <AuthGuard><VillSePickerPage /></AuthGuard>;
}
```

- [ ] **Step 10.5: Verifiera**

Run: `npm run typecheck && npm run lint && npm test` → PASS
(`consistency.test.ts`-guarden gäller `src/components/pages/*` — väljaren bor i
`watchlist/` och använder ändå PageHeader/LoadingView/EmptyState-receptet.)

Manuell rök i dev (`npm run dev`): `/my/vill-se` visar mixen, chips filtrerar,
tomt läge har CTA, `/my/series` visar "Ej påbörjade"-sektionen när en serie
följs utan progress.

- [ ] **Step 10.6: Commit**

```bash
git add src/components/watchlist/VillSePickerPage.tsx src/app/my/vill-se/page.tsx src/components/WatchlistPage.tsx
git commit -m "feat(bibliotek): /my/vill-se blir väljare — filmer + ej påbörjade serier"
```

---

### Task 11: Dokumentation + minne

**Files:**
- Modify: `CLAUDE.md` (WatchStatus-avsnittet + kalenderavsnittet)
- Modify: `docs/voice-and-tone.md` (statustabeller)
- Modify: `C:\Users\malla\.claude\projects\C--binge\memory\feedback_status_system.md`

- [ ] **Step 11.1: CLAUDE.md**

I avsnittet "WatchStatus + TV sub-states":
- Statuslistan: `'vill_se' — vill se (ENDAST film sedan 2026-06; TV-vill_se lazy-migreras till 'mina')`.
- Sub-state-listan får `ej_paborjad — följs men inget avsnitt markerat` överst.
- Stryk hela "Auto-promote"-stycket; ersätt med en rad: progress ändrar aldrig
  status — läget härleds.
- Migration-stycket: lägg till `'vill_se' (TV) → 'mina'`-regeln.
- Kalenderavsnittet ("Kalender — källor + entry-modell"): tre källor blir två
  (serier i 'mina' inkl. ej påbörjade — alla med toggel; filmer i 'vill_se');
  stryk `source`-omnämnandet.
- Routes-listan: `/my/vill-se — väljaren (filmer vill_se + ej påbörjade serier)`.

- [ ] **Step 11.2: voice-and-tone.md**

- Status-vokabulärtabellen: `vill_se`-raden får "Var visas det" = "Status-chip
  och knapp (film); vy-rubrik för väljaren /my/vill-se".
- `mina`-raden: notera CTA-verbet — knapp "Följ", chip "Följer".
- Sub-state-tabellen får raden `ej_paborjad | Ej påbörjad | Följer serien men
  inget avsnitt är markerat` överst.

- [ ] **Step 11.3: Minnesfilen**

Uppdatera `feedback_status_system.md`: statusuppsättningen är oförändrad i
typen men `vill_se` är film-only sedan 2026-06-11; TV har härlett
`ej_paborjad`-läge under Följer; auto-promote borttagen; /my/vill-se är en
väljare. Behåll regeln "inga nya statusar utan att fråga".

- [ ] **Step 11.4: Commit**

```bash
git add CLAUDE.md docs/voice-and-tone.md
git commit -m "docs: status-/kalenderdokumentation efter foljer/vill se-mergen"
```

---

### Task 12: Slutverifiering

- [ ] **Step 12.1:** `npm run lint` → 0 fel
- [ ] **Step 12.2:** `npm run typecheck` → 0 fel
- [ ] **Step 12.3:** `npm test` → alla tester gröna (förvänta ~95+ tester; nya i watchStatus, migration, advisor-helpers, candidates, taste)
- [ ] **Step 12.4:** `npm run build` → statisk export OK
- [ ] **Step 12.5:** Sök kvarvarande TV-vill_se-antaganden: `rg -n "vill_se" src functions --glob "!*.test.ts"` och granska att varje träff är film-only, migrations-/läsarkod eller insights-aggregat (alla fyra nycklar är fortsatt giltiga där eftersom gamla docs finns kvar i Firestore).
- [ ] **Step 12.6:** Rapportera till användaren; deploy sker separat via /commit (endast hosting behövs — ingen functions/rules-ändring i detta arbete).
