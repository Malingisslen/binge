import { describe, it, expect } from 'vitest';
import {
  MAX_SESSION_INVITEES,
  SESSION_INVITE_FROM_NAME_MAX,
  buildSessionInviteFields,
  groupPrefill,
  inviteRecipients,
  isJoinableSession,
  inviteSummaryText,
  isValidSessionId,
  parseSessionInvite,
  sessionInviteDocId,
  toggleInvitee,
} from './sessionInvites';

const uids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

describe('sessionInviteDocId and isValidSessionId', () => {
  it('joins session and sender with an underscore', () => {
    expect(sessionInviteDocId('AbC123', 'hostuid')).toBe('AbC123_hostuid');
  });

  it('accepts a Firestore auto-id and refuses anything that could split differently', () => {
    expect(isValidSessionId('AbCdEfGhIj0123456789')).toBe(true);
    expect(isValidSessionId('a_b')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('a'.repeat(40))).toBe(true);
    expect(isValidSessionId('a'.repeat(41))).toBe(false);
  });
});

describe('buildSessionInviteFields', () => {
  it('carries exactly the three fields the rules allow besides createdAt', () => {
    expect(buildSessionInviteFields({ fromUid: 'h', fromName: 'Hanna', sessionId: 'S1' }))
      .toEqual({ fromUid: 'h', fromName: 'Hanna', sessionId: 'S1' });
  });

  it('sends null for a blank name or one longer than the rules allow', () => {
    expect(buildSessionInviteFields({ fromUid: 'h', fromName: '  ', sessionId: 'S1' }).fromName).toBeNull();
    expect(buildSessionInviteFields({ fromUid: 'h', fromName: null, sessionId: 'S1' }).fromName).toBeNull();
    const long = 'x'.repeat(SESSION_INVITE_FROM_NAME_MAX + 1);
    expect(buildSessionInviteFields({ fromUid: 'h', fromName: long, sessionId: 'S1' }).fromName).toBeNull();
    const edge = 'x'.repeat(SESSION_INVITE_FROM_NAME_MAX);
    expect(buildSessionInviteFields({ fromUid: 'h', fromName: edge, sessionId: 'S1' }).fromName).toBe(edge);
  });
});

describe('parseSessionInvite', () => {
  const data = { fromUid: 'h', fromName: 'Hanna', sessionId: 'S1', createdAt: { toDate: () => new Date(5) } };

  it('reads a well-formed invite', () => {
    expect(parseSessionInvite('S1_h', data)).toEqual({
      id: 'S1_h', fromUid: 'h', fromName: 'Hanna', sessionId: 'S1', createdAt: new Date(5),
    });
  });

  // "Gå med" opens the session the stored field names, so an id that disagrees with it
  // is not rendered.
  it('skips a doc whose id does not match its fields', () => {
    expect(parseSessionInvite('S2_h', data)).toBeNull();
    expect(parseSessionInvite('S1_x', data)).toBeNull();
  });

  it('skips a doc without a sender or with a malformed session id', () => {
    expect(parseSessionInvite('S1_h', { ...data, fromUid: '' })).toBeNull();
    expect(parseSessionInvite('a_b_h', { ...data, sessionId: 'a_b' })).toBeNull();
  });

  it('reads a missing name as null', () => {
    expect(parseSessionInvite('S1_h', { ...data, fromName: null })?.fromName).toBeNull();
  });
});

describe('inviteRecipients', () => {
  it('drops the sender and duplicates, keeping the pick order', () => {
    expect(inviteRecipients(['a', 'me', 'b', 'a', ''], 'me')).toEqual(['a', 'b']);
  });

  it('cuts at the cap', () => {
    const out = inviteRecipients(uids(MAX_SESSION_INVITEES + 5), 'me');
    expect(out).toHaveLength(MAX_SESSION_INVITEES);
    expect(out[0]).toBe('u0');
    expect(MAX_SESSION_INVITEES).toBe(20);
  });
});

describe('toggleInvitee', () => {
  it('adds and removes', () => {
    expect(toggleInvitee([], 'a')).toEqual(['a']);
    expect(toggleInvitee(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('adds nobody past the cap, and still removes there', () => {
    const full = uids(MAX_SESSION_INVITEES);
    expect(toggleInvitee(full, 'extra')).toEqual(full);
    expect(toggleInvitee(full, 'u0')).toHaveLength(MAX_SESSION_INVITEES - 1);
  });
});

describe('groupPrefill', () => {
  it('ticks every member but the host, up to the cap', () => {
    expect(groupPrefill(['me', 'a', 'b'], 'me')).toEqual(['a', 'b']);
    expect(groupPrefill(uids(MAX_SESSION_INVITEES + 3), 'me')).toHaveLength(MAX_SESSION_INVITEES);
  });
});

describe('isJoinableSession', () => {
  const at = (ms: number) => ({ expiresAt: { toMillis: () => ms } });

  it('is false for a missing session and for one past its expiry', () => {
    expect(isJoinableSession(null, 1000)).toBe(false);
    expect(isJoinableSession(at(1000), 1000)).toBe(false);
    expect(isJoinableSession(at(999), 1000)).toBe(false);
  });

  it('is true for a live session, and for one without an expiry stamp', () => {
    expect(isJoinableSession(at(1001), 1000)).toBe(true);
    expect(isJoinableSession({}, 1000)).toBe(true);
  });
});

describe('inviteSummaryText', () => {
  it('counts what went out and what did not, with no reason', () => {
    expect(inviteSummaryText(1, 0)).toBe('1 inbjudan skickad');
    expect(inviteSummaryText(3, 0)).toBe('3 inbjudningar skickade');
    expect(inviteSummaryText(2, 1)).toBe('2 inbjudningar skickade, 1 kunde inte skickas');
    expect(inviteSummaryText(0, 1)).toBe('Inbjudan kunde inte skickas');
    expect(inviteSummaryText(0, 4)).toBe('Inbjudningarna kunde inte skickas');
  });
});
