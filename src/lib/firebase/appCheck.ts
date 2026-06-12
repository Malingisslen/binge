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
