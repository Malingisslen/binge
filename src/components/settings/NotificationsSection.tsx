'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { enablePushForUser, disablePushForUser, isPushSupported } from '@/lib/firebase/messaging';
import { SettingsSection } from './SettingsSection';

/**
 * Push-notif-toggle (Fas 4). Två tillstånd:
 *
 * - PÅ:  notifs visas som OS-notifs när appen är stängd, och som in-app
 *        toasts när appen är öppen (foreground onMessage).
 * - AV:  inga push:ar. Cloud Functions skippar tokens där pushEnabled=false.
 *
 * Browser-permission grantas vid PÅ-toggle (måste ske i samma click-handler
 * som user-interaction). Om användaren tidigare har "denied" i webbläsaren
 * måste de manuellt återställa via webbplats-inställningarna.
 */
export function NotificationsSection() {
  const { user, uid, updateNotificationSettings } = useAuth();
  const { show: toast } = useToast();
  // BIN-160: per-toggle busy-state (inte en delad boolean) så att en in-flight
  // skrivning för en toggle inte blockerar/sväljer klick på de andra två.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const setBusyKey = (key: string, val: boolean) => setBusyKeys(prev => {
    const next = new Set(prev);
    if (val) next.add(key); else next.delete(key);
    return next;
  });

  if (!user || !uid) return null;
  // Servicen-stöd-check kan bara köras klient-sidigt; rendera ändå (med
  // disabled-meddelande om FCM inte stöds) så användaren förstår varför.
  const supported = typeof window !== 'undefined' ? isPushSupported() : true;
  const pushEnabled = user.notificationSettings.pushEnabled;

  // Samma busy-guard + try/catch+toast som handleToggle — annars kan snabba
  // klick fyra parallella skrivningar och ett offline-fel sväljs tyst (UI:t
  // hamnar ur synk med Firestore tills nästa profil-laddning).
  async function handleEpisodeReleasesToggle(next: boolean) {
    if (busyKeys.has('episodeReleases')) return;
    setBusyKey('episodeReleases', true);
    try {
      await updateNotificationSettings({ episodeReleases: next });
      toast(next ? 'Avsnittsnotiser på' : 'Avsnittsnotiser av');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('episodeReleases', false);
    }
  }

  async function handleAvailableToggle(next: boolean) {
    if (busyKeys.has('available')) return;
    setBusyKey('available', true);
    try {
      await updateNotificationSettings({ availableOnMyServices: next });
      toast(next ? 'Tillgänglighetsnotiser på' : 'Tillgänglighetsnotiser av');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('available', false);
    }
  }

  async function handleToggle(next: boolean) {
    if (busyKeys.has('push')) return;
    setBusyKey('push', true);
    try {
      if (next) {
        // Sätter inte pushEnabled förrän token-registrering lyckats — annars
        // skulle Cloud Functions tro att vi har push aktivt utan att ha en
        // token att skicka till.
        await enablePushForUser(uid!);
        await updateNotificationSettings({ pushEnabled: true });
        toast('Push-notiser på');
      } else {
        await disablePushForUser(uid!);
        await updateNotificationSettings({ pushEnabled: false });
        toast('Push-notiser av');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('push', false);
    }
  }

  return (
    <SettingsSection title="Notifikationer">
      <p className="text-xs text-ink-3 mb-2">
        Få notiser när någon skickar en vänförfrågan eller när din grupp loggar
        en ny filmkväll. Notiser visas på den här enheten — andra enheter har
        sina egna inställningar.
      </p>

      {!supported ? (
        <div className="text-xs text-ink-3 py-2">
          Push-notiser stöds inte i den här webbläsaren.
        </div>
      ) : (
        <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={pushEnabled}
            disabled={busyKeys.has('push')}
            onChange={(e) => { void handleToggle(e.target.checked); }}
            className="accent-acc-deep w-[14px] h-[14px]"
          />
          Skicka push-notiser till den här enheten
        </label>
      )}

      <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
        <input type="checkbox" checked={user.notificationSettings.episodeReleases} disabled={busyKeys.has('episodeReleases')}
          onChange={(e) => { void handleEpisodeReleasesToggle(e.target.checked); }}
          className="accent-acc-deep w-[14px] h-[14px]" />
        Notiser när en serie jag följer släpper ett nytt avsnitt
      </label>

      <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
        <input type="checkbox" checked={user.notificationSettings.availableOnMyServices} disabled={busyKeys.has('available')}
          onChange={(e) => { void handleAvailableToggle(e.target.checked); }}
          className="accent-acc-deep w-[14px] h-[14px]" />
        Notiser när en titel jag vill se dyker upp på en tjänst jag har
      </label>
    </SettingsSection>
  );
}
