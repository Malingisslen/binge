# Internal breach-assessment record — BIN-505 profile + notes PII exposure

**GDPR Art. 33(5) internal record.** Art. 33(5) requires the controller to document
*every* personal-data breach internally, even where it does not meet the Art. 33(1)
supervisory-authority notification threshold. This is that record. Not legal advice;
a plain-language summary for the controller (Malin) is in the "Assessment" section.

- **Ticket:** BIN-505
- **Discovery date:** 2026-07-14 (found during a routine backlog scan / this session)
- **Nature:** unauthorised-access *risk* (confidentiality). No evidence of actual access
  or exfiltration — the exposure was reachable, not known to be exploited.

## What was exposed, and to whom

Firestore reads are whole-document; the rules could not field-filter. Two docs were
readable beyond their intended audience:

1. **`users/{uid}` profile doc** — readable by ANY unauthenticated caller when the
   profile was public (`isPublic == true` / `defaultVisibility == 'public'`), and by any
   confirmed friend regardless of tier. A raw SDK/REST read returned the whole document,
   bypassing the app's client-side field redaction. Sensitive fields carried:
   - `email`
   - `hemkommun` (home municipality — coarse location)
   - `providerCosts`, `providerCampaigns` (self-reported subscription costs — financial)
   - plus other non-public fields (notificationSettings, rotationSchedule, providerRenewalDays,
     terms/age timestamps) that were never intended to be public.
2. **`users/{uid}/watchlist/{tmdbId}` docs** — public/friends-readable; the free-text
   `notes` field rode along in the raw read. Free text can capture third-party personal
   data (a named person in a note).

## Scope (affected data subjects)

- All users who had set their profile public (`isPublic`/`defaultVisibility == 'public'`),
  for the profile-field exposure to unauthenticated callers.
- All confirmed friend-pairs, for the profile-field exposure between friends.
- Any user with a non-null `notes` on a public/friends-visible watchlist item, for the
  notes exposure (plus any third party named in such a note).
- **Duration:** since the profile-visibility / notes features shipped — NOT since
  discovery. This was a standing rules design gap, not a regression introduced 2026-07-14.
- **Population:** binge is live but unmarketed with a small user base; the practically
  affected set is small.

## Remediation

- **Fix:** BIN-505 (this change) — `users/{uid}` locked to owner-only read; a positive-
  whitelist public projection `publicProfiles/{uid}` (display fields only, no email/costs/
  hemkommun/myProviders) serves public/friend viewers, visibility gated live against the
  source; free-text `notes` moved to an owner-only `watchlistNotes` subcollection with an
  eager migration off the public doc. Rules proven by 13 emulator tests.
- **Timeline:** discovered 2026-07-14; fix designed + panel-reviewed + built same day.
  Rules deploy + rollout: see the deploy plan in `tasks/bin-505-plan.md`.

## Assessment — notification threshold (Art. 33(1) / Art. 34)

Preliminary controller assessment (to be confirmed by Malin as controller-of-record):
this breach **likely does NOT cross** the mandatory thresholds —
- **Art. 33(1)** (notify the supervisory authority, IMY, within 72h unless "unlikely to
  result in a risk"): the small, unmarketed, non-scraped user base + same-day remediation
  + no evidence of actual access weigh toward "unlikely to result in a risk." Borderline
  given financial + location categories; if in doubt, notifying IMY is the conservative call.
- **Art. 34** (notify affected data subjects, required only for "high risk"): the same
  factors weigh against a high-risk finding.

**This conclusion is recorded, not assumed** — that is the point of this document. If the
controller disagrees or new facts emerge (evidence of scraping/access), revisit the
threshold and, if warranted, notify IMY within 72h of that determination.

## Accepted trade-off (Malin, 2026-07-14)

- **Backfill = lazy, no eager admin backfill.** Each user's `publicProfiles` card is written
  the next time they sign in (the AuthContext sync effect). Until then a public user can
  render as "private" on their profile page and show a fallback name in search/friends/feed.
  Accepted for binge's small, active, unmarketed user base; dormant public accounts stay
  invisible until they return. This is a deliberate, documented degradation, not a defect.

## Follow-ups

- Confirm this breach assessment with Malin (controller-of-record) — IMY / data-subject
  notification not required per the preliminary read above.
