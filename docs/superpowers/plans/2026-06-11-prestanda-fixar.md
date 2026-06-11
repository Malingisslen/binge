# Prestandafixar binge.nu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exekvera de 11 verifierade prestandaåtgärderna från ultracode-auditen 2026-06-11 (se `~/.claude/plans/binge-prestanda-laddningstider.md`) — snabbare first load, momentana återbesök, kortare inloggat vattenfall — utan att öka driftskostnaden.

**Architecture:** Binge är en statisk Next.js 16-export (SPA, all data client-side) på Firebase Hosting bakom Cloudflare. Åtgärderna faller i fyra grupper: (1) HTTP-cache-konfiguration, (2) mindre kritisk JS via lazy-imports, (3) kortare nätverksvattenfall (Firestore-cache, icke-blockerande auth-profil, React Query-persist som faktiskt fungerar), (4) billigare TMDB-fan-out (lite-queries, deferred WeekStrip) + bildbantning.

**Tech Stack:** Next.js 16 (App Router, `output: 'export'`), React 19, TanStack Query v5 + persist, Firebase JS SDK v12, Vitest.

**Viktiga repo-regler:**
- Svenskt UI, inga hex-färger i komponentkod, `danger`-tokens för fel.
- Verifiering per task: `npm run typecheck` + `npm test` (93+ tester ska passera).
- Commits på svenska enligt repo-stil (`perf(...)`, `fix(...)`), avsluta commit-meddelanden med `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Deploy sker via push till main (deploy.yml deployar hosting inkl. firebase.json-headers). `/commit`-skillen purgar Cloudflare.

**Task-ordning är medveten:** Task 1–4 är oberoende snabbvinster. Task 5 bygger vidare på Task 4 (samma useEffect i AuthContext). Task 6–8 hänger ihop via persist-whitelisten (tv-lite-nycklarna). Task 9–11 är oberoende.

---

### Task 1: firebase.json — laga HTML-cachen + dubbel-301-redirects

Bakgrund: header-blocket `**/*.@(html)` matchar ALDRIG eftersom `trailingSlash: true` gör att inga request-URL:er slutar på `.html` (Firebase matchar request-pathen, inte filen). Resultat live-verifierat: HTML serveras med Firebase-default `max-age=3600` → trasig app upp till 1 h efter deploy. Redirect-källorna utan trailing slash pekar dessutom på destinationer utan trailing slash → två 301:or i rad.

**Files:**
- Modify: `firebase.json:5-11` (redirects), `firebase.json:20-53` (headers)
- Modify: `docs/analysis/EXTERNAL_ACTIONS.md` (Cloudflare Cache Rule — manuell åtgärd)

- [ ] **Step 1: Fixa redirect-destinationerna**

I `firebase.json`, ersätt redirects-arrayen (rad 5–12) med (enda ändringen är trailing slash på destinationerna för de tre källorna utan trailing slash):

```json
    "redirects": [
      { "source": "/my/following", "destination": "/my/series/", "type": 301 },
      { "source": "/my/following/", "destination": "/my/series/", "type": 301 },
      { "source": "/my/watched", "destination": "/my/films/", "type": 301 },
      { "source": "/my/watched/", "destination": "/my/films/", "type": 301 },
      { "source": "/my/want-to-watch", "destination": "/my/vill-se/", "type": 301 },
      { "source": "/my/want-to-watch/", "destination": "/my/vill-se/", "type": 301 }
    ],
```

- [ ] **Step 2: Flytta no-cache till `**`-blocket och ta bort det döda html-globben**

I headers-arrayen: (a) lägg till Cache-Control-headern sist i `"source": "**"`-blockets headers-lista (efter Permissions-Policy, rad 35–38), (b) ta bort hela `**/*.@(html)`-blocket (rad 47–52), (c) lägg till ett nytt block för statiska public-assets. Firebase Hosting tillämpar alla matchande headers-block och senare block vinner för samma header-nyckel — så `/_next/static/**`-blocket (som står EFTER `**`) fortsätter ge immutable till hashade assets.

```json
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Content-Security-Policy", "value": "(BEFINTLIGT VÄRDE — RÖR INTE)" },
          { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
          { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { "key": "Cache-Control", "value": "no-cache, must-revalidate" }
        ]
      },
      {
        "source": "/_next/static/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      },
      {
        "source": "**/*.@(svg|png|ico|jpg|webp|webmanifest|txt|xml)",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=86400" }
        ]
      }
    ]
```

OBS: CSP-värdet på rad 26 ska behållas exakt som det är — kopiera det befintliga strängvärdet, skriv inte om det.

OBS 2: `firebase-messaging-sw.js` (service workern) får `no-cache` från `**`-blocket — det är KORREKT för en SW (den ska revalideras), lägg den inte i asset-blocket.

- [ ] **Step 3: Validera JSON + bygg**

Kör: `npx firebase --version` (sanity) och `node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('OK')"`
Förväntat: `OK`

- [ ] **Step 4: Dokumentera Cloudflare Cache Rule som extern åtgärd**

Lägg till en sektion sist i `docs/analysis/EXTERNAL_ACTIONS.md`:

```markdown
## Cloudflare Cache Rule för HTML (prestandaplan 2026-06-11, åtgärd 1b)

Kräver inloggning i Cloudflare-dashboarden (free plan räcker):

1. Caching → Cache Rules → Create rule, namn: `Edge-cache HTML kort`
2. When incoming requests match: Hostname equals `binge.nu`
3. Then: Eligible for cache, Edge TTL: **Override origin → 10 minutes**,
   Browser TTL: **Respect origin**
4. Spara. `/commit`-skillen purgar redan hela zonen vid deploy, så regeln är
   säker — max 10 min stale efter en deploy som inte går via /commit.

Effekt: long-tail-HTML (alla rewrites till /_/index.html) serveras från
Cloudflare-edge (~0 ms origin-tid) istället för Fastly-MISS mot Firebase
(~235–275 ms extra TTFB, live-uppmätt).
```

- [ ] **Step 5: Commit**

```bash
git add firebase.json docs/analysis/EXTERNAL_ACTIONS.md
git commit -m "perf(hosting): no-cache på HTML (death-glob fixad) + enkel-301 för legacy-routes

**-globben får Cache-Control no-cache; **/*.@(html) matchade aldrig pga
trailingSlash (request-paths slutar inte på .html) så HTML cachades 1h av
Firebase-default — trasig app upp till en timme efter deploy. /_next/static
behåller immutable (senare block vinner). Redirect-destinationer får trailing
slash så legacy-länkar gör EN 301 istället för två.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Verifiera efter nästa deploy** (kan göras i slutet av hela planen)

Kör: `curl -sI https://binge.nu/calendar/ | grep -i cache-control`
Förväntat: `cache-control: no-cache, must-revalidate`
Kör: `curl -sI https://binge.nu/my/following | grep -i -E "location"`
Förväntat: `location: /my/series/` (en hopp, inte två)

Verifiera också att immutable-headern ÖVERLEVDE på hashade assets (kritiskt — om Firebase inte låter senare block vinna har `**`-blockets no-cache slagit igenom där med):
Hämta en riktig chunk-URL: `curl -s https://binge.nu/ | grep -o '/_next/static/chunks/[^"]*\.js' | head -1`
Kör: `curl -sI "https://binge.nu<CHUNK-PATH>" | grep -i cache-control`
Förväntat: `cache-control: public, max-age=31536000, immutable`
Om detta istället visar no-cache: flytta ut Cache-Control ur `**`-blocket och använd ett negationsmönster i ett eget block — `{ "source": "!(_next)/**", ... }` plus `{ "source": "/", ... }` — och re-deploya.

---

### Task 2: Firestore persistentLocalCache

Bakgrund: `getFirestore(app)` ger memory-only-cache → varje sidladdning väntar på en full nätverkssnapshot av watchlisten (~160–200 debiterade reads per kallt besök). Med IndexedDB-cache levereras första `onSnapshot`-callbacken momentant från disk och servern skickar bara deltan. Inga ändringar behövs i WatchlistContext.

**Files:**
- Modify: `src/lib/firebase/config.ts:1-24`

- [ ] **Step 1: Byt getFirestore mot initializeFirestore med persistent cache**

Ersätt rad 1–3 och rad 23–24 i `src/lib/firebase/config.ts`:

```ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
```

och exporterna (behåll `export const auth = getAuth(app);` orörd):

```ts
export const auth = getAuth(app);

// IndexedDB-cache: första onSnapshot-callbacken serveras momentant från disk
// (fromCache=true) och servern skickar bara deltan via resume-token. Det gör
// watchlist-rendering vid återbesök omedelbar OCH sänker debiterade reads
// (~160–200 per kallt besök utan cache). multipleTabManager så flera flikar
// delar samma cache utan lås-konflikt.
let firestoreDb: Firestore;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  // HMR i dev: initializeFirestore på en redan-initierad app kastar.
  // Återanvänd den befintliga instansen.
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
```

Emulator-blocket (rad 29–44) lämnas orört — `connectFirestoreEmulator(db, …)` fungerar likadant.

- [ ] **Step 2: Typecheck + tester**

Kör: `npm run typecheck && npm test`
Förväntat: PASS (inga tester importerar config.ts direkt — pure-logic-mönstret).

- [ ] **Step 3: Manuell rökverifiering**

Kör `npm run dev`, logga in på http://localhost:3000, ladda om sidan. I DevTools → Application → IndexedDB ska en `firestore/...`-databas finnas. Biblioteket ska rendera direkt vid omladdningen (ingen sekundlång spinner).

- [ ] **Step 4: Commit**

```bash
git add src/lib/firebase/config.ts
git commit -m "perf(firestore): persistentLocalCache — momentan watchlist vid återbesök

IndexedDB-cache ersätter memory-only: första snapshoten kommer från disk och
servern skickar deltan. Sänker även debiterade reads (~160–200 per kallt
besök idag). try/catch-fallback till getFirestore för HMR-dubbelinit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Lazy-importera Sentry

Bakgrund: `import * as Sentry from '@sentry/react'` på toppnivå i `sentry.ts` lägger 26 KB gzip i first-load på ALLA sidor, trots att init är DSN-gated och körs i en useEffect. `queryClient.ts` importerar `captureError` härifrån, så filen sitter i den delade chunken. Mönstret för lazy-import finns redan i `messaging.ts:23`.

**Files:**
- Modify: `src/lib/sentry.ts` (hela filen skrivs om)

- [ ] **Step 1: Skriv om sentry.ts med dynamic import**

Ersätt hela innehållet i `src/lib/sentry.ts` med:

```ts
'use client';

/**
 * Sentry-initialisering för Binge.
 *
 * Designprinciper:
 * - Opt-in via NEXT_PUBLIC_SENTRY_DSN. Tomt DSN → no-op, vilket gör att
 *   CI-builds, lokal dev och test-miljöer aldrig skickar events.
 * - SDK:n LAZY-importeras (samma mönster som messaging.ts) — @sentry/react
 *   är 26 KB gzip och ska inte ligga i first-load-bundlen på varje sida.
 *   captureError no-op:ar tills SDK:n laddats; fel under de första ~100 ms
 *   tappas medvetet (samma utfall som när DSN saknas).
 * - Ingen PII i events. email/username/UID scrubbas via beforeSend.
 * - Sampling: 100% errors, 0% performance (traces) i startläge.
 * - release = git-SHA om satt, annars 'dev'.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'production';
const RELEASE = process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev';

type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;
let initStarted = false;

export function initSentry(): void {
  if (initStarted) return;
  if (!DSN) return; // no-op i dev/CI om DSN saknas
  if (typeof window === 'undefined') return;
  initStarted = true;

  void import('@sentry/react')
    .then((S) => {
      S.init({
        dsn: DSN,
        environment: ENV,
        release: RELEASE,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        // Scrubba bort vanliga PII-källor innan events skickas.
        beforeSend(event) {
          if (event.user) {
            delete event.user.email;
            delete event.user.username;
            delete event.user.ip_address;
          }
          // Fånga och nulla ut ev. query-strängar med tokens.
          if (event.request?.url) {
            try {
              const u = new URL(event.request.url);
              u.search = '';
              event.request.url = u.toString();
            } catch {
              // icke-URL — lämna
            }
          }
          return event;
        },
        // Ignorera brus: ResizeObserver-varningar, abort-errors vid navigation,
        // extension-errors som inte är vår kod.
        ignoreErrors: [
          /ResizeObserver loop/i,
          /Non-Error promise rejection captured/i,
          /The operation was aborted/i,
          /NetworkError when attempting to fetch resource/i,
        ],
      });
      sentry = S;
    })
    .catch((err) => {
      console.warn('[sentry] SDK-laddning misslyckades:', err);
      initStarted = false; // tillåt nytt försök vid nästa initSentry()
    });
}

/**
 * Rapportera ett fel med taggar. No-op om Sentry inte hunnit laddas/initieras.
 * Används både av queryClient.ts (React Query-fel) och SegmentError.tsx
 * (app-router error boundaries).
 */
export function captureError(
  error: unknown,
  context: { scope: string; kind?: string; extra?: Record<string, unknown> },
): void {
  if (!sentry) return;
  sentry.captureException(error, {
    tags: {
      scope: context.scope,
      ...(context.kind ? { kind: context.kind } : {}),
    },
    extra: context.extra,
  });
}
```

- [ ] **Step 2: Typecheck + tester**

Kör: `npm run typecheck && npm test`
Förväntat: PASS.

- [ ] **Step 3: Verifiera att chunken lämnat first-load**

Kör: `npm run build` och kontrollera att route-tabellens "First Load JS shared by all" minskat (≈25–30 KB gzip mindre än baslinjen 423 KB). Snabbkoll utan full analys:
`grep -rl "sentry" .next/server 2>/dev/null | head -1` är INTE måttet — titta på build-outputens shared-chunk-summa.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sentry.ts
git commit -m "perf(sentry): lazy-importera @sentry/react ur first-load-bundlen

26 KB gzip låg i shared chunk på alla sidor trots DSN-gated init i useEffect.
SDK:n dynamic-importeras nu i initSentry(); captureError no-op:ar tills
modulen laddats (samma utfall som saknat DSN). Mönster från messaging.ts.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Lazy-importera App Check

Bakgrund: `appCheck.ts` toppnivå-importerar `firebase/app-check` (~10–18 KB) på varje sida. Viktig invariant från `AuthContext.tsx:211-218`: App Check MÅSTE vara initierad innan `onAuthStateChanged` subscribar, annars kan Auth hänga när enforcement är på. Lösningen: `initAppCheck()` blir async (returnerar Promise) och AuthContext awaitar den före subscribe. Utan site key (= ingen enforcement möjlig) resolvar den direkt UTAN att ladda någon kod — noll kostnad i det vanliga fallet.

**Files:**
- Modify: `src/lib/firebase/appCheck.ts` (hela filen)
- Modify: `src/contexts/AuthContext.tsx:210-248` (effekten)
- Modify: `src/components/Providers.tsx:42-50` (void-anrop)

- [ ] **Step 1: Skriv om appCheck.ts**

Ersätt hela innehållet i `src/lib/firebase/appCheck.ts` med:

```ts
let initPromise: Promise<void> | null = null;

// Anropas från AuthContext-effekten (efter React 19-hydration) och AWAITAS
// där innan onAuthStateChanged subscribar — Auth attachar App Check-tokens
// till alla Identity Toolkit-calls och hänger om providern inte är
// registrerad när enforcement är på.
//
// Lazy-import: firebase/app-check (~15 KB) laddas BARA när en site key finns.
// Utan site key resolvar vi synkront utan att hämta någon kod — det är
// default-läget och kostar noll. Idempotent via initPromise-memoiseringen
// (StrictMode dubbelkör mount-effekter i dev).
export function initAppCheck(): Promise<void> {
  if (initPromise) return initPromise;
  if (typeof window === 'undefined') return Promise.resolve();

  const siteKey = process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY;
  if (!siteKey) {
    // No-op utan site key är en medveten säker default — men i en prod-build
    // betyder det att bot-skyddet är AV. Logga en varning så en oavsiktlig
    // prod-deploy utan nyckel märks (S8). I dev är frånvaron väntad.
    if (process.env.NEXT_PUBLIC_APP_ENV === 'production') {
      console.warn('[app-check] NEXT_PUBLIC_APP_CHECK_SITE_KEY saknas — App Check är inaktiverat i produktion.');
    }
    return Promise.resolve();
  }

  initPromise = (async () => {
    try {
      const [{ initializeAppCheck, ReCaptchaV3Provider }, { default: app }] = await Promise.all([
        import('firebase/app-check'),
        import('@/lib/firebase/config'),
      ]);
      // Fail-closed: debug-token bara i dev. Glöms variabeln eller får fel
      // värde i prod-build → debug är AV (säkert default).
      if (process.env.NEXT_PUBLIC_APP_ENV === 'development') {
        (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      // HMR kan re-trigga init på samma app-instans → SDK:n kastar. Svälj.
      console.warn('[app-check] init skipped:', err);
    }
  })();
  return initPromise;
}
```

(OBS: den statiska `import app from '@/lib/firebase/config'`-raden överst i filen ska bort — config dynamic-importeras nu inne i closuren så appCheck-modulen inte drar in Firebase-kedjan.)

- [ ] **Step 2: Awaita initAppCheck i AuthContext-effekten**

I `src/contexts/AuthContext.tsx`, ersätt effekten (rad 210–248) med — callback-bodyn (`async (firebaseUser) => { … }`) behålls EXAKT som den är i detta steg, det enda som ändras är ramverket runt subscriben:

```ts
  useEffect(() => {
    // App Check måste vara initierad innan onAuthStateChanged subscribar —
    // Auth attachar App Check-tokens till alla Identity Toolkit-calls (inkl.
    // token-refresh på boot) och hänger annars på en token-provider som
    // aldrig kommer. initAppCheck() är async (lazy-laddad chunk) men resolvar
    // direkt utan site key, så detta kostar inget i default-läget.
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void initAppCheck().then(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        // ... BEFINTLIG CALLBACK-BODY OFÖRÄNDRAD (rad 220-245) ...
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
```

- [ ] **Step 3: void-anropet i Providers.tsx**

I `src/components/Providers.tsx`, ändra raden `initAppCheck();` i useEffect (rad 44) till `void initAppCheck();` (fire-and-forget; AuthContext äger await-ordningen).

- [ ] **Step 4: Typecheck + tester + manuell inloggning**

Kör: `npm run typecheck && npm test`
Förväntat: PASS.
Manuellt: `npm run dev`, logga in/ut — auth ska fungera som vanligt (ingen site key i dev → initAppCheck resolvar direkt).

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase/appCheck.ts src/contexts/AuthContext.tsx src/components/Providers.tsx
git commit -m "perf(app-check): lazy-importera firebase/app-check

~15 KB lämnar first-load-bundlen. initAppCheck returnerar Promise och
AuthContext awaitar den före onAuthStateChanged-subscriben (invarianten att
App Check måste init:as före auth-boot bevaras). Utan site key resolvar den
synkront utan att ladda någon kod alls.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---### Task 5: Bryt den seriella auth-kedjan — icke-blockerande profil

Bakgrund: idag väntar HELA appen (`loading=true`) på auth-besked + profil-`getDoc` + ev. username-claim-rundresor innan watchlist-snapshoten ens får starta (`WatchlistContext.tsx:89` är keyad på `uid`). Det är minst en Firestore-RTT (300–800 ms) ren serialisering. Fix: sätt `uid` + `loading=false` direkt i callbacken; profilen laddas parallellt och exponeras via nytt `profileLoading`-state. Sidor som KRÄVER profilen (admin-gate, insikter, startsidans dashboard-val) justeras.

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (interface, default-värde, callback-body, value-memo)
- Modify: `src/app/page.tsx:287,322` (gate på uid istället för user)
- Modify: `src/app/admin/reports/page.tsx:36-37`
- Modify: `src/app/insikter/InsikterClient.tsx:33`

- [ ] **Step 1: Lägg till profileLoading i AuthState**

I `src/contexts/AuthContext.tsx`, interface `AuthState` (rad 34–63): lägg till efter `loading: boolean;`:

```ts
  /**
   * True medan Firestore-profilen laddas EFTER att auth-beskedet kommit.
   * `loading` (auth-besked) släpps direkt så watchlist/TMDB kan starta;
   * ytor som kräver profildata (isAdmin-gates, onboarding-beslut) ska vänta
   * på loading || profileLoading.
   */
  profileLoading: boolean;
```

och i default-context-objektet (rad 65–91), efter `loading: true,`: lägg till `profileLoading: false,`.

- [ ] **Step 2: Skriv om onAuthStateChanged-callbacken**

I `AuthProvider`: lägg till state-raden efter `const [loading, setLoading] = useState(true);`:

```ts
  const [profileLoading, setProfileLoading] = useState(false);
```

Ersätt sedan callback-bodyn (det som i Task 4 behölls oförändrat — `async (firebaseUser) => {...}`) med en ICKE-async callback:

```ts
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
          // Släpp appen direkt på auth-beskedet — watchlist-snapshoten och
          // sid-queries startar parallellt med profil-hämtningen istället
          // för att serialiseras bakom den (en hel Firestore-RTT).
          setUid(firebaseUser.uid);
          setEmailVerified(firebaseUser.emailVerified);
          setLoading(false);
          setProfileLoading(true);
          // SSR-flagga för startsidan: prerendrad HTML är alltid LandingPage
          // (för Googlebot + LLM-crawlers). Inloggade återvändande användare
          // hoppar direkt till dashboard-skeletten istället för att se en
          // LandingPage-flicker — page.tsx läser den här flaggan synkront
          // i en lazy useState-init innan hydration.
          try { window.localStorage.setItem('binge:wasLoggedIn', '1'); } catch { /* private mode */ }

          void ensureUserProfile(firebaseUser)
            .then((profile) => {
              // Account-switch-skydd: skriv bara om samma användare
              // fortfarande är inloggad när profilen landar.
              if (auth.currentUser?.uid === firebaseUser.uid) setUser(profile);
            })
            .catch((err) => {
              console.error('Failed to load user profile:', err);
              // uid behålls — auth är giltig även om profil-läsningen
              // failade; user-beroende ytor null-hanterar redan.
              if (auth.currentUser?.uid === firebaseUser.uid) setUser(null);
            })
            .finally(() => {
              if (auth.currentUser?.uid === firebaseUser.uid) setProfileLoading(false);
            });
        } else {
          setUser(null);
          setUid(null);
          setEmailVerified(false);
          setProfileLoading(false);
          try { window.localStorage.removeItem('binge:wasLoggedIn'); } catch { /* private mode */ }
          setLoading(false);
        }
      });
```

- [ ] **Step 3: Exponera profileLoading i value-memot**

I `value = useMemo(...)` (rad 640–657): lägg till `profileLoading` direkt efter `loading` BÅDE i objektet och i dependency-arrayen.

- [ ] **Step 4: page.tsx — gata dashboarden på uid**

I `src/app/page.tsx`:
- Rad 287: `const { user, loading } = useAuth();` → `const { uid, loading } = useAuth();`
- Rad 320–322: kommentaren + `if (!user)` → `if (!uid)`:

```ts
  // Auth resolverat utan uid: anonym besökare. Visa LandingPage med
  // trending-sektionen. (Gatear på uid — inte user — eftersom profilen
  // numera laddas parallellt och kan landa något senare än auth-beskedet.)
  if (!uid) {
```

- [ ] **Step 5: AdminGate + Insikter väntar på profilen**

`src/app/admin/reports/page.tsx` rad 36–37:

```ts
  const { user, loading, profileLoading } = useAuth();
  if (loading || profileLoading) return <LoadingView label="Laddar…" />;
```

`src/app/insikter/InsikterClient.tsx` rad 33:

```ts
  const { user, loading: authLoading, profileLoading } = useAuth();
```

och sök i samma fil efter användningar av `authLoading` (gate-/render-villkor längre ner) och ersätt varje `authLoading` med `(authLoading || profileLoading)` så admin-detekteringen inte flashar "ingen åtkomst" medan profilen laddar.

- [ ] **Step 6: Audita övriga loading-konsumenter**

Kör: `grep -rn "loading.*useAuth\(\)" src --include="*.tsx" --include="*.ts"`
Gå igenom träffarna (utöver de redan fixade): `src/app/login/page.tsx` är OK som den är (redirect-effekten triggar på `user` och får bara vänta ~en RTT extra — onboarding-beslutet KRÄVER profilen). Bekräfta att ingen annan yta använder mönstret `!loading && !user` för att visa anonymt läge — i så fall gäller samma fix som page.tsx (gata på `uid`).

- [ ] **Step 7: Typecheck + tester + manuell verifiering**

Kör: `npm run typecheck && npm test`
Förväntat: PASS.
Manuellt i `npm run dev`: (1) inloggad omladdning → dashboard-skelett → innehåll, INGEN LandingPage-flash; (2) utloggad → LandingPage; (3) settings-sidan visar profil korrekt efter en kort stund.

- [ ] **Step 8: Commit**

```bash
git add src/contexts/AuthContext.tsx src/app/page.tsx src/app/admin/reports/page.tsx src/app/insikter/InsikterClient.tsx
git commit -m "perf(auth): släpp loading direkt på auth-besked — profilen laddas parallellt

uid + loading=false sätts i onAuthStateChanged-callbacken före
ensureUserProfile-awaiten, så watchlist-onSnapshot och sid-queries startar
parallellt med profil-getDoc (sparar en Firestore-RTT i kritiska kedjan).
Nytt profileLoading-state för ytor som kräver profilen (admin-gate,
insikter). page.tsx gatear dashboarden på uid. Account-switch-skydd via
auth.currentUser-jämförelse innan setUser.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Laga React Query-persistern

Bakgrund (fyra samverkande fel): (a) default `gcTime` 5 min < `maxAge` 24 h → cachen GC:as innan den persisteras, persisten är nästan tom; (b) ingen dehydrate-whitelist → när (a) fixas skulle 100 fulla TMDB-detaljsvar spränga localStorage-kvoten (~5 MB) och persistern failar tyst; (c) provider-swappen QCP→PQCP efter mount REMOUNTAR hela appträdet (dubbla auth-subscriptions, all DOM byggs om); (d) `throttleTime: 1000` serialiserar hela cachen ~1 ggr/s under laddningsbursten.

**Files:**
- Modify: `src/lib/queryClient.ts` (gcTime + persist-predikat)
- Create: `src/lib/queryClient.persist.test.ts`
- Modify: `src/components/Providers.tsx` (hela filen skrivs om)

- [ ] **Step 1: Skriv failande test för persist-predikatet**

Skapa `src/lib/queryClient.persist.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldPersistQuery } from './queryClient';

// Minimal strukturell mock — shouldPersistQuery läser bara queryKey + status.
function q(key: unknown[], status: 'success' | 'pending' | 'error' = 'success') {
  return { queryKey: key, state: { status } } as Parameters<typeof shouldPersistQuery>[0];
}

describe('shouldPersistQuery', () => {
  it('persisterar lyckade queries med whitelistade prefix', () => {
    expect(shouldPersistQuery(q(['tv-lite', 123]))).toBe(true);
    expect(shouldPersistQuery(q(['movie-lite', 27205]))).toBe(true);
    expect(shouldPersistQuery(q(['tv-season', 123, 2]))).toBe(true);
    expect(shouldPersistQuery(q(['genres-movie']))).toBe(true);
    expect(shouldPersistQuery(q(['trending', 'all', 'week']))).toBe(true);
  });

  it('skippar tunga/fulla detaljsvar och sök', () => {
    expect(shouldPersistQuery(q(['tv', 123]))).toBe(false);
    expect(shouldPersistQuery(q(['movie', 27205]))).toBe(false);
    expect(shouldPersistQuery(q(['search', 'dune', 1]))).toBe(false);
  });

  it('skippar queries som inte lyckats', () => {
    expect(shouldPersistQuery(q(['tv-lite', 123], 'pending'))).toBe(false);
    expect(shouldPersistQuery(q(['tv-lite', 123], 'error'))).toBe(false);
  });

  it('skippar icke-sträng-nycklar defensivt', () => {
    expect(shouldPersistQuery(q([42]))).toBe(false);
  });
});
```

- [ ] **Step 2: Kör testet — ska faila**

Kör: `npx vitest run src/lib/queryClient.persist.test.ts`
Förväntat: FAIL — `shouldPersistQuery` finns inte.

- [ ] **Step 3: Implementera i queryClient.ts**

I `src/lib/queryClient.ts`: lägg till efter importerna (rad 5):

```ts
/** Delas med Providers.tsx — persist-fönstret OCH queryernas gcTime måste
 *  vara samma värde: med gcTime < maxAge GC:as cachen innan den hinner
 *  persisteras och localStorage-persisten blir i praktiken tom. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Whitelist för vad som persisteras till localStorage (~5 MB-kvot).
// Lite-queries + säsonger + katalogytor = det som gör återbesök snabba.
// INTE fulla ['tv']/['movie']-detaljsvar (20–80 KB JSON styck × bibliotek
// spränger kvoten) och INTE search (flyktigt).
const PERSISTED_QUERY_PREFIXES = new Set([
  'tv-lite', 'movie-lite', 'tv-season',
  'genres-movie', 'genres-tv', 'watch-providers',
  'trending', 'popular-movies', 'popular-tv', 'discover-movies', 'discover-tv',
]);

export function shouldPersistQuery(query: {
  queryKey: readonly unknown[];
  state: { status: string };
}): boolean {
  if (query.state.status !== 'success') return false;
  const head = query.queryKey[0];
  return typeof head === 'string' && PERSISTED_QUERY_PREFIXES.has(head);
}
```

och i `createQueryClient()` defaultOptions.queries (rad 64–77), lägg till efter `staleTime`-raden:

```ts
        // Matchar PERSIST_MAX_AGE — se kommentaren vid konstanten.
        gcTime: PERSIST_MAX_AGE,
```

OBS: `'tv-lite'`/`'movie-lite'`-nycklarna skapas i Task 7 — predikatet är framåtkompatibelt och testet driver namngivningen.

- [ ] **Step 4: Kör testet — ska passera**

Kör: `npx vitest run src/lib/queryClient.persist.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Skriv om Providers.tsx — en permanent PersistQueryClientProvider**

Ersätt hela `src/components/Providers.tsx` med:

```tsx
'use client';

import { PersistQueryClientProvider, removeOldestQuery } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AuthProvider } from '@/contexts/AuthContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { NotInterestedProvider } from '@/contexts/NotInterestedContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createQueryClient, shouldPersistQuery, PERSIST_MAX_AGE } from '@/lib/queryClient';
import { initSentry } from '@/lib/sentry';
import { initAppCheck } from '@/lib/firebase/appCheck';
import { useState, useEffect, type ReactNode } from 'react';

/**
 * React Query-cachen persisteras till localStorage så återbesök hydreras
 * från disk istället för ~200 nätverksanrop.
 *
 * - EN permanent PersistQueryClientProvider — den gamla swappen
 *   QueryClientProvider→PersistQueryClientProvider efter mount remountade
 *   hela appträdet (dubbla auth-subscriptions, all DOM byggdes om).
 *   Hydration-mismatch undviks genom att persister-objektet skapas med
 *   storage: undefined på server/build (no-op-persister) — samma
 *   komponenttyp på båda sidor, ingen DOM-skillnad.
 * - PQCP pausar query-fetching tills restore är klar (isRestoring), så
 *   cachen läses INNAN första fetch — tidigare startade fetcherna före
 *   restoren och skrev över den.
 * - dehydrateOptions whitelistar vad som persisteras (shouldPersistQuery)
 *   så 100 fulla TMDB-detaljsvar inte spränger ~5 MB-kvoten; retry:
 *   removeOldestQuery kastar äldsta querien vid quota-fel istället för
 *   att tyst ge upp.
 * - maxAge/gcTime delar konstant (PERSIST_MAX_AGE) — se queryClient.ts.
 * - buster = git-SHA invaliderar cachen per deploy.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window === 'undefined' ? undefined : window.localStorage,
      key: 'binge-rq-cache',
      // 3 s: sync-serialiseringen av hela cachen kördes tidigare ~1 ggr/s
      // under laddningsbursten — ren main-thread-jank.
      throttleTime: 3000,
      retry: removeOldestQuery,
    })
  );

  // Sentry + App Check init efter hydration. Sentry: no-op utan DSN.
  // App Check: AuthContext awaitar samma promise före auth-subscribe;
  // anropet här är bara en tidig kickoff. Båda lazy-laddar sina SDK:er.
  useEffect(() => {
    initSentry();
    void initAppCheck();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev',
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      <AuthProvider>
        <WatchlistProvider>
          <NotInterestedProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </NotInterestedProvider>
        </WatchlistProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
```

- [ ] **Step 6: Typecheck + full testsvit + build**

Kör: `npm run typecheck && npm test && npm run build`
Förväntat: allt PASS, build utan hydration-varningar.

- [ ] **Step 7: Manuell verifiering av persist-flödet**

I `npm run dev` (dev har buster 'dev' så cachen överlever omladdningar): besök startsidan inloggad, vänta 5 s, ladda om. DevTools → Application → Local Storage → `binge-rq-cache` ska finnas och innehålla `trending`/`genres-*`-nycklar (tv-lite kommer i Task 7). Omladdningen ska INTE refetcha trending (Network-fliken).

- [ ] **Step 8: Commit**

```bash
git add src/lib/queryClient.ts src/lib/queryClient.persist.test.ts src/components/Providers.tsx
git commit -m "perf(rq-persist): fungerande 24h-persist utan app-remount

Fyra samverkande fel fixade: gcTime (5 min) < maxAge (24 h) gjorde persisten
tom; ingen dehydrate-whitelist (kvot-risk när gcTime fixas) — nu
shouldPersistQuery + removeOldestQuery-retry; QCP→PQCP-swappen efter mount
remountade hela appträdet — nu en permanent PQCP med SSR-säker no-op-persister
(storage: undefined på server); throttleTime 1s→3s mot serialiserings-jank.
PQCP pausar dessutom fetching tills restore är klar, så cachen faktiskt
används istället för att skrivas över av första fetchen.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: tv-lite/movie-lite-queries för kalender + rådgivare

Bakgrund: `getTVShow` drar `append_to_response: watch/providers,recommendations,credits,videos,external_ids` — 20–80 KB JSON per serie. Kalendern/rådgivaren behöver bara basfälten + `watch/providers` (rådgivaren matchar providers; kalenderns metarad visar provider — verifierat i `buildEntries.ts:42` och advisorn). credits/recommendations/videos är ~80 % av payloaden och används bara på titelsidorna. OBS: `useCalendar` och `useSubscriptionAdvisor` delar queryKey idag — BÅDA måste migreras i samma commit, annars dubblas fan-outen.

**Files:**
- Modify: `src/lib/tmdb/client.ts` (två nya funktioner efter getTVShow, rad 146)
- Modify: `src/lib/tmdb/cacheTiers.ts` (ny tier)
- Modify: `src/hooks/useCalendar.ts:6,44-52,120-126`
- Modify: `src/hooks/useSubscriptionAdvisor.ts:7,73-80`
- Modify: `CLAUDE.md` (staleTime-sektionen)

- [ ] **Step 1: Nya client-funktioner**

I `src/lib/tmdb/client.ts`, direkt efter `getTVShow` (rad 146), lägg till:

```ts
// Lite-varianter för fan-out-ytor (kalender, rådgivare, revival): behåller
// watch/providers (rådgivaren matchar mot dem; kalenderns metarad visar
// provider) men skippar credits/recommendations/videos/external_ids —
// ~80 % mindre payload per titel. Egen queryKey ('tv-lite'/'movie-lite')
// så titelsidornas fulla detaljsvar inte krockar i React Query-cachen.
export function getTVShowLite(id: number, opts?: TmdbFetchOpts): Promise<TMDBTVShow> {
  return tmdbFetch(`/tv/${id}`, { append_to_response: 'watch/providers' }, opts);
}

export function getMovieLite(id: number, opts?: TmdbFetchOpts): Promise<TMDBMovie> {
  return tmdbFetch(`/movie/${id}`, {
    append_to_response: 'watch/providers,release_dates',
  }, opts);
}
```

- [ ] **Step 2: Ny stale-tier**

I `src/lib/tmdb/cacheTiers.ts`, lägg till i `TMDB_STALE`-objektet efter `TV_DETAIL`:

```ts
  /** Lite-detalj för kalender/rådgivare ('tv-lite'/'movie-lite') — driver
   *  premiärbevakning, inte titelsidor. 6 h: air-datum flippar sällan
   *  intra-dag, och varje cache-miss är en fan-out över hela biblioteket. */
  LITE_DETAIL: 6 * 60 * 60 * 1000,
```

- [ ] **Step 3: Migrera useCalendar**

I `src/hooks/useCalendar.ts`:
- Rad 6: `import { getTVShow, getTVSeason, getMovie } from '@/lib/tmdb/client';` → `import { getTVShowLite, getTVSeason, getMovieLite } from '@/lib/tmdb/client';`
- Show-queries (rad 43–53):

```ts
  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv-lite', id],
      // Lite-variant utan credits/recommendations/videos (~80 % mindre JSON
      // per serie). Delas med useSubscriptionAdvisor — samma nyckel + samma
      // TMDB_STALE.LITE_DETAIL så observers inte slåss om cachen (H3).
      // Signal avbryter in-flight fetches vid navigation bort så
      // semaphore-slots inte läcker.
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
```

- Movie-queries (rad 120–126):

```ts
  const movieQueries = useQueries({
    queries: movieIds.map(id => ({
      queryKey: ['movie-lite', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getMovieLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
```

- Uppdatera den nu inaktuella kommentaren ovanför movie-queries (rad 110–112): kalendern delar INTE längre nyckel med useMovie — skriv om till: `// Egen lite-nyckel ('movie-lite') — bara release_dates + providers behövs här; titelsidans fulla ['movie', id]-svar är 5–10× större och ska inte fan-out:as över hela vill_se-listan.`

- [ ] **Step 4: Migrera useSubscriptionAdvisor**

I `src/hooks/useSubscriptionAdvisor.ts`:
- Rad 7: `import { getTVShow } from '@/lib/tmdb/client';` → `import { getTVShowLite } from '@/lib/tmdb/client';`
- Rad 73–80:

```ts
  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv-lite', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled: true,
    })),
  });
```

- [ ] **Step 5: Verifiera att inga andra callsites delar gamla nyckeln fel**

Kör: `grep -rn "queryKey: \['tv'," src` och `grep -rn "queryKey: \['movie'," src`
Förväntat kvar: `useTMDB.ts` (titelsidor — ska ha kvar fulla detaljen) och `QuickAddButton.tsx:47` (prefetchar fulla detaljen inför titelsidebesök — korrekt, lämna). Ingen annan träff.

Kör också: `grep -rn "useUpcomingShowsForAdvisor\|useAdvisorTimeline" src/hooks` och öppna träffarna — om någon av dem kör egna `['tv', id]`-useQueries (utöver att konsumera useCalendarEntries/advisor) ska de migreras likadant som Step 4. (Auditen fann inga, detta är ett skyddsnät.)

- [ ] **Step 6: Uppdatera CLAUDE.md-regeln**

I `CLAUDE.md`, sektionen "### TMDB staleTime — dela via `TMDB_STALE`", ersätt de två styckena med:

```markdown
Flera hooks kan registrera samma queryKey — då MÅSTE de använda samma
`TMDB_STALE`-konstant (annars slåss observers om senaste värde):

- `['tv', id]` (full detalj, append_to_response): useTVShow + QuickAddButton
  → `TMDB_STALE.TV_DETAIL`
- `['tv-lite', id]` (bas + watch/providers): useCalendar + useSubscriptionAdvisor
  → `TMDB_STALE.LITE_DETAIL`
- `['movie', id]` (full detalj): useMovie → `TMDB_STALE.MOVIE_DETAIL`
- `['movie-lite', id]` (bas + release_dates + providers): useCalendar
  → `TMDB_STALE.LITE_DETAIL`

Fan-out-ytor (kalender/rådgivare, en query per bibliotekstitel) ska använda
lite-varianterna (`getTVShowLite`/`getMovieLite` i `src/lib/tmdb/client.ts`) —
fulla detaljsvar är 5–10× större och hör hemma på titelsidor. Lite-nycklarna
ingår i React Query-persist-whitelisten (`shouldPersistQuery` i
`src/lib/queryClient.ts`) — full-nycklarna gör det medvetet inte.
```

- [ ] **Step 7: Typecheck + tester + manuell kalenderverifiering**

Kör: `npm run typecheck && npm test`
Förväntat: PASS (buildEntries-tester opåverkade — datatypen är samma).
Manuellt: `/calendar` ska visa avsnitt MED provider-badge (bevisar att watch/providers följer med lite-svaret), WeekStrip ska fyllas, Streamingrådgivaren ska visa samma råd som innan.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tmdb/client.ts src/lib/tmdb/cacheTiers.ts src/hooks/useCalendar.ts src/hooks/useSubscriptionAdvisor.ts CLAUDE.md
git commit -m "perf(tmdb): tv-lite/movie-lite för kalender + rådgivare — ~80 % mindre fan-out-bytes

Kalendern och rådgivaren hämtade fulla detaljsvar (credits+recommendations+
videos, 20–80 KB/titel) för varje bibliotekstitel men använder bara basfält +
watch/providers. Nya getTVShowLite/getMovieLite under egna nycklar
('tv-lite'/'movie-lite', LITE_DETAIL 6h) — migrerade samtidigt eftersom de
delade queryKey. Nycklarna matchar persist-whitelisten från föregående commit
så kalenderdata överlever omladdning. CLAUDE.md-regeln uppdaterad.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Defer:a WeekStrips kalender-fan-out

Bakgrund: WeekStrip sitter i AppTopbar på VARJE sida och drar igång hela kalenderpipelinen (N show-queries + N säsongsqueries) vid mount — sidans egna queries (t.ex. titelsidans `useTVShow`) ställs i kö bakom upp till ~28 semafor-vågor. Fix: `enabled`-flagga i `useCalendarEntries` som WeekStrip sätter först efter idle (~1,5 s). På `/calendar` och Hem kör sidans egen `useCalendarEntries()` (default enabled) — samma cache, så de ytorna påverkas inte.

**Files:**
- Modify: `src/hooks/useCalendar.ts:31-53,86-93,120-126`
- Modify: `src/components/layout/WeekStrip.tsx:73-77`

- [ ] **Step 1: enabled-parameter i useCalendarEntries**

I `src/hooks/useCalendar.ts`, ändra signaturen (rad 31):

```ts
export function useCalendarEntries(opts: { enabled?: boolean } = {}): UseCalendarResult {
  const enabled = opts.enabled ?? true;
```

och lägg till `enabled,` i alla tre query-objekten (show-queries, season-queries, movie-queries) — t.ex. show-queries:

```ts
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled,
```

(Säsongsqueries är redan indirekt gated — specs byggs från shows — men flaggan adderas för tydlighet och för att inte starta refetch av stale säsonger. Loading-semantiken behöver INTE ändras: med `enabled: false` är queries `isPending` → `isLoading` blir true → WeekStrip visar "…" precis som under riktig laddning.)

- [ ] **Step 2: Idle-aktivering i WeekStrip**

I `src/components/layout/WeekStrip.tsx`, ersätt rad 73–77 (`export default function WeekStrip() {` t.o.m. `useCalendarEntries()`-raden):

```ts
export default function WeekStrip() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  // Strippen sitter på VARJE sida och dess kalenderpipeline (N show- + N
  // säsongs-queries) tog tidigare semaforens alla 8 slots före sidans egna
  // queries. Aktivera den först efter idle (~1,5 s) — sidans innehåll vinner
  // first paint, strippen fylls strax efter. På /calendar och Hem kör sidans
  // egen useCalendarEntries() (default enabled) så datat finns ändå direkt
  // via delad cache.
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  useEffect(() => {
    const start = () => setCalendarEnabled(true);
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(start, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(start, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const { entries, isLoading } = useCalendarEntries({ enabled: calendarEnabled });
```

- [ ] **Step 3: Typecheck + tester + manuell verifiering**

Kör: `npm run typecheck && npm test`
Förväntat: PASS.
Manuellt: öppna en titelsida direkt (t.ex. `/movie/27205/`) med kall cache och DevTools Network — titelsidans TMDB-request ska gå iväg FÖRE kalender-fan-outen; WeekStrip visar "…" och fylls efter ett par sekunder.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCalendar.ts src/components/layout/WeekStrip.tsx
git commit -m "perf(weekstrip): defer:a kalender-fan-outen tills idle

WeekStrip (på varje sida) tog TMDB-semaforens alla slots före sidans egna
queries. useCalendarEntries får enabled-flagga; strippen aktiverar via
requestIdleCallback (timeout 2 s, setTimeout-fallback 1,5 s). /calendar och
Hem opåverkade — deras egna hook-anrop kör med default enabled.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Släpp /my/series-gaten på advisorn

Bakgrund: `WatchlistPage.tsx:222` gatear HELA sidan på `advisor.isLoading` (= alla ~100 TV-detaljqueries settled) trots att listan kan bucketas direkt på persisterade fält (`librarySubState` är byggd för `knownBehind=false`). Fix: rendera direkt; applicera behind-settet i EN diskret re-bucketing när advisorn settlat (bevarar X1-anti-flicker-intentionen — ingen gradvis migration mellan sektioner). Undantag: om användaren aktivt filtrerar på "ligger efter" (`behindFilterActive`) KRÄVS behind-settet — behåll gaten just för det läget.

**Files:**
- Modify: `src/components/WatchlistPage.tsx:163-166,222`

- [ ] **Step 1: Läs filens topp (rad 1–150)**

Läs `src/components/WatchlistPage.tsx:1-150` och identifiera var `behindIds` definieras (används i filter-memots deps på rad 152) och var `behindFilterActive` sätts. Bekräfta att `behindIds` härleds från `advisor.unfinishedTmdbIds`.

- [ ] **Step 2: Frys behind-settet medan advisorn laddar**

Lägg till på modulnivå (utanför komponenten, t.ex. ovanför komponentdefinitionen):

```ts
// Stabil tom referens — behind-settet appliceras i EN re-bucketing när
// advisorn settlat (X1: ingen gradvis migration mellan sektioner medan
// queries löser en och en).
const EMPTY_BEHIND = new Set<number>();
```

och ändra `subStateOf`-memot (rad 163–166) till:

```ts
  const subStateOf = useMemo(() => {
    const behind = advisor.isLoading ? EMPTY_BEHIND : advisor.unfinishedTmdbIds;
    return (item: WatchlistItem) => librarySubState(item, behind.has(item.tmdbId));
  }, [advisor.isLoading, advisor.unfinishedTmdbIds]);
```

Om `behindIds` (filter-vägen från Step 1) läser `advisor.unfinishedTmdbIds` direkt: applicera samma frysning där (`advisor.isLoading ? EMPTY_BEHIND : …`).

- [ ] **Step 3: Släpp sidgaten — utom för behind-filtret**

Ändra rad 222 från:

```ts
  if (watchlistLoading || (status === 'mina' && advisor.isLoading)) {
```

till:

```ts
  // B13: gata bara på watchlist-snapshoten. /my/series renderar direkt på
  // persisted-fields-bucketing (librarySubState klarar knownBehind=false by
  // design) och re-bucketas EN gång när advisorn settlat. Undantag:
  // "ligger efter"-filtret KRÄVER behind-settet — där behålls gaten så vi
  // inte visar en felaktigt tom filtrerad lista.
  if (watchlistLoading || (behindFilterActive && advisor.isLoading)) {
```

- [ ] **Step 4: Typecheck + tester + manuell verifiering**

Kör: `npm run typecheck && npm test`
Förväntat: PASS (libraryView-testerna är pure och opåverkade).
Manuellt med kall cache: `/my/series` ska visa korten direkt (grupperade på persisterade fält); efter att advisorn settlat får "Ligger efter"-sektionen sina extra titlar i ETT hopp, inte stegvis.

- [ ] **Step 5: Commit**

```bash
git add src/components/WatchlistPage.tsx
git commit -m "perf(bibliotek): /my/series renderar direkt — advisor-gaten släppt

Sidan väntade på att alla ~100 TV-detaljqueries skulle settla trots att
bucketing på persisterade fält (librarySubState) räcker för första
renderingen. Behind-settet appliceras nu i EN re-bucketing när advisorn
settlat (frusen EMPTY_BEHIND-referens under laddning — ingen gradvis
sektionsmigration, X1-intentionen bevarad). Gaten kvar enbart när
'ligger efter'-filtret är aktivt, som faktiskt kräver settet.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Attributpaket — preconnect, fetchPriority, eager LCP-bilder

Bakgrund: inloggades första Firebase-anrop betalar kall DNS+TLS (~100–300 ms mobil) — inga preconnects till Firebase-origins finns. `fetchPriority` förekommer inte alls i src/; i en SPA kan bild-URL:er inte head-preloadas, så attributet är enda prioriteringsspaken för LCP-bilder. HemFocal-postern (synlig direkt på Hem) är felaktigt `loading="lazy"`. Dessutom: befintliga preconnecten till `image.tmdb.org` har `crossOrigin=""` men `<img>`-element är no-CORS — den förvarmda socketen återanvänds inte; ta bort attributet där.

**Files:**
- Modify: `src/app/layout.tsx:76-77`
- Modify: `src/components/home/HemFocal.tsx:55-64,80`
- Modify: `src/components/pages/MoviePageClient.tsx:113`
- Modify: `src/components/pages/TVShowPageClient.tsx:141`
- Modify: `src/components/pages/PersonPageClient.tsx:82`

- [ ] **Step 1: Preconnects i layout.tsx**

Ersätt rad 76–77 i `src/app/layout.tsx`:

```tsx
        {/* TMDB-API:t fetch:as (CORS) → crossOrigin krävs för att socketen
            ska återanvändas. image.tmdb.org konsumeras av <img> (no-CORS) →
            INGEN crossOrigin, annars förvarmas fel socket-typ. Firebase-
            origins (CORS-fetch): auth-token-refresh + Firestore är inloggades
            första nätverkshopp — kall DNS+TLS kostar 100–300 ms på mobil. */}
        <link rel="preconnect" href="https://api.themoviedb.org" crossOrigin="" />
        <link rel="preconnect" href="https://image.tmdb.org" />
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" crossOrigin="" />
        <link rel="preconnect" href="https://securetoken.googleapis.com" crossOrigin="" />
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="" />
```

- [ ] **Step 2: HemFocal — prioritera stillen, eager:a postern**

I `src/components/home/HemFocal.tsx`:
- Still-bilden (rad 55–65): lägg till `fetchPriority="high"` efter `loading="eager"`.
- Poster-bilden (rad 80): byt `loading="lazy"` → `loading="eager"` (den är synlig i viewporten direkt — lazy LCP-kandidat = långsammare LCP).

- [ ] **Step 3: fetchPriority på titelsidornas posters**

Lägg till `fetchPriority="high"` på dessa tre img-element (alla redan `loading="eager"`):
- `src/components/pages/MoviePageClient.tsx:113`
- `src/components/pages/TVShowPageClient.tsx:141`
- `src/components/pages/PersonPageClient.tsx:82`

Exempel (MoviePageClient):

```tsx
              <img src={poster} alt={displayTitle} loading="eager" fetchPriority="high" decoding="async" width={342} height={513} />
```

- [ ] **Step 4: Typecheck + tester**

Kör: `npm run typecheck && npm test`
Förväntat: PASS. (React 19 stödjer `fetchPriority` som DOM-prop — ingen ts-expect-error behövs.)

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/components/home/HemFocal.tsx src/components/pages/MoviePageClient.tsx src/components/pages/TVShowPageClient.tsx src/components/pages/PersonPageClient.tsx
git commit -m "perf(critical-path): Firebase-preconnects + fetchPriority på LCP-bilder

Preconnect till identitytoolkit/securetoken/firestore (inloggades första
nätverkshopp, kall DNS+TLS 100-300 ms mobil). crossOrigin borttagen från
image.tmdb.org-preconnecten (img är no-CORS — fel sockettyp förvarmades).
fetchPriority=high på titelsidors poster + HemFocal-stillen; HemFocal-postern
eager istället för lazy (synlig direkt = LCP-kandidat).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Bildstorlekar — nedväxlingar + srcset på TitleCard

Bakgrund: noll `srcset`/`sizes` i hela src/ — allt är fast DPR2-dimensionerat och flera ytor hämtar 5–50× fler bytes än renderingsytan kräver. Värst: onboarding-kalibreringen laddar w500-posters för 70 px-slots + default-w1280-backdrops bakom en gradient (~2–3 MB för 10 kort).

**Files:**
- Modify: `src/lib/tmdb/client.ts` (posterSrcSet-helper efter posterUrl, rad 107)
- Modify: `src/app/kalibrera/page.tsx:135-136`
- Modify: `src/components/calendar/EventCard.tsx:40-41`
- Modify: `src/components/home/HemFocal.tsx:34`
- Modify: `src/components/watchlist/WatchlistCard.tsx:48`
- Modify: `src/components/title/TitleCard.tsx:62-70`
- Modify: `src/app/globals.css:676-679` + `CLAUDE.md` (död transition)

- [ ] **Step 1: posterSrcSet-helper**

I `src/lib/tmdb/client.ts`, efter `posterUrl` (rad 107), lägg till:

```ts
// srcset för poster-grids: låter browsern välja w185 för små celler/DPR1
// och w342/w500 för stora/DPR2+. Använd med sizes-attribut i konsumenten.
export function posterSrcSet(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${IMAGE_BASE}/w185${path} 185w, ${IMAGE_BASE}/w342${path} 342w, ${IMAGE_BASE}/w500${path} 500w`;
}
```

- [ ] **Step 2: Kalibrera-kortet (största enskilda vinsten)**

I `src/app/kalibrera/page.tsx`, rad 135–136:

```ts
  // 70 px-slot → w154 räcker (DPR2 = 140 px). Backdropen ligger dimmad till
  // 60 % bakom en gradient i en 180 px-hög yta → w780 är redan överkvalitet;
  // default (w1280) var ~10× bytes för noll synlig skillnad.
  const poster = posterUrl(item.poster_path, 'w154');
  const backdrop = backdropUrl(item.backdrop_path, 'w780');
```

- [ ] **Step 3: EventCard-stills**

I `src/components/calendar/EventCard.tsx`, rad 40–41 (7-kolumnersbrädan renderar ~150 px breda celler):

```ts
  const still = stillUrl(entry.backdropPath, 'w300')
    ?? backdropUrl(entry.backdropPath, 'w300');
```

- [ ] **Step 4: HemFocal-postern**

I `src/components/home/HemFocal.tsx`, rad 34 (92 px-slot):

```ts
  const poster = posterUrl(entry.posterPath, 'w185');
```

- [ ] **Step 5: WatchlistCard-thumben**

I `src/components/watchlist/WatchlistCard.tsx`, rad 48 (renderas 50×75):

```ts
  const poster = posterUrl(item.posterPath, 'w92');
```

- [ ] **Step 6: srcset på TitleCard**

I `src/components/title/TitleCard.tsx`: importera helpern (rad 6: lägg till `posterSrcSet` i import-listan från `@/lib/tmdb/client`) och utöka img-elementet (rad 62–70):

```tsx
            <img
              src={poster}
              srcSet={posterSrcSet(item.poster_path)}
              sizes="(max-width: 768px) 45vw, 160px"
              alt={title}
              loading="lazy"
              decoding="async"
              width={342}
              height={513}
              onError={() => setImgError(true)}
            />
```

(Grid-cellerna är `minmax(120px,1fr)` → ~120–180 px desktop, ~45vw i 2-kolumns mobilgrid.)

- [ ] **Step 7: Ta bort den döda duotone-transitionen**

I `src/app/globals.css`, ta bort regeln på rad 676–679:

```css
.poster img,
[class*="duo-"]:has(> img) > img {
  transition: filter 220ms cubic-bezier(0.2, 0, 0, 1);
}
```

Motivering: `filter: url(#duo-x)` → `none` är icke-interpolerbart — transitionen animerar aldrig, den bara fördröjer hover-reveal med en diskret flip. Uppdatera även `CLAUDE.md`, raden "Hover på poster → `filter: none` (avslöjar original-bitmap). Transition 220ms." → "Hover på poster → `filter: none` (avslöjar original-bitmap, momentant — SVG-filter→none kan inte interpoleras så ingen transition)."

- [ ] **Step 8: Typecheck + tester + visuell kontroll**

Kör: `npm run typecheck && npm test`
Förväntat: PASS.
Manuellt: kalibrera-flödet (`/kalibrera`), kalendern, Hem och `/my/all` ska se identiska ut (samma layout, skarpa bilder); Network-fliken ska visa w154/w300/w185/w92-URL:er.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tmdb/client.ts src/app/kalibrera/page.tsx src/components/calendar/EventCard.tsx src/components/home/HemFocal.tsx src/components/watchlist/WatchlistCard.tsx src/components/title/TitleCard.tsx src/app/globals.css CLAUDE.md
git commit -m "perf(bilder): rätta TMDB-storlekar till renderingsytan + srcset på TitleCard

Kalibrera: w500→w154-poster (70px-slot) + w1280→w780-backdrop (~10× bytes
för 10 onboarding-kort). EventCard w500→w300, HemFocal-poster w342→w185,
WatchlistCard w185→w92. posterSrcSet-helper + sizes på TitleCard-grids så
DPR1-desktop slipper DPR2-bytes. Död duotone-transition borttagen
(filter:url()→none kan inte interpoleras — den fördröjde bara hover-reveal).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Catch-all — skeleton istället för 404-flash + chunk-prefetch

Bakgrund: SPA-shellen (`out/_/index.html`, som serverar ALLA long-tail-URL:er via rewriten) prerendrar NotFound-vyn — en delningslänk till en giltig film flashar "Sidan hittades inte" innan JS tagit över. Fix i `DynamicRouter`: pre-mount → neutral detalj-skeleton; post-mount + omatchad path → NotFound (fallbacken behåller sin 404-roll). Prefetch av de tre vanligaste delningsmålens chunkar kapar dessutom chunk-RTT:n ur den seriella kedjan bundle-parse → chunk-fetch → TMDB-fetch.

**Files:**
- Modify: `src/components/pages/DynamicRouter.tsx:24-27,41-43`

- [ ] **Step 1: Skeleton pre-mount**

I `src/components/pages/DynamicRouter.tsx`, ändra rad 41–43 från:

```ts
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback}</>;
```

till:

```ts
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Pre-mount (= prerendrad HTML i out/_/index.html + första klient-rendern):
  // neutral detalj-skeleton, INTE fallbacken. Fallbacken är NotFound-vyn och
  // den prerendrade shellen serverar ALLA long-tail-URL:er via rewriten —
  // en giltig delningslänk ska inte flasha "Sidan hittades inte" innan JS
  // hunnit dispatcha. NotFound visas fortsatt post-mount för omatchade paths.
  if (!mounted) return <LoadingView variant="detail" label="Laddar…" />;
```

- [ ] **Step 2: webpackPrefetch på delningsmålen**

Ändra rad 24–27 så de tre vanligaste delningsmålen prefetchas (webpack-magic-comment; ignoreras harmlöst av Turbopack):

```ts
const MoviePageClient = dynamic(() => import(/* webpackPrefetch: true */ './MoviePageClient'), { ssr: false, loading: () => LOADING });
const TVShowPageClient = dynamic(() => import(/* webpackPrefetch: true */ './TVShowPageClient'), { ssr: false, loading: () => LOADING });
const SeasonPageClient = dynamic(() => import('./SeasonPageClient'), { ssr: false, loading: () => LOADING });
const PersonPageClient = dynamic(() => import(/* webpackPrefetch: true */ './PersonPageClient'), { ssr: false, loading: () => LOADING });
```

- [ ] **Step 3: Typecheck + tester + build + manuell verifiering**

Kör: `npm run typecheck && npm test && npm run build`
Förväntat: PASS.
Kör sedan: `grep -o "Sidan hittades inte" out/_/index.html | head -1`
Förväntat: ingen träff (skeletten prerendras istället).
Manuellt: besök en long-tail-titel direkt (t.ex. en obskyr film-URL) — skeleton → innehåll, ingen 404-flash. Besök en påhittad URL (`/finnsinte/`) — skeleton → NotFound.

- [ ] **Step 4: Commit**

```bash
git add src/components/pages/DynamicRouter.tsx
git commit -m "fix(catch-all): skeleton pre-mount istället för 404-flash + prefetch av delningsmål

SPA-shellen prerendrade NotFound — varje delningslänk utanför topp-N flashade
'Sidan hittades inte' före JS-dispatch. Pre-mount visar nu LoadingView
variant=detail; NotFound behåller sin roll för omatchade paths post-mount.
webpackPrefetch på Movie/TV/Person-chunkar kapar chunk-RTT:n ur den seriella
kedjan bundle→chunk→TMDB för delade länkar.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Avslutande verifiering (efter alla tasks)

- [ ] Kör hela kedjan: `npm run lint && npm run typecheck && npm test && npm run build`
- [ ] Jämför buildens "First Load JS shared by all" mot baslinjen (423 KB gzip / 1,40 MB raw) — förvänta ~30–45 KB gzip mindre (Sentry + app-check ur shared chunk).
- [ ] Manuell regressionsrunda i dev: inloggad omladdning (dashboard direkt, ingen LandingPage-flash), `/my/series` (direkt rendering, ett diskret behind-hopp), `/calendar` (provider-badges kvar), titelsida (poster laddar först), kalibrera-flödet, logga ut/in.
- [ ] Deploy via `/commit` (deployar hosting inkl. firebase.json + purgar Cloudflare), kör därefter Task 1 Step 6-curlarna.
- [ ] **Extern manuell åtgärd:** skapa Cloudflare Cache Rule enligt docs/analysis/EXTERNAL_ACTIONS.md.

### Medvetet INTE i denna plan (uppföljning)

- **Lazy-ladda Firestore-SDK:n** (109 KB gzip, 26 % av first-load) — stor insats (23 filer importerar `{ db }` statiskt), och auditens rekommendation är att mäta om den efter att vattenfallsfixarna ovan landat. Mål om den görs: ~250 KB gzip gäst / ~350 KB inloggad.
- **App-shell service worker** — omvärdera först om återbesöks-TTFB fortfarande är ett problem efter Task 1 + Cloudflare-regeln.
- **TMDB-edge-Worker** — bryter inte gratis-constrainten för enbart katalog-endpoints men är en single point of failure; inte värd det nu.
- **Duotone-ombyggnad** — profilera `/my/all` med stort bibliotek innan något görs.
