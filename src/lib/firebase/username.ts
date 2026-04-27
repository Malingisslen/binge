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

// Slugify:ar en sträng till en kandidat som *kan* validera mot
// USERNAME_REGEX. Tar bort accenter (Gisslén → Gisslen), lowercase:ar,
// stripper icke-tillåtna tecken, trimmar bindestreck i kanterna och cap:ar
// på 20 tecken. Returnerar tom sträng om inget alfanumeriskt finns kvar.
export function slugifyUsername(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
}

// Genererar en kandidat från Google/email-data. Försöker displayName först
// (Malin Gisslén → "malingisslen"), sedan local-part av email
// (malin.gisslen@x.se → "malingisslen"). Returnerar null om varken kandidat
// validerar (t.ex. för korta efter slugify, eller bara icke-latinska tecken).
export function suggestUsernameFromIdentity(
  displayName: string | null,
  email: string | null,
): string | null {
  const fromName = displayName ? slugifyUsername(displayName) : '';
  if (validateUsername(fromName) === null) return fromName;
  const fromEmail = email ? slugifyUsername(email.split('@')[0] ?? '') : '';
  if (validateUsername(fromEmail) === null) return fromEmail;
  return null;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'usernames', username));
  return !snap.exists();
}

// Hittar närmaste lediga variant av en kandidat. Försöker först bare bones,
// sedan suffix 2-9, sedan ger upp. Sekvensiella reads — kan ta upp till 9
// Firestore-roundtrips i värsta fall, men rätt path är 1 read för 99 % av
// användare. Anropas bara från sign-in-flödet för helt nya konton.
export async function findAvailableUsername(base: string): Promise<string | null> {
  if (validateUsername(base) === null && await isUsernameAvailable(base)) return base;
  for (let i = 2; i <= 9; i++) {
    const trimmed = base.slice(0, 19);
    const candidate = `${trimmed}${i}`;
    if (validateUsername(candidate) === null && await isUsernameAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
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
