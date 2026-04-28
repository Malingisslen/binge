/* eslint-disable */
/**
 * Firebase Cloud Messaging service worker — Fas 4 push-notifs.
 *
 * MÅSTE ligga på origin-roten (`/firebase-messaging-sw.js`) — FCM letar
 * efter den här exakta URL:en när `getMessaging().getToken()` körs.
 * `public/`-mappen kopieras 1:1 till `out/` av next build (static export).
 *
 * KONFIGURATION:
 * Service workers kan inte importera process.env (de är frikopplade från
 * Next.js-bundlern). Vi hardcodar därför projekt-config:en nedan. Värdena
 * är desamma NEXT_PUBLIC_FIREBASE_* som finns i .env.local — och som ändå
 * exponeras till klienten i den serverade JS-bundeln. Ingen säkerhets-
 * regression.
 *
 * För att hämta värdena:
 *   firebase apps:sdkconfig --project binge-nu WEB
 *
 * Eller från Firebase Console: Project Settings → General → Your apps →
 * Web app → SDK setup and configuration.
 *
 * VAPID-key sätts SEPARAT i klienten (NEXT_PUBLIC_FCM_VAPID_KEY) — den
 * behövs bara vid getToken(), inte i SW:n.
 */

importScripts('https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js');

// === KONFIGURERA: ersätt nedan med värden från `firebase apps:sdkconfig` ===
firebase.initializeApp({
  apiKey: 'AIzaSyBdEFOnai3-jfg_r_62bYFBzmKKpgZ_qsk',
  authDomain: 'binge-nu.firebaseapp.com',
  projectId: 'binge-nu',
  storageBucket: 'binge-nu.firebasestorage.app',
  messagingSenderId: '879931819959',
  appId: '1:879931819959:web:61d5a48329ac329f128a32',
});

const messaging = firebase.messaging();

// onBackgroundMessage triggas BARA när appen INTE är i fokus. När appen är
// öppen hanteras push:en av onMessage-listenern i klient-koden — det är
// medvetet, för då vill vi visa en in-app-toast istället för OS-notif.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Binge';
  const body = (payload.notification && payload.notification.body) || '';
  // fcmOptions.link skickas från Cloud Function; default är '/'.
  const link =
    (payload.fcmOptions && payload.fcmOptions.link) ||
    (payload.data && payload.data.link) ||
    '/';
  // Tag används för att samma logiska notif (t.ex. en specifik vänförfrågan)
  // ska ersätta tidigare istället för att stapla i notif-centern.
  const tag =
    (payload.notification && payload.notification.tag) ||
    (payload.data && payload.data.tag);

  self.registration.showNotification(title, {
    body: body,
    icon: '/og-image.svg',
    badge: '/og-image.svg',
    tag: tag,
    renotify: !!tag,
    data: { link: link },
  });
});

// Klick på notif → fokusera befintlig flik om den finns, annars öppna ny.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const targetUrl = new URL(link, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          // Hitta första binge-flik som matchar origin. focus() + navigate()
          // ger bättre UX än att alltid öppna ny — användaren har sin auth-
          // session redan laddad.
          if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
            client.focus();
            if ('navigate' in client) {
              return client.navigate(targetUrl);
            }
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});

// Standard SW lifecycle — claim:a klienter direkt så vi inte behöver
// vänta på reload för första aktivering.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
