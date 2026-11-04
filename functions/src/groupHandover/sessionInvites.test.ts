import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SESSION_INVITE_PUSH_WINDOW_MS } from '../sessionInvitePush/logic';
import {
  eraseSessionInviteTraces,
  type SessionInviteErasureIo,
  type SessionInviteMarker,
} from './sessionInvites';

const NOW = Date.UTC(2026, 10, 3, 12);
const OUTSIDE_WINDOW = NOW - SESSION_INVITE_PUSH_WINDOW_MS - 1;
const INSIDE_WINDOW = NOW - SESSION_INVITE_PUSH_WINDOW_MS + 60_000;

// A marker as `markers` returns it, from its `{recipient}_{sender}` path.
function marker(path: string, lastPushedAtMs: number | null = OUTSIDE_WINDOW): SessionInviteMarker {
  const recipientUid = path.slice('sessionInvitePushes/'.length).split('_')[0];
  return { path, recipientUid, lastPushedAtMs };
}

function ioWith(invites: string[], markers: SessionInviteMarker[], failOnBatch = -1) {
  const deleted: string[][] = [];
  const io: SessionInviteErasureIo = {
    sentInvitePaths: async () => invites,
    markers: async () => markers,
    deletePaths: async (paths) => {
      if (deleted.length === failOnBatch) throw new Error('commit failed');
      deleted.push([...paths]);
    },
  };
  return { io, deleted };
}

describe('eraseSessionInviteTraces', () => {
  it('deletes the sent invites and the markers, and counts them', async () => {
    const { io, deleted } = ioWith(
      ['users/a/sessionInvites/S1_me', 'users/b/sessionInvites/S2_me'],
      [marker('sessionInvitePushes/a_me'), marker('sessionInvitePushes/me_c')],
    );
    const progress = { attempted: false };
    await expect(eraseSessionInviteTraces(io, 'me', progress, NOW)).resolves.toEqual({ found: 4 });
    expect(deleted.flat().sort()).toEqual([
      'sessionInvitePushes/a_me', 'sessionInvitePushes/me_c',
      'users/a/sessionInvites/S1_me', 'users/b/sessionInvites/S2_me',
    ]);
    expect(progress.attempted).toBe(true);
  });

  // The two marker queries return the same path when a document names the uid in
  // both fields.
  it('deletes a path returned twice only once', async () => {
    const { io, deleted } = ioWith([], [marker('sessionInvitePushes/me_me'), marker('sessionInvitePushes/me_me')]);
    await expect(eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW)).resolves.toEqual({ found: 1 });
    expect(deleted).toEqual([['sessionInvitePushes/me_me']]);
  });

  // Any signed-in user can call handOverOwnedGroups without deleting the account.
  // Erasing a sender marker still inside the window would reset the brake: invite,
  // call, invite again, and a new notice each time.
  it('keeps a marker naming the uid as sender while it still holds a notice back', async () => {
    const { io, deleted } = ioWith([], [marker('sessionInvitePushes/a_me', INSIDE_WINDOW)]);
    await expect(eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW)).resolves.toEqual({ found: 0 });
    expect(deleted).toEqual([]);
  });

  it('erases a sender marker once the window has passed, and keeps a fresh one beside it', async () => {
    const { io, deleted } = ioWith([], [
      marker('sessionInvitePushes/a_me', OUTSIDE_WINDOW),
      marker('sessionInvitePushes/b_me', INSIDE_WINDOW),
    ]);
    await expect(eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW)).resolves.toEqual({ found: 1 });
    expect(deleted).toEqual([['sessionInvitePushes/a_me']]);
  });

  // The window boundary as the trigger reads it: at exactly the window a new notice
  // may go out, so the marker no longer holds anything back.
  it('erases a sender marker at exactly the window, and keeps one a millisecond younger', async () => {
    const { io, deleted } = ioWith([], [
      marker('sessionInvitePushes/a_me', NOW - SESSION_INVITE_PUSH_WINDOW_MS),
      marker('sessionInvitePushes/b_me', NOW - SESSION_INVITE_PUSH_WINDOW_MS + 1),
    ]);
    await eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW);
    expect(deleted).toEqual([['sessionInvitePushes/a_me']]);
  });

  // A marker naming the uid as recipient only brakes notices to the uid itself.
  it('erases a fresh marker naming the uid as recipient', async () => {
    const { io, deleted } = ioWith([], [marker('sessionInvitePushes/me_c', INSIDE_WINDOW)]);
    await eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW);
    expect(deleted).toEqual([['sessionInvitePushes/me_c']]);
  });

  // The trigger reads a missing timestamp as "may notify", so such a marker brakes
  // nothing, and the retention sweep never reaps it.
  it('erases a sender marker without a readable timestamp', async () => {
    const { io, deleted } = ioWith([], [marker('sessionInvitePushes/a_me', null)]);
    await eraseSessionInviteTraces(io, 'me', { attempted: false }, NOW);
    expect(deleted).toEqual([['sessionInvitePushes/a_me']]);
  });

  it('writes nothing and leaves progress untouched when there is nothing', async () => {
    const { io, deleted } = ioWith([], []);
    const progress = { attempted: false };
    await expect(eraseSessionInviteTraces(io, 'me', progress)).resolves.toEqual({ found: 0 });
    expect(deleted).toEqual([]);
    expect(progress.attempted).toBe(false);
  });

  it('splits a large set into batches under the Firestore ceiling', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => `users/u${i}/sessionInvites/S_me`);
    const { io, deleted } = ioWith(many, []);
    await eraseSessionInviteTraces(io, 'me', { attempted: false });
    expect(deleted.length).toBeGreaterThan(1);
    expect(Math.max(...deleted.map((b) => b.length))).toBeLessThanOrEqual(450);
    expect(deleted.flat()).toHaveLength(1000);
  });

  // A throw after a batch landed must not read as a run that wrote nothing.
  it('marks progress before a batch that then throws', async () => {
    const { io } = ioWith(['users/a/sessionInvites/S1_me'], [], 0);
    const progress = { attempted: false };
    await expect(eraseSessionInviteTraces(io, 'me', progress)).rejects.toThrow('commit failed');
    expect(progress.attempted).toBe(true);
  });
});

// The Admin port needs firebase-admin, which this toolchain does not load. These pin
// the queries' shape from the source; the field names are what the rules bind.
describe('adminSessionInviteErasureIo source (shape only)', () => {
  const SRC = readFileSync(join(__dirname, 'sessionInvites.ts'), 'utf8');

  it('finds sent invites by fromUid across every recipient, and markers by both fields', () => {
    expect(SRC).toContain(".collectionGroup('sessionInvites').where('fromUid', '==', uid)");
    expect(SRC).toContain(".collection('sessionInvitePushes').where('recipientUid', '==', uid)");
    expect(SRC).toContain(".collection('sessionInvitePushes').where('fromUid', '==', uid)");
  });

  // Without these two fields every marker reads as recipient-less and timestamp-less,
  // and mayEraseSessionInviteMarker would erase every sender marker again.
  it('selects the fields the erase decision reads', () => {
    expect(SRC).toContain(".where('recipientUid', '==', uid).select('recipientUid', 'lastPushedAt')");
    expect(SRC).toContain(".where('fromUid', '==', uid).select('recipientUid', 'lastPushedAt')");
    expect(SRC).toContain("lastPushedAtMs: millis(d.get('lastPushedAt'))");
  });
});
