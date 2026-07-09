# Sprint 2026-07-09 (b) — bundle-arbitrage resilience + test-guard follow-ups

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 9 open tickets (Todo/In Progress both
empty). Only 2 clear a "build" mandate. The other 7 are unchanged or newly-arrived
variants of the same honest reads from the last two sprints: still gated on a
date/cache event, or still genuinely Malin's call. No manufactured work to fill
N — a small batch is the correct call here.

## Agent A — streaming (bundle-arbitrage diff follow-ups, round 2)

Both tickets trace back to the BIN-430 ship. Files are disjoint (page/hook vs. a
design-system test file) so there's no patch-conflict risk running them in one
batch/one agent.

- [ ] **[Tier A] BIN-442** — Bundle-arbitrage card hidden during a TMDB outage —
  decouple it from the `providers.length === 0` empty-state guard. Recovered by
  BIN-440's investigation (interactive binge-test-reviewer, 2026-07-09): the hook
  deliberately keeps `bundleSuggestions` alive through a cold-cache TMDB outage
  (`useSubscriptionAdvisor.ts:489-506`), but `src/app/savings/page.tsx:200` early-
  returns the "Inga tjänster tillagda än" empty state before
  `<BundleArbitrageCard>` ever mounts (`:259`) whenever `advisor.providers` is
  empty — including the outage case, where the emptiness is an artifact of the
  error path, not a genuine no-services user. Result: a user who owns ≥2
  bundle-eligible services sees a false "you have no services" screen during an
  outage, and the panel that was engineered to survive exactly this never shows.
  - Disposition: **build** (real, narrow, non-blocking correctness/resilience
    bug with a clear, already-investigated fix; not a design/product pivot).
    Scope is deliberately capped to the guard fix — the ticket's "ideally
    distinguish outage state from genuine no-services state with new outage
    copy" idea is an explicit "ideally" stretch goal, OUT of scope here to keep
    this Tier A; file a follow-up if that copy nuance is still wanted after this
    ships.
  - Router: `node docs/org/route.mjs --md` → tier **medium** (single) · owning
    role **#28 Recommendations / Scoring-Integrity Engineer** (same role
    attached to BIN-430/433/440).
  - requiresPlanMode: **false** (single + priority Medium(3), not ≤2, no
    security label).
  - Files:
    - `src/app/savings/page.tsx` (~200, ~259 — render `BundleArbitrageCard`
      independent of / above the `providers.length === 0` guard, gated on
      `advisor.bundleSuggestions.length > 0` instead)
    - `src/app/savings/page.test.tsx` (new — no existing test file for this
      page; regression test per the ticket's missing-seam call-out)
    - `src/hooks/useSubscriptionAdvisor.ts` (read-only reference unless the
      gating condition needs a small export/shape tweak — don't touch its
      `bundleSuggestions`/`hasError` computation logic)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. `BundleArbitrageCard` renders whenever `advisor.bundleSuggestions.length
       > 0`, even when `advisor.providers.length === 0` (outage case) — proven
       by a new test that stubs `useSubscriptionAdvisor` to
       `{ providers: [], hasError: true, bundleSuggestions: [oneSuggestion], … }`
       and asserts the card is present.
    2. The genuine no-services case (`providers: [], bundleSuggestions: []`)
       still shows the existing "Inga tjänster tillagda än" `EmptyState`
       unchanged — proven by a test (or the existing behavior left untouched
       and explicitly asserted).
    3. No new outage-specific copy/messaging is introduced — the "ideally
       distinguish outage vs. no-services" idea is explicitly deferred (grep:
       no new string literals about outages/errors added to `page.tsx`).
    4. `npm run typecheck` and the scoped test suite
       (`src/app/savings/page.test.tsx`, `useSubscriptionAdvisor*`,
       `BundleArbitrageCard.test.tsx`) stay green;
       `src/lib/advisor/bundleArbitrage.ts` is not touched.

- [ ] **[Tier A] BIN-441** — Decide + close the deferred BIN-439 sub-scope: a
  savings-cluster-specific design-token guard in `consistency.test.ts`. The
  existing broad scan (`src/lib/design/consistency.test.ts`) already covers all
  of `src/components` for the 18px-title anti-pattern and raw-Tailwind-red
  usage, so `BundleArbitrageCard` (`src/components/savings/*`) is only loosely
  covered, not uncovered. Ticket frames two valid closes: add a savings-cluster-
  specific assertion, or close as intentionally-deferred (broad scan judged
  sufficient).
  - Decision: add the specific assertion — it's a low-risk, additive test-only
    change (belt-and-suspenders) and directly satisfies what BIN-439's own note
    asked for, rather than re-litigating whether the broad scan is "enough."
  - Disposition: **build** (test-gap closure, no product/UI decision — the
    ticket's only two options are both engineering-only).
  - Router: `node docs/org/route.mjs --md` → tier **medium** (single) · owning
    role **#1 Product Designer / UX** (design-system consistency guard).
  - requiresPlanMode: **false** (single + priority Low(4)).
  - Files:
    - `src/lib/design/consistency.test.ts` (extend — add a
      `src/components/savings/*`-scoped assertion alongside the existing
      broad-scan checks; follow the file's existing `tsxFilesIn`/
      `tsxFilesRecursive` + regex-offender pattern)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. A new assertion in `consistency.test.ts` scans specifically
       `src/components/savings/*.tsx` for the same banned patterns already
       checked broadly (18px-title anti-pattern and/or raw-Tailwind-red), so
       that cluster's compliance is explicitly pinned, not just incidentally
       covered.
    2. `BundleArbitrageCard.tsx` (and the rest of `src/components/savings/*`)
       passes the new assertion with zero offenders — no source file in that
       directory is modified to make the test pass (the guard should already
       be clean; if it isn't, that's a real finding to fix, not to weaken).
    3. The existing broad-scan tests in the same file are untouched and still
       pass — this is additive, not a replacement.
    4. `npm test -- consistency` (or the full suite) stays green; no change to
       `bundleArbitrage.ts` or `useSubscriptionAdvisor.ts`.

## Not selected (mandate / gating — surfaced, not built)

- **BIN-447** (SEO/infra, Medium) — Cloudflare-purge backstop for BIN-423 WP3
  person-filmography static HTML. Mandate is clear (Malin filed it herself as a
  backstop) but it is genuinely **not actionable today**: the build cache only
  re-seeds person entries past their 6-day freshness window at the next weekly
  scheduled refresh (~2026-07-13); running the purge now would be a no-op since
  nothing has re-seeded yet. Recommendation: **do it — just not yet.** Revisit
  ~2026-07-13; note any `/commit`-driven deploy before then auto-purges
  everything and may resolve this for free. The ticket's "optional durable fix"
  (add a Cloudflare-purge step to `deploy.yml` for scheduled/cron deploys) is a
  separate, sensitive-domain change (deploy/hosting/Cloudflare-CDN config is
  explicitly called out in CLAUDE.md as needing a written plan + go-ahead) —
  recommend scoping that as its own approved ticket if wanted, not bundled here.
- **BIN-419** (SEO measurement, Low) — explicit due date 2026-08-28, not due for
  ~7 more weeks; building the before/after measurement now would just measure
  too little elapsed time. Recommendation: leave parked; revisit near the date.
- **BIN-424** (SEO hub-topology review, Low) — the ticket says "evaluate after
  WP1-3 ship"; WP1 (ff93b43) and WP2/3 (BIN-422/423, shipped b72c799 earlier
  today) are now all live, so the gate has technically cleared. But the ticket
  itself is a scoping *review* of three separate new-URL-surface ideas
  (hub-of-hubs page, genre hub pages, `/forsvinner/[id]` server-rendering), each
  needing its own product/keyword-targeting call before it becomes a buildable
  ticket — it is not itself a code change. Recommendation: worth a scoping pass
  now that the gate cleared, but that scoping session is Malin's call to
  schedule, not something to silently build into existence this sprint.
- **BIN-173** (affiliate-tag rent/buy deeplinks, Medium) — real revenue
  opportunity but a business/legal call (affiliate program terms, disclosure
  copy, which networks) Malin hasn't greenlit. Recommendation: worth doing,
  needs her decision on which affiliate program(s) first.
- **BIN-360** (targeted "släpps idag" FCM push, Low) — a new push-notification
  channel; UX/consent call (frequency, opt-in default) she should weigh in on
  before it's built. Recommendation: build a small opt-in proposal for her to
  react to, not a silent ship.
- **BIN-185** (spoiler-safe catch-up recaps, Low) — new AI-generated-content
  feature; spoiler-boundary trust is high-stakes if wrong, needs a design/UX
  pass first. Recommendation: worth exploring, needs a design spike before it's
  a ticket that builds itself.
- **BIN-170** (Binge Wrapped year-in-review, Low) — new shareable feature,
  needs a design pass (what stats, what the share-card looks like).
  Recommendation: fun, low urgency; revisit as a themed mini-sprint closer to a
  natural moment (December/new year) rather than now.

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.
(BIN-447 is time-gated, not credential-blocked, so it's filed above instead.)

## Post-sprint steps

- [ ] Phase 2: implement BIN-442 then BIN-441 (correctness fix before the
  test-only guard add), TDD where the fix lands, `npm run typecheck` + `npm
  test` scoped to `savings/page*`, `useSubscriptionAdvisor*`,
  `BundleArbitrageCard`, and `consistency.test.ts`.
- [ ] Phase 2.7: fresh-context verifier grades the acceptance criteria above
  from diff + tests only, per ticket.
- [ ] Phase 3: commit (code-reviewer + test-reviewer markers — no security
  marker, no firebase/rules/functions paths touched), push (push triggers
  deploy). Both are clean Tier A builds → Done on all-pass; back to Todo only
  if a criterion can't be closed in-session.

---

# Archived — Sprint 2026-07-09 (a) — BIN-430 traceability follow-ups

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 10 open tickets. Only 2 clear a "build"
mandate — both are BIN-430 follow-ups filed by the post-sprint completeness sweep.
The other 8 are unchanged from the 2026-07-07 sprint's honest read: still gated,
still not due, or still genuinely Malin's call (see "Not selected" below). No
manufactured work to fill N — a small batch is the correct call here.

## Agent A — streaming (BIN-430 diff follow-ups)

Both tickets touch the same three files from the BIN-430 ship (untested wiring +
an unresolved reviewer note on the same diff), so they run as ONE batch/one agent,
sequenced, to avoid file-conflict risk between "investigate + maybe fix" and
"add test coverage" landing on the same lines.

- [x] **[Tier A] BIN-440** — Recover the test-reviewer's lost medium production-code
  correctness note from the BIN-430 ship. Real bug found and fixed → BIN-442
  filed for the actual fix (decouple bundle card from providers-empty guard).
- [x] **[Tier A] BIN-439** — Add hook-level test coverage for the untested
  `bundleSuggestions` `useMemo` in `useSubscriptionAdvisor.ts`. Shipped; a minor
  deferred sub-scope (savings-cluster-specific design-token guard) split out to
  BIN-441.

## Not selected (mandate / gating — surfaced, not built)

Unchanged from the 2026-07-07 read — re-checked against today's backlog, nothing
has moved:

- **BIN-422/BIN-423** (SEO internal-linking WP2/WP3+WP4) — shipped this session
  (b72c799) — see the new sprint above.
- **BIN-424** (SEO hub-topology review) — the ticket itself says "evaluate after
  WP1-3 land"; WP2/3 haven't shipped yet (see above). Not yet scoped. Recommendation:
  revisit once BIN-422/423 ship.
- **BIN-419** (SEO re-measure content-floor impact) — explicit due date
  2026-08-28, not due for ~7 more weeks. Recommendation: leave parked; a
  reminder/cron could pick this up near the date.
- **BIN-173** (affiliate-tag rent/buy deeplinks) — real revenue opportunity but a
  business/legal call (affiliate program terms, disclosure copy, which networks)
  that Malin hasn't greenlit. Recommendation: worth doing, needs her decision on
  which affiliate program(s) first.
- **BIN-360** (targeted "släpps idag" FCM push) — a new push-notification channel;
  UX/consent call (frequency, opt-in default) she should weigh in on before it's
  built. Recommendation: build a small opt-in proposal for her to react to, not a
  silent ship.
- **BIN-185** (spoiler-safe catch-up recaps) — new AI-generated-content feature,
  needs a design/UX pass (spoiler-boundary trust is high-stakes if wrong).
  Recommendation: worth exploring, needs a design spike before it's a ticket that
  builds itself.
- **BIN-170** (Binge Wrapped year-in-review) — new shareable feature, needs a
  design pass (what stats, what the share-card looks like). Recommendation: fun,
  low urgency; revisit as a themed mini-sprint closer to a natural moment (e.g.
  December/new year) rather than now.

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.

Post-sprint completeness sweep filed two follow-ups now archived in the sprint
above: BIN-440 (lost test-reviewer note) and BIN-439 (hook-level test gap).
