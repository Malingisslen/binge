'use client';

import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { enablePushForUser, isPushSupported } from '@/lib/firebase/messaging';
import { decideFollowPrompt, isAppleMobile } from './useFollowConfirmation.helpers';

function currentEnv(pushEnabled: boolean) {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const standalone = typeof window !== 'undefined' && (
    (nav as (Navigator & { standalone?: boolean }) | null)?.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true
  );
  return {
    pushEnabled,
    pushSupported: isPushSupported(),
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
    appleMobile: nav ? isAppleMobile(nav.userAgent, nav.maxTouchPoints ?? 0) : false,
    standalone,
  };
}

/**
 * BIN-1442 — the toast after following the first series asks about
 * notifications, in place of the plain "— Följer" confirmation. "Ja" runs the
 * same steps as the switch in Inställningar, from the tap itself (browsers only
 * show the permission prompt for a user gesture).
 */
export function useFirstFollowConfirmation() {
  const { uid, user, updateNotificationSettings } = useAuth();
  const { show: toast } = useToast();
  const pushEnabled = user?.notificationSettings?.pushEnabled === true;

  return useCallback((title: string, plainConfirmation: string) => {
    const prompt = decideFollowPrompt(currentEnv(pushEnabled));
    if (prompt === 'ask' && uid) {
      toast(`Du följer ${title}. Vill du få en notis när nästa avsnitt släpps?`, [
        {
          label: 'Ja, skicka notis',
          onClick: () => {
            // No await before enablePushForUser: Safari only shows the permission
            // prompt while the tap still counts as the user's gesture.
            void (async () => {
              try {
                await enablePushForUser(uid);
                await updateNotificationSettings({ pushEnabled: true });
                toast('Push-notiser på');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Kunde inte slå på notiser. Försök igen under Inställningar.');
              }
            })();
          },
        },
        { label: 'Inte nu', onClick: () => {} },
      ]);
      return;
    }
    if (prompt === 'homescreen-tip') {
      toast(`Du följer ${title}. Lägg Binge på hemskärmen för att få notiser. Tryck på Dela och sedan Lägg till på hemskärmen.`, { label: 'OK', onClick: () => {} });
      return;
    }
    toast(plainConfirmation);
  }, [uid, pushEnabled, toast, updateNotificationSettings]);
}
