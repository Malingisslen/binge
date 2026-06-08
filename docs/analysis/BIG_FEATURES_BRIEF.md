# Stora features — decomposition-brief

**Syfte:** de roadmap-poster som är för stora för remediation-omgången. Var och en
kräver en **egen spec → plan → implementation-cykel** (brainstorming först). Det
här är scoping-underlag, inte en implementationsplan.

> Status 2026-06: ingen av dessa är påbörjad. Prioritera efter värde/insats nedan.

---

## B12 — Dark mode

**Problem:** användare vill ha mörkt läge; verktygs-appar förväntas stödja det.

**Scope:**
- Definiera mörka oklch-varianter för alla yt-/ink-/rule-tokens i `globals.css`
  (`:root` + en `[data-theme="dark"]` / `@media (prefers-color-scheme: dark)`-skugga).
- Theme-toggle i inställningar + `prefers-color-scheme`-default; persist i user-doc
  (`displayPreferences.theme`) + `localStorage` för gäst.
- Flash-prevention: inline-script i `<head>` som sätter `data-theme` före hydrering
  (static export → ingen server, så det måste ske i ett blockande inline-script).
- Duotone-poster-filtren (SVG-defs) kan behöva mörk-justering.

**Beroenden:** designbeslut om mörk palett (två-accent-regeln gäller fortfarande).
**Insats:** ~1 vecka. **Risk:** låg-medel (token-täckning + flash-prevention är pillrigt).

---

## B13 — PWA (install-to-home)

**Problem:** installerbar app + offline-skal höjer retention på mobil.

**Scope:**
- `public/manifest.json` (ikoner, theme-color, display: standalone, start_url).
- Full service worker via Workbox — **separat från** den befintliga
  `firebase-messaging-sw.js` (FCM-SW:n får inte krocka; precache app-skalet,
  runtime-cache TMDB-bilder).
- Install-banner / "Lägg till på hemskärmen"-prompt (beforeinstallprompt).
- React Query har redan `PersistQueryClientProvider` (offline-cache finns).

**Beroenden:** ikon-assets i flera storlekar. Static export gör SW-registrering
enkel men kräver noggrann scope-hantering mot FCM-SW:n.
**Insats:** ~1 vecka. **Risk:** medel (två service workers samexisterar).

---

## B11 — CSV-import (Trakt / Letterboxd / IMDb)

**Problem:** nya användare vill ta med sin historik från andra tjänster.

**Scope:**
- Parsers per format (Trakt/Letterboxd/IMDb har olika CSV-kolumner).
- Titel-matchning mot TMDB (fuzzy på titel + år; hantera tvetydigheter).
- Dedupe mot befintlig watchlist; status-mappning till Binge-schemat.
- **Dry-run-UI**: visa vad som kommer importeras + omatchade rader innan commit.
- Batch-skrivning till `users/{uid}/watchlist` (respektera rate/cost).

**Beroenden:** TMDB search-rate-limit (befintlig semafor hjälper). UI för
konfliktlösning. **Insats:** ~1–2 veckor. **Risk:** medel (matchnings-kvalitet
är den svåra biten — fel match förstör användarens data).

---

## B25–B27 — Paddle-betalning + paywall + billing-portal

**Problem:** monetisering (premium-nivå).

**Scope:**
- Paddle-integration (checkout + webhooks). Webhook → **Cloud Function** som
  verifierar signatur och uppdaterar user-doc.
- Nya fält på UserProfile: `plan`, `renewsAt`, `canceledAt`, `paddleCustomerId`.
- Paywall-grindar i UI (vilka features är premium?).
- Billing-portal-länk (Paddle hostad) + status-vy i inställningar.
- Firestore rules: skydda plan-fälten (bara webhook/admin får skriva).

**Beroenden:** **juridik** (moms/EU, villkor, ångerrätt), Paddle-konto, en
produktbeslut om vad som faktiskt är premium. Cloud Functions-webhook med
signaturverifiering är säkerhetskritisk. **Insats:** flera veckor. **Risk:** hög
(pengar + juridik + säkerhet). **Rekommendation:** störst och sist; egen
spec-cykel med tydligt premium-värdeerbjudande innan en rad kod.

---

## B14 — Native-appar (React Native / Capacitor)

**Problem:** "riktig" app i App Store / Play.

**Scope:** utvärdering React Native (omskrivning) vs Capacitor (wrappa
PWA-skalet). Capacitor är billigast om B13 (PWA) redan finns. App Store-konton,
review-process, push via APNs/FCM.

**Beroenden:** B13 bör göras först (Capacitor bygger på PWA-skalet).
**Insats:** månader. **Risk:** hög. **Rekommendation:** eget projekt, inte en
feature — ta först PWA (B13) och mät om native ens behövs.

---

## Föreslagen ordning

1. **B12 Dark mode** — högt upplevt värde, isolerad, låg risk. Bra första egen spec.
2. **B13 PWA** — möjliggör B14 senare; medel insats.
3. **B11 CSV-import** — onboarding-värde; medel.
4. **B25–B27 Paywall** — när det finns ett premium-erbjudande värt att ta betalt för.
5. **B14 Native** — bara om PWA visar sig otillräckligt.
