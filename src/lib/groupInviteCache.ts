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
