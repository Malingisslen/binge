'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { enablePushForUser, disablePushForUser, isPushSupported, hasLocalPushToken, hasLivePushToken } from '@/lib/firebase/messaging';
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

  // BIN-844: `pushEnabled` is ACCOUNT-level and cannot say whether THIS device is
  // registered. Since sign-out now unregisters the device without touching the
  // account flag, a checkbox bound to `pushEnabled` alone would render ticked after
  // the next sign-in while nothing arrives here — and the user would have no reason
  // to touch it. So the box reflects both: the account wants push AND this device
  // holds a token.
  //
  // Read in an effect, not during render: localStorage does not exist on the server,
  // and reading it inline would make the first client render disagree with the markup
  // it hydrates. Declared ABOVE the `!user || !uid` early return — a hook after it
  // would change hook order between renders.
  //
  // Two passes, and the order matters. The synchronous pointer answers first so the
  // box paints exactly as it does today, then the Firestore doc refines it — because
  // the pointer can outlive the registration it points at (FCM's self-heal, BIN-848's
  // sweep, a sign-out delete that lands after unload). Only `hasLivePushToken` may
  // move the box from ticked to empty, and only on a server-confirmed absence.
  const [hasDeviceToken, setHasDeviceToken] = useState(false);
  const pushBusy = busyKeys.has('push');
  useEffect(() => {
    if (!uid) return;
    setHasDeviceToken(hasLocalPushToken(uid));
    let cancelled = false;
    // The guard is load-bearing: this effect re-runs on `busyKeys`, so a slow read
    // from the previous run could otherwise land after a newer one and overwrite it.
    void hasLivePushToken(uid).then(live => { if (!cancelled) setHasDeviceToken(live); });
    return () => { cancelled = true; };
    // The push toggle's own busy state, NOT the whole `busyKeys` set: the set is
    // shared by all six toggles, so depending on it re-ran this Firestore read on
    // every click anywhere in the section. Depending on the boolean re-reads after
    // the push toggle settles — which is what makes the box tick without a reload —
    // and ignores the other five.
  }, [uid, pushBusy]);

  if (!user || !uid) return null;
  // Servicen-stöd-check kan bara köras klient-sidigt; rendera ändå (med
  // disabled-meddelande om FCM inte stöds) så användaren förstår varför.
  const supported = typeof window !== 'undefined' ? isPushSupported() : true;
  const pushEnabled = user.notificationSettings.pushEnabled;
  const pushOnThisDevice = pushEnabled && hasDeviceToken;

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

  async function handlePriceDropsToggle(next: boolean) {
    if (busyKeys.has('priceDrops')) return;
    setBusyKey('priceDrops', true);
    try {
      await updateNotificationSettings({ priceDrops: next });
      toast(next ? 'Prisrasnotiser på' : 'Prisrasnotiser av');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('priceDrops', false);
    }
  }

  async function handleRotationToggle(next: boolean) {
    if (busyKeys.has('rotation')) return;
    setBusyKey('rotation', true);
    try {
      await updateNotificationSettings({ rotationReminders: next });
      toast(next ? 'Rotationspåminnelser på' : 'Rotationspåminnelser av');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('rotation', false);
    }
  }

  async function handleWeeklyDigestToggle(next: boolean) {
    if (busyKeys.has('weeklyDigest')) return;
    setBusyKey('weeklyDigest', true);
    try {
      await updateNotificationSettings({ weeklyDigest: next });
      toast(next ? 'Veckodigest på' : 'Veckodigest av');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunde inte ändra notisinställningar. Försök igen om en stund.');
    } finally {
      setBusyKey('weeklyDigest', false);
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
            checked={pushOnThisDevice}
            disabled={pushBusy}
            onChange={(e) => { void handleToggle(e.target.checked); }}
            className="accent-acc-deep w-[14px] h-[14px]"
          />
          Skicka push-notiser till den här enheten
        </label>
      )}

      {/*
        The account wants push, this device has no registration. Without a line here
        the only signal is an empty box, which is what "nobody finds out their push
        died" looks like. #19 Customer Support required a blame-free cause in the
        wording: an un-tick the user did not cause otherwise reads as "something is
        wrong with my account".

        `pushEnabled` is account-level, so this covers TWO situations at once: a
        device that lost its registration, and a device that never had one because
        push was enabled on a different one. The copy must therefore not presuppose
        the first — an earlier draft said "igen" and named a browser wipe as the
        cause, which is simply wrong on a second device.
      */}
      {supported && pushEnabled && !hasDeviceToken && (
        <p className="text-xs text-ink-3 mt-1">
          Push är inte påslagen på den här enheten. Varje enhet har sin egen
          inställning, och den nollställs om du rensar webbläsaren — kryssa i rutan
          för att slå på den här.
        </p>
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

      <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
        <input type="checkbox" checked={user.notificationSettings.priceDrops} disabled={busyKeys.has('priceDrops')}
          onChange={(e) => { void handlePriceDropsToggle(e.target.checked); }}
          className="accent-acc-deep w-[14px] h-[14px]" />
        Notiser när priset rasar på en film jag vill se
      </label>

      <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
        <input type="checkbox" checked={user.notificationSettings.rotationReminders} disabled={busyKeys.has('rotation')}
          onChange={(e) => { void handleRotationToggle(e.target.checked); }}
          className="accent-acc-deep w-[14px] h-[14px]" />
        Påminnelser om att pausa/återuppta tjänster (rotationskalendern)
      </label>

      <label className="flex items-center gap-2 cursor-pointer text-base mt-3">
        <input type="checkbox" checked={user.notificationSettings.weeklyDigest} disabled={busyKeys.has('weeklyDigest')}
          onChange={(e) => { void handleWeeklyDigestToggle(e.target.checked); }}
          className="accent-acc-deep w-[14px] h-[14px]" />
        Veckodigest: titlar som lämnar dina tjänster snart + nytt den här veckan
      </label>
    </SettingsSection>
  );
}
