import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import app from '@/lib/firebase/config';

let initialized = false;

// Måste anropas från en useEffect (efter React 19-hydration). Idempotent —
// säker att kalla flera gånger (StrictMode dubbelkör mount-effekter i dev).
//
// initializeAppCheck() är synkron men reCAPTCHA-libbet laddas async i
// bakgrunden. När andra Firebase-tjänster (Auth, Firestore) frågar efter
// en App Check-token via getToken() köar SDK:n requesten tills reCAPTCHA
// är klar — så vi behöver inte vänta in init innan auth-subscribe firar.
export function initAppCheck(): void {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  const siteKey = process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY;
  if (!siteKey) {
    // No-op utan site key är en medveten säker default — men i en prod-build
    // betyder det att bot-skyddet är AV. Logga en varning så en oavsiktlig
    // prod-deploy utan nyckel märks (S8). I dev är frånvaron väntad.
    if (process.env.NEXT_PUBLIC_APP_ENV === 'production') {
      console.warn('[app-check] NEXT_PUBLIC_APP_CHECK_SITE_KEY saknas — App Check är inaktiverat i produktion.');
    }
    return;
  }

  initialized = true;
  try {
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
}
