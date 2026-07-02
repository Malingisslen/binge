let initPromise: Promise<void> | null = null;

// Anropas från AuthContext-effekten (efter React 19-hydration) och AWAITAS
// där innan onAuthStateChanged subscribar — Auth attachar App Check-tokens
// till alla Identity Toolkit-calls och hänger om providern inte är
// registrerad när enforcement är på.
//
// OBS: bara REGISTRERINGEN måste föregå auth-subscribe — App Check-SDK:n
// köar getToken() tills reCAPTCHA-libbet laddat, så vi behöver inte awaita
// grecaptcha-ready.
//
// Lazy-import: firebase/app-check (~15 KB) laddas BARA när en site key finns.
// Utan site key resolvar vi synkront utan att hämta någon kod — det är
// default-läget och kostar noll. Med site key satt kostar awaiten ~1
// chunk-RTT före första onAuthStateChanged på kall load (immutable-cachad
// vid återbesök). Idempotent via initPromise-memoiseringen (StrictMode
// dubbelkör mount-effekter i dev).
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
    initPromise = Promise.resolve();
    return initPromise;
  }

  initPromise = (async () => {
    let mod: typeof import('firebase/app-check');
    let appMod: typeof import('@/lib/firebase/config');
    try {
      [mod, appMod] = await Promise.all([
        // webpackPrefetch: låt webbläsaren idle-hämta chunken direkt efter
        // sidladdning så awaiten i AuthContext oftast är cache-träff även på
        // kall load. OBS: init-ORDNINGEN (await initAppCheck() FÖRE
        // onAuthStateChanged) är lastbärande och får inte parallelliseras —
        // se kommentaren överst i filen (hang om providern inte är
        // registrerad när enforcement är på). Granskad + blockerad 2026-07-02.
        import(/* webpackPrefetch: true */ 'firebase/app-check'),
        import('@/lib/firebase/config'),
      ]);
    } catch (err) {
      // Transient chunk-fel (nätverksglapp/adblocker): nollställ memoiseringen
      // så ett senare initAppCheck()-anrop kan försöka igen — annars är
      // App Check tyst avstängt hela sessionen med enforcement-avvisningar
      // som följd den dag site key är satt.
      initPromise = null;
      console.warn('[app-check] SDK-chunk kunde inte laddas:', err);
      return;
    }
    try {
      // Fail-closed: debug-token bara i dev. Glöms variabeln eller får fel
      // värde i prod-build → debug är AV (säkert default).
      if (process.env.NEXT_PUBLIC_APP_ENV === 'development') {
        (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      mod.initializeAppCheck(appMod.default, {
        provider: new mod.ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      // HMR kan re-trigga init på samma app-instans → SDK:n kastar. Svälj.
      console.warn('[app-check] init skipped:', err);
    }
  })();
  return initPromise;
}
