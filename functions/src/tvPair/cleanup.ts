/**
 * Städning efter TV-kopplingar (BIN-1471). Firestore-triggers, eftersom varken reglerna
 * eller klientens kontoradering når Auth-konton eller `tvPairings`.
 *
 *  tvDeviceDeleted  raden users/{uid}/tvDevices/{deviceId} är borta (ägaren kopplade bort TV:n,
 *                   kontoraderingen tog den, eller poll återställde efter misslyckad token):
 *                   radera TV:ns Auth-konto `tv_<enhet>` så det inte blir kvar.
 *  tvOwnerDeleted   ägarens profil users/{uid} är borta: radera kopplingskoder hen godkänt
 *                   (`approvedBy`) i stället för att vänta på TTL.
 *
 * Båda tål att köras flera gånger (Firestores leverans är minst-en-gång) och att målet redan
 * saknas.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { tvPrincipalUid, isAuthUserNotFound } from './logic';

const REGION = 'europe-west1';

export const tvDeviceDeleted = onDocumentDeleted(
  { document: 'users/{uid}/tvDevices/{deviceId}', region: REGION, retry: true, maxInstances: 5 },
  async (event) => {
    const deviceId = event.params.deviceId;
    try {
      await getAuth().deleteUser(tvPrincipalUid(deviceId));
    } catch (e) {
      if (isAuthUserNotFound(e)) return;
      logger.error('[tvPair] could not delete TV auth account', { message: (e as Error).message });
      throw e; // låt triggern försöka igen
    }
  },
);

export const tvOwnerDeleted = onDocumentDeleted(
  { document: 'users/{uid}', region: REGION, retry: true, maxInstances: 5 },
  async (event) => {
    const db = getFirestore();
    const snap = await db.collection('tvPairings').where('approvedBy', '==', event.params.uid).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  },
);
