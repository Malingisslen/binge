import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './config';

const USERNAME_REGEX = /^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$/;

export function validateUsername(s: string): string | null {
  if (s.length < 3) return 'Minst 3 tecken';
  if (s.length > 20) return 'Max 20 tecken';
  if (s !== s.toLowerCase()) return 'Bara gemener';
  if (!USERNAME_REGEX.test(s)) return 'Bara bokstäver, siffror och bindestreck';
  return null;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'usernames', username));
  return !snap.exists();
}

export interface ResolvedUser {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  myProviders: number[];
}

export async function lookupUserByHandle(handle: string): Promise<ResolvedUser | null> {
  const cleaned = handle.trim().toLowerCase().replace(/^@/, '');
  if (!cleaned) return null;
  const usernameSnap = await getDoc(doc(db, 'usernames', cleaned));
  if (!usernameSnap.exists()) return null;
  const uid = usernameSnap.data().uid as string;
  const profileSnap = await getDoc(doc(db, 'users', uid));
  if (!profileSnap.exists()) return null;
  const p = profileSnap.data();
  return {
    uid,
    displayName: (p.displayName as string) ?? cleaned,
    username: (p.username as string | null) ?? cleaned,
    photoURL: (p.photoURL as string | null) ?? null,
    myProviders: (p.myProviders as number[]) ?? [],
  };
}

export async function claimUsername(uid: string, username: string, oldUsername: string | null): Promise<void> {
  const batch = writeBatch(db);
  if (oldUsername) {
    batch.delete(doc(db, 'usernames', oldUsername));
  }
  batch.set(doc(db, 'usernames', username), { uid, createdAt: serverTimestamp() });
  batch.update(doc(db, 'users', uid), { username, updatedAt: serverTimestamp() });
  await batch.commit();
}
