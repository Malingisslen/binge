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

// === Offline (BIN-1497) ===
// Samma worker äger scope '/', så offline-cachen måste bo här (en andra worker
// skulle ersätta push). Bara statiska, icke-personliga filer cachas: appskalet
// (HTML), JS/CSS och ikoner. Användardata ligger i Firestore-/React Query-cachen,
// aldrig här. Cachen byts när CACHE-namnet byts.
const CACHE = 'binge-shell-v1';
const MAX_ENTRIES = 400;
const NAV_TIMEOUT_MS = 4000;
// Skalen som dynamiska rutter (/movie/123 m.fl.) serveras från, se firebase.json.
const SHELL_PREFIXES = ['tillsammans', 'grupper', 'list', 'user'];
const SHELLS = ['/', '/_/index.html'].concat(SHELL_PREFIXES.map((p) => '/' + p + '/_/index.html'));
// Inloggning, funktioner och egna API-anrop ska aldrig cachas.
const NEVER_CACHE = /^\/(__\/|api\/)/;

function shellFor(pathname) {
  if (/^\/(movie|tv|person|provider)\//.test(pathname)) return '/_/index.html';
  for (const p of SHELL_PREFIXES) {
    if (pathname.startsWith('/' + p + '/')) return '/' + p + '/_/index.html';
  }
  return '/';
}

let puts = 0;

async function remember(request, response) {
  if (!response || !response.ok || response.type !== 'basic' || response.redirected) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  // Rensningen listar hela cachen, så den körs bara var 20:e sparning.
  if (++puts % 20 !== 0) return;
  const keys = await cache.keys();
  // Skalen är äldst men får aldrig rensas bort: utan dem går offlinestart inte.
  const evictable = keys.filter((k) => !SHELLS.includes(new URL(k.url).pathname));
  for (let i = 0; i < evictable.length - MAX_ENTRIES; i++) await cache.delete(evictable[i]);
}

function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () =>
      caches.match(request).then((hit) => hit || null);
    const timer = timeoutMs
      ? setTimeout(() => {
          fallback().then((hit) => {
            if (hit && !settled) {
              settled = true;
              resolve(hit);
            }
          });
        }, timeoutMs)
      : null;
    fetch(request)
      .then((response) => {
        remember(request, response).catch(() => {});
        if (!settled) {
          settled = true;
          resolve(response);
        }
      })
      .catch(() =>
        fallback().then(async (hit) => {
          if (settled) return;
          settled = true;
          if (hit) return resolve(hit);
          if (request.mode === 'navigate') {
            const shell = await caches.match(shellFor(new URL(request.url).pathname));
            if (shell) return resolve(shell);
          }
          resolve(Response.error());
        }),
      )
      .finally(() => timer && clearTimeout(timer));
  });
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    remember(request, response).catch(() => {});
    return response;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return;
  if (url.pathname.startsWith('/_next/static/')) {
    // Innehållshashade filnamn: en cachad fil är alltid rätt version.
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request, request.mode === 'navigate' ? NAV_TIMEOUT_MS : 0));
});

// Standard SW lifecycle — claim:a klienter direkt så vi inte behöver
// vänta på reload för första aktivering.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Skalen läggs undan direkt så första offlinestarten funkar även på sidor
  // som aldrig besökts. Misslyckas det (t.ex. nätet försvann) är det ofarligt.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELLS))
      .catch(() => {}),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith('binge-shell-') && n !== CACHE).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
