# BIN-185 — Spoiler-safe catch-up recaps ("Påminn mig var jag slutade")

**Status:** design approved by Malin 2026-07-12. Sensitive domain (paid AI + privacy + new
public-read Firestore collection + rules + Cloud Function) — review panel + folded conditions
required before any build.

## Problem

Returning to a half-watched show after months is high-friction: you've forgotten the story. Prime
Video shipped AI recaps but only for Prime originals. binge knows each user's **exact per-episode
progress**, so it can offer a recap that stops precisely where the user stopped — spoiler-safe — and
works across *every* service because it's built from episode metadata, not one platform's catalog.

## User experience

- On a TV show the user is part-way through (`episodeProgress` shows a last-watched S/E), a button
  **"Påminn mig var jag slutade"** appears on the show page and on that show's calendar entry.
- Tap → a tight Swedish recap of the story **up to and including their exact last-watched episode**
  ("Du slutade efter S3E4. Hittills: …"), with a discreet **"AI-genererad"** note beneath it.
- No progress on a show → no button (nothing to recap). Movies are out of scope (episode-based feature).

## The load-bearing invariant — spoiler boundary

A recap for boundary `(tmdbId, season, episode)` is built **only** from episode metadata for episodes
**≤ that boundary** (S1E1 … up to the user's last-watched S/E). Never anything later. This is the
whole product promise and the primary thing tests must guard.

**Privacy corollary:** the AI is only ever sent public episode summaries + "summarise up to episode
N". A user's watch history is NEVER sent to any AI — only the episode number (derived client-/server-
side from their progress). Neither AI is a processor of personal data here.

## Architecture — one shared cache, two fill tiers

### Shared cache

`recaps/{tmdbId}_{season}_{episode}` — top-level, **public read, no client write** (mirrors the
`titleRatings` pattern: `match /recaps/{id} { allow read: if true; allow write: if false; }` — writes
only via Admin SDK in a callable/CLI). Generated **once globally ever** per boundary, then served free
forever. Document shape:

```
{
  tmdbId: number, season: number, episode: number,
  text: string,            // the Swedish recap
  lang: 'sv',
  source: 'claude' | 'gemini',
  model: string,           // e.g. the Gemini model id, or 'claude-max-batch'
  sources: string[],       // attribution: ['tmdb'] or ['tmdb','wikipedia']
  generatedAt: Timestamp,
  schemaVersion: number,
}
```

Keyed by `(tmdbId, season, episode)` so it is identical for every user at that boundary — the reason
the economics work.

### Tier 1 — Claude, batch, for popular shows (`/recap <show>` command)

A repo command I run in a session (Claude Max subscription → **0 kr marginal**, not the metered API):

1. Resolve the show (TMDB id) and its full season/episode list.
2. **Prioritisation:** work down binge's OWN most-tracked TV ranking — reuse
   `topTitles(watchlist, N)` from `functions/src/insights/rollup.ts` (the daily insikter rollup already
   scans every watchlist and ranks by tracked-count), filtered to `mediaType: 'tv'`, extended N. "Keep
   going as much as possible" = cover shows in real popularity order, one show per run.
3. For **each** boundary `(s, e)` in the show, gather episode metadata for episodes **≤ (s,e)** from
   **TMDB + Wikipedia** (see Sources), and generate a spoiler-bounded Swedish recap.
4. Upload each recap to `recaps/{id}_{s}_{e}` via Admin SDK (`source: 'claude'`).

Idempotent: skip boundaries already cached (unless a `--force` refresh). A show with new episodes is
re-run to fill the new boundaries only.

### Tier 2 — Gemini, runtime, for the long tail (cache-miss fallback)

A callable Cloud Function `generateRecap({tmdbId, season, episode})`, modelled directly on
`functions/src/askbinge/parse.ts`:

- App-Check/auth gated; re-check the cache doc first (race-safe).
- Reserve **global daily budget** (transaction, `recapBudget/{day}`) + **per-user throttle**
  (`users/{uid}/recapMeta/throttle`) — same pattern as askbinge.
- Fetch TMDB season/episode overviews for episodes ≤ boundary (server-side TMDB call).
- Build the spoiler-bounded prompt, call **Gemini** (reuse `GEMINI_API_KEY` secret), sanitise output,
  write `recaps/{id}_{s}_{e}` via Admin SDK (`source: 'gemini'`, `sources: ['tmdb']`), return the text.
- On budget-exhausted / failure → return null; client shows a graceful "Kunde inte skapa just nu" state.

The runtime tier is **TMDB-only** — it keeps the automated path simple and clear of the Wikipedia
sourcing question. Popular shows are pre-baked by Claude (richer); the tail self-fills cheaply.

### Client flow

1. On an in-progress show, derive last-watched `(s, e)` from `episodeProgress`.
2. Read `recaps/{id}_{s}_{e}` (public). Hit → render. Miss → call `generateRecap`, then render (or the
   graceful failure state). Cache the read via React Query.
3. Render the recap + "AI-genererad" note + required attributions (TMDB always; Wikipedia when
   `sources` includes it).

## Sources

- **TMDB** (both tiers): `episode.overview` via `getTVSeason`. Always present; attribution already
  required site-wide.
- **Wikipedia** (Claude tier only): per-episode / "List of episodes" summaries — far richer than
  TMDB's one-liners. CC BY-SA → reusable **with attribution**. MUST be read per-episode and bounded to
  ≤ the boundary (never the season's later rows or an overall-plot section, which would spoil).
- **IMDB: PARKED.** IMDB's terms restrict content reuse and reading-to-synthesise is legally grey.
  Excluded pending an explicit Legal ruling (open question below).

## Cost & safety

- Shared cache → steady-state generation trends to zero; a given boundary is generated once ever.
- Gemini path: global daily generation ceiling + per-user throttle (runaway guard), reusing the
  askbinge budget machinery. Well inside the 25 SEK/mån Blaze cap.
- Claude path: 0 kr marginal (subscription batch), bounded by whatever shows I run `/recap` on.
- No new always-on infrastructure; the callable only runs on genuine cache misses.

## Privacy & disclosure

- **"AI-genererad"** note under every recap (decided).
- No personal data to either AI (only public episode summaries + a boundary number).
- Privacy policy already lists Gemini as a sub-processor. Wikipedia is a content source, not a
  processor of user data. Anthropic (Claude) only touches public metadata in an offline batch, not
  user data at runtime — **sub-processor disclosure need is an open question for DPO** (below).

## Testing

- **Spoiler boundary (critical):** a pure function assembling the ≤-boundary episode set must NEVER
  include an episode past the boundary — property-tested across season/episode edges (season rollovers,
  E1 boundaries, absent-episode gaps).
- Cache key correctness (`{id}_{s}_{e}`), public-read / no-client-write rules test.
- Gemini callable: budget-reserve + throttle + cache-hit short-circuit (mirror askbinge tests).
- `/recap` command: idempotent skip of cached boundaries; Wikipedia sourcing stays ≤ boundary.
- Client: button visibility gated on in-progress state; graceful failure state.

## Open questions (for the review panel)

1. **Legal — IMDB sourcing:** confirmed PARKED unless Legal clears reading IMDB content for synthesis.
2. **DPO — sub-processor disclosure:** does Anthropic/Wikipedia need listing in the privacy policy
   given neither receives personal data (offline, public-metadata-only)? Likely a light disclosure.
3. **Security:** `recaps` rules (public-read, admin-only-write) + the callable's App-Check/auth gate +
   budget-forge resistance (reuse askbinge's transaction pattern).
4. **DBA/cost:** confirm the daily ceiling + throttle values; confirm the `topTitles` scan reuse for
   seeding prioritisation is acceptable cost (runs occasionally, not per-request).

## Non-goals (YAGNI)

- No movie recaps. No per-user personalised recaps (the boundary is the only per-user input, and it's
  shared across all users at the same boundary). No auto-generation on show-open (opt-in per tap). No
  IMDB (parked). No binge-specific most-tracked *rebuild* — reuse the existing insikter `topTitles`.
