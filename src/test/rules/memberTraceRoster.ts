import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';

import { memberTraceWrites, type TraceWrite } from '../../../functions/src/groupHandover/logic';
import type { HandoverIo, TraceErasure } from '../../../functions/src/groupHandover/runHandover';

/**
 * BIN-1123 — holds each emulator port's hand-written `eraseMemberTraces` to the writes
 * `memberTraceWrites` decides.
 *
 * The expectation comes from the function's OUTPUT, never from a port's own code: every
 * trace the departing member has in the seeded group is either named by a write (and must
 * be gone after the port runs) or not named (and must still be there). So a category the
 * function gains fails here until the seed learns it, and then fails every port that does
 * not write it; a category the function drops fails every port that still writes it.
 *
 * The Admin-SDK port is not held here: it needs firebase-admin, which the root toolchain
 * cannot resolve, and it applies `memberTraceWrites` directly rather than copying it.
 *
 * Derive the ports this must cover rather than trusting a list:
 *   git grep -ln "eraseMemberTraces" -- src/test
 */

const GROUP = 'roster-group';
const LEAVER = 'roster-leaver';
const STAYER = 'roster-stayer';
const ITEM = 'movie_1';
const HISTORY = 'history-1';

export const ROSTER_ERASURE: TraceErasure = {
  itemIds: [ITEM],
  clearAddedByIds: [ITEM],
  clearPickedByIds: [HISTORY],
  dropParticipantIds: [HISTORY],
};

/** One trace of the leaver in the seed: a whole document, a field, or an entry in an array. */
interface SeededTrace {
  readonly op: TraceWrite['op'];
  readonly collection: string;
  readonly doc: string;
  readonly field?: string;
}

const LEAVER_TRACES: readonly SeededTrace[] = [
  { op: 'delete', collection: 'members', doc: LEAVER },
  { op: 'delete', collection: 'household', doc: LEAVER },
  { op: 'delete', collection: 'joinAttempts', doc: LEAVER },
  { op: 'delete', collection: `watchlist/${ITEM}/progress`, doc: LEAVER },
  { op: 'clear', collection: 'watchlist', doc: ITEM, field: 'addedBy' },
  { op: 'clear', collection: 'sessionHistory', doc: HISTORY, field: 'pickedByUid' },
  { op: 'drop', collection: 'sessionHistory', doc: HISTORY, field: 'participantUids' },
];

const key = (t: SeededTrace) => `${t.op} ${t.collection}/${t.doc}${t.field ? `.${t.field}` : ''}`;
const path = (t: SeededTrace) => `groups/${GROUP}/${t.collection}/${t.doc}`;

type Run = <T>(fn: (db: Firestore) => Promise<T>) => Promise<T>;

async function seed(db: Firestore) {
  await setDoc(doc(db, 'groups', GROUP), { ownerUid: STAYER, memberUids: [STAYER, LEAVER], name: 'Roster' });
  for (const uid of [LEAVER, STAYER]) {
    await setDoc(doc(db, 'groups', GROUP, 'members', uid), { uid, displayName: `namn-${uid}` });
    await setDoc(doc(db, 'groups', GROUP, 'household', uid), { providerIds: ['x'] });
    await setDoc(doc(db, 'groups', GROUP, 'joinAttempts', uid), { token: 'plaintext' });
    await setDoc(doc(db, 'groups', GROUP, 'watchlist', ITEM, 'progress', uid), { season: 1 });
  }
  await setDoc(doc(db, 'groups', GROUP, 'watchlist', ITEM), { addedBy: LEAVER, title: ITEM });
  await setDoc(doc(db, 'groups', GROUP, 'sessionHistory', HISTORY), {
    pickedByUid: LEAVER, tmdbId: 1, participantUids: [LEAVER, STAYER],
  });
}

/** Is this trace of the leaver still present? */
async function present(db: Firestore, t: SeededTrace): Promise<boolean> {
  const snap = await getDoc(doc(db, path(t)));
  if (!snap.exists()) return false;
  if (t.op === 'delete') return true;
  const data = snap.data();
  if (t.op === 'clear') return t.field! in data;
  return ((data[t.field!] as string[] | undefined) ?? []).includes(LEAVER);
}

/**
 * Seeds the group, runs the port, and returns every way the port disagreed with
 * `memberTraceWrites`. Empty means the port writes exactly what the function decides.
 */
export async function rosterMismatches(run: Run, erase: HandoverIo['eraseMemberTraces']): Promise<string[]> {
  await run(seed);

  const named = new Set(memberTraceWrites(LEAVER, ROSTER_ERASURE).map((w) => key(w)));
  const seeded = new Set(LEAVER_TRACES.map(key));
  const unseeded = [...named].filter((k) => !seeded.has(k));
  if (unseeded.length > 0) {
    return unseeded.map((k) => `memberTraceWrites names ${k}, which the roster seed does not hold — teach memberTraceRoster.ts the new category`);
  }

  const before = await run(async (db) => Promise.all(LEAVER_TRACES.map((t) => present(db, t))));
  const unseededInFact = LEAVER_TRACES.filter((_, i) => !before[i]).map(key);
  if (unseededInFact.length > 0) return unseededInFact.map((k) => `the seed did not write ${k}`);

  await erase(GROUP, LEAVER, ROSTER_ERASURE);

  const mismatches: string[] = [];
  await run(async (db) => {
    for (const t of LEAVER_TRACES) {
      const still = await present(db, t);
      if (named.has(key(t)) && still) mismatches.push(`port left ${key(t)}, which memberTraceWrites erases`);
      if (!named.has(key(t)) && !still) mismatches.push(`port erased ${key(t)}, which memberTraceWrites does not`);
    }
    for (const sub of ['members', 'household', 'joinAttempts', `watchlist/${ITEM}/progress`]) {
      if (!(await getDoc(doc(db, `groups/${GROUP}/${sub}/${STAYER}`))).exists()) {
        mismatches.push(`port erased the remaining member's ${sub} row`);
      }
    }
    const history = await getDoc(doc(db, 'groups', GROUP, 'sessionHistory', HISTORY));
    if (!((history.data()?.participantUids as string[] | undefined) ?? []).includes(STAYER)) {
      mismatches.push("port dropped the remaining member from participantUids");
    }
  });
  return mismatches;
}
