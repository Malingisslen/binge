import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);

// Emulator-koppling: aktiveras när NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true.
// Vi kopplar bara en gång per app-instans — getApps()-guarden ovan säkerställer
// att detta bara körs en gång per page load.
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true' &&
  getApps().length === 1
) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    // eslint-disable-next-line no-console
    console.info('[firebase] emulator mode — auth:9099, firestore:8080');
  } catch (err) {
    // Dubbel-initialisering (HMR i dev) → redan kopplad. Okej att svälja.
    // eslint-disable-next-line no-console
    console.warn('[firebase] emulator connect skipped:', err);
  }
}

export default app;
