// BIN-1196. The on-screen text for a friend action that could not be written.
//
// One string per ACTION, and the same string for every cause within that action: a
// separate message for a block would tell the sender they had been blocked. The
// blocked-list clause in `firestore.rules` gates `friendRequests` create and nothing
// else, so only the send path has a refusal a block could explain — naming the wrong
// action elsewhere would cost clarity to buy a secrecy those paths do not need.
//
// It lives here rather than beside one button because four surfaces render these
// actions: the profile button, the friends page's two lists, and the topbar's
// notification popover. A per-file copy is a per-file wording, which is the thing the
// rule above is about.

export type FriendAction = 'send' | 'cancel' | 'accept' | 'decline' | 'remove';

export const FRIEND_FAILURE_TEXT: Record<FriendAction, string> = {
  send: 'Kunde inte skicka förfrågan.',
  cancel: 'Kunde inte avbryta förfrågan.',
  accept: 'Kunde inte acceptera förfrågan.',
  decline: 'Kunde inte avböja förfrågan.',
  remove: 'Kunde inte ta bort vännen.',
};
