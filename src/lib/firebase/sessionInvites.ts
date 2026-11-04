import { fsdb } from './db';
import { captureError } from '@/lib/sentry';
import {
  buildSessionInviteFields,
  inviteRecipients,
  isJoinableSession,
  parseSessionInvite,
  sessionInviteDocId,
  type SessionInvite,
} from '@/lib/sessionInvites';

// Bjud in till Tillsammans: users/{recipientUid}/sessionInvites/{sessionId}_{fromUid}.
// firestore.rules decides who may be invited (a friend or a member of the session's
// group, nobody blocked either way, and only while the recipient accepts invites), so a
// refused write is one recipient the invite did not reach, not an error for the host.

export const SESSION_INVITES_LIST_LIMIT = 50;

export interface SendSessionInvitesResult {
  sent: string[];
  failed: string[];
}

/**
 * One invite per recipient, written side by side. A refusal for one person does not
 * stop the others; the caller tells the host how many did not go out. The recipients
 * are capped and de-duplicated here, whatever the picker passed.
 */
export async function sendSessionInvites(params: {
  sessionId: string;
  fromUid: string;
  fromName: string | null;
  recipientUids: readonly string[];
}): Promise<SendSessionInvitesResult> {
  const recipients = inviteRecipients(params.recipientUids, params.fromUid);
  if (recipients.length === 0) return { sent: [], failed: [] };
  const { db, doc, setDoc, serverTimestamp } = await fsdb();
  const fields = buildSessionInviteFields({
    fromUid: params.fromUid,
    fromName: params.fromName,
    sessionId: params.sessionId,
  });
  const id = sessionInviteDocId(params.sessionId, params.fromUid);
  const results = await Promise.allSettled(recipients.map(uid =>
    setDoc(doc(db, 'users', uid, 'sessionInvites', id), { ...fields, createdAt: serverTimestamp() }),
  ));
  const sent: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? sent : failed).push(recipients[i]));
  // A refusal is expected (a recipient who turned invites off), so only its code is
  // reported, never the path: the path carries the session id.
  const codes = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => (r.reason as { code?: unknown })?.code ?? 'unknown');
  if (codes.some(c => c !== 'permission-denied')) {
    captureError(new Error('sendSessionInvites: invite write failed'), {
      scope: 'sessionInvites', kind: 'send', extra: { codes: codes.join(',') },
    });
  }
  return { sent, failed };
}

export async function listSessionInvites(myUid: string): Promise<SessionInvite[]> {
  const { db, collection, getDocs, query, orderBy, limit } = await fsdb();
  const snap = await getDocs(query(
    collection(db, 'users', myUid, 'sessionInvites'),
    orderBy('createdAt', 'desc'),
    limit(SESSION_INVITES_LIST_LIMIT),
  ));
  const invites: SessionInvite[] = [];
  for (const d of snap.docs) {
    const invite = parseSessionInvite(d.id, d.data());
    if (invite) invites.push(invite);
  }
  return invites;
}

export async function declineSessionInvite(myUid: string, inviteId: string): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  await deleteDoc(doc(db, 'users', myUid, 'sessionInvites', inviteId));
}

export type OpenSessionInviteResult =
  | { status: 'open'; sessionId: string }
  | { status: 'gone' };

/**
 * "Gå med": look the session up, then remove the invite either way. A session that is
 * gone or past its expiry answers `gone`, so the row can say "Sessionen finns inte
 * längre" instead of opening an empty page. Removing the invite is best-effort on the
 * way in: the session page works without it, and the retention sweep is the backstop.
 */
export async function openSessionInvite(myUid: string, invite: SessionInvite): Promise<OpenSessionInviteResult> {
  const { db, doc, getDoc } = await fsdb();
  const snap = await getDoc(doc(db, 'sessions', invite.sessionId));
  const joinable = snap.exists() && isJoinableSession(snap.data(), Date.now());
  try {
    await declineSessionInvite(myUid, invite.id);
  } catch (err) {
    captureError(new Error('openSessionInvite: removing the invite failed'), {
      scope: 'sessionInvites', kind: 'remove-on-open',
      extra: { code: String((err as { code?: unknown })?.code ?? 'unknown') },
    });
    if (!joinable) throw err;
  }
  return joinable ? { status: 'open', sessionId: invite.sessionId } : { status: 'gone' };
}
