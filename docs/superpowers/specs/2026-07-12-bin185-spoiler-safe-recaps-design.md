# BIN-185 — Spoiler-safe catch-up recaps ("Påminn mig var jag slutade")

**Status:** design approved by Malin 2026-07-12, **redesigned to Wikipedia-only** after the review panel
found a hard blocker. Five-role panel (Security #4, DPO #6, Legal #5, DBA #27, Technical Writer #21) all
approve-with-conditions; every condition folded below. Ready for implementation.

## Why Wikipedia-only (the pivot)

The original two-tier design fed **TMDB episode summaries into an LLM**. TMDB's API Terms §1.C **prohibit**
this on binge's non-commercial licence ("Use the TMDB APIs or TMDB Content in connection with, including for
training, a machine learning (ML) or artificial intelligence (AI) based Application"; §2.A classes LLM use of
TMDB content as commercial). Since TMDB powers the entire product, a breach risks the key everything depends
on. **Malin chose the Wikipedia-only redesign.** This single change resolves **both** panel blockers:
- **Legal blocker (TMDB→LLM):** gone — no TMDB content ever reaches the AI.
- **Security blocker (client-forged boundary seeds a public spoiler):** gone — there is no runtime AI
  generation and no user-triggered write at all; the app only *reads* a pre-baked cache.

**Accepted residual (Malin informed):** TMDB's "in connection with an AI Application" wording is broad; running
any AI feature inside a TMDB-powered app is a reduced-but-nonzero interpretive risk. Mitigated by never sending
TMDB content to the AI and by sourcing solely from Wikipedia.

**Coverage tradeoff (accepted):** recaps exist only for shows that have good Wikipedia per-episode coverage AND
have been batch-baked — roughly the most-tracked popular shows. No long-tail. The button appears only on a
cache hit.

## User experience

- On a TV show the user is part-way through, if a recap exists for their exact boundary: a button
  **"Påminn mig var jag slutade"** on the show page + its calendar entry.
- Tap → boundary line **"Du slutade efter S3E4."** → a legible **"AI-genererad sammanfattning"** kicker
  (ABOVE the prose; EU AI Act Art. 50(4) "clear and distinguishable" — normal secondary-text size, not faint
  grey) → the Swedish recap → a small **"Kan innehålla mindre felaktigheter"** caveat → a `RecapSourceCredit`
  line (see Attribution).
- No cached recap for the boundary → no button (nothing served). Movies out of scope.
- Canonical Swedish noun: **sammanfattning** (register in `docs/voice-and-tone.md`). Boundary format `S{n}E{n}`.

## The load-bearing invariant — spoiler boundary

A recap for `(tmdbId, season, episode)` is built **only** from Wikipedia per-episode summaries for episodes
**≤ that boundary** — never later rows, never a season/series "overall plot" section. This is the whole product
promise; tests guard it. The `/recap` generation procedure reads Wikipedia's "List of episodes" / season
episode tables row-by-row up to the boundary, never prose that spans the whole season.

## Architecture — offline batch fills a read-only cache; the app only reads

**No Cloud Function. No runtime AI. No metered cost.** Two pieces only:

### 1. `/recap <show>` — offline Claude batch (the only writer)

A repo command run in a Claude Code session (Claude **Sonnet 5** via Malin's Max subscription → **0 kr
marginal**):
1. Resolve the show + full season/episode list; prioritise shows by reading the **already-stored**
   `insights/daily.topTitles` (filtered `mediaType:'tv'`) — **never** re-invoke the `collectionGroup('watchlist')`
   scan (DBA: that scan is budgeted 1×/day; widen N inside the existing daily `computeRollup()` if 10 is too few).
2. For **each** boundary `(s,e)`: fetch **per-episode** summaries for episodes **≤ (s,e)** from Wikipedia and,
   when a richer one exists, additional **CC BY-SA-compatible** wikis (Fandom/show wikis — most are CC BY-SA;
   **verify each source's licence footer and SKIP any all-rights-reserved source**, else the share-alike
   posture breaks). Stay strictly on **episode-specific** pages ≤ the boundary — never character or
   overall-plot pages (they span the whole series → spoilers). Generate a spoiler-bounded Swedish recap with
   an explicit **"paraphrase, never copy verbatim phrasing or track sentence structure"** instruction (Legal).
   Record every source used in `sources[]`; set the output `license` to the latest-compatible CC BY-SA version
   across them (3.0 → 4.0 is one-way compatible; license the combined output CC BY-SA 4.0).
3. **Human spot-check** a sample of each batch before upload (Security — cached-forever stakes).
4. Upload each recap via a **least-privilege Admin-SDK** script (`recaps/*` write only; service-account key
   never committed — explicit `.gitignore`; documented in the runbook) using the **shared**
   `buildAndValidateRecap()` sanitiser (below). Idempotent: skip boundaries already cached (`--force` to refresh).

### 2. Shared cache + client read

`recaps/{tmdbId}_{season}_{episode}` — top-level, **public read, no client write** (`allow read: if true;
allow write: if false` — mirrors `titleRatings`). Doc shape:

```
{
  tmdbId, season, episode,           // key parts
  text: string,                      // the Swedish recap (plain text)
  lang: 'sv',
  model: string,                     // e.g. 'claude-sonnet-5'
  sources: { name: string; url: string; license: string }[],  // every source used (≥1)
  license: 'CC BY-SA 4.0',           // the OUTPUT licence (latest-compatible of the sources' licences)
  generatedAt: Timestamp,
  schemaVersion: number,
}
```

Client: derive `(s,e)` from `episodeProgress`, read `recaps/{id}_{s}_{e}` (public), render on hit. React
Query in-memory only — **recap keys MUST NOT be added to `PERSISTED_QUERY_PREFIXES`** (per-title-per-episode
data would blow the 5MB localStorage limit — the standing rule).

## Sanitisation & security (Wikipedia is world-editable → untrusted)

One shared `buildAndValidateRecap()` used by generation + upload (no parallel paths):
- Treat Wikipedia extracts as **untrusted data**, clearly delimited in the prompt; instruct the model to ignore
  any instruction-like content inside them.
- Output enforced as **plain text**: length cap; strip/reject HTML, markdown, URL-like substrings, and
  injection meta-strings; basic Swedish/on-topic heuristic. Client renders as plain text — **never**
  `dangerouslySetInnerHTML` or a markdown renderer for this field.
- **Report + purge path:** a lightweight "rapportera sammanfattning" affordance (reuse the `submitReport`
  pattern) + a documented runbook procedure to purge/regenerate a bad recap doc (only Admin SDK can write).

## Attribution & legal (CC BY-SA conservative — Malin's decision)

- Per-recap `RecapSourceCredit` (visual twin of `JustWatchCredit`, 11px `--ink-3`), driven by `sources[]`:
  **"Källa: …"** (one source) / **"Källor: …"** (several, joined with "och"), each source name linking its
  `url` and a licence link to `creativecommons.org/licenses/by-sa/4.0/`, plus **"bearbetad"** (changes-made
  indication) — CC BY-SA requires source + licence + link + indicate-changes, next to the content (not
  footer-only). Every source in `sources[]` must be CC BY-SA-compatible (enforced at generation time).
- **Share-alike accepted:** binge's recap text is itself CC BY-SA 4.0 (others may reuse it with attribution +
  share-alike). Recorded as an ADR. No TMDB attribution needed on the recap (no TMDB content in it).
- No-verbatim-copy prompt instruction (above). Plot facts aren't copyrightable; the risk is close paraphrase,
  which the instruction + spot-check mitigate.

## Privacy (DPO)

- **No personal data reaches any AI** — only public Wikipedia text + integer episode numbers; the recap docs
  contain zero user data (absent from `collectUserDataSnapshots` — no export/deletion impact).
- **Light Anthropic disclosure** in the privacy policy §4 (following the TMDB precedent): named, offline batch,
  public metadata only, no personal data, no DPA needed. **No Gemini entry needed** (no runtime Gemini).
  Wikipedia needs no §4 entry (content source, not a processor) — its disclosure is the per-recap attribution.
- **No TMDB §1.C retention conflict** — recaps are Wikipedia-derived, not TMDB Data, so the 6-month caching
  ceiling does not apply. Recap docs are durable-forever (DBA: no TTL, same class as `titleRatings`).

## Testing

- **Spoiler boundary (critical):** pure function assembling the ≤-boundary Wikipedia episode set NEVER includes
  an episode past the boundary — property-tested across season rollovers, E1 boundaries, gaps.
- Sanitiser: rejects HTML/markdown/URL/injection-string inputs; caps length; plain-text out.
- Rules: `recaps` public-read / no-client-write (emulator test).
- Client: button visibility gated strictly on cache-hit + in-progress state; renders plain text; no persist.
- `/recap`: idempotent skip; Wikipedia sourcing stays ≤ boundary; shared sanitiser path.

## Implementation plan (phased, in order)

**P1 — Data + rules (backend-lite).** `recaps` collection rules (public-read/admin-write) + emulator test; the
recap doc schema/types. *Sensitive (rules): security marker.*

**P2 — Pure core (TDD).** `boundary.ts` (assemble ≤-boundary Wikipedia episode set — the invariant),
`buildAndValidateRecap()` sanitiser, `recapDocId(tmdbId,s,e)`. Full unit + property tests. Admin-free (root
runner).

**P3 — `/recap` command + upload script.** The Claude-session command: resolve show, read stored `topTitles`
for prioritisation, fetch Wikipedia per-episode ≤ boundary, generate (Sonnet 5, no-verbatim prompt), spot-check,
upload via least-privilege Admin SDK using the P2 sanitiser. Runbook (creds, purge/regenerate, spot-check gate).

**P4 — Client surface.** `RecapButton` (gated on cache-hit + in-progress) on show page + calendar entry;
recap panel: boundary line → "AI-genererad sammanfattning" kicker (above) → plain-text prose → accuracy caveat →
`RecapSourceCredit`; "rapportera sammanfattning" affordance. Swedish copy per Tech Writer.

**P5 — Compliance + docs.** Privacy-policy §4 Anthropic entry; ADR for the CC BY-SA share-alike posture;
`voice-and-tone.md` "sammanfattning" registration; data-retention-policy note (durable-forever, Wikipedia-derived).

**Cost:** 0 kr runtime (no Cloud Function, no metered AI). Claude batch is 0 kr marginal (subscription).
Firestore: public-read single-doc gets + admin batch writes — negligible, well inside 25 SEK/mån.

## Non-goals (YAGNI)

No movie recaps. No runtime/on-demand AI generation (offline batch only). No Gemini tier. No TMDB content to the
AI. No long-tail coverage (Wikipedia-covered popular shows only). No IMDB (prohibited — needs a commercial
AI-synthesis licence from IMDb/Amazon to ever reconsider). No binge-specific most-tracked rebuild (reuse stored
`topTitles`). No auto-generation on show-open (button = explicit read).
