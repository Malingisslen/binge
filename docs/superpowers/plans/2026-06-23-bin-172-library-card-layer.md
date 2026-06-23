# BIN-172 — "Gratis med ditt lånekort": library-card free-streaming layer

**Status:** Foundation shipped (`src/lib/libraries/municipalities.ts` — all 290 kommuner +
tests). Remaining work is Tier-B (UI, sign-off) + Tier-C/D (Viddla scraper, deploy).

## The wedge

Binge becomes the only tracker that answers *"what can I watch tonight for 0 kr?"* —
surfacing titles free via a Swedish public-library card (Cineasterna ~3,400 films,
Viddla ~3,000; free in ~250 / ~50 kommuner respectively). Letterboxd/Trakt will never
model "is this in your kommun's library catalog" — it needs Swedish municipal knowledge
with zero global reuse. Most defensible, on-brand hook in the product.

## What already exists (don't rebuild)

- **Cineasterna catalog is already scraped** weekly into `cineasternaCatalog/current`
  (`functions/src/cineasterna/`), consumed by `useCineasternaCatalog()` →
  `{ has(tmdbId), rentalFor(tmdbId) }`.
- The movie detail page already renders "Finns på Cineasterna (via ditt bibliotek)"
  (`MoviePageClient.tsx` ~317) and the `CheapestPathVerdict` already has a
  `free_library` case → "Gratis via biblioteket".
- The SVT free-public recommendation row (`useRowFreePublic` + `cascadePrioritizer`
  `free-public` + `RecommendationsHub` `FreePublicRow`) is the exact row pattern to mirror.
- **Shipped this run:** `MUNICIPALITIES` (290, SCB code+name) + `MUNICIPALITY_NAMES`
  (sorted sv-locale) + `findMunicipality`/`isValidMunicipality` + tests.

## Honesty constraints (important)

1. **We can't read the library ledger.** Loan quotas (Cineasterna ~1/week, Viddla
   ~4/month) are framed as a *self-reported depleting budget*, never a guarantee.
2. **Per-kommun service coverage is not authoritatively sourced.** We know aggregates
   (Cineasterna ~250 kommuner, Viddla ~50) but not a verified kommun→service map. So the
   MVP gates the layer on the user *declaring* their `hemkommun` (= "I have a library
   card"), and frames availability as "via ditt bibliotek" — exactly the existing copy.
   A verified kommun→service map is a later data-sourcing task (see Viddla section).

## Build sequence

### A. Home-kommun field + setting (Tier-B, sign-off)
- `domain.ts`: add `hemkommun?: string | null` to `UserProfile`.
- `AuthContext.tsx`: read it in `ensureUserProfile`; expose `updateHomeMunicipality(name)`
  via the existing `updateUserField('hemkommun', ...)` pattern (optimistic + merge write).
- `firestore.rules`: confirm the `users/{uid}` update rule allows a new owner-writable
  string field (the rule allows owner writes except `isAdmin`; add a length/format guard
  mirroring `bio` if it's a whitelist). **Rules deploy is manual (Tier-D).**
- Settings UI: a `BibliotekSection` (mirror `ProvidersSection`) with a `<select>` over
  `MUNICIPALITY_NAMES` + a "Spara" + a one-line honest explainer ("Vi kan inte se ditt
  lånesaldo — vi visar bara vad som *kan* vara gratis via ditt bibliotek"). Insert into
  `src/app/settings/page.tsx`. Follow the canonical view recipe (design tokens, sv copy).
- Personalize the existing Cineasterna line: when `hemkommun` set, "via biblioteket i
  {kommun}" instead of generic "via ditt bibliotek".

### B. Badge everywhere (Tier-B, sign-off)
- TV detail page: wire `libraryAvailable` from `useCineasternaCatalog().has(id)`
  (currently hardcoded `false` in `TVShowPageClient`). (Cineasterna is films-only today,
  so this mostly matters once Viddla/other TV catalogs land — keep the wiring generic.)
- `TitleCard` poster badge: a "Bibliotek" chip when the title is in a catalog. **Perf
  note:** don't call `useCineasternaCatalog()` per card — compute the catalog `Set` once
  in each grid parent and pass `libraryAvailable` down as a prop (matches how `isFree`
  badge data is already passed in). This is the one real design decision needing sign-off.

### C. "Gratis ikväll via biblioteket" row (Tier-B, sign-off)
- New `useRowFreeLibrary`: unlike `useRowFreePublic` (which hits TMDB discover by
  provider), the catalog is a flat tmdbId set with no discover query. So the honest row =
  **the user's own watchlist titles that are in the catalog** ("you want these, they're
  free at the library") — bounded by library size, high intent. Convert watchlist items
  → `RowTitle` (needs a light TMDB detail fetch or reuse already-loaded list data).
- Add `{ kind: 'free-library' }` to `RowId` + `rowKey`/`parseRowKey` in
  `types/recommendations.ts`; a score entry in `cascadePrioritizer.ts` (only emitted when
  `hemkommun` is set); `FreeLibraryRow` in `RecommendationsHub` + `whyForRow` case in `RecRow`.
- Optional: `FilterState.freeLibraryOnly` toggle in `RecommendationsFilters` (gated on hemkommun).

### D. Loan-quota budget (Tier-B, sign-off)
- Self-reported depleting counters on the user doc (`libraryQuota: { cineasternaLeft,
  viddlaLeft, periodStart }`), reset on period boundary client-side. Framed as a budget,
  not a guarantee. Small, can follow A–C.

### E. Viddla scraper (Tier-C/D — needs live reverse-engineering)
- **Viddla has no public API.** It's an SPA on `viddla.se`; selecting a film + "Spela
  film" reveals a participating-library dropdown and a per-library auth flow. The catalog
  endpoint must be reverse-engineered from the live site's network calls (the same way
  `backend.cineasterna.com` was), using Chrome DevTools against viddla.se.
- Once the catalog endpoint is known, mirror `functions/src/cineasterna/` wholesale:
  `api.ts` (fetch catalog) / `resolve.ts` (imdb→tmdb via TMDB `/find`) / `parse.ts`
  (`detectRot` >50% drop guard) / `types.ts` / `index.ts` (`onSchedule('every 168 hours')`,
  CONCURRENCY 6, checkpoint every 50). Writes `viddlaCatalog/current`.
- `firestore.rules`: add a `viddlaCatalog/{doc}` stanza (public read, admin write) —
  identical to the `cineasternaCatalog` block. **Manual rules deploy (Tier-D).**
- Export `viddlaCatalogSync` from `functions/src/index.ts`. **Manual functions deploy (Tier-D).**
- Then union Viddla into `useCineasternaCatalog` (rename → `useLibraryCatalog`, merge both
  tmdbId sets) so all of A–D light up for Viddla titles automatically.
- A bundled, verified kommun→{cineasterna,viddla} map can be sourced from the viddla.se
  + Cineasterna participating-library lists during the same reverse-engineering pass; ship
  as static JSON in `src/lib/libraries/swedishLibraries.ts` keyed by the 290 codes.

## Acceptance criteria
1. A user can set + persist their `hemkommun` from settings; reload keeps it. (A)
2. With `hemkommun` set, the Cineasterna line reads "via biblioteket i {kommun}". (A)
3. A title in the Cineasterna catalog shows the "Bibliotek" badge on its card without a
   per-card Firestore read (catalog Set computed once per grid). (B)
4. The "Gratis via biblioteket" row shows only watchlist titles actually in a catalog,
   and is hidden when `hemkommun` is unset. (C)
5. (After E) `viddlaCatalog/current` is populated weekly and Viddla titles light up the
   same badge/row/verdict with no per-surface changes.
