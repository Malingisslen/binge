import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  documentId,
} from 'firebase/firestore';
import { db } from './config';
import type { ResolvedUser } from './username';

// Prefix-sökning på `usernames/{username}` collection. Eftersom username är
// doc-id är range-queryn `>= q && < q + ` ett gratis-index — ingen
// composite-index behövs. Filtrerar tomt om query är < 2 tecken (matchar
// useSearchBox debounce-policy + sänker oavsiktliga reads).
//
// Per-doc-read av users/{uid} faller automatiskt bort för icke-publika
// profiler eftersom Firestore-regeln kräver isPublic == true för att läsa
// någon annans user-doc. Vi sväljer permission-fel och hoppar.
const MAX_RESULTS = 5;

//  = Unicode Private Use Area — konventionellt använd som
// "ovanför alla rimliga printbara tecken" så `>= q && < q+suffix` blir
// en prefix-sökning.
const PREFIX_END_SUFFIX = '';

export async function searchUsersByPrefix(prefix: string): Promise<ResolvedUser[]> {
  const q = prefix.trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return [];

  const usernamesQuery = query(
    collection(db, 'usernames'),
    orderBy(documentId()),
    where(documentId(), '>=', q),
    where(documentId(), '<', q + PREFIX_END_SUFFIX),
    limit(MAX_RESULTS),
  );
  const snap = await getDocs(usernamesQuery);
  if (snap.empty) return [];

  const matches = snap.docs.map(d => ({ username: d.id, uid: d.data().uid as string }));

  const profiles = await Promise.all(
    matches.map(async m => {
      try {
        const profileSnap = await getDoc(doc(db, 'users', m.uid));
        if (!profileSnap.exists()) return null;
        const p = profileSnap.data();
        if (p.isPublic !== true) return null;
        return {
          uid: m.uid,
          displayName: (p.displayName as string) ?? m.username,
          username: m.username,
          photoURL: (p.photoURL as string | null) ?? null,
          myProviders: (p.myProviders as number[]) ?? [],
        } as ResolvedUser;
      } catch {
        return null;
      }
    }),
  );

  return profiles.filter((p): p is ResolvedUser => p !== null);
}
