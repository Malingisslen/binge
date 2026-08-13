import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markDeletionStarted, clearDeletionStarted } from '../deletionMarker';
import {
  DELETION_IN_PROGRESS,
  assertProfileWritable,
  mergeUserDoc,
  mergePublicProfileDoc,
} from './userDocWrite';

// BIN-816 / ADR 0019 condition 1 — the chokepoint's own behaviour.
// `userDocWrite.chokepoint.test.ts` is the separate guard that no writer bypasses
// it; this file proves the gate itself refuses, and that it refuses in the two
// different SHAPES the two documents need (throw vs. boolean).

// Typed via the generic, not via impl parameters: the assertions read
// `mock.calls[0][1]` and `[0][2]`, which a no-arg vi.fn() types as an empty
// tuple (and tsc then rejects the index).
const setDoc = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}));
const doc = vi.hoisted(() => vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })));
const serverTimestamp = vi.hoisted(() => vi.fn(() => '<server-ts>'));

vi.mock('./db', () => ({
  fsdb: async () => ({ db: {}, doc, setDoc, serverTimestamp }),
}));

beforeEach(() => {
  window.localStorage.clear();
  setDoc.mockClear();
  doc.mockClear();
});

describe('userDocWrite — grinden mot en påbörjad radering', () => {
  it('släpper igenom en vanlig skrivning och stämplar updatedAt själv', async () => {
    await mergeUserDoc('alice', { bio: 'hej' });

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith({}, 'users', 'alice');
    // updatedAt stämplas här och inte hos anroparen: en skrivare som glömde
    // den skulle annars vara en tyst avvikelse i stället för ett fel.
    expect(setDoc.mock.calls[0][1]).toEqual({ bio: 'hej', updatedAt: '<server-ts>' });
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
  });

  it('bygg-funktionen får kitet, så sentinelvärden inte kräver en egen fsdb-import', async () => {
    // Det är just den importen chokepoint-testet förbjuder. Utan den här formen
    // skulle markNotificationsSeen och writeVisibilitySyncPending behöva gå
    // utanför grinden för att nå serverTimestamp()/deleteField().
    await mergeUserDoc('alice', kit => ({ lastNotificationsSeenAt: kit.serverTimestamp() }));

    expect(setDoc.mock.calls[0][1]).toEqual({
      lastNotificationsSeenAt: '<server-ts>',
      updatedAt: '<server-ts>',
    });
  });

  it('KASTAR — och skriver inte — när kontots radering är påbörjad', async () => {
    markDeletionStarted('alice', 1_000);

    await expect(mergeUserDoc('alice', { bio: 'hej' })).rejects.toThrow(DELETION_IN_PROGRESS);
    // Kärnan: inte bara ett fel, utan noll skrivningar. Ett kastat fel efter en
    // landad write hade återuppväckt dokumentet ändå.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('grinden är uid-scopad — en annan användares markering spärrar inte mig', async () => {
    markDeletionStarted('bob', 1_000);

    await mergeUserDoc('alice', { bio: 'hej' });

    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('assertProfileWritable är samma kontroll för de två batch-skrivarna', () => {
    // resumeProvider och claimUsername bygger users/{uid} in i en större atomisk
    // batch och kan därför inte använda mergeUserDoc. De ska ändå gå mot SAMMA
    // implementation — inte en egen kopia som kan glida isär.
    expect(() => assertProfileWritable('alice')).not.toThrow();

    markDeletionStarted('alice', 1_000);

    expect(() => assertProfileWritable('alice')).toThrow(DELETION_IN_PROGRESS);
  });

  it('den publika projektionen VÄGRAR tyst i stället för att kasta', async () => {
    // syncMyPublicProfile är best-effort och sväljer allt den fångar. Kastade
    // grinden här hade vägran sett likadan ut som ett nätverksfel — och
    // signaturnyckeln hade stämplats som om skrivningen gått igenom.
    markDeletionStarted('alice', 1_000);

    await expect(mergePublicProfileDoc('alice', () => ({ displayName: 'A' }))).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('den publika projektionen skrivs normalt när ingen radering pågår', async () => {
    await expect(mergePublicProfileDoc('alice', () => ({ displayName: 'A' }))).resolves.toBe(true);

    expect(doc).toHaveBeenCalledWith({}, 'publicProfiles', 'alice');
    expect(setDoc.mock.calls[0][1]).toEqual({ displayName: 'A' });
  });

  it('en avslutad radering öppnar grinden igen', async () => {
    markDeletionStarted('alice', 1_000);
    clearDeletionStarted('alice');

    await mergeUserDoc('alice', { bio: 'hej' });

    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});
