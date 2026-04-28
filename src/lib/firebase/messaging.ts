'use client';

import {
  doc,
  collection,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './config';

// Lazy-importerar firebase/messaging eftersom den drar in en relativt stor
// chunk + bryter SSR (window-references). Importeras bara när användaren
// faktiskt aktiverar push i settings.

const VAPID_KEY = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;

// Singleton för att inte registrera samma SW flera gånger på en sidvisning.
let messagingPromise: ReturnType<typeof import('firebase/messaging').getMessaging> | null = null;

async function getMessagingInstance() {
  if (!messagingPromise) {
    const { getMessaging, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) {
      throw new Error('FCM stöds inte i den här webbläsaren.');
    }
    const { default: app } = await import('./config');
    messagingPromise = getMessaging(app);
  }
  return messagingPromise;
}

/**
 * Registrerar service worker:en i `/firebase-messaging-sw.js` och returnerar
 * registreringen. Idempotent — webbläsaren cachear SW:n så upprepade calls
 * är billiga.
 */
async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers stöds inte i den här webbläsaren.');
  }
  // Använd existing registration om det finns — annars registrera ny.
  const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

/**
 * Begär notif-permission, registrerar SW + hämtar FCM-token, sparar till
 * Firestore. Returnerar tokenId (Firestore-doc-ID) som kan användas för
 * senare delete.
 *
 * Kastar med läsbar text om något steg failar — UI:n showar en toast.
 */
export async function enablePushForUser(uid: string, userAgent?: string): Promise<string> {
  if (!VAPID_KEY) {
    throw new Error('Push är inte konfigurerad — NEXT_PUBLIC_FCM_VAPID_KEY saknas.');
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    throw new Error('Push kan bara aktiveras i webbläsaren.');
  }

  // Steg 1: be om browser-permission. Detta måste ske som direkt resultat
  // av en användarinteraktion (klick), annars kastar vissa webbläsare.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notiser blockerade i webbläsaren — aktivera dem i webbplats-inställningarna.'
        : 'Notiser inte tillåtna.',
    );
  }

  // Steg 2: registrera SW + hämta FCM-token.
  const registration = await ensureServiceWorkerRegistration();
  const messaging = await getMessagingInstance();
  const { getToken } = await import('firebase/messaging');
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) {
    throw new Error('Kunde inte hämta push-token. Försök igen.');
  }

  // Steg 3: spara token i users/{uid}/fcmTokens. Använd autoid så samma
  // device kan få nytt doc om token roterar utan duplikat-kollision.
  const tokensCol = collection(db, 'users', uid, 'fcmTokens');
  const tokenDoc = doc(tokensCol);
  await setDoc(tokenDoc, {
    token,
    createdAt: serverTimestamp(),
    lastUsedAt: serverTimestamp(),
    userAgent: userAgent ?? navigator.userAgent ?? '',
  });

  // Spara doc-id i localStorage så vi vet vilken doc att radera vid disable
  // utan att läsa hela tokens-collection och matcha på token-värde.
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`binge:fcm:tokenId:${uid}`, tokenDoc.id);
  }

  return tokenDoc.id;
}

/**
 * Inverteringen av enablePushForUser — rensar denna devices token både
 * lokalt (deleteToken) och i Firestore. Andra enheters tokens lämnas
 * orörda.
 */
export async function disablePushForUser(uid: string): Promise<void> {
  // Försök radera Firestore-doc:et även om FCM-deleteToken failar — det
  // viktiga är att Cloud Functions inte fortsätter skicka push hit.
  let firestoreErr: unknown;
  if (typeof localStorage !== 'undefined') {
    const tokenId = localStorage.getItem(`binge:fcm:tokenId:${uid}`);
    if (tokenId) {
      try {
        await deleteDoc(doc(db, 'users', uid, 'fcmTokens', tokenId));
      } catch (err) {
        firestoreErr = err;
      }
      localStorage.removeItem(`binge:fcm:tokenId:${uid}`);
    }
  }

  try {
    const messaging = await getMessagingInstance();
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(messaging);
  } catch {
    // deleteToken kan failas om SW inte är registrerad eller om browser
    // inte stödjer push — irrelevant, vi har raderat Firestore-doc:et.
  }

  if (firestoreErr) throw firestoreErr;
}

/**
 * Subscribe på onMessage-events när appen är i fokus. Returnerar unsub.
 * Använd från en hook för att visa in-app-toasts istället för OS-notifs
 * när användaren redan har appen öppen (mer subtil UX).
 */
export async function subscribeToForegroundMessages(
  callback: (payload: { title?: string; body?: string; link?: string }) => void,
): Promise<() => void> {
  const messaging = await getMessagingInstance();
  const { onMessage } = await import('firebase/messaging');
  return onMessage(messaging, (payload) => {
    callback({
      title: payload.notification?.title,
      body: payload.notification?.body,
      link: payload.fcmOptions?.link ?? (payload.data?.link as string | undefined),
    });
  });
}

/**
 * Snabb sniff utan att importera FCM-libs — användbart för UI:n att gömma
 * push-toggle helt på iOS Safari < 16.4 eller andra obekanta klienter.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator
    && 'Notification' in window
    && 'PushManager' in window
  );
}
