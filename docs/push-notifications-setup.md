# Push-notifs (FCM) — verification & troubleshooting

FCM web push is **live**. This is the runbook for verifying it and diagnosing failures — the
one-time setup (Blaze upgrade, VAPID key, service-worker config, first functions/rules deploy)
is done. Push is opt-in per device (Inställningar → Notifikationer); browsers without support
(iOS Safari < 16.4, some privacy modes) hide the toggle.

The publik values in `public/firebase-messaging-sw.js` are hardcoded because a service worker
can't read `process.env` — they're already public in the served bundle, so that's not a
security regression. `NEXT_PUBLIC_FCM_VAPID_KEY` must be present in the env where `next build`
runs (incl. CI), or the settings toggle shows "Push är inte konfigurerad".

## Smoke test

1. Log in from a push-capable browser (Chrome/Firefox/Edge, Safari ≥ 16.4).
2. Settings → **Notifikationer** → toggle on. Accept the browser permission dialog.
3. Expect a toast + a new doc in `users/{uid}/fcmTokens/`.
4. From a second account, trigger a push (e.g. friend request) → within ~10 s an OS notif
   appears on the first device; clicking it deep-links into the app.
5. **Foreground suppression is intentional:** if the tab is open and focused, the notif shows
   as an in-app toast instead of an OS notif.
6. **Cleanup:** toggling off deletes the token doc + runs browser-side `deleteToken()`;
   toggling back on creates a fresh token doc.

## Troubleshooting

- **"Push är inte konfigurerad — NEXT_PUBLIC_FCM_VAPID_KEY saknas"** — the VAPID key isn't in
  the build env (incl. CI/CD).
- **"Notiser blockerade i webbläsaren"** — user previously chose "Block"; must clear it in the
  browser's site settings (Chrome: lock icon → Notifications → Allow).
- **Push doesn't arrive** — check, in order: (1) `firebase functions:log` for errors;
  (2) `users/{uid}/fcmTokens/` has ≥1 doc AND `notificationSettings.pushEnabled === true` on
  the user doc; (3) DevTools Console for CSP violations at SW registration; (4) DevTools →
  Application → Service Workers → `firebase-messaging-sw.js` is "activated and running".
- **`messaging/registration-token-not-registered` in logs** — expected (user removed the app /
  reset browser storage). Functions delete the token doc automatically.

## Cost monitoring

Realistic baseline: 1–10 pushes/day → ~$0.01/month Cloud Functions execution + ~$0.0001/month
FCM send (FCM itself is free). The Blaze budget cap (§ External Actions) is the guard.
`firebase functions:log` verifies nothing is looping.

## Not built (out of scope)

Per-channel opt-out (today it's all-on/all-off), a notif-history view, and native iOS push via
installed PWA.
