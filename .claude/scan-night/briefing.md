# scan night — agent briefing (binge, 2026-07-24)

You are one of three scoped scanners in an unattended overnight backlog scan of Binge,
a Next.js + Firebase streaming-watchlist app. You do NOT write code and you do NOT create
tickets. You return findings. Someone else files them.

## Step 0 — read these first (mandatory)

1. `.claude/linear-tracker.json` — ~222 already-filed ticket ids → titles. Grep it for your
   candidate's key nouns before reporting. Near-match (same verb + same target) → DROP and
   say which id it duplicates.
2. Any `accepted-deviations`-style file under `.claude/rules/` if one exists — decided
   deviations are out of bounds.

## HARD EXCLUSION — a parallel session has work in flight

These paths are uncommitted/staged right now. Someone is actively editing them. **Do not
report findings in any of them** — the code you read may be half-written:

```
functions/src/tmdbTosSweep/index.ts        functions/src/tmdbTosSweep/runSweep.ts
functions/src/weeklyDigest/index.ts        functions/src/weeklyDigest/logic.ts
functions/src/weeklyDigest/logic.test.ts   src/app/settings/import/page.tsx
src/components/franchise/CompanionSection.tsx
src/components/onboarding/OnboardingFlow.tsx
src/components/pages/MoviePageClient.tsx
src/components/pages/TillsammansSessionPageClient.tsx
src/components/title/CollectionSection.tsx src/components/title/QuickAddButton.tsx
src/components/title/SeenPosterCard.tsx    src/components/title/StatusButton.tsx
src/hooks/useMarkSeen.ts                   src/hooks/useMySessions.ts
src/hooks/useOptimisticMirrorField.test.ts src/hooks/useStreamingOffers.ts
src/hooks/useStreamingOffers.test.ts       src/lib/firebase/sessions.ts
src/lib/together/matching.ts               src/lib/together/matching.test.ts
src/lib/watchlist/buildAddPayload.ts       src/lib/watchlist/buildAddPayload.test.ts
src/test/rules/tmdb-sweep-orchestrator.test.ts
src/types/social.ts
```

Reading them for context is fine. Filing against them is not.

## What counts as a finding — two classes, two gates

### Class A: DEFECT (`Bug` / `security` / `performance` / `test-gap` / `tech-debt`)
Gate: a correctness, security, data-integrity, cost, or resource bug **confirmed at a real
`file:line` you opened and read**, with a **stated failure path** — concrete inputs or
state → wrong output, crash, data loss, exposure, or runaway spend. "Looks fragile" is not
a finding.

### Class B: FEATURE GAP (`idea`)
Gate: must cite an **anchor**, quoted at `file:line` — a `TODO`/`FIXME` in production code,
a half-built path nothing calls, data captured but never surfaced, or a flow dead-end. No
anchor → do not report. Do not invent product ideas.

## Cost is a first-class concern here
Binge runs on paid third-party APIs (TMDB, and a RapidAPI streaming-availability quota that
has already hit 85% of its allowance). An uncounted API call, a missing budget reservation,
an unbounded fan-out, or a cache tier that silently misses is a real defect, not a nitpick.

## Adversarial self-check (mandatory, per finding)
Try to DISPROVE your own finding before reporting: is the guard elsewhere? is the caller
already checking? is it dead code? test-only? Discard what you cannot confirm by reading
the code. Prefer 2 confirmed findings over 8 guesses.

## Aggregation
Same issue in N files = ONE finding listing every site.

## Output format (return ONLY this, no preamble)

```
### <verb-first title naming the file or surface>
CLASS: defect | gap
TYPE: Bug|security|performance|test-gap|tech-debt|dependency|idea
AREA: <one or more of: frontend watchlist streaming social auth data seo infra>
PRIORITY: urgent|high|medium|low
ANCHOR: path/to/file.ts:123  (+ a <=2 line verbatim quote)
FINDING: what is wrong, where, how it manifests
FAILURE PATH: concrete inputs/state -> wrong outcome   (defects only)
WHY IT MATTERS: 1-2 sentences
SUGGESTED FIX: smallest root-cause change
DISPROOF ATTEMPT: what you checked to try to kill it, and why it survived
DEDUP: checked tracker for "<terms>" — no match | duplicates BIN-XXX (then DROP)
```

End with `SCANNED:` and `NOTHING-FOUND:` lines.

Hard cap: 5 findings.
