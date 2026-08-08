---
name: recap
description: Use when Malin asks to seed spoiler-safe recaps for a TV show — "/recap <show>", "/recap <show> season N", "do <show>", "seed recaps", "/recap N shows", or plain "/recap" (then pick from binge's most-tracked shows). Runs the whole BIN-185 pipeline end to end, in parallel across shows by default.
---

# /recap — seed spoiler-safe recaps for a show

Generate + upload Swedish episode recaps for the `recaps/` cache that powers binge's
"Påminn mig var jag slutade" button. Deep reference: `docs/recaps/RUNBOOK.md`.
Everything runs in-session on the Max subscription — 0 kr. No deploy needed; recaps
are live the moment the upload finishes.

**Model:** the recaps are written by the SESSION model (no API call is made). The
cost-efficient choice is **Sonnet 5** — summarisation with good Swedish prose doesn't
need Opus/Fable, and Sonnet is far lighter on the subscription's usage limits. If the
session is running a heavier model when /recap is invoked, tell Malin she can switch
with `/model sonnet` first (or proceed if she says go). Whatever actually generates
the text is what goes in the `model` field below — record the real generator, never
a hardcoded label. Same applies to every subagent a batch run spawns — it inherits
the session model, don't override it.

## Default mode: parallel batch via Workflow (decided 2026-07-24)

**Any request for more than one show — `/recap N`, `/recap N shows`, "do the next
batch", a `/loop /recap` continuation, or a bare `/recap` picking its own targets —
runs as a `Workflow` batch, never as a single agent working through shows one at a
time.** A solo agent checking candidates and writing each show serially is the slow
path: it was measured directly (2026-07-24) at roughly an hour of real time per
show/season, because Firestore existence-checks and full research-and-write passes
both happen sequentially in one thread. The proven fast path (first run 2026-07-16/17,
50+ shows in 3 rounds) is: one cheap discovery pass to build a candidate list, then
one subagent PER SHOW running concurrently. Reserve inline single-agent execution for
when Malin names exactly one specific show — that doesn't need orchestration overhead.

**Step A — refresh the coverage manifest FIRST, before checking anything else:**
```
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/malla/.secrets/recaps-writer.json \
  node functions/scripts/recap-coverage-manifest.mjs
```
This rewrites `docs/recaps/covered-shows.json` from Firestore truth via a cheap
`listDocuments()` scan (lists document IDs only — not billed as document reads) plus
one lightweight `get()` per index doc found. Read that file to get every already-
covered `tmdbId` in ONE local file read, instead of one `firestore_get_document` call
per candidate (60+ round trips were burned re-confirming already-done shows in a
single 2026-07-24 run before this manifest existed). **The manifest is a safe
allowlist for skipping (if it lists a tmdbId, it really is covered — it's rebuilt from
Firestore, not hand-maintained) but not authoritative for the negative case** — a
tmdbId's absence just means "not yet confirmed," most commonly because it's genuinely
new. Cross-check absentees against `docs/recaps/unsourced-shows.json` too (logged
unusable, skip without re-fetching Wikipedia) before treating them as real candidates.

**Step B — build the candidate batch** using the existing priority order (below):
regeneration backlog next-season pick, then uncovered `topTitles`, then TMDB-popularity
fallback — filtering every candidate against the freshly-refreshed manifest + the
unsourced log, applying the same judgment calls (skip procedurals/soaps/sitcoms/kids
content) documented under "TMDB popularity fallback" below. Stop once the batch hits a
reasonable size (10–50 shows has worked well; bigger batches cost more session usage,
smaller ones underuse the parallelism — use judgment, don't ask Malin to size it).

**Step C — dispatch via `Workflow`.** Call the tool with a script shaped like this
(adapt the candidate list and prompt text; this is a template, not a literal file to
load):
```js
export const meta = {
  name: 'recap-batch',
  description: 'Seed spoiler-safe recaps for a batch of shows in parallel',
  phases: [{ title: 'Generate', detail: 'one subagent per distinct show, concurrent' }],
}

// candidates: [{ tmdbId, title, note }] — already filtered against covered-shows.json
// + unsourced-shows.json by the coordinator before calling Workflow. One entry per
// DISTINCT show only — never split one show's seasons across multiple agents (see
// the same-tmdbId concurrency rule below; a single agent may still do several of ITS
// OWN show's seasons in one pass, e.g. a small show can finish all seasons at once).
const candidates = args.candidates

phase('Generate')
const results = await parallel(candidates.map((c) => () =>
  agent(
    `Run the /recap pipeline (.claude/skills/recap/SKILL.md, "Pipeline (per show)" ` +
    `section) for "${c.title}" (tmdbId ${c.tmdbId}). Wikipedia CC BY-SA sources only ` +
    `— never TMDB episode overviews (TMDB ToS bans feeding its data to an LLM). ` +
    `Verify TMDB episode numbering before writing boundaries. Produce self-contained ` +
    `text + textFull per boundary, season docs for completed seasons, spot-check your ` +
    `own output, then upload via functions/scripts/recap-upload.mjs (credentials: ` +
    `C:/Users/malla/.secrets/recaps-writer.json). Log any unsourced episodes per the ` +
    `skill's --unsourced convention. Report what you seeded.`,
    { label: c.title }
  ).catch((err) => ({ tmdbId: c.tmdbId, title: c.title, error: String(err) }))
))

return results.filter(Boolean)
```

**Step D — reconcile, don't trust self-reports.** After the wave finishes, re-run
`recap-coverage-manifest.mjs` once to see the real, current state — a per-show agent
that errors out (session-usage limit, transient API failure) may still have completed
its Firestore write before crashing on its own final report (this happened for 4 shows
in the first-ever batch run, per `[[project_bin185_recaps_planned]]`). Diff the
before/after manifest to know what actually landed, not what agents claimed. Tell
Malin the real count.

**Same-show concurrency is still a hard rule inside a batch:** never let two agents
touch the same `tmdbId` at once — the coverage index write is last-writer-wins, so
concurrent uploads to one show corrupt it. The Workflow script above already enforces
this by construction (`candidates` has distinct tmdbIds); don't add a second wave that
revisits a tmdbId already running in the same batch.

**Regeneration-backlog and new-show batches CAN run in the same parallel wave** — a
regen-backlog show (e.g. continuing Grey's Anatomy season-by-season) and N new shows
are all distinct tmdbIds, so one of the `candidates` entries can simply be "next
un-regenerated season of tmdbId X" alongside the rest.

## Pipeline (per show; chunk big shows one season per pass)

This is what EACH per-show subagent in a batch executes on its own — and what a
single agent runs directly when Malin names exactly one show.

1. **Resolve the show on TMDB** (`NEXT_PUBLIC_TMDB_API_KEY` from `.env.local`):
   confirm the tmdbId matches the show, and fetch the season/episode structure.
   **GOTCHA:** TMDB sometimes merges two-part episodes into ONE episode (Grey's S11
   "She's Leaving Home" = E22). Boundaries MUST follow TMDB numbering — verify the
   per-season episode list before writing anything.
2. **Check existing coverage:** read `recaps/{tmdbId}_index` (or the local
   `scripts/recaps/*.local.json` files). Skip boundaries already covered **AND
   already on the current schema** — read one boundary doc per season (e.g. its
   episode 1) from Firestore; `schemaVersion < 2` means that season still has the
   old single-episode-style recaps and needs a full redo pass (see "Regeneration"
   below), not a skip.
3. **Sources — CC BY-SA only:** Wikipedia season articles first; fan wikis as
   enrichment ONLY if you can fetch their licence page and it states CC BY-SA.
   **NEVER search wider into copyrighted recap sites** (Fandom usually 402-blocks
   WebFetch = licence unverifiable = skip). An episode with no usable source gets
   NO recap — log it:
   `node functions/scripts/recap-upload.mjs --unsourced <tmdbId> "<title>" <reason>`
   Reasons: `no-wiki` = no summary exists at all; `partial-coverage` = a summary
   exists but is too thin to paraphrase safely; `incompatible-license` = source
   found but not CC BY-SA. (The nearest-earlier fallback covers the gap in the UI.)
   **Season-level source, no per-episode breakdown at all** (a real, common shape —
   not a bug): don't guess which beat belongs to which episode. Write ONE `kind:
   'season'` entry from the season-level text (step 5) and upload with
   `--season-only` instead of any boundary entries for that season — see step 7.
4. **Write the recaps** — for EACH episode boundary, produce TWO fields from the same
   source read (no extra fetches):
   - `text` — the short digest (~450–550 chars) shown by default. **MUST be
     self-contained: a reader who remembers nothing since they stopped watching
     should be able to follow it.** Open with a brief clause of context per ongoing
     thread ("Mika, som lämnat sjukhuset efter [X], ...") BEFORE its newest
     development — never assume the reader remembers the prior episodes. This was
     the bug in the v1 recaps (they read as "what happened in this one episode,"
     e.g. "Mika är tillbaka" with no reminder of why she'd left) — don't repeat it.
   - `textFull` — a fuller "this season, up to my episode" recap (~1200–1800 chars),
     same self-contained requirement, more room for the season's ongoing threads.
     Powers the "Visa säsongens sammanfattning" disclosure.
   - Both: warm, natural Swedish — NOT translated-encyclopedia stiffness. First
     names. Paraphrase; never copy source phrasing. Plain text: no URLs/markdown/HTML
     (the validator rejects them).
   - Locked terms: **AT-läkare** (intern), **överläkare** (attending),
     **ST-läkare** (resident), **kirurgichef** (chief). Ask Malin for new domains.
     **Keep these consistent between `text` and `textFull` for the same boundary** —
     both are written in the same pass from the same source, so a character's title
     must not drift between the two fields.
5. **After finishing a season's boundary pass, write its season doc too** (skip this
   for the show's current/in-progress season — only COMPLETED seasons get one):
   one entry with `kind: 'season'`, a full self-contained recap of the whole season
   (~1200–1800 chars, same locked terms), plus `episodeCount` (the season's total
   episode count per TMDB — the upload script refuses the season doc unless every
   episode 1..episodeCount already has a boundary doc). Powers "Visa tidigare
   säsonger" for later seasons.
6. **Emit** `scripts/recaps/<show>-sN.local.json` (gitignored): a JSON array mixing
   both entry kinds —
   - Boundary: `{ tmdbId, season, episode, text, textFull, model: "<the session model that wrote the text>", sources: [{name,url,license:"CC BY-SA 4.0"}] }`
   - Season: `{ kind: 'season', tmdbId, season, episodeCount, text, model, sources: [...] }`
     (only for a season you just finished the boundary pass for).
7. **Spot-check** a sample yourself, then upload:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=C:/Users/malla/.secrets/recaps-writer.json \
     node functions/scripts/recap-upload.mjs scripts/recaps/<file>.local.json
   ```
   The script validates every entry, writes boundary + season docs, and updates the
   coverage index automatically. Season docs are written once — add `--force` only
   if you're deliberately re-baking a completed season's doc (e.g. a spot-check
   catches an error in it). **Season-only source (no boundary docs for that
   season):** add `--season-only` — the ONE case where a season doc is allowed
   without full per-episode coverage (a partial mix is still always refused). If you
   later find a per-episode source for a season already uploaded this way, uploading
   the full boundaries does NOT silently replace it — you'll be told to add `--force`
   to explicitly upgrade it.
8. **Verify + report:** confirm `N/N valid` (boundary) + `M season recaps valid` +
   `index updated`; read back one doc if in doubt. Tell Malin what's covered and
   what was gap-logged.

## Regeneration (BIN-185 story-so-far redesign, 2026-07-12)

All boundary docs generated before this redesign are `schemaVersion: 1` — single-
episode-style `text`, no `textFull`, no season docs. Malin approved a full
regeneration of every existing show, spread across multiple autonomous loop runs
(0 kr; this is a lot of Wikipedia re-reads and rewriting, not a quick pass).

- **Prioritise finishing regeneration over starting a new show.** Before picking a
  brand-new uncovered show (see "No args given" below), check whether any
  already-covered show still has `schemaVersion < 2` seasons (step 2's per-season
  doc check) — if so, continue that show's regeneration, one season per run, in
  season order. As of this redesign: **Grey's Anatomy (tmdbId 1416, 22 seasons,
  ~460 boundary docs) is the regeneration backlog** — none of it is on v2 yet.
- Regenerating a season = redo steps 3–7 for that season exactly as a fresh
  generation would (same Wikipedia sources, same boundaries) — the only difference
  is `text` now needs the self-contained rewrite and `textFull` is new. Boundary
  docs are always overwritten (no existence check), so this is safe to just re-run.
- Once a show's every season is on v2, generate its season docs too (step 5) for
  any completed season that doesn't have one yet.

## Hard rules

- `INDEX WRITE FAILED` → run the printed `--index-only` command IMMEDIATELY
  (uploaded recaps are invisible until indexed).
- Never run two uploads for the same tmdbId concurrently — including different
  seasons of one show (index merge = last-writer-wins). Sequential is always safe.
- No args given → build a BATCH (see "Default mode" above) in this priority order,
  and **never ask Malin to confirm any pick — this command runs unattended on a
  loop.** State the batch + tier breakdown in your final report so she can see what
  ran. **Always refresh `docs/recaps/covered-shows.json` first** (Step A above) and
  filter every tier against it — this replaces one-by-one `recaps/{tmdbId}_index`
  checks, which is what made early 2026-07-24 runs slow (dozens of Firestore round
  trips to re-confirm shows already known covered).
  1. **Regeneration backlog** — any show with `schemaVersion < 2` seasons still
     pending (see "Regeneration" above). One candidate slot in the batch continues
     it, one season per pass (a single agent can do several of that show's seasons
     in one turn if it's small — see "chunk big shows" above — just never split one
     show's seasons across separate PARALLEL agents).
  2. **binge's most-tracked** (insights `topTitles`, TV only, ranked by count desc),
     filtered against the manifest.
  3. **TMDB popularity fallback** (once tier 2 has no uncovered TV title left —
     Malin's goal is to eventually work through all relevant shows, not just her
     users' current watchlist snapshot): page through
     `GET /discover/tv?language=sv-SE&watch_region=SE&sort_by=popularity.desc&without_genres=10767,10763,10764,99&with_original_language=en`
     (excludes talk/news/reality/documentary; English-original tightens the pool —
     drop this last filter if the English pool ever dries up, non-English is still
     allowed for a well-covered prestige show). Walk the results in popularity
     order, filtering against the manifest AND `docs/recaps/unsourced-shows.json`
     (already checked and found unusable — don't re-fetch Wikipedia for it every
     run). Because tier 3 is an open-ended TMDB catalog rather than a fixed list,
     expect this tier to run indefinitely across many future `/recap` batches —
     that's the intent, not a bug. **As of 2026-07-24, the popularity list is
     heavily worked already** — 60+ titles across the first 12 discover pages were
     already covered before finding two genuine gaps (X-Men '97, House). Expect to
     page further (13+) or drop the language filter before finding fresh candidates;
     budget batch-building time for that.
     **Use judgment on the page, don't mechanically grab the literal first result.**
     Popularity-sorted results skew toward two poor fits: ultra-long-running
     procedurals (Law & Order: SVU, Criminal Minds, The Mentalist — episodic not
     serialized, so a "story so far" recap adds little, and per-episode Wikipedia
     coverage is spotty across hundreds of episodes) and non-English soaps/anime
     with no realistic English Wikipedia per-episode coverage. Skim the page for
     the best real candidates (prestige serialized drama, plausible Wikipedia depth)
     instead of burning a full check-and-log cycle on every low-value one in order.
