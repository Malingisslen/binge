# Binge SLOs (Service Level Objectives)

_Status: skeleton — 2026-04-24. Fyll i efter ~2 veckor med Sentry-data._

Service-Level Objectives är de uppsättningar vi mäter oss mot för att veta om
användare får acceptabel kvalitet. Skelettet här listar metrikerna; de faktiska
trösklarna sätts när vi har data att grunda dem på.

## Tillgänglighet (availability)

| Metric | Target | Källa | Status |
|--------|--------|-------|--------|
| Uptime (binge.nu) | 99.0 % / månad | UptimeRobot | TBD |
| Uptime (Firestore reads) | 99.5 % / månad | Firebase status.firebase.google.com | TBD |
| Cold-page-load (TTFB) | p95 < 500 ms | ingen källa (BIN-1438) | TBD |

**Varför 99.0 % inte 99.9 %?** Vi är en solo-app på Firebase Hosting + Cloudflare,
inte en enterprise-tjänst. 99.0 % motsvarar ~7 timmars down/månad, vilket är
realistiskt.

## Latens (performance)

| Metric | Target | Källa | Status |
|--------|--------|-------|--------|
| LCP | p75 < 2.5 s | ingen källa (BIN-1438) | TBD |
| CLS | p75 < 0.1 | ingen källa (BIN-1438) | TBD |
| INP | p75 < 200 ms | ingen källa (BIN-1438) | TBD |
| TMDB fetch | p95 < 1500 ms | ingen källa (BIN-1438) | TBD |

### Lighthouse-baseline (engångsmätning)

_Mätt 2026-06-04 mot `https://binge.nu/` (Lighthouse desktop-preset, performance-kategorin)._

| Mått | Värde |
|------|-------|
| Performance-score | 80 |
| LCP (lab) | 3.4 s |
| CLS (lab) | 0 |
| TBT (lab) | 30 ms |

Lab-värdena ovan är en engångs-snapshot för regressionsjämförelse. De
fältbaserade p75-targetsen i tabellen ovan har ingen källa sedan Plausible togs bort (BIN-1438).

## Kvalitet (error rates)

| Metric | Target | Källa | Status |
|--------|--------|-------|--------|
| Sentry unhandled-error rate | < 0.5 % av sessions | Sentry | TBD |
| React Query error rate | < 1 % av queries | ingen källa (`query_error` räknas inte, BIN-1438) | TBD |
| Successful logins | > 99 % | `signed_in` i eventStats vs sign-in-attempts | TBD |

## Säkerhet / compliance

| Metric | Target | Källa | Status |
|--------|--------|-------|--------|
| Dagar sedan senast roterad invite-token | < 180 dagar per grupp | Firestore `inviteTokenRotatedAt` | TBD |
| GDPR data-export turn-around | < 24 h från request till JSON | Self-service (instant) | ✅ |
| Kontoradering turn-around | Omedelbar | Self-service (client-side) | ✅ |

## Hur vi mäter

- **eventStats:** dagliga summor av de händelser `src/lib/analytics.ts` räknar, via `recordEvent` (BIN-1438). Inga Web Vitals, inga besök.
- **Sentry:** error rate + release health
- **UptimeRobot:** 5-min HTTP check på `binge.nu`
- **Firebase Console:** Firestore read/write quota + Auth MAU

## Hur vi reagerar när SLO:er bryts

Vänta 2 veckor med att sätta trösklar. Bryts de sedan:

1. **En burst bryter** (t.ex. TMDB-outage): dokumentera i RUNBOOK.md § 12 loggbok
2. **Trend bryter** (30d mer än targeten): debugga root cause, fixa, uppdatera SLO
3. **SLO är för strikt** (vi kommer aldrig nå target): sänk threshold, dokumentera
   varför

## Review-kadens

- **Veckovis** (efter 2 v baseline): snabb kolla på Insikter + Sentry, notera
  om trender går åt fel håll
- **Månadsvis:** uppdatera denna fil med faktiska värden vs targets
- **Kvartalsvis:** omvärdera om SLO:erna fortfarande är rätt (ambition,
  relevans)

## Dokumentationsstatus

- [ ] Fyll i uptime-baseline när UptimeRobot har 30 dagar data
- [ ] Fyll i p75 LCP/CLS/INP — kräver en källa för fältdata, som saknas sedan Plausible togs bort (BIN-1438). Lighthouse lab-baseline infördes 2026-06-04.
- [ ] Fyll i Sentry-baseline när DSN är provisionerat + 30 dagar data
- [ ] Re-visit efter Sprint 7 framework-upgrades (prestanda kan ändras)
