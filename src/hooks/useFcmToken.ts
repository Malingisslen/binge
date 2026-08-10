'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { isPushSupported, subscribeToForegroundMessages } from '@/lib/firebase/messaging';

/**
 * Subscribe på foreground-messages när användaren är inloggad och har
 * pushEnabled=true. Visar in-app-toast istället för OS-notif (FCM
 * suppressar OS-notif automatiskt när onMessage-listener finns).
 *
 * Detta är en passive-hook — den registrerar inte tokens, det görs i
 * NotificationsSection när användaren toggles ON. Den enda jobbet här är
 * att lyssna på inkommande push:ar medan appen är öppen.
 */
export function useFcmForeground() {
  const { user, uid } = useAuth();
  const { show: toast } = useToast();

  useEffect(() => {
    // BIN-844 note, deliberately NOT a `hasLocalPushToken(uid)` guard here.
    //
    // Since sign-out unregisters the device without touching the account-level
    // `pushEnabled`, this hook does subscribe on devices that can no longer receive —
    // wasted chunk load and a dead listener. Guarding on the local token was tried and
    // reverted: this effect's deps are `[uid, pushEnabled, toast]`, and none of them
    // changes when a token appears. On a SECOND device for an account that already
    // has push on, ticking the Settings box writes the token but leaves `pushEnabled`
    // at `true` — no dep changes, the effect never re-runs, and the foreground
    // listener is missing until a reload. Trading a real bug for an optimisation is
    // the wrong way round.
    //
    // Doing it properly needs a signal this hook can subscribe to (a token version
    // bumped by enable/disable). Filed rather than improvised.
    if (!uid || !user?.notificationSettings.pushEnabled) return;
    if (!isPushSupported()) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToForegroundMessages((payload) => {
      const text = payload.title
        ? payload.body
          ? `${payload.title} — ${payload.body}`
          : payload.title
        : payload.body ?? 'Ny notis';
      toast(text);
    })
      .then(unsub => {
        if (cancelled) {
          unsub();
        } else {
          unsubscribe = unsub;
        }
      })
      .catch(err => {
        // FCM kan failas på inkognito + iOS < 16.4 — irrelevant ljudligt.
        console.warn('[fcm] foreground subscribe failed', err);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [uid, user?.notificationSettings.pushEnabled, toast]);
}
