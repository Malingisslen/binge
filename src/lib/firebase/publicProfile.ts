import { fsdb } from './db';
import { toDate } from './utils';

// BIN-505: public profile PROJECTION. users/{uid} is owner-locked because it
// carries sensitive fields (email, hemkommun, providerCosts, providerCampaigns,
// …) and Firestore reads are whole-doc. publicProfiles/{uid} is the ONLY doc a
// public/friend viewer reads — a positive whitelist of public-safe DISPLAY
// fields (see isValidPublicProfile in firestore.rules). `myProviders` is
// deliberately NOT here (Malin 2026-07-14: which-services is not public).
//
// Every client site that used to read a FOREIGN users/{uid} doc reads through
// this module instead, so the read-lock can't silently break a caller.

export interface PublicProfileCard {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  bio: string;
  // Coarse visibility flag — whether the source profile is public. Used ONLY to
  // gate follower/following-count queries client-side (those rules allow read for
  // public OR owner, not friends), so a friend-only profile view doesn't fire a
  // denied count query into Sentry/Plausible. NOT an access gate (the projection
  // read is live-gated by the rule); a stale value is at worst transient noise.
  isPublic: boolean;
  createdAt: Date | null;
}

// The public-safe subset written to publicProfiles/{uid}. Source is the owner's
// own UserProfile (React state) or their raw users/{uid} doc data.
interface PublicCardSource {
  displayName?: string | null;
  username?: string | null;
  photoURL?: string | null;
  bio?: string | null;
  isPublic?: boolean;
  createdAt?: unknown;
}

function cardFromDoc(uid: string, data: Record<string, unknown>): PublicProfileCard {
  return {
    uid,
    displayName: (data.displayName as string) ?? '',
    username: (data.username as string | null) ?? null,
    photoURL: (data.photoURL as string | null) ?? null,
    bio: (data.bio as string) ?? '',
    isPublic: (data.isPublic as boolean) ?? false,
    createdAt: data.createdAt ? toDate(data.createdAt) : null,
  };
}

// Read one foreign (or own) public profile card. Returns null when the doc is
// missing OR the read is denied (profile private / not a friend) — callers that
// need to distinguish "no user" from "private" already have the usernames doc.
export async function getPublicProfileCard(uid: string): Promise<PublicProfileCard | null> {
  try {
    const { db, doc, getDoc } = await fsdb();
    const snap = await getDoc(doc(db, 'publicProfiles', uid));
    if (!snap.exists()) return null;
    return cardFromDoc(uid, snap.data());
  } catch {
    // permission-denied (private / not-friend) — treat as unavailable.
    return null;
  }
}

// Batch variant — one getDoc per uid (publicProfiles has no list surface), each
// failing independently. Returns a Map keyed by uid; denied/missing uids are
// simply absent, so callers filter rather than crash (fixes the unguarded
// Promise.all crash sites in feed/friends under the read-lock).
export async function getPublicProfileCards(
  uids: string[],
): Promise<Map<string, PublicProfileCard>> {
  const out = new Map<string, PublicProfileCard>();
  await Promise.all(
    uids.map(async uid => {
      const card = await getPublicProfileCard(uid);
      if (card) out.set(uid, card);
    }),
  );
  return out;
}

export const publicProfileSignatureKey = (uid: string) => `binge:pubprofile-sig:${uid}`;

// BIN-817: the localStorage signature must not be READABLE. Until 2026-08-09 this
// function returned the JSON array itself, so displayName/username/photoURL/bio sat
// in plaintext on disk, keyed by uid, with no expiry — undisclosed in the privacy
// policy and surviving account deletion (clearFirestorePersistence drops IndexedDB
// only). The comparison never needed the content, only "did it change".
//
// The exact field list and ORDER below is load-bearing in two directions: it is what
// the hash covers, and `legacySignature` must reproduce the pre-2026-08-09 string
// byte-for-byte so an existing key can be recognised without a redundant write.
// `createdAt` is deliberately absent (it is written to the projection but never
// changes after the first write) — do not add it to either function.
function signatureFields(src: PublicCardSource): [string, string | null, string | null, string, boolean] {
  return [
    src.displayName ?? '',
    src.username ?? null,
    src.photoURL ?? null,
    src.bio ?? '',
    src.isPublic ?? false,
  ];
}

// The pre-2026-08-09 on-disk form. Kept ONLY to recognise a key written by the old
// build: matching it means the profile is unchanged, so the key is upgraded to the
// hash in place and NO Firestore write is spent. Never written.
function legacySignature(src: PublicCardSource): string {
  return JSON.stringify(signatureFields(src));
}

// FNV-1a (32-bit), base36. Synchronous on purpose: syncMyPublicProfile's cheap
// bail-out runs BEFORE the lazy fsdb() import, and `crypto.subtle` would drag an
// await into that path (and is absent from this module's test `window` stub).
//
// A collision does NOT merely skip a no-op: it skips a REAL write, so the projection
// keeps showing the previous name/bio until the next field change. That is tolerable
// here and nowhere near a security boundary — the projection READ is gated on
// users/{uid}, not on the projection's own isPublic (firestore.rules), so a stale
// card can never turn a private profile public — but do not copy this hash into a
// place where a missed write would matter. Base36 can never start with `[`, which is
// what keeps the legacy-vs-hash format check unambiguous.
function hashSignature(src: PublicCardSource): string {
  const input = JSON.stringify(signatureFields(src));
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Owner-only, best-effort: drop the local signature so account deletion leaves no
// trace of the profile card on the device. Exported so the key name lives in exactly
// one place — AuthContext's deletion cascade calls this rather than re-spelling it.
export function clearPublicProfileSignature(uid: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(publicProfileSignatureKey(uid));
  } catch { /* private mode */ }
}

// Owner-only: write/repair MY publicProfiles/{uid} from my own profile. Covers
// BOTH the backfill for existing users (projection missing) and drift-repair
// (display field changed). Best-effort + skip-if-unchanged: a stale projection
// is only a cosmetic stale name (visibility is live-gated by the rule), never a
// leak, so a missed sync is harmless. Never throws.
export async function syncMyPublicProfile(uid: string, src: PublicCardSource): Promise<void> {
  const sigKey = publicProfileSignatureKey(uid);
  const sig = hashSignature(src);
  try {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(sigKey);
      if (stored === sig) return;
      // A key written by the pre-BIN-817 build still proves the profile is unchanged.
      // Upgrade it to the hash in place and skip the write — otherwise every existing
      // user would pay one redundant projection write on their first post-deploy load.
      if (stored !== null && stored === legacySignature(src)) {
        try { window.localStorage.setItem(sigKey, sig); } catch { /* private mode */ }
        return;
      }
    }
  } catch { /* private mode — fall through and write */ }
  try {
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    // photoURL: the users/{uid} doc has NO length bound on it, but the projection
    // rule caps it at 500. Omit an over-long URL (→ null) rather than let the whole
    // atomic write fail the rule and get swallowed — which would leave the user
    // with NO projection at all (invisible in search/friends/profile).
    const photoURL = src.photoURL && src.photoURL.length <= 500 ? src.photoURL : null;
    // Clamp to the projection rule's caps (80 / 160) so an over-long name or bio
    // can't make the WHOLE atomic write fail the rule and get swallowed — which
    // would leave the user with NO projection (invisible everywhere). users/{uid}
    // itself has no length rule on displayName at signup, so this is reachable.
    const displayName = (src.displayName ?? '').slice(0, 80);
    const bio = (src.bio ?? '').slice(0, 160);
    await setDoc(
      doc(db, 'publicProfiles', uid),
      {
        displayName,
        username: src.username ?? null,
        photoURL,
        bio,
        isPublic: src.isPublic ?? false,
        // createdAt is preserved as-is when present (member-since); a serverTimestamp
        // is only stamped on first backfill via merge if the field is absent upstream.
        ...(src.createdAt ? { createdAt: src.createdAt } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    try { window.localStorage.setItem(sigKey, sig); } catch { /* private mode */ }
  } catch {
    // best-effort; the profile edit itself already persisted to users/{uid}.
  }
}

// NOTE: account-deletion erases the publicProfiles/{uid} DOC via the deletion
// cascade (collectDeletionRefs → snaps.publicProfileSnap.ref). The device-local
// signature key is NOT covered by that cascade — clearFirestorePersistence only
// drops IndexedDB — so AuthContext.deleteAccount calls clearPublicProfileSignature
// above, after the point of no return. Erasing one without the other is what
// BIN-817 was filed about.
