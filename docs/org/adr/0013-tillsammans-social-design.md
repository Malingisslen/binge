# ADR 0013 — Tillsammans / social layer: founding design decisions

**Date:** 2026-04-17 · **Status:** Accepted (design interview, shipped) · **Via:** social-layer design interview

## Context
Binge's social differentiator is **Swedish streaming availability** — the killer question
is not "what did my friend think?" but **"what can we all stream tonight?"**. The
"Tillsammans ikväll" engine (`src/app/tillsammans/`, `sessions/{id}`) and permanent groups
(`src/app/grupper/`) shipped from this interview. These are the design calls that shaped
them and that the code enforces but does not explain.

## Decisions (interview 2026-04-17)
- **Guest UX = temporary unlisted link** (Doodle-style), no account required. Trust-based:
  participant id lives in `localStorage`, auth not required to join a session.
- **Match threshold = majority yes, 1 veto per person.** A veto kills a candidate
  definitively (ranking on `yes − no × 0.5`).
- **Sessions are async-first** — `onSnapshot` real-time is enough for MVP; no hard
  play-together sync. TV asymmetry is *allowed with a warning*, not blocked.
- **Provider mode = intersect by default for pairs** (toggle per session/group;
  aggregation least-misery / average / fair is user-chosen per session).
- **Privacy default = private**; public profile is opt-in. Public `@handle`, locked after
  first choice.
- **Notifications = in-app only** for the social layer (no email/push in scope then).
- **Reviews exist but are de-prioritised for social** — MVP surfaces ratings only.
- **Session TTL = 7 days** (`expiresAt`).

## Consequences
- The trust-based unlisted-link model is a conscious product-trust choice (no auth wall on
  guests); GDPR posture for guests = anonymous `pid` only, no personal data.
- Later phases (taste-overlap scoring, social polish, push) are tracked in Linear, not here.

## Decided by
Malin (design interview, 2026-04-17). Recorded on the 2026-07-13 docs-sweep when the
"tillsammans-roadmap" living-doc was retired; phase/roadmap tracking now lives in Linear,
and the shipped behaviour is the code.
