# Sprint 2026-07-13 — Selection

**Outcome: no tickets selected for build.** Linear MCP connected, project "Binge" scoped
throughout. The full open backlog (Backlog/Todo/In Progress states) is 7 tickets; every one
of them is either ops-blocked (needs Malin's console/credentials/account action, no code to
write) or a speculative "idea"-labeled feature / explicitly-deferred workstream she hasn't
approved. Per the sprint skill: "an all-build-review/needs-approval batch is a valid outcome
— never manufacture build work to fill N." N = 0 here, honestly.

3 further tickets (BIN-468, BIN-459, BIN-402) are already "In Review" — mid-flight from a
prior sprint, not re-selected.

## Needs you (surfaced, not built)

- **BIN-454** — tmdbFieldsSweep rollout runbook (deploy rules → dry-run → record cost → flip
  `mutateEnabled`). Ops runbook requiring live Firebase Console access + a cost-judgment call,
  AND explicitly blocked until BIN-402's freshness-stamp defect is fixed first. Recommend:
  hold: fix the BIN-402 defect, then you run the Console flip yourself per the ordered steps
  (memory is explicit — do not auto-flip `mutateEnabled`).
- **BIN-173** — Affiliate-tag rent/buy deeplinks. Code plumbing already shipped 2026-07-12
  (fabf1b0) — `affiliateWrap` is wired at all 3 render sites, currently a no-op passthrough.
  Remaining scope (real per-network deeplink templates + "Annonslänk" disclosure UI) is
  blocked on you creating the Adtraction account; building the disclosure UI before real
  tagging exists would mislabel plain links as ads. Recommend: revisit once the account
  exists — nothing to code today.
- **BIN-447** — Person-filmography SEO surfaced after Cloudflare purge (BIN-423 follow-up).
  No code change — the fix is self-healing on the next weekly TMDB refresh (~today), the
  remaining step is a Cloudflare purge for binge.nu + a curl verification, which needs CF
  credentials this session doesn't have configured for binge (the `/purge` skill here targets
  synat.se). Recommend: run a purge after today's refresh finishes, or let it resolve for free
  on your next `/commit`-driven deploy (auto-purges).
- **BIN-189** — Seasonal challenges ("Nordic Noir November" etc.). Speculative "idea"-labeled
  feature, Low priority, no mockup/spec. Your call whether it's worth a design pass.
- **BIN-170** — "Binge Wrapped" year-in-review. Speculative "idea"-labeled feature, Low
  priority, no mockup/spec. Your call.
- **BIN-461** — Genre hub pages (`/genre/[slug]`). Ticket body already records your decision:
  "build as its own workstream, not now." Left untouched — re-propose only if you want it
  scheduled.
- **BIN-419** — SEO content-floor before/after re-measurement. Due 2026-08-28, over a month
  out — nothing actionable yet. Recommend: leave in backlog, revisit near the due date.

## Obsolete

None — no open ticket's fix was found already shipped under a different id.

## Post-sprint steps

None (no batches, no commit, no push, no Linear transitions this cycle — the 7 backlog
tickets above stay in Backlog, untouched, since none were selected).

---

# BIN-185 follow-up — nearest-earlier recap fallback (Malin's request 2026-07-12)

**Goal:** if the user's exact boundary has no recap, show the nearest EARLIER covered boundary's recap
with a note "informationen från de senaste X avsnitten saknas". Spoiler-safe by construction (earlier ⊂ watched).

## No architecture-changing unknowns
- No rules change: per-show index doc lives INSIDE recaps/ as `recaps/{tmdbId}_index` (matches the existing
  public-read/admin-write wildcard; id can't collide — real recap ids are int_int_int). DBA's
  no-`.where()`-queries condition holds: client does two direct doc gets (index → recap).
- Uploader maintains the index (merge on upload + `--index-only` backfill mode). Client: pure
  `nearestCoveredBoundary` helper (TDD; must NEVER return a boundary > the user's), useRecap 2-step fetch,
  RecapPanel gap note. Backfill Grey's index from the 22 local season files.

## Work
- [ ] Pure helpers (coverage.ts): parse index doc, nearestCoveredBoundary (spoiler-safety test-locked), TDD.
- [ ] Uploader: write/merge `recaps/{tmdbId}_index` + `--index-only` mode.
- [ ] useRecap: index-first fetch; return recap + coveredBoundary. RecapPanel: gap note (Swedish).
- [ ] Backfill Grey's index; gates (code/test/security reviewers + /code-review); commit/push; verify.

---

# BIN-185 — spoiler-safe catch-up recaps (in-session phased build)

**Status:** approved design + 5-role panel (spec `docs/superpowers/specs/2026-07-12-bin185-spoiler-safe-recaps-design.md`).
Wikipedia-only (no TMDB→AI). In-session phased build (Malin chose over autonomous sprint).

## No architecture-changing unknowns
Design settled. Assumptions: public-read/admin-write `recaps/{tmdbId}_{s}_{e}` cache; offline Claude batch is
the only writer; client reads only; no runtime AI/cost; CC BY-SA conservative posture.

## Phases
- [x] P1 — recaps rules (public-read/admin-write) + rules tests + doc types. SHIPPED (78f8bea, rules live).
- [x] P2 — pure core: boundary.ts (spoiler invariant), sanitize.ts (plain-text guard), types.ts. SHIPPED.
- [x] P3 — `/recap` batch (`functions/scripts/recap-upload.mjs`) + least-privilege `recaps-writer` SA
      (created by Malin, roles/datastore.user) + runbook. SHIPPED.

## GO-LIVE (2026-07-12)
Malin created the service-account key; I generated + uploaded Grey's Anatomy S1 (tmdbId 1416, 9 spoiler-safe
Swedish recaps, Wikipedia-sourced, CC BY-SA), iterated the voice + medical terms (AT-läkare / överläkare /
ST-läkare / kirurgichef) on her feedback, re-uploaded. Now flipping `RECAPS_ENABLED = true` in
`src/lib/recaps/config.ts` to make the "Påminn mig var jag slutade" button live on Grey's. Also committing the
ops-script relocation to `functions/scripts/` (so firebase-admin resolves) + runbook path update + gitignore.
No architecture change — one-line flag flip on the already-reviewed feature + committed tooling.
- [x] P4 — client: `lastWatchedBoundary` (progress.ts), `useRecap` hook (in-memory only), `RecapPanel`
      (button + "AI-genererad sammanfattning" kicker above prose + accuracy caveat + `RecapSourceCredit`),
      wired into TVShowPageClient (in-library shows). Dormant until P3 seeds recaps.
- [x] P5 — compliance: privacy §4 Anthropic entry (Gemini NOT extended — runtime tier was cut); ADR 0011
      (CC BY-SA share-alike); voice-and-tone "sammanfattning"; retention note (durable-forever, Wikipedia-derived).

## Deferred / notes
- User-facing "report a recap" affordance needs a submitReport functions change (new `recap` target type) —
  fast-follow. Detection net for now = per-batch spot-check (P3) + purge/regenerate runbook.
- Calendar-entry RecapPanel placement — fast-follow (show page done).
