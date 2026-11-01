/**
 * Kodinloggning för TV-appen (BIN-1471), samma form som OAuth device grant.
 *
 *  tvPairStart   TV:n ber om en kod (oautentiserad, kräver App Check).
 *  tvPairApprove inloggad telefon godkänner koden.
 *  tvPairPoll    TV:n hämtar sin inloggning när koden är godkänd.
 *
 * TV:n loggar in som en EGEN principal (`tv_<enhet>` med ownerUid-claim), aldrig som
 * ägarens uid: med ägarens uid skulle den ärva admin och kunna radera kontot via
 * Auth-API:t, som regler inte når. Reglerna släpper bara in TV på uttryckligt
 * namngivna sökvägar och kräver att enhetens rad i users/{uid}/tvDevices finns,
 * så "Koppla bort" slår igenom direkt utan att telefonen loggas ut.
 *
 * `tvPairings` och `tvRate` har ingen match-sats i reglerna: bara dessa funktioner
 * (Admin SDK) når dem. Giltigheten kontrolleras här mot expiresAt, eftersom
 * Firestores TTL-radering kan dröja ca ett dygn.
 */
import { getFirestore, FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { stockholmDayId } from '../util/dayId';
import {
  PAIRING_TTL_MS, PAIRING_ROW_TTL_MS, MAX_TV_DEVICES, RATE_LIMITS,
  generateUserCode, generateDeviceSecret, generateDeviceId, normalizeUserCode, sha256Hex,
  secretMatches, sanitizeDeviceName, isExpired, nextRateState, ipRateKey, pollTooSoon, tvPrincipalUid,
  type RateState,
} from './logic';

const REGION = 'europe-west1';
const QR_BASE = 'https://binge.nu/tv?kod=';

function clientIp(request: { rawRequest?: { ip?: string } }): string {
  return request.rawRequest?.ip ?? 'unknown';
}

/** Tar en plats i ett räknefönster, eller kastar resource-exhausted. Egen transaktion per nyckel. */
export async function takeRate(key: string, limit: { max: number; windowMs: number }): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`tvRate/${key}`);
  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const prev: RateState | null = snap.exists
      ? { windowStartMs: snap.get('windowStartMs') as number, count: snap.get('count') as number }
      : null;
    const now = Date.now();
    const next = nextRateState(prev, now, limit);
    if (!next) throw new HttpsError('resource-exhausted', 'För många försök. Vänta en stund och försök igen.');
    tx.set(ref, { ...next, expireAt: Timestamp.fromMillis(now + limit.windowMs + PAIRING_ROW_TTL_MS) });
  });
}

export const tvPairStart = onCall(
  { region: REGION, enforceAppCheck: true, maxInstances: 3 },
  async (request) => {
    await takeRate(ipRateKey('start', clientIp(request), stockholmDayId()), RATE_LIMITS.start);

    const db = getFirestore();
    const deviceName = sanitizeDeviceName((request.data as { deviceName?: unknown } | null)?.deviceName);
    const deviceSecret = generateDeviceSecret();
    const now = Date.now();

    // Kollision på hashen är i praktiken omöjlig (2^40), men create() avgör det atomiskt.
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = generateUserCode();
      const pairingId = sha256Hex(userCode);
      try {
        await db.doc(`tvPairings/${pairingId}`).create({
          status: 'pending',
          deviceSecretHash: sha256Hex(deviceSecret),
          deviceName,
          expiresAtMs: now + PAIRING_TTL_MS,
          expireAt: Timestamp.fromMillis(now + PAIRING_ROW_TTL_MS),
          createdAt: FieldValue.serverTimestamp(),
        });
        return {
          pairingId,
          deviceSecret,
          userCode,
          qrUrl: `${QR_BASE}${userCode}`,
          expiresInSeconds: PAIRING_TTL_MS / 1000,
        };
      } catch (e) {
        if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
      }
    }
    throw new HttpsError('internal', 'Kunde inte skapa en kod. Försök igen.');
  },
);

export const tvPairApprove = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Du måste vara inloggad för att koppla en TV.');
  if (request.auth?.token?.tv === true) {
    throw new HttpsError('permission-denied', 'En TV kan inte koppla en annan TV.');
  }

  const code = normalizeUserCode((request.data as { code?: unknown } | null)?.code);
  await takeRate(`approveUid_${uid}`, RATE_LIMITS.approveUid);
  await takeRate(ipRateKey('approveIp', clientIp(request), stockholmDayId()), RATE_LIMITS.approveIp);
  if (!code) throw new HttpsError('invalid-argument', 'Koden ser inte rätt ut. Kontrollera den på TV:n.');

  const db = getFirestore();
  const devices = await db.collection(`users/${uid}/tvDevices`).count().get();
  if (devices.data().count >= MAX_TV_DEVICES) {
    throw new HttpsError('failed-precondition', `Du kan ha högst ${MAX_TV_DEVICES} kopplade TV. Koppla bort en först.`);
  }

  const ref = db.doc(`tvPairings/${sha256Hex(code)}`);
  const deviceName = await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (!snap.exists || snap.get('status') !== 'pending' || isExpired(snap.get('expiresAtMs') as number, now)) {
      throw new HttpsError('not-found', 'Koden har gått ut eller finns inte. Be TV:n om en ny kod.');
    }
    tx.update(ref, { status: 'approved', approvedBy: uid, approvedAt: FieldValue.serverTimestamp() });
    return snap.get('deviceName') as string;
  });
  return { ok: true, deviceName };
});

export const tvPairPoll = onCall({ region: REGION, enforceAppCheck: true, maxInstances: 5 }, async (request) => {
  const data = (request.data ?? {}) as { pairingId?: unknown; deviceSecret?: unknown };
  const pairingId = typeof data.pairingId === 'string' && /^[0-9a-f]{64}$/.test(data.pairingId) ? data.pairingId : null;
  if (!pairingId) throw new HttpsError('invalid-argument', 'Ogiltig koppling.');

  const db = getFirestore();
  const ref = db.doc(`tvPairings/${pairingId}`);
  type Outcome =
    | { kind: 'pending' }
    | { kind: 'expired' }
    | { kind: 'approved'; ownerUid: string; deviceName: string; deviceId: string };

  const outcome = await db.runTransaction(async (tx: Transaction): Promise<Outcome> => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (!snap.exists) return { kind: 'expired' };
    // Samma svar för fel hemlighet som för saknad rad: ingen orakel för vilka koder som finns.
    if (!secretMatches(data.deviceSecret, snap.get('deviceSecretHash'))) return { kind: 'expired' };
    if (isExpired(snap.get('expiresAtMs') as number, now)) {
      tx.delete(ref);
      return { kind: 'expired' };
    }
    const last = snap.get('lastPollAtMs');
    if (pollTooSoon(typeof last === 'number' ? last : null, now)) {
      throw new HttpsError('resource-exhausted', 'Fråga lite glesare.');
    }
    if (snap.get('status') !== 'approved') {
      tx.update(ref, { lastPollAtMs: now });
      return { kind: 'pending' };
    }
    const ownerUid = snap.get('approvedBy') as string;
    // En koppling som godkänts av ett konto som sedan raderats får inte ge en inloggning.
    const owner = await tx.get(db.doc(`users/${ownerUid}`));
    if (!owner.exists) {
      tx.delete(ref);
      return { kind: 'expired' };
    }
    const deviceName = snap.get('deviceName') as string;
    const deviceId = generateDeviceId();
    const dayStart = Timestamp.fromMillis(Date.parse(`${stockholmDayId()}T00:00:00Z`));
    tx.set(db.doc(`users/${ownerUid}/tvDevices/${deviceId}`), {
      name: deviceName,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: dayStart,
    });
    tx.delete(ref); // engångs: den som läser approved har också raderat raden
    return { kind: 'approved', ownerUid, deviceName, deviceId };
  });

  if (outcome.kind !== 'approved') return { status: outcome.kind };

  const { ownerUid, deviceName, deviceId } = outcome;
  let token: string;
  try {
    token = await getAuth().createCustomToken(tvPrincipalUid(deviceId), { tv: true, ownerUid, tvDeviceId: deviceId });
  } catch (e) {
    await db.doc(`users/${ownerUid}/tvDevices/${deviceId}`).delete().catch(() => undefined);
    logger.error('[tvPair] createCustomToken failed', { message: (e as Error).message });
    throw new HttpsError('internal', 'Kunde inte logga in TV:n. Försök igen.');
  }

  // Ägaren ska märka en koppling hon inte gjorde själv. Awaitas så funktionen inte stryps före skicket; felet stoppar inte inloggningen.
  try {
    await sendPushToUser(ownerUid, {
    title: 'TV kopplad till Binge',
    body: `${deviceName} är nu kopplad till ditt konto. Var det inte du? Koppla bort den i Inställningar.`,
    actionUrl: '/settings',
    tag: 'tv-paired',
    });
  } catch (e) {
    logger.warn('[tvPair] push failed', { message: (e as Error).message });
  }

  return { status: 'approved', token, deviceId };
});
