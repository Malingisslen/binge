/**
 * TV-appens översikt (Ikväll, Tillsammans och hushållet), BIN-1470.
 *
 * Reglerna släpper inte TV:n till profil, sessioner eller hushåll, med flit. I stället
 * för att öppna dem returnerar den här funktionen färdiga rader, och inget annat:
 *  - ägaren läses ENDAST ur TV:ns inloggning, aldrig ur indata;
 *  - TV:ns rad i users/{ägare}/tvDevices kontrolleras vid varje anrop, så "Koppla bort" slår igenom direkt;
 *  - hushållsvyn kräver att ägaren själv delar (egen household-rad) och är avstängd tills
 *    `appConfig/tvHousehold` har `enabled: true`; Privat filtreras här på servern;
 *  - loggarna bär aldrig uid, namn eller titlar.
 */
import { getFirestore, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { takeRate } from '../tvPair';
import {
  MAX_ITEMS_PER_MEMBER, OPEN_RAW_STATUSES, buildHouseholdView, displayLabel, householdUids, parseProviders, parseSeated,
  resolveSeating, rosterOf, sharingUidsOf, toWatchItem, type WatchItem,
} from './logic';

const REGION = 'europe-west1';
// Ett anrop vid start och ett per soffbyte: 120 i timmen ryms med marginal för en lång kväll.
const RATE = { max: 120, windowMs: 60 * 60_000 } as const;

export const tvOverview = onCall(
  { region: REGION, enforceAppCheck: true, maxInstances: 3 },
  async (request) => {
    const token = request.auth?.token as { tv?: unknown; ownerUid?: unknown; tvDeviceId?: unknown } | undefined;
    const deviceId = typeof token?.tvDeviceId === 'string' ? token.tvDeviceId : '';
    const ownerUid = typeof token?.ownerUid === 'string' ? token.ownerUid : '';
    if (!request.auth || token?.tv !== true || !deviceId || !ownerUid || request.auth.uid !== `tv_${deviceId}`) {
      throw new HttpsError('permission-denied', 'TV:n är inte kopplad.');
    }

    const db = getFirestore();
    const device = await db.doc(`users/${ownerUid}/tvDevices/${deviceId}`).get();
    if (!device.exists) throw new HttpsError('permission-denied', 'TV:n är inte kopplad.');
    await takeRate(`overview_${deviceId}`, RATE);

    const data = (request.data ?? {}) as { seated?: unknown; roster?: unknown };
    const requestedSeated = parseSeated(data.seated);

    const [profile, sessions, flag, groups] = await Promise.all([
      db.doc(`users/${ownerUid}`).get(),
      // Indexet byggs efter deploy och frågan kastar tills det är klart: då saknas bara Tillsammans, inte tjänsterna.
      db.collection('sessions').where('hostUid', '==', ownerUid).orderBy('createdAt', 'desc').limit(3).get()
        .catch((e: unknown) => {
          logger.warn('[tvOverview] sessions query failed', { code: (e as { code?: unknown }).code });
          return null;
        }),
      // Flaggan och grupperna hör bara till hushållsvyn: ett fel där ska inte ta ner tjänsterna.
      db.doc('appConfig/tvHousehold').get().catch(() => null),
      db.collection('groups').where('memberUids', 'array-contains', ownerUid).limit(10).get().catch(() => null),
    ]);

    const now = Date.now();
    const live = sessions?.docs.find((d) => {
      const exp = d.get('expiresAt') as { toMillis?: () => number } | undefined;
      return d.get('status') === 'active' && typeof exp?.toMillis === 'function' && exp.toMillis() > now;
    });

    const household = flag?.get('enabled') === true
      ? await householdFor(db, ownerUid, groups?.docs ?? [], requestedSeated, typeof data.roster === 'string' ? data.roster : null)
      : null;

    logger.info('[tvOverview]', { hasSession: !!live, household: !!household });
    return {
      providers: parseProviders(profile.get('myProviders')),
      sessionId: live?.id ?? null,
      household,
    };
  },
);

async function householdFor(
  db: Firestore,
  ownerUid: string,
  groups: DocumentSnapshot[],
  requestedSeated: number[],
  clientRoster: string | null,
) {
  // Första gruppen där ägaren själv delar (reciprocitet, ADR 0010). Medlemskapet läses live, aldrig ur en kopia.
  for (const g of groups) {
    const ownRow = await g.ref.collection('household').doc(ownerUid).get();
    if (!ownRow.exists) continue;
    const memberUids = ((g.get('memberUids') as unknown[]) ?? []).filter((u): u is string => typeof u === 'string');
    if (!memberUids.includes(ownerUid)) continue;

    // Bara medlemmar som själva delar räknas som hushållet. Ägaren är alltid plats 0.
    const rows = await Promise.all(memberUids.filter((u) => u !== ownerUid).map((u) => g.ref.collection('household').doc(u).get()));
    const uids = householdUids(ownerUid, memberUids, sharingUidsOf(rows));

    const profiles = await Promise.all(uids.map((u) => db.doc(`users/${u}`).get()));
    const members = profiles.map((p, index) => ({ index, ...displayLabel(p.get('displayName')) }));

    // Har hushållet ändrats sedan TV:n valde pekar index på andra personer; då gäller bara ägaren.
    const roster = rosterOf(uids);
    const { seated: wanted, seatingReset } = resolveSeating(clientRoster, roster, requestedSeated, uids.length);

    // Listor läses bara för dem som sitter i soffan. Soffvalet sparas inte.
    const lists = new Map<number, WatchItem[]>();
    await Promise.all(wanted.map(async (i) => {
      const snap = await db.collection(`users/${uids[i]}/watchlist`).where('status', 'in', [...OPEN_RAW_STATUSES]).limit(MAX_ITEMS_PER_MEMBER).get();
      lists.set(i, snap.docs.map((d) => toWatchItem(d.data())).filter((x): x is WatchItem => x !== null));
    }));

    return { members, roster, seatingReset, view: wanted.length >= 2 ? buildHouseholdView(wanted, lists) : null };
  }
  return null;
}
