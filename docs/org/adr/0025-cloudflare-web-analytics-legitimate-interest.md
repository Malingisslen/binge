# 0025. Cloudflare Web Analytics on legitimate interest, no consent banner

- **Date:** 2026-10-29
- **Status:** Accepted
- **Trigger:** plan `tasks/insikter-plan-2026-10-28.md`, section "Cloudflare Web Analytics"; blind critique #5 Legal/GDPR (approve with conditions, escalated the interpretation to Malin)
- **Stakeholders (panel):** #5 Legal / GDPR Counsel (approve with conditions), #22 Data Analyst / BI (approve with conditions on the dashboard)

## Context
Binge measured no visits at all: the dashboard said so in a card. Cloudflare Web Analytics
is a cookie-free visit counter: a script from Cloudflare runs in the visitor's browser and
posts one report per page load; Binge reads daily sums per path and referring host through
Cloudflare's GraphQL API from the insights function. Cloudflare states that it sets no
cookies, uses no local storage and does not fingerprint by IP or user agent. The report
dataset is stored in the US.

The legal question #5 escalated: does this need consent (ePrivacy, the Swedish LEK 9 kap. 28 §)
or can it run on legitimate interest (GDPR art. 6.1.f)?

## Decision
Run it on legitimate interest, without a consent banner, with these guards:

1. **Consent is owed only for storing or reading on the device.** Before the change went
   live the same beacon was observed on synat.se (same vendor, same script): it loaded,
   posted to `cloudflareinsights.com/cdn-cgi/rum`, and left no cookie, no localStorage,
   no sessionStorage and no IndexedDB entry. The check is repeated on binge.nu after the
   deploy. If a later check shows a write on the device, the beacon is removed first and
   consent is designed afterwards; §8 of the policy ("inga egna spårningscookies") is
   never reworded around it. The §8 promise that a future statistics tool would first
   ask for consent under LEK is struck in the same change: it is contradicted by this
   decision, and a reworded version would be a new claim.
2. **The balancing (LIA).** Purpose: knowing whether anyone visits and from where, to run
   a one-person product. Necessity: the own event counter cannot see visits that never
   touch a feature, and no cookie-free counter with fewer data exists that Binge can afford.
   Impact on the visitor: a page view with path and referrer, processed in the request with
   the IP address like every HTTP request, aggregated by Cloudflare; Binge receives sums
   only. Expectation: a visitor to a Swedish web app expects its owner to count visits.
   Safeguards: no cookies, no identifiers stored, exact CSP hosts, secrets never reach the
   client, policy §3/§4/§5/§6 updated (version 1.17), art. 21 objection route exists in §7.
3. **Transfer:** US storage under Cloudflare's DPA (SCC, DPF where applicable), named in §5.
4. **Not an accepted deviation.** This is a decision about a new processing, recorded here;
   it is not a deviation from a rule, so nothing is appended to the deviations ledger.

## Consequences
- The dashboard's "Besök i perioden" section shows visits, page views, a per-day curve, top
  pages and referrers, each with an explanation naming Cloudflare as the source.
- The privacy policy says what is measured and that the sums are stored in the US.
- A world-watch item for #5: IMY/EDPB guidance on cookie-free web analytics. A ruling that
  classifies a beacon like this as requiring consent reopens this ADR.
