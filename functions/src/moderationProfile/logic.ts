/**
 * Pure logic for `getProfileForModeration` (BIN-1244). No firebase-admin or
 * firebase-functions imports, so the root vitest can run the tests in CI.
 *
 * Malin's decision 2026-09-18: an admin may see a reported user's profile, but only
 * for moderation. A Firestore rule cannot tell which screen asks, so widening the
 * `publicProfiles` read rule would have reached search, invites and lists too. The
 * admin view instead calls this function, and nothing else in the app changes.
 */

/** Firestore auto-ids and Auth uids are far shorter; the bound only stops abuse. */
export const MODERATION_UID_MAX = 128;

export type LookupInput = { ok: true; uid: string } | { ok: false; error: string };

export function validateLookupInput(data: unknown): LookupInput {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Ogiltig förfrågan.' };
  const uid = (data as Record<string, unknown>).uid;
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > MODERATION_UID_MAX || uid.includes('/')) {
    return { ok: false, error: 'Ogiltigt användar-id.' };
  }
  return { ok: true, uid };
}

/** The caller's own `users/{uid}` data decides; only a literal `true` counts. */
export function isAdminDoc(data: Record<string, unknown> | undefined): boolean {
  return data?.isAdmin === true;
}

export interface ModerationProfile {
  displayName: string;
  username: string | null;
  photoURL: string | null;
  bio: string;
  isPublic: boolean;
}

/**
 * Whitelist of what the admin view gets back. Same display fields as the public
 * projection itself (`isValidPublicProfile` in firestore.rules); anything else on the
 * document is dropped, and `users/{uid}` is never read.
 */
export function projectModerationProfile(data: Record<string, unknown>): ModerationProfile {
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    username: typeof data.username === 'string' ? data.username : null,
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    bio: typeof data.bio === 'string' ? data.bio : '',
    isPublic: data.isPublic === true,
  };
}

/**
 * Per-admin lookup budget. A stolen admin session must not become an unbounded way
 * to read every profile (role 4's condition). The counter lives in the top-level
 * `moderationBudget/{adminUid}`, which no rule in firestore.rules matches, so every
 * client read and write is denied and only this function (Admin SDK) touches it. Under
 * `users/{uid}/reportMeta/` the owner's delete right would have let the admin reset it.
 */
export const MODERATION_LOOKUP_WINDOW_MS = 60 * 60 * 1000;
export const MODERATION_LOOKUPS_PER_WINDOW = 120;

export interface LookupBudget { windowStartMs: number; count: number }

/** Returns the budget after this call, or null when the call is over the limit. */
export function spendLookup(prev: LookupBudget | null, nowMs: number): LookupBudget | null {
  if (!prev || nowMs - prev.windowStartMs >= MODERATION_LOOKUP_WINDOW_MS || nowMs < prev.windowStartMs) {
    return { windowStartMs: nowMs, count: 1 };
  }
  if (prev.count >= MODERATION_LOOKUPS_PER_WINDOW) return null;
  return { windowStartMs: prev.windowStartMs, count: prev.count + 1 };
}
