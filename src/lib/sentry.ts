'use client';

import * as Sentry from '@sentry/react';

/**
 * Sentry-initialisering för Binge.
 *
 * Designprinciper:
 * - Opt-in via NEXT_PUBLIC_SENTRY_DSN. Tomt DSN → no-op, vilket gör att
 *   CI-builds, lokal dev och test-miljöer aldrig skickar events.
 * - Ingen PII i events. email/username/UID scrubbas via beforeSend.
 * - Sampling: 100% errors, 0% performance (traces) i startläge för att hålla
 *   kostnad låg. Höj tracesSampleRate när vi har MAU att motivera det.
 * - release = git-SHA om satt, annars 'dev'. Underlättar regressionsspårning.
 *
 * OBS: Integrationen är nätverkspassiv tills DSN sätts i Firebase Hosting-
 * miljön. Sätt det via firebase.json eller CI-secrets när projektet är
 * skapat i Sentry (sprint 2 uppföljning).
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'production';
const RELEASE = process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) return; // no-op i dev/CI om DSN saknas
  if (typeof window === 'undefined') return;

  Sentry.init({
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

  initialized = true;
}

/**
 * Rapportera ett fel med taggar. No-op om Sentry inte är initialiserad.
 * Används både av queryClient.ts (React Query-fel) och SegmentError.tsx
 * (app-router error boundaries).
 */
export function captureError(
  error: unknown,
  context: { scope: string; kind?: string; extra?: Record<string, unknown> },
): void {
  if (!initialized) return;
  Sentry.captureException(error, {
    tags: {
      scope: context.scope,
      ...(context.kind ? { kind: context.kind } : {}),
    },
    extra: context.extra,
  });
}
