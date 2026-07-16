import { fsdb } from './db';
import { getPublicProfileCard } from './publicProfile';
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

export async function searchUsersByPrefix(
  prefix: string,
  myUid: string | null = null,
): Promise<ResolvedUser[]> {
  const q = prefix.trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return [];

  const { db, collection, getDocs, query: fsQuery, where, limit, orderBy, documentId } = await fsdb();
  const usernamesQuery = fsQuery(
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
      // Egen profil visas aldrig i sökträffar.
      if (myUid && m.uid === myUid) return null;
      // BIN-505: publicProfiles/{uid} är läsbar EXAKT när profilen är publik
      // ELLER jag redan är vän (rules gate:ar publik/vän live) — vilket är
      // precis den gamla tier + friend-relationen. En läsbar card ÄR alltså
      // sökbarhets-beviset; ingen manuell tier-läsning + friend-getDoc behövs,
      // och användarens känsliga profil-doc nås aldrig.
      const card = await getPublicProfileCard(m.uid);
      if (!card) return null;
      return {
        uid: m.uid,
        displayName: card.displayName || m.username,
        username: m.username,
        photoURL: card.photoURL,
      } as ResolvedUser;
    }),
  );

  return profiles.filter((p): p is ResolvedUser => p !== null);
}
