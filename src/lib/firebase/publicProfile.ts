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

// Signature of the display fields — lets the owner skip a no-op projection write
// on every load (DBA #27: don't re-write on every authenticated session).
function cardSignature(src: PublicCardSource): string {
  return JSON.stringify([
    src.displayName ?? '',
    src.username ?? null,
    src.photoURL ?? null,
    src.bio ?? '',
    src.isPublic ?? false,
  ]);
}

// Owner-only: write/repair MY publicProfiles/{uid} from my own profile. Covers
// BOTH the backfill for existing users (projection missing) and drift-repair
// (display field changed). Best-effort + skip-if-unchanged: a stale projection
// is only a cosmetic stale name (visibility is live-gated by the rule), never a
// leak, so a missed sync is harmless. Never throws.
export async function syncMyPublicProfile(uid: string, src: PublicCardSource): Promise<void> {
  const sigKey = `binge:pubprofile-sig:${uid}`;
  const sig = cardSignature(src);
  try {
    if (typeof window !== 'undefined' && window.localStorage.getItem(sigKey) === sig) return;
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

// NOTE: account-deletion erases publicProfiles/{uid} via the deletion cascade
// (collectDeletionRefs → snaps.publicProfileSnap.ref), so no dedicated delete
// helper is needed here.
