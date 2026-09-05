import { fsdb, lazySubscribe, type FirestoreKit } from './db';
import { toDate, generateSecureToken, sha256Hex } from './utils';
import { isPermissionDenied } from './errorCodes';
import { mediaTypeDocId, resolveTmdbId } from '@/lib/mediaTypeDocId';
import {
  buildHouseholdContribution,
  contributionContentEquals,
  type HouseholdContribution,
  type HouseholdContributionContent,
} from '@/lib/advisor/householdAggregate';
import type { ProviderCampaign } from '@/lib/advisor/campaignPricing';
import type {
  Group,
  GroupDefaults,
  GroupMember,
  GroupRole,
  GroupWatchlistItem,
  MediaType,
} from '@/types';

// BIN-510/536: cap på "mina grupper"-queries (array-contains på memberUids).
// OBS: firestore.rules begränsar memberUids.size() <= 100 PER GRUPP
// (max antal MEDLEMMAR i en grupp) — den säger inget om hur många OLIKA
// grupper en enskild uid kan vara med i. Det finns ingen regel som sätter
// tak på det. 100 är ett produktval (rimligt antal grupper per användare vid
// launch-skala), inte en rules-garanti. Delad mellan groups.ts fyra queries
// och AuthContext.tsx:s updateProviders (BIN-536) — importeras dynamiskt
// därifrån istället för en egen lokal kopia, så de aldrig kan divergera.
export const MY_GROUPS_LIMIT = 100;

// BIN-510: kort TTL-cache av det FAKTISKA senaste query-resultatet (grupp-id:n
// jag är medlem i) — inte en separat "är jag med i någon grupp"-flagga.
// Skrivs av varje lyckad bounded query eller live-subscription
// (cacheMyGroups) och rivs (invalidateMyGroupsCache, se nedan) av de tre
// ställen i filen som lägger till en uid i memberUids: createGroup,
// joinGroupViaToken, acceptGroupInvite. (2026-07-18 tillägg — utan detta
// hoppar syncProgressToGroups deterministiskt över en nyss-skapad/joinad
// grupp i upp till TTL-fönstret om cachen redan var varm, inte bara i en
// sällsynt race.) Läses via getFreshMyGroups. Om en invalideringsplats
// missas är värsta fallet fortfarande best-effort-synk (samma resonemang
// som originaldesignen) — inte en krasch eller felaktig data.
const MY_GROUPS_TTL_MS = 5 * 60 * 1000;
const myGroupsCache = new Map<string, { groupIds: string[]; at: number }>();

function cacheMyGroups(uid: string, groupIds: string[]): void {
  myGroupsCache.set(uid, { groupIds, at: Date.now() });
}

function getFreshMyGroups(uid: string): string[] | null {
  const entry = myGroupsCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.at >= MY_GROUPS_TTL_MS) return null;
  return entry.groupIds;
}

// Rivs vid varje medlemskaps-TILLÄGG (create/join/accept — de tre ställen i
// filen som lägger till en uid i memberUids). Håller INTE reda på den fulla
// nya grupp-id-listan (skulle kräva att känna till hela den gamla listan
// eller ett extra read) — river bara cachen så nästa getFreshMyGroups-läsning
// (t.ex. nästa syncProgressToGroups-anrop) tvingar en färsk bounded query.
// Medlemskaps-BORTTAG (removeMember/deleteGroup) river inte cachen med
// avsikt: en stale post där gör högst att syncProgressToGroups försöker
// skriva progress till en grupp man precis lämnat — det failar tyst
// (per-grupp try/catch, se syncProgressToGroups) och är ofarligt.
function invalidateMyGroupsCache(uid: string): void {
  myGroupsCache.delete(uid);
}

// Skapar en grupp och returnerar både groupId och plaintext-tokenet. Tokenet
// hashas (sha256) innan det persisteras — plaintext finns BARA hos klienten
// och i URL:n som ägaren delar. Caller ansvarar för att cacha plaintext (t.ex.
// localStorage) ifall ägaren vill se länken igen utan att rotera.
//
// BIN-532 (reverterad 2026-07-18): ett försök att skriva grupp-doc:et och
// ägarens member-doc atomiskt i EN writeBatch verifierades BRYTA all
// grupp-skapande i produktion. members/{memberUid}-create-regeln
// (firestore.rules) läser `get(groups/$(groupId)).data.memberUids` — och
// Firestore Security Rules löser get()/exists() mot databasens tillstånd
// FÖRE hela batchen/transaktionen, inte mot andra writes köade i SAMMA
// commit. Grupp-doc:et existerar alltså inte ännu ur regelns perspektiv när
// member-doc:ets create-regel utvärderas, även om det står tidigare i samma
// batch → permission-denied för varje ny grupp. Detsamma gäller
// runTransaction (samma get()-semantik). Tillbaka till två separata
// awaitade writes: en ägarlös grupp om det andra writet failar är en känd,
// liten regression jämfört med "riktig" atomicitet — men det är det enda
// som faktiskt fungerar från en klient. Riktig atomicitet kräver en
// Cloud Function (admin SDK, förbi klient-regler).
export async function createGroup(params: {
  ownerUid: string;
  ownerDisplayName: string;
  ownerUsername: string | null;
  ownerPhotoURL: string | null;
  ownerProviders: number[];
  name: string;
  defaults: GroupDefaults;
}): Promise<{ groupId: string; inviteToken: string }> {
  const inviteToken = generateSecureToken();
  const inviteTokenHash = await sha256Hex(inviteToken);

  const { db, addDoc, collection, doc, setDoc, deleteDoc, serverTimestamp } = await fsdb();
  const groupRef = await addDoc(collection(db, 'groups'), {
    name: params.name,
    ownerUid: params.ownerUid,
    memberUids: [params.ownerUid],
    defaults: params.defaults,
    inviteTokenHash,
    inviteTokenRotatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // BIN-555: samma spöke-medlems-form som join/accept, men spegelvänd. Här
  // finns ingen ANNAN medlem att bevara — grupp-doc:et skrevs just, med
  // memberUids: [owner] — så kompensationen är att radera hela grupp-doc:et,
  // inte arrayRemove:a ägaren ur det. En arrayRemove hade lämnat kvar exakt
  // det ägarlösa doc:et den här biljetten finns för att bli av med, och
  // dessutom gjort det osynligt för ägarens egen "mina grupper"-query
  // (array-contains på memberUids) — alltså omöjligt att ens hitta igen.
  //
  // deleteDoc, inte deleteGroup(): gruppen kan omöjligt ha hunnit få
  // subkollektioner, och deleteGroup:s städning kostar läsningar i onödan.
  try {
    await setDoc(doc(db, 'groups', groupRef.id, 'members', params.ownerUid), {
      uid: params.ownerUid,
      displayName: params.ownerDisplayName,
      username: params.ownerUsername,
      photoURL: params.ownerPhotoURL,
      providers: params.ownerProviders,
      role: 'owner',
      notifications: true,
      joinedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('owner member doc write failed after group create — rolling back the group doc', err);
    await deleteDoc(doc(db, 'groups', groupRef.id)).catch(rollbackErr => {
      console.error('rollback of the group doc ALSO failed — an ownerless group remains, needs manual Firestore fix', rollbackErr);
    });
    // Kastas vidare: anroparen får INTE ett groupId + token för en grupp som
    // inte längre finns. Ett omförsök är säkert — inget spår är kvar.
    throw err;
  }

  invalidateMyGroupsCache(params.ownerUid);

  return { groupId: groupRef.id, inviteToken };
}

export async function updateGroup(
  groupId: string,
  patch: Partial<Pick<Group, 'name' | 'defaults'>>,
): Promise<void> {
  const { db, doc, updateDoc, serverTimestamp } = await fsdb();
  await updateDoc(doc(db, 'groups', groupId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// Roterar inbjudningstoken: genererar ny plaintext, lagrar ny hash, returnerar
// plaintext. Befintliga invitelänkar (med gamla plaintext-tokenet) slutar
// fungera direkt eftersom ny hash inte matchar.
export async function rotateInviteToken(groupId: string): Promise<string> {
  const inviteToken = generateSecureToken();
  const inviteTokenHash = await sha256Hex(inviteToken);
  const { db, doc, updateDoc, serverTimestamp } = await fsdb();
  await updateDoc(doc(db, 'groups', groupId), {
    inviteTokenHash,
    inviteTokenRotatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return inviteToken;
}

export async function hasInGroupWatchlist(mediaType: MediaType, groupId: string, tmdbId: number): Promise<boolean> {
  const { db, doc, getDoc } = await fsdb();
  const snap = await getDoc(doc(db, 'groups', groupId, 'watchlist', mediaTypeDocId(mediaType, tmdbId)));
  return snap.exists();
}

export async function disableInviteToken(groupId: string): Promise<void> {
  const { db, doc, updateDoc, serverTimestamp } = await fsdb();
  await updateDoc(doc(db, 'groups', groupId), {
    inviteTokenHash: null,
    updatedAt: serverTimestamp(),
  });
}

// Joina en grupp via plaintext-token. Två-stegs-flöde:
//
// 1. Skriv joinAttempts/{uid} med plaintext-tokenet. Firestore-regeln hashar
//    plaintext server-side och jämför mot inviteTokenHash på grupp-doc:et.
//    Om hash matchar accepteras dokumentet — annars permission-denied.
// 2. Uppdatera grupp-doc:et: lägg till sig själv i memberUids, DÄREFTER (som
//    en egen awaitad write, inte samma batch) skapa members/{uid}-doc.
//    Grupp-update-regeln verifierar bara att joinAttempts-doc:et existerar
//    för request.auth.uid; den bevisar att hash-checken passerade.
//    members/{memberUid}-create-regeln kräver i sin tur att uid:et redan
//    finns i grupp-doc:ets memberUids — och (samma get()-före-batch-
//    semantik som BIN-532, se createGroup) ett get() i en Security Rule
//    ser ALDRIG en sibling-write köad i samma batch/transaktion. Låg dessa
//    två writes i en batch skulle steg 2 permission-denyas identiskt med
//    det som brutit createGroup. Två separata awaitade writes löser det.
//
// Om steg 1 redan finns från tidigare misslyckad join, ta bort och försök igen
// (självborttag är tillåtet).

// Bara permission-denied bevisar att token faktiskt är fel. Allt annat
// (unavailable, deadline-exceeded, offline …) är infrastruktur och GÅR över.
// Att slå ihop dem — som koden gjorde före 2026-07-20 — betydde att en dålig
// mobiluppkoppling rapporterades som "länken är ogiltig eller har dragits
// tillbaka": användaren gav upp och bad ägaren rotera en fungerande token,
// och anroparens retry-gren var i praktiken död kod eftersom den bara triggar
// på ett KASTAT fel.
// BIN-942 moved the predicate itself to `errorCodes.ts` so the watchlist edit paths
// share ONE definition with this one; the reasoning above is why it exists and stays here.
// (imported at the top of this file)

export async function joinGroupViaToken(params: {
  groupId: string;
  token: string;
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
}): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'invalid_token' | 'already_member' | 'transient' }> {
  const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp } = await fsdb();
  const ref = doc(db, 'groups', params.groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, reason: 'not_found' };
  const data = snap.data();
  const memberUids: string[] = data.memberUids ?? [];
  // Gruppregelns token-join-gren kräver att uid INTE redan står i memberUids,
  // så den vägen är stängd för den som redan är medlem. Spöke-medlemmen
  // (memberUids satt, medlemsdokument saknas) är ett olöst tillstånd, med sitt
  // omfång mätt i BIN-1097.
  if (memberUids.includes(params.uid)) return { ok: false, reason: 'already_member' };
  if (!data.inviteTokenHash) return { ok: false, reason: 'invalid_token' };

  // Steg 1 — skriv joinAttempt. Rule:n hashar params.token server-side och
  // verifierar att den matchar lagrad inviteTokenHash. Vid invalid token får
  // vi permission-denied här.
  const attemptRef = doc(db, 'groups', params.groupId, 'joinAttempts', params.uid);
  try {
    // Best-effort cleanup om gammalt attempt-doc finns kvar (t.ex. efter
    // tidigare misslyckad rotation). Reglerna tillåter självborttag.
    await deleteDoc(attemptRef).catch(() => {});
    await setDoc(attemptRef, {
      token: params.token,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Permission-denied = hash matchade inte. Nätverksfel ≠ fel token.
    console.error('joinAttempt rejected', err);
    return { ok: false, reason: isPermissionDenied(err) ? 'invalid_token' : 'transient' };
  }

  // Steg 2 — uppdatera grupp, DÄREFTER (separat write) lägg till member-doc.
  // Rule:n verifierar att joinAttempts/{auth.uid} existerar (vilket den nu
  // gör efter steg 1).
  try {
    await updateDoc(ref, {
      memberUids: arrayUnion(params.uid),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('group update rejected', err);
    return { ok: false, reason: isPermissionDenied(err) ? 'invalid_token' : 'transient' };
  }

  // Code review (2026-07-18, high-effort pass): member-doc:et i ett EGET
  // try/catch, inte samma block som memberUids-updateDoc:en ovan. Om DEN
  // här writen faller (nätverksfel/tab-close mellan de två awaits) måste
  // memberUids-tillägget rullas tillbaka — annars blir uid:et en
  // "spöke-medlem" (full läsbehörighet till gruppen via memberUids, men
  // ingen member-doc) OCH funktionens egen already_member-guard (ovan) låser
  // ute varje framtida retry-försök. Rollbacken är det som håller det sällsynt.
  try {
    await writeMemberDoc(
      { db, doc, getDoc, setDoc, serverTimestamp },
      params.groupId,
      params.uid,
      {
        displayName: params.displayName,
        username: params.username,
        photoURL: params.photoURL,
        providers: params.providers,
        role: 'member',
      },
    );
  } catch (err) {
    console.error('member doc write failed after memberUids update — rolling back to allow retry', err);
    await updateDoc(ref, { memberUids: arrayRemove(params.uid), updatedAt: serverTimestamp() }).catch(rollbackErr => {
      console.error('rollback of memberUids ALSO failed — uid is now a ghost member, needs manual Firestore fix', rollbackErr);
    });
    // Token är redan bevisat giltig här (steg 1 + 2 gick igenom), så det här är
    // per definition infrastruktur — och rollbacken ovan gör ett omförsök
    // säkert. 'transient' är alltså både sannare och det som faktiskt låter
    // anroparen försöka igen.
    return { ok: false, reason: 'transient' };
  }

  invalidateMyGroupsCache(params.uid);

  // Best-effort: städa upp joinAttempt-doc:et nu när vi är medlem. Inte
  // säkerhetskritiskt — token är ändå "spent" (om den roteras blir hashen
  // ny och plaintext här blir värdelös).
  void deleteDoc(attemptRef).catch(() => {});

  return { ok: true };
}

// Samtyckesbaserad inbjudan (ersätter tidigare tysta addMemberByUid). Ägaren
// skriver en inbjudan på mål-användarens väg; mål-användaren måste själv
// acceptera innan medlemskap skapas. Mirror av sendFriendRequest-mönstret.
// Doc-id = groupId så vi inte kan ha dubbletter och existens-checken i
// firestore.rules blir trivial.
export async function inviteMemberByUid(params: {
  groupId: string;
  groupName: string;
  fromUid: string;
  fromDisplayName: string;
  targetUid: string;
}): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  await setDoc(doc(db, 'users', params.targetUid, 'groupInvites', params.groupId), {
    groupId: params.groupId,
    groupName: params.groupName,
    fromUid: params.fromUid,
    fromDisplayName: params.fromDisplayName,
    invitedAt: serverTimestamp(),
  });
}

/**
 * Skriv medlemsdokumentet på det sätt reglerna tillåter för det tillstånd som
 * faktiskt råder (BIN-1063 steg 1).
 *
 * joinedAt får bara sättas när dokumentet SKAPAS. En ovillkorlig setDoc utan
 * merge mot ett dokument som redan finns är en rules-UPDATE med ett nytt
 * joinedAt, och den nekas — vilket fäller anroparens catch och rullar tillbaka
 * ett medlemskap som var giltigt. Före pinningen lyckades samma överskrivning
 * tyst.
 *
 * Läsningen är laglig: den sker EFTER att uid ligger i
 * memberUids, vilket är precis vad members-läsregeln kräver.
 */
async function writeMemberDoc(
  kit: Pick<FirestoreKit, 'db' | 'doc' | 'getDoc' | 'setDoc' | 'serverTimestamp'>,
  groupId: string,
  uid: string,
  profile: {
    displayName: string;
    username: string | null;
    photoURL: string | null;
    providers: number[];
    role: string;
  },
): Promise<void> {
  const { db, doc, getDoc, setDoc, serverTimestamp } = kit;
  const ref = doc(db, 'groups', groupId, 'members', uid);
  const fields = {
    uid,
    displayName: profile.displayName,
    username: profile.username,
    photoURL: profile.photoURL,
    providers: profile.providers,
    role: profile.role,
    notifications: true,
  };
  const existing = await getDoc(ref);
  if (existing.exists()) {
    // Uppdatering: joinedAt utelämnas helt, så oföränderligheten är trivialt
    // uppfylld och det ursprungliga datumet står kvar.
    await setDoc(ref, fields, { merge: true });
    return;
  }
  await setDoc(ref, { ...fields, joinedAt: serverTimestamp() });
}

// Mål-användaren accepterar en inbjudan: lägger till sig själv i memberUids,
// skriver därefter sin member-doc, raderar sist inbjudan — tre separata
// awaitade writes, INTE en batch. (Reverterad 2026-07-18, samma orsak som
// createGroup/joinGroupViaToken: members/{memberUid}-create-regeln kräver
// att uid:et redan finns i grupp-doc:ets memberUids, och ett get() i en
// Security Rule ser aldrig en sibling-write köad i samma batch/transaktion
// — bara ett get()/exists() mot state FÖRE hela batchen. Att köra
// group-update:en som en egen, redan committad write löser det.)
// groupInvites/{groupId} raderas sist (efter att medlemskapet är på plats)
// — inte säkerhetskritiskt i vilken ordning det sker (delete-regeln är bara
// isOwner(uid), oberoende av grupp-state), men görs sist så ett avbrutet
// flöde (t.ex. nätverksfel efter steg 1) lämnar inbjudan kvar för en ny
// accept-försök istället för att tyst tappa bort den.
export async function acceptGroupInvite(params: {
  groupId: string;
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  providers: number[];
}): Promise<void> {
  const { db, doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp } = await fsdb();
  const groupRef = doc(db, 'groups', params.groupId);

  // BIN-1063 steg 1: den already_member-spärr joinGroupViaToken har haft hela tiden.
  // Ett ANDRA accept är nåbart när inbjudan sist i flödet inte hann raderas, och det
  // nekas av gruppregelns accept-gren, som kräver att uid INTE redan står i
  // memberUids. Spärren gör det till ett rent no-op som dessutom städar bort den
  // inaktuella inbjudan. Mekanismen är pinnad i
  // src/test/rules/firestore-rules.test.ts.
  //
  // Utkastningen — att en rollback tar bort en giltig medlem — hör till ett ANNAT
  // tillstånd, det där medlemsdokumentet finns men uid saknas i memberUids. Där
  // lyckas arrayUnion, och det är writeMemberDoc som håller den skrivningen laglig.
  //
  // Samma enda läsning av gruppdoc:et som joinGroupViaToken redan gör.
  const groupSnap = await getDoc(groupRef);
  const existingMemberUids: string[] = groupSnap.data()?.memberUids ?? [];
  if (existingMemberUids.includes(params.uid)) {
    // Är uid redan medlem finns två olika tillstånd, och bara ett av dem är
    // ett avslutat medlemskap. Saknas medlemsdokumentet är detta en
    // spöke-medlem (memberUids satt, dokumentet aldrig skrivet). Att kortsluta
    // där hade raderat inbjudan, och att behålla den är strikt bättre än att
    // kasta den. Omfånget för spöke-tillståndet är mätt i BIN-1097.
    // Läsningen är laglig: uid ligger i memberUids.
    const existingMember = await getDoc(doc(db, 'groups', params.groupId, 'members', params.uid));
    if (existingMember.exists()) {
      invalidateMyGroupsCache(params.uid);
      await deleteDoc(doc(db, 'users', params.uid, 'groupInvites', params.groupId));
      return;
    }
    // Spöke — fall igenom, precis som före den här spärren fanns.
  }

  await updateDoc(groupRef, {
    memberUids: arrayUnion(params.uid),
    updatedAt: serverTimestamp(),
  });

  // Code review (2026-07-18, high-effort pass): egen try/catch, samma
  // motivering som joinGroupViaToken — om DEN här writen faller (nätverksfel
  // mellan de två awaits) måste memberUids-tillägget rullas tillbaka, annars
  // blir uid:et en spöke-medlem (full läsbehörighet via memberUids, ingen
  // member-doc). groupInvites-doc:et står kvar (raderas sist) så ett nytt
  // accept-försök fungerar — men utan rollback är gruppen ändå trasig tills dess.
  try {
    await writeMemberDoc(
      { db, doc, getDoc, setDoc, serverTimestamp },
      params.groupId,
      params.uid,
      {
        displayName: params.displayName,
        username: params.username,
        photoURL: params.photoURL,
        providers: params.providers,
        role: 'member',
      },
    );
  } catch (err) {
    console.error('member doc write failed after memberUids update — rolling back to allow retry', err);
    await updateDoc(groupRef, { memberUids: arrayRemove(params.uid), updatedAt: serverTimestamp() }).catch(rollbackErr => {
      console.error('rollback of memberUids ALSO failed — uid is now a ghost member, needs manual Firestore fix', rollbackErr);
    });
    throw err;
  }

  invalidateMyGroupsCache(params.uid);
  await deleteDoc(doc(db, 'users', params.uid, 'groupInvites', params.groupId));
}

// Avböj inbjudan — raderar bara invite-doc:et utan att bli medlem.
export async function declineGroupInvite(uid: string, groupId: string): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  await deleteDoc(doc(db, 'users', uid, 'groupInvites', groupId));
}

export async function removeMember(groupId: string, uid: string): Promise<void> {
  const { db, doc, writeBatch, arrayRemove, serverTimestamp } = await fsdb();
  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', groupId), {
    memberUids: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'groups', groupId, 'members', uid));
  // BIN-184: den lämnande/borttagna medlemmens hushålls-bidrag (delade
  // kostnadsdata) får ALDRIG överleva medlemskapet — raderas i samma batch
  // (no-op när medlemmen aldrig opt:at in; rules tillåter self + owner).
  batch.delete(doc(db, 'groups', groupId, 'household', uid));
  await batch.commit();
}

export async function leaveGroup(groupId: string, uid: string): Promise<void> {
  return removeMember(groupId, uid);
}

export async function deleteGroup(groupId: string, currentUid: string): Promise<void> {
  // Best-effort cleanup. Members + watchlist (inkl. per-item progress) +
  // sessionHistory-subcollections måste raderas innan parent-doc:et för att
  // undvika orphaned data; i produktion skulle detta ske i en Cloud Function.
  // För MVP raderar vi det vi kan klient-sidigt.
  const { db, doc, collection, getDocs, query, where, writeBatch, serverTimestamp } = await fsdb();
  const [membersSnap, watchlistSnap, sessionHistorySnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, 'groups', groupId, 'members')),
    getDocs(collection(db, 'groups', groupId, 'watchlist')),
    getDocs(collection(db, 'groups', groupId, 'sessionHistory')),
    // G8: top-level sessions/{id} bär groupId och blir annars föräldralösa
    // — kvar som "aktiva" i sessionslistor med den raderade gruppens namn.
    getDocs(query(collection(db, 'sessions'), where('groupId', '==', groupId))),
  ]);

  // Firestore-rules tillåter bara sessionens host (hostUid == auth.uid) att
  // uppdatera/radera session-docs. Den raderande ägaren kan alltså bara städa
  // sessioner hen själv startat: de märks 'expired' + avlänkas (groupId: null)
  // så de försvinner ur aktiva listor och inte refererar en raderad grupp. Sessioner
  // startade av ANDRA medlemmar kan inte röras klient-sidigt — de löper ut
  // via expiresAt (7 dagar) och deras grupp-skrivningar ("Den här tar vi")
  // är redan best-effort. Full städning hör hemma i en Cloud Function.
  const mySessions = sessionsSnap.docs.filter(d => d.data().hostUid === currentUid);
  if (mySessions.length > 0) {
    const batch = writeBatch(db);
    for (const d of mySessions) {
      batch.update(d.ref, {
        status: 'expired',
        groupId: null,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // Varje watchlist-item kan ha en progress-subcollection
  // (groups/{id}/watchlist/{tmdbId}/progress/{uid}) — hämta dem parallellt.
  const progressSnaps = await Promise.all(
    watchlistSnap.docs.map(d =>
      getDocs(collection(d.ref, 'progress')),
    ),
  );

  // Samla alla refs och committa i chunkar ≤450 för att hålla oss under
  // Firestore-batchens 500-gräns (samma mönster som deleteAccount).
  // BIN-184: hushålls-refs härleds ur medlems-id:na — ALDRIG via list-query
  // (share-to-see-reglerna nekar list för en ägare som inte själv delar; en
  // list här fick hela deleteGroup att kasta, xhigh-review 2026-07-05).
  // batch.delete på icke-existerande docs är no-ops → full täckning ändå.
  const householdUids = new Set<string>(membersSnap.docs.map(d => d.id));
  householdUids.add(currentUid);

  const refs = [
    ...membersSnap.docs.map(d => d.ref),
    ...watchlistSnap.docs.map(d => d.ref),
    ...sessionHistorySnap.docs.map(d => d.ref),
    ...[...householdUids].map(u => doc(db, 'groups', groupId, 'household', u)),
    ...progressSnaps.flatMap(snap => snap.docs.map(d => d.ref)),
    doc(db, 'groups', groupId),
  ];

  const CHUNK = 450;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db);
    refs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

export async function updateMemberProviders(
  groupId: string,
  uid: string,
  providers: number[],
): Promise<void> {
  const { db, doc, updateDoc } = await fsdb();
  await updateDoc(doc(db, 'groups', groupId, 'members', uid), {
    providers,
  });
}

export async function setMemberRating(params: {
  groupId: string;
  mediaType: MediaType;
  tmdbId: number;
  uid: string;
  rating: number | null;
}): Promise<void> {
  const { db, doc, updateDoc, deleteField } = await fsdb();
  const ref = doc(db, 'groups', params.groupId, 'watchlist', mediaTypeDocId(params.mediaType, params.tmdbId));
  await updateDoc(ref, {
    [`memberRatings.${params.uid}`]: params.rating == null ? deleteField() : params.rating,
  });
}

// BIN-532: merge-write utan memberRatings-fältet. Ett tidigare icke-merge
// setDoc skrev alltid memberRatings:{} — så ett race mellan två medlemmar,
// eller ett remove+re-add, nollställde tyst redan satta betyg. watchlist-
// DocToObject defaultar redan saknat memberRatings till {} vid läsning
// så att utelämna fältet här är korrekt för BÅDE förstagångstillägg (fältet
// finns inte alls — samma effekt som {}) och re-add
// (merge rör inte ett befintligt memberRatings-fält).
export async function addToGroupWatchlist(params: {
  groupId: string;
  uid: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
}): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  await setDoc(doc(db, 'groups', params.groupId, 'watchlist', mediaTypeDocId(params.mediaType, params.tmdbId)), {
    tmdbId: params.tmdbId,
    mediaType: params.mediaType,
    title: params.title,
    posterPath: params.posterPath,
    releaseYear: params.releaseYear,
    addedBy: params.uid,
    addedAt: serverTimestamp(),
  }, { merge: true });
}

export async function removeFromGroupWatchlist(mediaType: MediaType, groupId: string, tmdbId: number): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  await deleteDoc(doc(db, 'groups', groupId, 'watchlist', mediaTypeDocId(mediaType, tmdbId)));
}

// Skriver min progress på en titel i en specifik grupp. Subcollection-path:
// groups/{id}/watchlist/{tmdbId}/progress/{uid}
//
// Ersätter den gamla designen där useGroupMemberProgress läste medlemmarnas
// personliga watchlist-items direkt — det funkar inte längre när medlemmar
// satt defaultVisibility='friends'/'private'. Grupp-scoped progress läses
// av alla medlemmar oavsett deras profil-visibility (åtkomstgränsen är
// gruppmedlemskap, inte profil-publik-flagga).
export async function setGroupMemberProgress(params: {
  groupId: string;
  mediaType: MediaType;
  tmdbId: number;
  uid: string;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status?: string | null;
}): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  const ref = doc(
    db, 'groups', params.groupId, 'watchlist', mediaTypeDocId(params.mediaType, params.tmdbId),
    'progress', params.uid,
  );
  await setDoc(ref, {
    lastWatchedSeason: params.lastWatchedSeason,
    lastWatchedEpisode: params.lastWatchedEpisode,
    status: params.status ?? null,
    syncedAt: serverTimestamp(),
  }, { merge: true });
}

// Sync-trigger: körs från WatchlistContext.updateProgress. Hittar alla
// grupper jag är medlem i där titeln finns på gruppens watchlist, skriver
// min progress till deras progress-subcollection. Fire-and-forget — fel
// per grupp slukas så vi aldrig blockerar updateProgress på en flaky
// gruppwrite.
//
// Kostnad i Firestore-reads: 1 query (mina grupper) + N getDoc per grupp
// för att kolla om titeln finns. För 5 grupper ≈ 5 reads + M writes där
// M är antal grupper som faktiskt har titeln. Acceptabelt — körs bara på
// progress-uppdateringar, inte på rendering.
// Loggar att gruppen valt en titel via en specifik Tillsammans-session.
// Skrivs en gång per session+pick-tillfälle (det är OK att skriva flera om
// gruppen ändrar sig — sessionId fungerar som idempotency-key).
//
// Path: groups/{groupId}/sessionHistory/{sessionId}
export async function recordGroupSessionPick(params: {
  groupId: string;
  sessionId: string;
  /** uid för den som loggar pick:en. Måste vara den inloggade (rules
   *  kräver pickedByUid == request.auth.uid) — så push-functionen kan
   *  härleda skribenten förfalskningssäkert och slå upp hens namn. */
  pickedByUid: string;
  pickedTmdbId: number;
  mediaType: 'movie' | 'tv';
  mediaTitle: string;
  posterPath: string | null;
  participantUids: string[];
}): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  await setDoc(
    doc(db, 'groups', params.groupId, 'sessionHistory', params.sessionId),
    {
      sessionId: params.sessionId,
      pickedByUid: params.pickedByUid,
      pickedTmdbId: params.pickedTmdbId,
      mediaType: params.mediaType,
      mediaTitle: params.mediaTitle,
      posterPath: params.posterPath,
      participantUids: params.participantUids,
      pickedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// Hämtar de senaste filmkvällarna ACROSS alla grupper användaren är medlem
// i (Fas 2c — bell-notifs). Filtrerar entries med pickedAt > since så vi
// kan räkna "nya sedan jag senast öppnade bell:n". Sorterat nyast först.
//
// Kostnad: 1 query (mina grupper) + N parallella query mot deras
// sessionHistory-subcollections. För 5 grupper ≈ 6 reads, vilket är OK
// för en bell-dropdown som öppnas sällan.
export async function getRecentSessionPicksAcrossGroups(
  uid: string,
  since: Date,
  limit = 10,
): Promise<Array<{
  groupId: string;
  groupName: string;
  sessionId: string;
  pickedTmdbId: number;
  mediaType: 'movie' | 'tv';
  mediaTitle: string;
  posterPath: string | null;
  pickedAt: Date;
}>> {
  const { db, collection, getDocs, query, where, orderBy, limit: queryLimit, Timestamp } = await fsdb();
  const groupsSnap = await getDocs(
    query(
      collection(db, 'groups'),
      where('memberUids', 'array-contains', uid),
      queryLimit(MY_GROUPS_LIMIT),
    ),
  );
  if (groupsSnap.empty) return [];

  const all = await Promise.all(groupsSnap.docs.map(async groupDoc => {
    const groupName = (groupDoc.data().name as string) ?? '';
    try {
      // Avgränsa läsningen server-side: bara picks efter `since`, nyast först,
      // max `limit` per grupp. Tidigare lästes HELA sessionHistory och
      // filtrerades i JS — O(all-history × grupper) reads varje gång (H4).
      // where + orderBy på samma fält kräver inget composite-index.
      const histSnap = await getDocs(query(
        collection(db, 'groups', groupDoc.id, 'sessionHistory'),
        where('pickedAt', '>', Timestamp.fromDate(since)),
        orderBy('pickedAt', 'desc'),
        queryLimit(limit),
      ));
      return histSnap.docs.map(d => {
        const data = d.data();
        const pickedAt: Date = data.pickedAt?.toDate?.() ?? new Date(0);
        return {
          groupId: groupDoc.id,
          groupName,
          sessionId: d.id,
          pickedTmdbId: (data.pickedTmdbId as number) ?? 0,
          mediaType: ((data.mediaType as string) === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
          mediaTitle: (data.mediaTitle as string) ?? '',
          posterPath: (data.posterPath as string | null) ?? null,
          pickedAt,
        };
      });
    } catch {
      return [];
    }
  }));
  const flat = all.flat().filter(e => e.pickedAt.getTime() > since.getTime());
  flat.sort((a, b) => b.pickedAt.getTime() - a.pickedAt.getTime());
  return flat.slice(0, limit);
}

// Hämtar gruppens senaste filmkvällar — sorterade nyast först. Konsumeras
// av "Senaste filmkvällar"-sektionen på grupp-sidan.
export async function getGroupSessionHistory(groupId: string, limit = 10): Promise<{
  sessionId: string;
  pickedTmdbId: number;
  mediaType: 'movie' | 'tv';
  mediaTitle: string;
  posterPath: string | null;
  participantUids: string[];
  pickedAt: Date;
}[]> {
  const { db, collection, getDocs, query, orderBy, limit: queryLimit } = await fsdb();
  // Avgränsa server-side: nyast först, max `limit` docs. Tidigare lästes HELA
  // sessionHistory och sorterades/slice:ades i JS — O(all-history) reads varje
  // gång sektionen laddas (växer med gruppens ålder). Single-field orderBy
  // kräver inget composite-index (samma mönster som getRecentSessionPicks…).
  const snap = await getDocs(query(
    collection(db, 'groups', groupId, 'sessionHistory'),
    orderBy('pickedAt', 'desc'),
    queryLimit(limit),
  ));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      sessionId: d.id,
      pickedTmdbId: (data.pickedTmdbId as number) ?? 0,
      mediaType: ((data.mediaType as string) === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
      mediaTitle: (data.mediaTitle as string) ?? '',
      posterPath: (data.posterPath as string | null) ?? null,
      participantUids: (data.participantUids as string[]) ?? [],
      pickedAt: data.pickedAt?.toDate?.() ?? new Date(),
    };
  });
}

// BIN-510: körs på VARJE avsnitts-toggle (fire-and-forget från
// WatchlistContext.updateProgress) — den vanligaste anropsvägen i hela
// filen. Två skydd: (1) den bakomliggande "mina grupper"-queryn är bounded
// (MY_GROUPS_LIMIT) istället för en obegränsad collection-scan; (2) en
// TTL-cache av senaste kända grupp-id:n (myGroupsCache, se toppen av filen)
// gör att en användare utan grupper — det vanligaste fallet — bara betalar
// EN bounded query per TTL-fönster istället för en per toggle.
export async function syncProgressToGroups(params: {
  uid: string;
  mediaType: MediaType;
  tmdbId: number;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
  status?: string | null;
}): Promise<void> {
  try {
    let groupIds = getFreshMyGroups(params.uid);
    if (groupIds == null) {
      const { db, collection, getDocs, query, where, limit: queryLimit } = await fsdb();
      const groupsSnap = await getDocs(
        query(
          collection(db, 'groups'),
          where('memberUids', 'array-contains', params.uid),
          queryLimit(MY_GROUPS_LIMIT),
        ),
      );
      groupIds = groupsSnap.docs.map(d => d.id);
      cacheMyGroups(params.uid, groupIds);
    }
    if (groupIds.length === 0) return;
    const { db, doc, getDoc } = await fsdb();
    await Promise.all(groupIds.map(async groupId => {
      try {
        const itemRef = doc(db, 'groups', groupId, 'watchlist', mediaTypeDocId(params.mediaType, params.tmdbId));
        const itemSnap = await getDoc(itemRef);
        if (!itemSnap.exists()) return;
        await setGroupMemberProgress({
          groupId,
          mediaType: params.mediaType,
          tmdbId: params.tmdbId,
          uid: params.uid,
          lastWatchedSeason: params.lastWatchedSeason,
          lastWatchedEpisode: params.lastWatchedEpisode,
          status: params.status ?? null,
        });
      } catch (err) {
        // Logga per grupp så en flaky grupp inte tystar de andra.
        console.warn('[group-progress-sync]', groupId, err);
      }
    }));
  } catch (err) {
    console.warn('[group-progress-sync]', err);
  }
}

// ---- Doc → object converters ----

export function groupDocToObject(id: string, data: Record<string, unknown>): Group {
  return {
    id,
    name: (data.name as string) ?? '',
    ownerUid: (data.ownerUid as string) ?? '',
    memberUids: (data.memberUids as string[]) ?? [],
    defaults: (data.defaults as GroupDefaults) ?? {
      providerMode: 'intersect',
      aggregation: 'least_misery',
      mediaType: 'both',
    },
    inviteTokenHash: (data.inviteTokenHash as string | null) ?? null,
    inviteTokenRotatedAt: data.inviteTokenRotatedAt ? toDate(data.inviteTokenRotatedAt) : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function memberDocToObject(id: string, data: Record<string, unknown>): GroupMember {
  return {
    uid: (data.uid as string) ?? id,
    displayName: (data.displayName as string) ?? '',
    username: (data.username as string | null) ?? null,
    photoURL: (data.photoURL as string | null) ?? null,
    providers: (data.providers as number[]) ?? [],
    role: ((data.role as GroupRole) ?? 'member'),
    joinedAt: toDate(data.joinedAt),
    notifications: (data.notifications as boolean) ?? true,
  };
}

export function watchlistDocToObject(id: string, data: Record<string, unknown>): GroupWatchlistItem {
  return {
    // Prefer the stored field; parse the doc id as fallback. Once group watchlist
    // ids are namespaced (movie_123) in Phase 5, a bare Number(id) would be NaN.
    tmdbId: resolveTmdbId(data.tmdbId as number | string | null | undefined, id),
    mediaType: (data.mediaType as MediaType) ?? 'movie',
    title: (data.title as string) ?? '',
    posterPath: (data.posterPath as string | null) ?? null,
    releaseYear: (data.releaseYear as number | null) ?? null,
    addedBy: (data.addedBy as string) ?? '',
    addedAt: toDate(data.addedAt),
    memberRatings: (data.memberRatings as Record<string, number>) ?? {},
  };
}

// ---- Subscriptions / fetchers ----

export function subscribeToGroup(
  groupId: string,
  cb: (group: Group | null) => void,
): () => void {
  return lazySubscribe(({ db, doc, onSnapshot }) =>
    onSnapshot(doc(db, 'groups', groupId), snap => {
      if (!snap.exists()) { cb(null); return; }
      cb(groupDocToObject(snap.id, snap.data()));
    }));
}

export function subscribeToGroupMembers(
  groupId: string,
  cb: (members: GroupMember[]) => void,
): () => void {
  return lazySubscribe(({ db, collection, onSnapshot }) =>
    onSnapshot(collection(db, 'groups', groupId, 'members'), snap => {
      cb(snap.docs.map(d => memberDocToObject(d.id, d.data())));
    }));
}

export function subscribeToGroupWatchlist(
  groupId: string,
  cb: (items: GroupWatchlistItem[]) => void,
): () => void {
  return lazySubscribe(({ db, collection, onSnapshot }) =>
    onSnapshot(collection(db, 'groups', groupId, 'watchlist'), snap => {
      cb(snap.docs.map(d => watchlistDocToObject(d.id, d.data())));
    }));
}

// ── BIN-184: Hushåll — opt-in delade prenumerationsbidrag ────────────────────
// groups/{gid}/household/{uid} skrivs ENDAST av medlemmen själv (opt-in = att
// skriva doc:et), läses bara av medlemmar som själva delar (share-to-see,
// ADR 0010), raderas av self/owner. Payload byggs av buildHouseholdContribution
// (householdAggregate.ts) — tier-namn lämnar aldrig klienten (DPO-krav).

function householdDocToObject(uid: string, data: Record<string, unknown>): HouseholdContribution {
  return {
    uid,
    providerIds: Array.isArray(data.providerIds) ? (data.providerIds as number[]) : [],
    providerCosts: (data.providerCosts as HouseholdContribution['providerCosts']) ?? {},
    providerCampaigns: (data.providerCampaigns as HouseholdContribution['providerCampaigns']) ?? {},
    activeProviderIds: Array.isArray(data.activeProviderIds) ? (data.activeProviderIds as number[]) : [],
    updatedAt: toDate(data.updatedAt)?.getTime() ?? null,
  };
}

/** Opt-in / refresh: skriv (över) medlemmens eget bidrag. Callern ansvarar för
 *  dirty-checken (contributionContentEquals) så oförändrat innehåll aldrig ger
 *  en Firestore-write (25 SEK-cappen). */
export async function setHouseholdContribution(
  groupId: string,
  uid: string,
  content: HouseholdContributionContent,
): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  await setDoc(doc(db, 'groups', groupId, 'household', uid), {
    ...content,
    updatedAt: serverTimestamp(),
  });
}

/** Opt-out (ångra delning) utan att lämna gruppen — DBA-krav: opt-in får inte
 *  vara enkelriktad. Raderingen slår igenom live hos läsande klienter via
 *  onSnapshot-prenumerationen (DPO-krav: revoke är omedelbar, inte eventual). */
export async function deleteHouseholdContribution(groupId: string, uid: string): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  await deleteDoc(doc(db, 'groups', groupId, 'household', uid));
}

/** Live-prenumeration på gruppens hushålls-bidrag. Ett revokerat/lämnat
 *  medlemsbidrag försvinner ur aggregatet i samma session. OBS: rules släpper
 *  bara igenom läsare som själva delar (share-to-see) — `onDenied` anropas
 *  ENDAST vid permission-denied (= inte opt-in) så opt-in-gaten aldrig visas
 *  för en delande medlem under ett transient fel; övriga fel går till
 *  `onError` (säkerhetsreview 2026-07-05: gate-by-denial får inte maskera
 *  en riktig driftstörning som "du delar inte"). */
export function subscribeToGroupHousehold(
  groupId: string,
  cb: (contributions: HouseholdContribution[]) => void,
  onDenied?: () => void,
  onError?: () => void,
): () => void {
  return lazySubscribe(({ db, collection, onSnapshot }) =>
    onSnapshot(
      collection(db, 'groups', groupId, 'household'),
      snap => {
        cb(snap.docs.map(d => householdDocToObject(d.id, d.data())));
      },
      err => {
        if (isPermissionDenied(err)) onDenied?.();
        else onError?.();
      },
    ));
}

/** DBA-krav (BIN-184): fan-out från mutationskällan — när användaren ändrar
 *  providers/kostnad/tier/kampanj uppdateras hens hushålls-bidrag i varje grupp
 *  där hen opt:at in, så andra medlemmars vy inte rotar tills nästa sidbesök.
 *  Speglar updateMemberProviders-mönstret. activeProviderIds bevaras från det
 *  befintliga doc:et (watchlist-datan finns inte i det här lagret; den
 *  uppdateras av grupp-sidans visit-refresh). Dirty-check före varje write. */
export async function refreshMyHouseholdContributions(
  uid: string,
  fields: {
    myProviders: number[];
    providerCosts: Record<number, number>;
    providerTiers: Record<number, string>;
    providerCampaigns: Record<number, ProviderCampaign>;
  },
): Promise<void> {
  const { db, collection, doc, getDoc, getDocs, query, where, limit: queryLimit } = await fsdb();
  const groupsSnap = await getDocs(
    query(
      collection(db, 'groups'),
      where('memberUids', 'array-contains', uid),
      queryLimit(MY_GROUPS_LIMIT),
    ),
  );
  await Promise.all(groupsSnap.docs.map(async g => {
    try {
      const snap = await getDoc(doc(db, 'groups', g.id, 'household', uid));
      if (!snap.exists()) return; // inte opt-in i den här gruppen
      const existing = householdDocToObject(uid, snap.data() as Record<string, unknown>);
      const built = buildHouseholdContribution(
        fields.myProviders, fields.providerCosts, fields.providerTiers, fields.providerCampaigns, [],
      );
      const next: HouseholdContributionContent = {
        ...built,
        activeProviderIds: existing.activeProviderIds,
      };
      if (contributionContentEquals(next, existing)) return; // dirty-check → ingen write
      await setHouseholdContribution(g.id, uid, next);
    } catch {
      // Best-effort per grupp (samma som updateMemberProviders-fan-outen) —
      // en trasig grupp får inte stoppa övriga eller själva profil-ändringen.
    }
  }));
}

// BIN-510: bounded query + refreshar myGroupsCache på varje snapshot — den
// live-mekanism som gör syncProgressToGroups' TTL-cache färsk "gratis" när
// någon gruppyta (t.ex. grupplistan) råkar vara monterad, utan att någon
// mutationsfunktion behöver komma ihåg att invalidera manuellt.
export function subscribeToMyGroups(
  uid: string,
  cb: (groups: Group[]) => void,
): () => void {
  return lazySubscribe(({ db, collection, query, where, limit, onSnapshot }) =>
    onSnapshot(
      query(
        collection(db, 'groups'),
        where('memberUids', 'array-contains', uid),
        limit(MY_GROUPS_LIMIT),
      ),
      snap => {
        cacheMyGroups(uid, snap.docs.map(d => d.id));
        cb(snap.docs.map(d => groupDocToObject(d.id, d.data())));
      },
    ));
}

export async function getGroupOnce(groupId: string): Promise<Group | null> {
  const { db, doc, getDoc } = await fsdb();
  const snap = await getDoc(doc(db, 'groups', groupId));
  if (!snap.exists()) return null;
  return groupDocToObject(snap.id, snap.data());
}

export interface GroupInvite {
  groupId: string;
  groupName: string;
  fromUid: string;
  fromDisplayName: string;
  invitedAt: Date;
}

// Live-prenumeration på inkomna grupp-inbjudningar för en användare. Speglar
// useFriendRequests-mönstret men som onSnapshot (badge/lista uppdateras live).
export function subscribeToMyGroupInvites(
  uid: string,
  cb: (invites: GroupInvite[]) => void,
): () => void {
  return lazySubscribe(({ db, collection, onSnapshot }) =>
    onSnapshot(collection(db, 'users', uid, 'groupInvites'), snap => {
      cb(snap.docs.map(d => {
        const data = d.data();
        return {
          groupId: d.id,
          groupName: (data.groupName as string) ?? 'Grupp',
          fromUid: (data.fromUid as string) ?? '',
          fromDisplayName: (data.fromDisplayName as string) ?? 'Någon',
          invitedAt: toDate(data.invitedAt),
        };
      }));
    }));
}
