// Someone without a display name is still known by their username, so that is shown
// before the 'Användare' placeholder. A blank or whitespace-only name counts as none,
// or the row would render with no name at all.
export function shownFriendName(displayName: unknown, username: unknown): string {
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
  if (typeof username === 'string' && username) return username;
  return 'Användare';
}

// The sender's own public profile wins over the name stored on a request or invite,
// which can be older. A profile with a blank name falls through to its username,
// and only then to the stored name.
export function shownSenderName(
  profile: { displayName: string | null; username: string | null } | null | undefined,
  storedName: string,
): string {
  return profile?.displayName?.trim() || profile?.username || storedName;
}
