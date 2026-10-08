// Someone without a display name is still known by their username, so that is shown
// before the 'Användare' placeholder. A blank or whitespace-only name counts as none,
// or the row would render with no name at all.
export function shownFriendName(displayName: unknown, username: unknown): string {
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();
  if (typeof username === 'string' && username) return username;
  return 'Användare';
}
