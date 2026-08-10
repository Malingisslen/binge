// LocalStorage-cache för plaintext-invite-tokens. Eftersom Firestore bara
// lagrar hashen kan ägaren bara se en aktiv invite-länk på den enhet där
// den genererades. Cache:n lagrar plaintext per groupId så ägaren kan
// återbesöka panel:n och kopiera länken igen.
//
// Keyspace är prefixat så vi inte krockar med andra binge-keys. Värdet
// rensas på rotate (efter att ny plaintext lagrats) och på disable.

const PREFIX = 'binge:groupInvite:';

function key(groupId: string): string {
  return `${PREFIX}${groupId}`;
}

export function cacheInviteToken(groupId: string, plaintext: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(groupId), plaintext);
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function readInviteToken(groupId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key(groupId));
  } catch {
    return null;
  }
}

export function clearInviteToken(groupId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(groupId));
  } catch {
    /* ignore */
  }
}

/**
 * BIN-844 — remove every cached invite plaintext on this device.
 *
 * Called from account deletion ONLY, not from sign-out. That is Malin's call
 * 2026-08-10 against a split panel, and the reasoning is worth keeping: the app
 * never shows this value to anyone but the group's owner (`GroupSidePanels`
 * renders it behind `isOwner`), so a different person signing in on the same
 * device cannot reach it through the UI — while clearing it on sign-out would
 * cost the OWNER their own link, and the only way back is "Generera ny", which
 * invalidates the link they already shared with people who have not clicked yet.
 * A routine sign-out would silently arm that trap. Security's counter-argument
 * stands and is recorded: someone who opens devtools reads the plaintext either
 * way, and clearing it revokes nothing server-side.
 *
 * On deletion the sweep is pure hygiene — an owner's groups are deleted by the
 * cascade, so the tokens these keys point at are already gone.
 *
 * Collect-then-remove: `localStorage.removeItem` inside an index-based loop
 * shifts the indices and silently skips every other key. There is no other
 * prefix sweep in this repo to copy, so this is the reference for the next one.
 */
export function clearAllInviteTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed = Object.keys(window.localStorage).filter(k => k.startsWith(PREFIX));
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    /* ignore quota / privacy mode */
  }
}
