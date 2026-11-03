/**
 * Bjud in till Tillsammans — the decisions behind the invite notice.
 *
 * A host can create a session, invite, delete it and start again, so without a
 * brake the same host could put a stream of notices on a friend's lock screen.
 * One marker per (recipient, sender) pair in `sessionInvitePushes` holds the
 * notice back inside a window; the invite itself still lands and is shown in the
 * app. A second limit caps how many invites one recipient holds at once: past it
 * the trigger deletes the new invite without a notice, so many hosts together
 * cannot fill one inbox either.
 *
 * The session id is the session's access key (ADR 0013/0015). Nothing here puts it
 * into a notice, a push payload or a log line, and nothing here needs to.
 *
 * Pure, with no firebase-admin import, so it runs under the root vitest toolchain
 * like `followPush/logic.ts`.
 */

/** How long after one notice the same sender cannot notify the same recipient again. */
export const SESSION_INVITE_PUSH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Markers older than this are reaped by `retentionCleanup`. A marker only matters
 * inside the window above; the margin keeps one that is still doing its job from
 * being reaped by a sweep that runs once a day.
 */
export const SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Pending invites one recipient can hold. An invite that arrives past it is
 * deleted by the trigger without a notice. Invites leave by being answered or by
 * the retention sweep, so the cap frees up on its own.
 */
export const SESSION_INVITE_RECIPIENT_CAP = 20;

/**
 * An invite older than this is reaped by `retentionCleanup`. A session lives for
 * the same span from its creation, so an invite this old points at a session that
 * is gone or about to be.
 */
export const SESSION_INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Longest sender name the inbox card shows, counted in code points. */
export const SENDER_NAME_MAX_CHARS = 40;

/** Shown when the sender's profile carries no usable name. */
export const FALLBACK_SENDER_NAME = 'En vän';

/** Where the card and the push lead: Vänner, where "Väntar på dig" lists the invite. */
export const SESSION_INVITE_ACTION_URL = '/my/friends/';

/** The pair marker's document id. */
export function sessionInvitePushMarkerId(recipientUid: string, fromUid: string): string {
  return `${recipientUid}_${fromUid}`;
}

/**
 * Whether the created document's id is `{sessionId}_{fromUid}` for the sender its
 * `fromUid` names. firestore.rules binds both on create; this guards the trigger
 * against a document the Admin SDK or an older rule wrote.
 */
export function inviteIdNamesSender(inviteId: string, fromUid: unknown): fromUid is string {
  return typeof fromUid === 'string'
    && fromUid.length > 0
    && inviteId.endsWith(`_${fromUid}`)
    && inviteId.length > fromUid.length + 1;
}

/** Only an explicit false turns invites off; an account without the key gets them. */
export function wantsSessionInvites(recipientProfile: Record<string, unknown>): boolean {
  const settings = recipientProfile.notificationSettings as Record<string, unknown> | undefined;
  return settings?.sessionInviteNotify !== false;
}

/** Same reading as `sendPushToUser`: push only on an explicit true. */
export function recipientPushEnabled(recipientProfile: Record<string, unknown>): boolean {
  const settings = recipientProfile.notificationSettings as Record<string, unknown> | undefined;
  return settings?.pushEnabled === true;
}

/** Whether the recipient now holds more invites than the cap allows. */
export function overRecipientCap(pendingCount: number): boolean {
  return pendingCount > SESSION_INVITE_RECIPIENT_CAP;
}

/**
 * Whether a new invite may notify. `lastPushedAtMs` is null when the pair has never
 * notified, or when its marker has already been reaped.
 */
export function mayNotifySessionInvite(lastPushedAtMs: number | null, nowMs: number): boolean {
  return lastPushedAtMs === null || nowMs - lastPushedAtMs >= SESSION_INVITE_PUSH_WINDOW_MS;
}

/** Whether `retentionCleanup` may delete a marker last stamped at `lastPushedAtMs`. */
export function isStaleSessionInvitePushMarker(lastPushedAtMs: number | null, nowMs: number): boolean {
  return lastPushedAtMs !== null && lastPushedAtMs < nowMs - SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS;
}

/** Whether `retentionCleanup` may delete an invite created at `createdAtMs`. */
export function isStaleSessionInvite(createdAtMs: number | null, nowMs: number): boolean {
  return createdAtMs !== null && createdAtMs < nowMs - SESSION_INVITE_MAX_AGE_MS;
}

// Control characters would break the line in the bell.
const CONTROL_CHARS = /\p{Cc}+/gu;

/** The sender's name as the inbox card shows it, read from their own profile. */
export function senderDisplayName(senderProfile: Record<string, unknown> | null): string {
  const raw = senderProfile?.displayName;
  const name = typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!name) return FALLBACK_SENDER_NAME;
  const points = Array.from(name);
  if (points.length <= SENDER_NAME_MAX_CHARS) return name;
  return `${points.slice(0, SENDER_NAME_MAX_CHARS - 1).join('').trimEnd()}…`;
}

export interface SessionInviteNotice {
  card: { title: string; body: string; actionUrl: string };
  push: { title: string; body: string; actionUrl: string; tag: string };
}

/**
 * The card is in the recipient's own inbox and may name the sender. The push is
 * neutral, with no name, because a lock screen is readable by whoever holds the
 * phone. Neither carries the session id: both lead to Vänner, where the invite
 * itself is listed.
 */
export function buildSessionInviteNotice(senderProfile: Record<string, unknown> | null): SessionInviteNotice {
  return {
    card: {
      title: 'Inbjudan till Tillsammans',
      body: `${senderDisplayName(senderProfile)} bjuder in dig att välja något att se tillsammans`,
      actionUrl: SESSION_INVITE_ACTION_URL,
    },
    push: {
      title: 'Binge',
      body: 'Du har fått en inbjudan till Tillsammans',
      actionUrl: SESSION_INVITE_ACTION_URL,
      tag: 'session-invite',
    },
  };
}
