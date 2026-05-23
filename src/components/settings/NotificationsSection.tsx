'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { enablePushForUser, disablePushForUser, isPushSupported } from '@/lib/firebase/messaging';
import { SettingsCard } from './SettingsCard';

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
  const [busy, setBusy] = useState(false);

  if (!user || !uid) return null;
  // Servicen-stöd-check kan bara köras klient-sidigt; rendera ändå (med
  // disabled-meddelande om FCM inte stöds) så användaren förstår varför.
  const supported = typeof window !== 'undefined' ? isPushSupported() : true;
  const pushEnabled = user.notificationSettings.pushEnabled;

  async function handleToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <SettingsCard title="Notifikationer">
      <p className="text-xs text-text-muted mb-2">
        Få notiser när någon skickar en vänförfrågan eller när din grupp loggar
        en ny filmkväll. Notiser visas på den här enheten — andra enheter har
        sina egna inställningar.
      </p>

      {!supported ? (
        <div className="text-xs text-text-muted py-2">
          Push-notifs stöds inte i den här webbläsaren.
        </div>
      ) : (
        <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={pushEnabled}
            disabled={busy}
            onChange={(e) => { void handleToggle(e.target.checked); }}
            className="accent-accent w-[14px] h-[14px]"
          />
          Skicka push-notifs till den här enheten
        </label>
      )}

      {pushEnabled && (
        <p className="text-xxs text-text-muted mt-2">
          För att tysta notiser per kanal i framtiden — använd de andra
          inställningarna nedan när vi byggt ut dem.
        </p>
      )}
    </SettingsCard>
  );
}
