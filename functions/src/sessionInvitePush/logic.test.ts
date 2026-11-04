import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FALLBACK_SENDER_NAME,
  SENDER_NAME_MAX_CHARS,
  SESSION_INVITE_ACTION_URL,
  SESSION_INVITE_MAX_AGE_MS,
  SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS,
  SESSION_INVITE_PUSH_WINDOW_MS,
  SESSION_INVITE_RECIPIENT_CAP,
  buildSessionInviteNotice,
  inviteIdNamesSender,
  isStaleSessionInvite,
  isStaleSessionInvitePushMarker,
  mayNotifySessionInvite,
  overRecipientCap,
  recipientPushEnabled,
  senderDisplayName,
  sessionInvitePushMarkerId,
  wantsSessionInvites,
} from './logic';

const NOW = Date.parse('2026-11-03T12:00:00Z');

describe('mayNotifySessionInvite', () => {
  it('notifies a pair that has never notified', () => {
    expect(mayNotifySessionInvite(null, NOW)).toBe(true);
  });

  // Both edges with literal offsets: `>` instead of `>=` would hold back a notice
  // exactly one window old, and the other way would let one through early.
  it('holds a notice one millisecond inside the window and allows it exactly at the edge', () => {
    expect(mayNotifySessionInvite(NOW - SESSION_INVITE_PUSH_WINDOW_MS + 1, NOW)).toBe(false);
    expect(mayNotifySessionInvite(NOW - SESSION_INVITE_PUSH_WINDOW_MS, NOW)).toBe(true);
  });

  it('the window is one hour', () => {
    expect(SESSION_INVITE_PUSH_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});

describe('isStaleSessionInvitePushMarker', () => {
  it('reaps a marker one millisecond past the max age, and keeps one exactly at it', () => {
    expect(isStaleSessionInvitePushMarker(NOW - SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(isStaleSessionInvitePushMarker(NOW - SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS, NOW)).toBe(false);
  });

  it('never reaps a marker with no readable stamp', () => {
    expect(isStaleSessionInvitePushMarker(null, NOW)).toBe(false);
  });

  // A reaped marker reads as "never notified", so a max age inside the window
  // would silently shorten the brake.
  it('the max age outlasts the window', () => {
    expect(SESSION_INVITE_PUSH_MARKER_MAX_AGE_MS).toBeGreaterThan(SESSION_INVITE_PUSH_WINDOW_MS);
  });
});

describe('isStaleSessionInvite', () => {
  it('reaps an invite one millisecond past seven days, and keeps one exactly at it', () => {
    expect(SESSION_INVITE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isStaleSessionInvite(NOW - SESSION_INVITE_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(isStaleSessionInvite(NOW - SESSION_INVITE_MAX_AGE_MS, NOW)).toBe(false);
    expect(isStaleSessionInvite(NOW, NOW)).toBe(false);
  });

  it('never reaps an invite with no readable stamp', () => {
    expect(isStaleSessionInvite(null, NOW)).toBe(false);
  });
});

describe('overRecipientCap', () => {
  // The count includes the invite that just landed, so the cap-th invite stays.
  it('keeps the invite that reaches the cap and deletes the one past it', () => {
    expect(overRecipientCap(SESSION_INVITE_RECIPIENT_CAP)).toBe(false);
    expect(overRecipientCap(SESSION_INVITE_RECIPIENT_CAP + 1)).toBe(true);
    expect(overRecipientCap(1)).toBe(false);
  });
});

describe('sessionInvitePushMarkerId', () => {
  it('orders recipient before sender, so the two directions are different markers', () => {
    expect(sessionInvitePushMarkerId('anna', 'bo')).toBe('anna_bo');
    expect(sessionInvitePushMarkerId('bo', 'anna')).not.toBe(sessionInvitePushMarkerId('anna', 'bo'));
  });
});

describe('inviteIdNamesSender', () => {
  it('accepts {sessionId}_{fromUid} for the named sender', () => {
    expect(inviteIdNamesSender('Sess1_hostuid', 'hostuid')).toBe(true);
  });

  it('refuses an id that names another sender, an id that is only the sender, and a non-string', () => {
    expect(inviteIdNamesSender('Sess1_otheruid', 'hostuid')).toBe(false);
    expect(inviteIdNamesSender('_hostuid', 'hostuid')).toBe(false);
    expect(inviteIdNamesSender('Sess1_hostuid', undefined)).toBe(false);
    expect(inviteIdNamesSender('Sess1_', '')).toBe(false);
  });
});

describe('settings', () => {
  it('only an explicit false turns invites off', () => {
    expect(wantsSessionInvites({})).toBe(true);
    expect(wantsSessionInvites({ notificationSettings: {} })).toBe(true);
    expect(wantsSessionInvites({ notificationSettings: { sessionInviteNotify: true } })).toBe(true);
    expect(wantsSessionInvites({ notificationSettings: { sessionInviteNotify: false } })).toBe(false);
  });

  it('pushes only on an explicit pushEnabled true', () => {
    expect(recipientPushEnabled({ notificationSettings: { pushEnabled: true } })).toBe(true);
    expect(recipientPushEnabled({ notificationSettings: {} })).toBe(false);
    expect(recipientPushEnabled({})).toBe(false);
  });
});

describe('buildSessionInviteNotice', () => {
  const SESSION_ID = 'AbCdEfGhIj0123456789';

  it('names the sender on the card and never on the push', () => {
    const n = buildSessionInviteNotice({ displayName: 'Hanna' });
    expect(n.card.body).toContain('Hanna');
    expect(n.push.title).not.toContain('Hanna');
    expect(n.push.body).not.toContain('Hanna');
  });

  it('leads both to Vänner and carries no session id', () => {
    const n = buildSessionInviteNotice({ displayName: SESSION_ID });
    expect(n.card.actionUrl).toBe(SESSION_INVITE_ACTION_URL);
    expect(n.push.actionUrl).toBe(SESSION_INVITE_ACTION_URL);
    expect(SESSION_INVITE_ACTION_URL).toBe('/my/friends/');
    expect(JSON.stringify(n.push)).not.toContain(SESSION_ID);
  });

  it('uses a fallback when the sender has no profile or no name', () => {
    expect(buildSessionInviteNotice(null).card.body).toContain(FALLBACK_SENDER_NAME);
    expect(senderDisplayName({ displayName: '   ' })).toBe(FALLBACK_SENDER_NAME);
  });

  it('removes control characters and shortens a long name', () => {
    expect(senderDisplayName({ displayName: 'Ha\nnna' })).toBe('Ha nna');
    const long = senderDisplayName({ displayName: 'x'.repeat(SENDER_NAME_MAX_CHARS + 5) });
    expect(Array.from(long)).toHaveLength(SENDER_NAME_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});

// The trigger itself needs firebase-admin, which this toolchain does not load. These
// read its source and pin what keeps the session id out of logs and payloads; they
// prove the shape of the code, not its behaviour against Firestore.
describe('onSessionInviteCreate source (shape only)', () => {
  const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');
  const logCalls = SRC.match(/logger\.(info|warn|error)\([\s\S]*?\);/g) ?? [];

  it('logs on every early exit and never names the invite id or the session id', () => {
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/inviteId|sessionId|snap\.ref|event\.params/);
    }
  });

  it('deletes an invite past the cap before any notice is considered', () => {
    expect(SRC.indexOf('overRecipientCap(')).toBeGreaterThan(-1);
    expect(SRC.indexOf('overRecipientCap(')).toBeLessThan(SRC.indexOf('runTransaction('));
    expect(SRC).toMatch(/overRecipientCap\(pending\.data\(\)\.count\)\) \{\s*try \{\s*await snap\.ref\.delete\(\);/);
  });

  it('pushes with the recipient\'s pushEnabled and writes a session_invite card', () => {
    expect(SRC).toMatch(/sendPushToUser\(recipientUid, notice\.push, \{ pushEnabled: recipientPushEnabled\(recipientProfile\) \}\)/);
    expect(SRC).toMatch(/kind: 'session_invite'/);
  });
});
