# Two-scans-per-specialist coverage — 2026-06-27

Goal: 2 verification passes over each of 28 role-domains (ownership-map.json).
Round 1 = defect lens (correctness/security/data-integrity). Round 2 = quality+opportunity lens.

## Round 1 (defect lens)
### Wave 1 — roles 1-7 — DONE
Filed: BIN-275 (auth/terms google-sso), BIN-276 (rules owner-branch immutability),
BIN-277 (reporterUid retention), BIN-278 (ConfirmDialog a11y), BIN-279 (rules deny-path tests).
Discarded: session-swipes unauth = DUP BIN-24; group-doc inviteTokenHash read = documented-intentional.
Held (low/unverified, revisit): episodeNotify unbounded collectionGroup+serial TMDB fetch (role3 Financial),
ToastContext aria-atomic + missing dismiss (role2 a11y), SegmentError aria-live contradiction,
DuotonePoster optional width/height CLS, subnav top:0 overlap, consistency.test regex word-order.

### Wave 2 — roles 8-14 — pending
### Wave 3 — roles 15-21 — pending
### Wave 4 — roles 22-28 — pending

## Round 2 (quality+opportunity lens) — pending all

### Wave 2 — roles 8-14 — DONE
Filed: BIN-290 (advisor enabled fan-out), BIN-291 (semaphore abort), BIN-292 (targetOwnerUid framing),
BIN-293 (fn fetch timeouts), BIN-294 (notify unbounded scans), BIN-295 (parseSearch/countries precision).
Discarded after verify: firebase.json /_/index.html rewrite = VALID (out/_/index.html exists, prod works);
security headers PRESENT (CSP/HSTS/XFO); setup-node@v6/checkout@v6 (CI green→resolve); notified-counter race (cosmetic);
streamingOffers 'offers' read (offers IS used for leavings).
Held: action-hosting-deploy@v0 pin (Low), next-cache key (Low), preview gates (design), tvSubState ikapp edge (PM),
migrateStatus film default (Low), feed empty-state count (T&S), updateReportStatus actionedBy (T&S audit),
updateProgress stale-status race + addItem merge (SWArch Low).

### Wave 3 — roles 15-21 — DONE
Filed: BIN-305 (sitemap /savings/), BIN-306 (og:image SVG), BIN-307 (social counters stale),
BIN-308 (settings unconditional toast), BIN-309 (legal copy drift), BIN-310 (docs drift).
Self-corrected by agents (good): CSV rating math OK, login OK, "avsnitt" invariant OK.
Discarded: setup-node@v6 again (CI green→resolves). Held: globals.css topbar border var(--ink) (maybe intentional),
Plausible shim beforeInteractive (subtle), sitemap lastModified hygiene, AppTopbar search combobox a11y+Escape (unverified),
manifest screenshots, taste isUsableVector all-negative (subtle), deleteComment !uid guard, email banner same-tab verify.

### Wave 4 — roles 22-28 — DONE
Filed: BIN-318 (taste avbruten weight), BIN-319 (backfill updatedAt clobber), BIN-320 (MOTN budget),
BIN-321 (titleRatings throttle), BIN-322 (cheapestPath tiers), BIN-323 (dependabot/CLAUDE.md).
Discarded after verify: watchlist/effectiveVisibility index (single-field auto-indexed, no composite needed);
collection-group __name__ indexes (auto-indexed, retentionCleanup comment confirms); @v6 again (builds run 12-18min→resolve);
communityRatings idempotency (agent retracted); rowComposition exhaustion + cascadePrioritizer NaN (agent retracted).
Held: deploy.yml false-failure (KNOWN per memory reference_deploy_false_failure), askbinge todayId UTC (Low),
Data Analyst histogram/zeroResults (Low), Monetization costFor contract + free_library null (design),
DBA usePublicProfile cast + step-3 fallback (speculative/rules-dependent), IA nav/route doc nits (Low),
composeSimilarPool dedup (Low, downstream dedupeAndExclude covers).

## ===== ROUND 1 COMPLETE: 28/28 specialists, 23 tickets (BIN-275..323) =====
## ===== ROUND 2 (quality+opportunity lens) starting =====

### ROUND 2 Wave 1 — roles 1-7 (quality lens) — DONE
Filed: BIN-324 (design guard scope), BIN-325 (toast aria-atomic+tests), BIN-326 (rollup retention+test),
BIN-327 (groups rules cap+tests), BIN-328 (export/delete completeness test), BIN-329 (joinAttempts deletion+reactions retention),
BIN-330 (matching/similarity/genreMapping tests). Deduped: reporterUid retention = BIN-277.

### ROUND 2 Wave 2 — roles 8-14 — DONE
Filed: BIN-331 (deploy false-RED), BIN-332 (WatchlistContext untested), BIN-333 (cineasterna checkpoint test),
BIN-334 (updateReportStatus audit), BIN-335 (tvSubState/labels), BIN-336 (useCalendar memo).
Held: CI bundle-size gate (Low), parseSearch myProvidersOnly/dual-set tests (Low), cineasterna-catalog persist test (Low),
cooldown boundary test (Low).

### ROUND 2 Wave 3 — roles 15-21 — DONE
Filed: BIN-337 (sitemap test+person pipeline), BIN-338 (AppTopbar combobox a11y), BIN-339 (declineFriendRequest paths),
BIN-340 (CSV IMDb rating tests), BIN-341 (preview.yml gates), BIN-342 (retention-policy subcollections).
Held: calendar/copy.ts finales-only standfirst test (Low).

### ROUND 2 Wave 4 — roles 22-28 — DONE
Filed: BIN-343 (askBinge todayId UTC), BIN-344 (npm audit not on deploy path), BIN-345 (DynamicRouter untested),
BIN-346 (OMDb cap no alert). Held (Low): cheapestPath unknown-cost branch test, ratingDelta non-finite test,
composeSimilarPool dedup test.

## ============================================================
## GOAL COMPLETE: two /linear scans per specialist (28 x 2)
## Round 1 (defects): BIN-275..323 = 23 tickets
## Round 2 (quality): BIN-324..346 = 23 tickets
## TOTAL: 46 tickets filed. All verified at file:line, deduped, router-stamped.
## Key verification saves (NOT filed — false/known/intentional):
##   - 2x false "missing Firestore index URGENT" (single-field + collection-group __name__ auto-indexed)
##   - @v6 actions "deploy broken" (flagged 3x; builds run 12-18min → resolve)
##   - /_/index.html rewrite "every route 404s" (out/_/index.html exists, prod works)
##   - firebase.json security headers "absent" (CSP/HSTS/XFO all present)
##   - many agent self-retractions honored (CSV math, communityRatings idempotency, cascadePrioritizer NaN)
## ============================================================
