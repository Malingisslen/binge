// Bjud in till Tillsammans: users/{recipientUid}/sessionInvites/{sessionId}_{fromUid}.
// Pure helpers, so the id, the payload and the parse are testable without Firebase and
// the rules test writes with the same builder the app does.

// How many people one session can invite from the app. The function also caps what one
// recipient can hold (functions/src/sessionInvitePush/logic.ts); this one stops a single
// tap from fanning out to a whole friend list.
export const MAX_SESSION_INVITEES = 20;

// The rules bind `fromName` to the sender's own profile name, which the profile rules
// already cap at this length. Kept here so the client can drop a longer value instead of
// sending a write the rules refuse.
export const SESSION_INVITE_FROM_NAME_MAX = 80;

// A session id is a Firestore auto-id. The rules accept only this alphabet, so the id
// joined with '_' below always splits back into the same session and sender.
const SESSION_ID_RE = /^[A-Za-z0-9]{1,40}$/;

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId);
}

// One invite per session and sender, so inviting the same person to the same session
// twice overwrites nothing and adds nothing. firestore.rules binds the id to this form.
export function sessionInviteDocId(sessionId: string, fromUid: string): string {
  return `${sessionId}_${fromUid}`;
}

export interface SessionInvitePayloadInput {
  fromUid: string;
  fromName: string | null | undefined;
  sessionId: string;
}

// The fields of an invite document, without `createdAt` (the write adds the server time).
// A name that is empty or longer than the rules allow is sent as null: the rules would
// refuse it, and the recipient's row reads the sender's public card first anyway.
export function buildSessionInviteFields(input: SessionInvitePayloadInput): Record<string, unknown> {
  const name = typeof input.fromName === 'string' ? input.fromName : '';
  return {
    fromUid: input.fromUid,
    fromName: name.trim() && name.length <= SESSION_INVITE_FROM_NAME_MAX ? name : null,
    sessionId: input.sessionId,
  };
}

export interface SessionInvite {
  id: string;
  fromUid: string;
  fromName: string | null;
  sessionId: string;
  createdAt: Date;
}

// Reads one stored invite. A doc whose id does not match its own fields is skipped
// rather than rendered: "Gå med" opens the session the id names, so a mismatch would
// open a different session than the row describes.
export function parseSessionInvite(id: string, data: Record<string, unknown>): SessionInvite | null {
  const { fromUid, fromName, sessionId, createdAt } = data;
  if (typeof fromUid !== 'string' || !fromUid) return null;
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return null;
  if (id !== sessionInviteDocId(sessionId, fromUid)) return null;
  const toDate = (createdAt as { toDate?: () => Date } | null | undefined)?.toDate;
  return {
    id,
    fromUid,
    fromName: typeof fromName === 'string' && fromName ? fromName : null,
    sessionId,
    createdAt: typeof toDate === 'function' ? toDate.call(createdAt) : new Date(0),
  };
}

// The people to invite, in the order they were picked: the sender left out, duplicates
// dropped, and the rest cut at the cap. The cap is applied here and not only in the UI,
// so the send path cannot exceed it whatever the picker does.
export function inviteRecipients(selected: readonly string[], senderUid: string): string[] {
  const out: string[] = [];
  for (const uid of selected) {
    if (!uid || uid === senderUid || out.includes(uid)) continue;
    out.push(uid);
    if (out.length === MAX_SESSION_INVITEES) break;
  }
  return out;
}

// Whether a session can still be joined. A session past `expiresAt` is waiting for the
// retention sweep, and opening it would show a session that is already over.
export function isJoinableSession(
  session: { expiresAt?: unknown } | null | undefined,
  nowMs: number,
): boolean {
  if (!session) return false;
  const toMillis = (session.expiresAt as { toMillis?: () => number } | null | undefined)?.toMillis;
  if (typeof toMillis !== 'function') return true;
  return toMillis.call(session.expiresAt) > nowMs;
}

// The picker's toggle: a ticked person is unticked, and an unticked one is added only
// while there is room under the cap, so the list can never grow past it.
export function toggleInvitee(selected: readonly string[], uid: string): string[] {
  if (selected.includes(uid)) return selected.filter(u => u !== uid);
  if (selected.length >= MAX_SESSION_INVITEES) return [...selected];
  return [...selected, uid];
}

// A group start shows its members ticked, and the host can untick anyone before a
// single invite is written. Nobody is invited by choosing the group alone.
export function groupPrefill(memberUids: readonly string[], senderUid: string): string[] {
  return inviteRecipients(memberUids, senderUid);
}

// What the host is told after the invites are written. A refusal is usually a person who
// turned invites off, so the text names a count and no reason.
export function inviteSummaryText(sent: number, failed: number): string {
  if (sent === 0) return failed === 1 ? 'Inbjudan kunde inte skickas' : 'Inbjudningarna kunde inte skickas';
  const sentText = sent === 1 ? '1 inbjudan skickad' : `${sent} inbjudningar skickade`;
  return failed === 0 ? sentText : `${sentText}, ${failed} kunde inte skickas`;
}
