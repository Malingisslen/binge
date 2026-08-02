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
 * - Ingen PII i events. email/username/UID scrubbas via beforeSend.
 * - Sampling: 100% errors, 0% performance (traces) i startläge.
 * - release = git-SHA om satt, annars 'dev'.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'production';
const RELEASE = process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev';

type SentryModule = typeof import('@sentry/react');

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
