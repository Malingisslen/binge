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
