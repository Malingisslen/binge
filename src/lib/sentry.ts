'use client';

/**
 * Sentry-initialisering för Binge.
 *
 * Designprinciper:
 * - Opt-in via NEXT_PUBLIC_SENTRY_DSN. Tomt DSN → no-op, vilket gör att
 *   CI-builds, lokal dev och test-miljöer aldrig skickar events.
 * - SDK:n LAZY-importeras (samma mönster som messaging.ts) — @sentry/react
 *   är 26 KB gzip och ska inte ligga i first-load-bundlen på varje sida.
 *   captureError no-op:ar tills SDK:n laddats; fel som inträffar innan
 *   SDK-chunken hunnit hämtas (sekunder på långsamma nätverk) tappas
 *   medvetet — samma utfall som när DSN saknas.
 * - email/username/UID scrubbas via beforeSend.
 * - Sampling: 100% errors, 0% performance (traces) i startläge.
 * - release = git-SHA om satt, annars 'dev'.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'production';
const RELEASE = process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev';

type SentryModule = typeof import('@sentry/react');

/**
 * BIN-1283: sidans adress, rensad innan den skickas till Sentry (USA).
 *
 * Frågesträngen tas bort, och segmentet efter en dynamisk väg byts mot en
 * platshållare. `/user/<användarnamn>` bär ett användarnamn, och
 * `/tillsammans/<id>` är själva länken som ger åtkomst till en session (ADR 0015).
 * `/grupper/<id>` och `/list/<id>` pekar ut en enskild persons data.
 *
 * En absolut URL behåller sitt ursprung; en ren sökväg förblir en sökväg. Det som
 * inte går att tolka lämnas orört hellre än att eventet tappas.
 */
const SCRUBBED_SEGMENTS: Record<string, string> = {
  user: ':username',
  tillsammans: ':session',
  grupper: ':group',
  list: ':list',
};

/** A Firestore document path in an error text, reduced to its collection names. */
// The full resource name (`.../documents/users/<uid>/...`), the SDK's validation
// message (`... in document users/<uid>/...)`), and its odd-segment message below.
export function scrubFirestorePaths(text: string): string {
  const ids = (path: string, skip: number) =>
    path
      .split('/')
      .map((seg, i) => (i >= skip && (i - skip) % 2 === 1 ? ':id' : seg))
      .join('/');
  return text
    .replace(/documents\/[^\s"'`)]+/g, (path) => ids(path, 1))
    .replace(/(in document )([^\s"'`)]+)/g, (_m, lead: string, path: string) => lead + ids(path, 0))
    // BIN-1300: the SDK's odd-segment message, "... but users/<uid>/watchlist has 3 ...".
    .replace(/(but )([^\s"'`)]+\/[^\s"'`)]+)( has )/g, (_m, lead: string, path: string, tail: string) => lead + ids(path, 0) + tail);
}

export function scrubUrlPath(raw: string): string {
  let u: URL;
  const isPath = raw.startsWith('/');
  try {
    u = new URL(raw, isPath ? 'https://x.invalid' : undefined);
  } catch {
    return raw;
  }
  u.search = '';
  u.hash = '';
  const parts = u.pathname.split('/');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const placeholder = SCRUBBED_SEGMENTS[parts[i]];
    if (placeholder && parts[i + 1] && parts[i + 1] !== 'ny') parts[i + 1] = placeholder;
  }
  u.pathname = parts.join('/');
  return isPath ? u.pathname : u.toString();
}

let sentry: SentryModule | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Startar (en gång) den lazy SDK-laddningen och returnerar ett löfte som
 * resolvar när SDK:n är initierad — eller direkt när den är en no-op (inget
 * DSN / server). Returvärdet finns för anropare som måste rapportera ETT fel
 * omedelbart efter init (global-error.tsx): utan att invänta laddningen skulle
 * captureError alltid falla igenom som no-op. Vanliga anropare ignorerar det.
 */
export function initSentry(): Promise<void> {
  if (initPromise) return initPromise;
  if (!DSN) return Promise.resolve(); // no-op i dev/CI om DSN saknas
  if (typeof window === 'undefined') return Promise.resolve();

  const loading = import('@sentry/react')
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
            // BIN-1283: `id` också. Appen sätter ingen användare i dag, men
            // integritetssidan lovar att användar-id rensas.
            delete event.user.id;
            delete event.user.email;
            delete event.user.username;
            delete event.user.ip_address;
          }
          if (event.request?.url) event.request.url = scrubUrlPath(event.request.url);
          // SDK:ns HttpContext lägger `document.referrer` här, och binge.nu:s
          // Referrer-Policy skickar hela sökvägen inom sajten.
          const referer = event.request?.headers?.Referer;
          if (event.request?.headers && typeof referer === 'string') {
            event.request.headers.Referer = scrubUrlPath(referer);
          }
          if (event.transaction) event.transaction = scrubUrlPath(event.transaction);
          // Ett fel utan stack får sidans adress som filnamn, och ett Firestore-fel
          // kan bära en dokumentsökväg med uid och grupp-id i sitt meddelande.
          for (const ex of event.exception?.values ?? []) {
            if (ex.value) ex.value = scrubFirestorePaths(ex.value);
            for (const frame of ex.stacktrace?.frames ?? []) {
              if (frame.filename) frame.filename = scrubUrlPath(frame.filename);
              if (frame.abs_path) frame.abs_path = scrubUrlPath(frame.abs_path);
            }
          }
          if (event.message) event.message = scrubFirestorePaths(event.message);
          return event;
        },
        // BIN-1283: navigeringsspåret bär samma adresser som eventet självt.
        beforeBreadcrumb(crumb) {
          // Konsolrader bär godtyckliga argument (grupp-id, felmeddelanden), och
          // klickspåret bär element-attribut som aria-label med visningsnamn.
          if (crumb.category === 'console') return null;
          if (crumb.category?.startsWith('ui.')) delete crumb.message;
          if (crumb.message) crumb.message = scrubFirestorePaths(crumb.message);
          const data = crumb.data;
          if (data) {
            for (const key of ['from', 'to', 'url']) {
              if (typeof data[key] === 'string') data[key] = scrubUrlPath(data[key] as string);
            }
          }
          return crumb;
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
      // Tillåt nytt försök om initSentry() anropas igen — i praktiken sker
      // det inte (Providers.tsx kör sin effect en gång per sidladdning), så
      // en adblocker-blockerad chunk ger INTE en retry-loop. Defensiv hygien.
      initPromise = null;
    });

  initPromise = loading;
  return loading;
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
