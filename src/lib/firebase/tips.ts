import { fsdb } from './db';
import { buildTipFields, parseTip, tipDocId, type Tip, type TipPayloadInput } from '@/lib/tips';

// Tipsa en vän: users/{recipientUid}/tips/{fromUid}_{mediaType}_{tmdbId}. firestore.rules
// decides who may write one (a confirmed friend the recipient has not blocked, and only
// while the recipient accepts tips), so a refused write surfaces as a thrown error here.

export const TIPS_LIST_LIMIT = 50;

export async function sendTip(recipientUid: string, input: TipPayloadInput): Promise<void> {
  if (recipientUid === input.fromUid) throw new Error('Cannot tip yourself');
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  await setDoc(
    doc(db, 'users', recipientUid, 'tips', tipDocId(input.fromUid, input.mediaType, input.tmdbId)),
    { ...buildTipFields(input), createdAt: serverTimestamp() },
  );
}

export async function listTips(myUid: string): Promise<Tip[]> {
  const { db, collection, getDocs, query, orderBy, limit } = await fsdb();
  const snap = await getDocs(query(
    collection(db, 'users', myUid, 'tips'),
    orderBy('createdAt', 'desc'),
    limit(TIPS_LIST_LIMIT),
  ));
  const tips: Tip[] = [];
  for (const d of snap.docs) {
    const tip = parseTip(d.id, d.data());
    if (tip) tips.push(tip);
  }
  return tips;
}

export async function dismissTip(myUid: string, tipId: string): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  await deleteDoc(doc(db, 'users', myUid, 'tips', tipId));
}
