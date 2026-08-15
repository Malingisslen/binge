import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collectionGroup, doc, documentId, getDoc, getDocs, limit, orderBy,
  query, setDoc, startAfter, Timestamp, where,
  type Firestore, type Query,
} from 'firebase/firestore';

import {
  runAvailableNotify,
  skipKey,
  type NotifyIo,
  type PushPayload,
  type ScanDoc,
  type SeProvider,
} from '../../../functions/src/availableNotify/runNotify';
import {
  RELEASE_REFETCH_TTL_DAYS,
  RELEASE_CATCHUP_GRACE_DAYS,
  type TmdbReleaseDatesCountry,
} from '../../../functions/src/releaseNotify/logic';

/**
 * BIN-727 step 2 — the availableNotify ORCHESTRATOR against a real Firestore
 * emulator.
 *
 * The gap this closes: the daily push job's PURE helpers were unit-tested
 * (logic.ts, releaseNotify/logic.ts), the loop around them was not. A dropped page
 * cursor, a phase run in the wrong order or a swallowed error would have logged
 * "availableNotify done" with a plausible number and nobody would have noticed —
 * on the function that sends real push notifications to real people, where the
 * worst failure (a user getting BOTH "släpps idag" and "finns nu på X" for the
 * same film on the same day) leaves no trace in Firestore at all.
 *
 * How it runs without firebase-admin: the loop lives in
 * functions/src/availableNotify/runNotify.ts behind an injected `NotifyIo` port.
 * Prod implements it with the Admin SDK, real TMDB and real FCM; here the SAME
 * port is implemented with the client SDK against the emulator plus in-memory TMDB
 * and push doubles (CI's rules job installs root deps only, and firebase-admin is
 * not resolvable there). The loop under test is the real one.
 *
 * WHY THE PUSH SEND IS A PORT METHOD AND NOT A SIDE EFFECT (#13 Data/Integrations
 * Engineer, 2026-08-15): there is no FCM emulator. "A user who opted out is never
 * sent to" is only provable by COUNTING calls; inferring it from a missing
 * Firestore document proves the card wasn't written, which is a different claim —
 * and on the overlap day it is the WRONG one, because the availability card is
 * suppressed for reasons that have nothing to do with consent.
 *
 * The emulator is opened with permissive rules on purpose: in production this job
 * runs as the Admin SDK, which bypasses security rules entirely. Pinning rule
 * behaviour is firestore-rules.test.ts's job.
 *
 * NOT PROVEN HERE, and it cannot be:
 *  · The `.select()` projection list and the `status in ['vill_se','mina']` filter
 *    live in the Admin port (index.ts); the client SDK has no `.select()`, so this
 *    harness reads whole documents and re-declares the filter itself. A wrong
 *    projection or a widened filter in production would starve or flood the loop
 *    while every test here stays green. index.ts carries that warning at the query.
 *  · The PHASE-LEVEL catch in runAvailableNotify. Every port call inside the
 *    release phase already sits inside the per-movie try, so no port failure can
 *    reach the outer handler — it is a genuine backstop against a future
 *    refactor, and the "one movie's failure doesn't block phase 2" test below is
 *    the strongest statement this suite can actually make.
 */

const PROJECT_ID = 'binge-notify-orchestrator-test';
const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: OPEN_RULES, host, port: Number(port) },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

function adminLikeDb(): Firestore {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

/**
 * A fixed instant. 10:00 UTC on 14 Aug 2026 is 12:00 in Stockholm, so the run's
 * "today" is unambiguously 2026-08-14 on either side of the DST boundary — the
 * fixtures never depend on the wall clock.
 */
const NOW = new Date(Date.UTC(2026, 7, 14, 10, 0, 0));
const TODAY = '2026-08-14';
const MS_PER_DAY = 86_400_000;

/**
 * The two release constants are used as LITERALS in the boundary fixtures below
 * (2 days, 3 days), so pin them here. Without this, changing a constant would
 * silently move every boundary the fixtures claim to sit on and the suite would
 * stay green while proving a different window than the one it describes.
 */
it('release-fönstrets konstanter är de som fixturerna nedan räknar med', () => {
  expect(RELEASE_REFETCH_TTL_DAYS).toBe(2);
  expect(RELEASE_CATCHUP_GRACE_DAYS).toBe(3);
});

// ─────────────────────────────────────────────────────────────────────────────
// The TMDB and push doubles
// ─────────────────────────────────────────────────────────────────────────────

interface SentPush {
  uid: string;
  payload: PushPayload;
  pushEnabled: boolean;
}

interface Doubles {
  /** Every push the job ASKED the port to send, in order. */
  readonly sent: SentPush[];
  /**
   * Port calls in order as `method` or `method:key` — the only way to assert
   * phase sequencing, and the only way to prove a call did NOT happen.
   */
  readonly calls: string[];
  /** `${mediaType}:${tmdbId}` → SE flatrate providers, or null (fetch failed). */
  readonly flatrate: Map<string, SeProvider[] | null>;
  /** tmdbId → raw /release_dates country blocks, or null (fetch failed). */
  readonly releaseDates: Map<number, TmdbReleaseDatesCountry[] | null>;
  /** Port calls that must THROW, as `${method}:${arg}` (e.g. `fetchSeFlatrate:movie:9`). */
  readonly throwOn: Set<string>;
}

function makeDoubles(): Doubles {
  return {
    sent: [], calls: [],
    flatrate: new Map(), releaseDates: new Map(), throwOn: new Set(),
  };
}

/** A TMDB /release_dates payload with one SE digital (type 4) entry. */
function seDigital(date: string): TmdbReleaseDatesCountry[] {
  return [{ iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: `${date}T00:00:00.000Z` }] }];
}

/** Port methods only the RELEASE phase calls, and only the AVAILABILITY phase calls. */
const RELEASE_ONLY = ['readReleaseCache', 'fetchReleaseDates', 'writeReleaseCache', 'readReleaseMarker', 'writeReleaseMarker'];
const AVAILABILITY_ONLY = ['fetchSeFlatrate', 'readAvailableState', 'writeAvailableState'];

/** The method name of a logged call, dropping its key. */
const methodOf = (call: string): string => call.split(':')[0];
const countCalls = (d: Doubles, method: string): number =>
  d.calls.filter((c) => methodOf(c) === method).length;

// ─────────────────────────────────────────────────────────────────────────────
// The client-SDK port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliberately tiny page size (prod: 2000). Every scan fixture below is bigger
 * than one page, so the cursor advance is exercised rather than assumed.
 */
const TEST_PAGE_SIZE = 2;

async function readDoc(db: Firestore, path: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, path));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

function makeIo(db: Firestore, d: Doubles, overrides: Partial<NotifyIo> = {}): NotifyIo {
  const note = (method: string, key?: string) => {
    d.calls.push(key === undefined ? method : `${method}:${key}`);
    if (key !== undefined && d.throwOn.has(`${method}:${key}`)) {
      throw new Error(`injected failure: ${method}:${key}`);
    }
  };
  return {
    pageSize: TEST_PAGE_SIZE,
    log: { info: () => {}, error: () => {} },
    now: () => NOW,

    scanWatchlistPage: async (cursor, pageSize): Promise<ScanDoc[]> => {
      note('scanWatchlistPage');
      // The `status in [...]` filter and the field projection live in the ADMIN
      // port; re-declaring the filter here keeps the fixture honest about which
      // docs reach the loop, but it pins THIS file, not production's query.
      let q: Query = query(
        collectionGroup(db, 'watchlist'),
        where('status', 'in', ['vill_se', 'mina']),
        orderBy(documentId()),
        limit(pageSize),
      );
      // A collection-group query ordered by documentId() takes the FULL path as
      // its cursor — the same value the Admin port wraps in a DocumentReference.
      if (cursor) q = query(q, startAfter(cursor));
      const snap = await getDocs(q);
      return snap.docs.map((s) => ({ path: s.ref.path, data: s.data() as Record<string, unknown> }));
    },

    readAvailableState: async (docId) => {
      note('readAvailableState', docId);
      return readDoc(db, `availableNotifyState/${docId}`);
    },
    writeAvailableState: async (docId, lastFlatrate) => {
      note('writeAvailableState', docId);
      await setDoc(doc(db, `availableNotifyState/${docId}`), { lastFlatrate: [...lastFlatrate], updatedAt: Timestamp.fromDate(NOW) }, { merge: true });
    },

    readReleaseCache: async (tmdbId) => {
      note('readReleaseCache', String(tmdbId));
      return readDoc(db, `releaseNotifyState/${tmdbId}`);
    },
    writeReleaseCache: async (tmdbId, seDigitalDates) => {
      note('writeReleaseCache', String(tmdbId));
      await setDoc(doc(db, `releaseNotifyState/${tmdbId}`), { seDigitalDates: [...seDigitalDates], datesResolvedAt: Timestamp.fromDate(NOW), updatedAt: Timestamp.fromDate(NOW) }, { merge: true });
    },

    readReleaseMarker: async (tmdbId, uid) => {
      note('readReleaseMarker', `${tmdbId}:${uid}`);
      return readDoc(db, `releaseNotifyState/${tmdbId}/notified/${uid}`);
    },
    writeReleaseMarker: async (tmdbId, uid, notifiedDate) => {
      note('writeReleaseMarker', `${tmdbId}:${uid}`);
      await setDoc(doc(db, `releaseNotifyState/${tmdbId}/notified/${uid}`), { notifiedDate, updatedAt: Timestamp.fromDate(NOW) }, { merge: true });
    },

    readNotification: async (uid, notifId) => {
      note('readNotification', `${uid}:${notifId}`);
      return readDoc(db, `users/${uid}/notifications/${notifId}`);
    },
    writeNotification: async (uid, notifId, card) => {
      note('writeNotification', `${uid}:${notifId}`);
      await setDoc(doc(db, `users/${uid}/notifications/${notifId}`), { ...card, createdAt: Timestamp.fromDate(NOW) }, { merge: true });
    },

    readUserDoc: async (uid) => {
      note('readUserDoc', uid);
      return readDoc(db, `users/${uid}`);
    },

    fetchSeFlatrate: async (tmdbId, mediaType) => {
      note('fetchSeFlatrate', `${mediaType}:${tmdbId}`);
      return d.flatrate.get(`${mediaType}:${tmdbId}`) ?? null;
    },
    fetchReleaseDates: async (tmdbId) => {
      note('fetchReleaseDates', String(tmdbId));
      return d.releaseDates.get(tmdbId) ?? null;
    },

    sendPush: async (uid, payload, opts) => {
      note('sendPush', uid);
      d.sent.push({ uid, payload, pushEnabled: opts.pushEnabled });
    },

    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/** One watchlist row at `users/{uid}/watchlist/{mediaType}_{tmdbId}`. */
async function seedTitle(
  db: Firestore,
  uid: string,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  status: 'vill_se' | 'mina' | 'sedda',
  title: string,
  opts: { omitTmdbIdField?: boolean } = {},
): Promise<void> {
  const data: Record<string, unknown> = { mediaType, status, title };
  if (!opts.omitTmdbIdField) data.tmdbId = tmdbId;
  await setDoc(doc(db, `users/${uid}/watchlist/${mediaType}_${tmdbId}`), data);
}

/** A profile with the two flags the job reads. */
async function seedUser(
  db: Firestore,
  uid: string,
  myProviders: number[],
  settings: { pushEnabled?: boolean; availableOnMyServices?: boolean } = {},
): Promise<void> {
  await setDoc(doc(db, `users/${uid}`), {
    myProviders,
    notificationSettings: {
      pushEnabled: settings.pushEnabled !== false,
      availableOnMyServices: settings.availableOnMyServices !== false,
    },
  });
}

const AVAILABILITY_PUSHES = (d: Doubles) => d.sent.filter((s) => s.payload.title.startsWith('Nu på din'));
const RELEASE_PUSHES = (d: Doubles) => d.sent.filter((s) => s.payload.title === 'Släpps idag');

// ─────────────────────────────────────────────────────────────────────────────
// 1. The bounded scan and the derivations that happen on the way in
// ─────────────────────────────────────────────────────────────────────────────

describe('bevakningsskanningen', () => {
  it('sidindelar sig igenom hela listan utan att tappa eller dubblera en titel', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    // Five rows across two users — well past the two-doc page size, so the run
    // only completes if the cursor advances correctly across three pages.
    await seedTitle(db, 'ida', 'movie', 1, 'vill_se', 'Ett');
    await seedTitle(db, 'ida', 'movie', 2, 'mina', 'Två');
    await seedTitle(db, 'ida', 'tv', 3, 'mina', 'Tre');
    await seedTitle(db, 'bo', 'movie', 1, 'mina', 'Ett');
    await seedTitle(db, 'bo', 'tv', 4, 'vill_se', 'Fyra');
    // Never reaches the loop: the port's status filter excludes it.
    await seedTitle(db, 'bo', 'movie', 9, 'sedda', 'Nio');
    for (const key of ['movie:1', 'movie:2', 'tv:3', 'tv:4']) d.flatrate.set(key, []);

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(summary.watchlistDocs).toBe(5);
    // movie_1 (two owners) + movie_2 + tv_3 + tv_4
    expect(summary.uniqueTitles).toBe(4);
    // Exactly one TMDB fetch per unique title — a re-scanned page would show up
    // here as a fifth call, and a dropped page as a third.
    expect(countCalls(d, 'fetchSeFlatrate')).toBe(4);
  });

  it('hämtar tmdbId ur dokumentets id när fältet saknas, och uid ur sökvägen', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    // An old row written before the tmdbId field existed. Getting this wrong is
    // silent: the title collapses onto id 0 and every owner reads as the same
    // stranger.
    await seedTitle(db, 'ida', 'movie', 777, 'vill_se', 'Utan fält', { omitTmdbIdField: true });
    d.flatrate.set('movie:777', [{ id: 8, name: 'Netflix' }]);
    await setDoc(doc(db, 'availableNotifyState/movie_777'), { lastFlatrate: [] });
    await seedUser(db, 'ida', [8]);

    await runAvailableNotify(makeIo(db, d));

    // The push only happens if BOTH derivations landed: id 777 off the doc id,
    // and owner "ida" off the path.
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].uid).toBe('ida');
    expect(d.sent[0].payload.actionUrl).toBe('/movie/777/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The availability phase's transition rules
// ─────────────────────────────────────────────────────────────────────────────

describe('tillgänglighetsfasen', () => {
  it('första observationen sätter bara baslinjen — ingen puff till någon', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [8]);
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }]);

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(d.sent).toHaveLength(0);
    expect(summary.notified).toBe(0);
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8]);
  });

  it('en omkörning utan förändring skickar ingenting', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [8]);
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }]);

    await runAvailableNotify(makeIo(db, d));
    await runAvailableNotify(makeIo(db, d));

    expect(d.sent).toHaveLength(0);
  });

  it('en ny leverantör som användaren har ger exakt en puff, och markören flyttas fram', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [337]);
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { lastFlatrate: [8] });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(summary.notified).toBe(1);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].payload.body).toBe('Ett går att streama där nu');
    expect(d.sent[0].payload.tag).toBe('available-movie_1');
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8, 337]);
    // The inbox card rides the same media-type-namespaced id as the state doc.
    expect(await readDoc(db, 'users/ida/notifications/movie_1-337')).not.toBeNull();
  });

  it('läser den gamla o-namngivna markören när den nya inte finns — och skriver framåt', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [337]);
    // Pre-BIN-523 state, keyed on the bare tmdbId.
    await setDoc(doc(db, 'availableNotifyState/1'), { lastFlatrate: [8] });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    // Without the fallback the run would see last === null and take the
    // baseline branch, swallowing a real "now streaming" transition.
    expect(d.sent).toHaveLength(1);
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8, 337]);

    // ...and the fallback is one-shot: the second run reads the namespaced doc.
    d.sent.length = 0;
    await runAvailableNotify(makeIo(db, d));
    expect(d.sent).toHaveLength(0);
  });

  it('en tom namngiven markör hoppar INTE tillbaka till den gamla', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [8]);
    // The decisive case for the fallback's existence test: a namespaced doc a
    // previous run wrote when the title had NO SE offer holds [], which is a real
    // baseline. Falling back past it (because [] "looks empty") would resurrect
    // the legacy baseline forever and permanently suppress this transition.
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { lastFlatrate: [] });
    await setDoc(doc(db, 'availableNotifyState/1'), { lastFlatrate: [8] });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(d.sent).toHaveLength(1);
  });

  it('en namngiven markör UTAN användbart fält gör baslinje om, den hämtar inte den gamla', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [337]);
    // The namespaced doc exists but carries no usable lastFlatrate — a partially
    // written or hand-edited state doc. Its EXISTENCE is what the fallback tests,
    // and that is the decision: we have been here before, so re-baseline silently
    // rather than reach back to legacy data of unknown provenance and push off it.
    // Testing the VALUE instead would look identical on every ordinary fixture
    // (an existing doc almost always has the field) and differ only here.
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { updatedAt: Timestamp.fromDate(NOW) });
    await setDoc(doc(db, 'availableNotifyState/1'), { lastFlatrate: [8] });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(d.sent).toHaveLength(0);
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8, 337]);
  });

  it('en misslyckad TMDB-hämtning rör inte markören', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [8]);
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { lastFlatrate: [99] });
    d.flatrate.set('movie:1', null); // fetch failed

    await runAvailableNotify(makeIo(db, d));

    expect(d.sent).toHaveLength(0);
    // Overwriting it with [] here would make the next successful run read the
    // whole catalogue as "new" and blast every follower.
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([99]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Opt-out — proven by call count, not by a missing document
// ─────────────────────────────────────────────────────────────────────────────

describe('avstängd puff', () => {
  beforeEach(async () => {
    const db = adminLikeDb();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { lastFlatrate: [8] });
  });

  it('pushEnabled: false når aldrig sändningsporten', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedUser(db, 'ida', [337], { pushEnabled: false });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(countCalls(d, 'sendPush')).toBe(0);
    expect(await readDoc(db, 'users/ida/notifications/movie_1-337')).toBeNull();
  });

  it('availableOnMyServices: false når aldrig sändningsporten', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedUser(db, 'ida', [337], { availableOnMyServices: false });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(countCalls(d, 'sendPush')).toBe(0);
  });

  it('en leverantör användaren inte har når aldrig sändningsporten', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedUser(db, 'ida', [8]);
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(countCalls(d, 'sendPush')).toBe(0);
    // The marker still advances — the transition happened, it just wasn't theirs.
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8, 337]);
  });

  it('en användare utan profildokument når aldrig sändningsporten', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    expect(countCalls(d, 'sendPush')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The release phase: cache TTL, fire window, per-user marker
// ─────────────────────────────────────────────────────────────────────────────

describe('releasefasen', () => {
  /** A bevakad film owned by ida, with no availability transition to distract. */
  async function seedBevakadFilm(db: Firestore, d: Doubles, tmdbId = 500): Promise<void> {
    await seedTitle(db, 'ida', 'movie', tmdbId, 'vill_se', 'Filmen');
    await seedUser(db, 'ida', [8]);
    d.flatrate.set(`movie:${tmdbId}`, []);
  }

  it('fyrar på släppdagen', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedBevakadFilm(db, d);
    d.releaseDates.set(500, seDigital(TODAY));

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(RELEASE_PUSHES(d)).toHaveLength(1);
    expect(d.sent[0].payload.body).toBe('Filmen finns digitalt i Sverige idag');
    expect(d.sent[0].payload.tag).toBe('release-500');
    expect(summary.releaseNotified).toBe(1);
    expect((await readDoc(db, 'releaseNotifyState/500/notified/ida'))?.notifiedDate).toBe(TODAY);
  });

  it('fyrar fortfarande på sista dagen i upphinningsfönstret, men inte dagen efter', async () => {
    // The literal boundary, with the grace pinned at 3 above: today is
    // 2026-08-14, so a date of 2026-08-11 is exactly 3 days back (fires) and
    // 2026-08-10 is 4 (does not). An off-by-one here either drops a release
    // after a missed cron day or fires one a day too late.
    for (const [date, shouldFire] of [['2026-08-11', true], ['2026-08-10', false]] as const) {
      await testEnv.clearFirestore();
      const db = adminLikeDb();
      const d = makeDoubles();
      await seedBevakadFilm(db, d);
      d.releaseDates.set(500, seDigital(date));

      await runAvailableNotify(makeIo(db, d));

      expect(RELEASE_PUSHES(d).length, `datum ${date}`).toBe(shouldFire ? 1 : 0);
    }
  });

  it('en cache som är exakt TTL gammal hämtas om; en yngre litar vi på', async () => {
    // TTL pinned at 2 days above. `>= ttl` is the production rule, so the
    // fixture sits ON the boundary and one millisecond inside it — the two
    // cases a `>` would separate.
    for (const [ageMs, shouldRefetch] of [[2 * MS_PER_DAY, true], [2 * MS_PER_DAY - 1, false]] as const) {
      await testEnv.clearFirestore();
      const db = adminLikeDb();
      const d = makeDoubles();
      await seedBevakadFilm(db, d);
      // A far-off cached date, so the "confirm live near release" branch can't
      // be what forces the refetch — the age is the only variable.
      await setDoc(doc(db, 'releaseNotifyState/500'), {
        seDigitalDates: ['2026-01-01'],
        datesResolvedAt: Timestamp.fromMillis(NOW.getTime() - ageMs),
      });
      d.releaseDates.set(500, seDigital('2026-01-01'));

      await runAvailableNotify(makeIo(db, d));

      expect(countCalls(d, 'fetchReleaseDates'), `ålder ${ageMs}`).toBe(shouldRefetch ? 1 : 0);
    }
  });

  it('samma användare får inte samma släppdatum två gånger', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedBevakadFilm(db, d);
    d.releaseDates.set(500, seDigital(TODAY));

    await runAvailableNotify(makeIo(db, d));
    await runAvailableNotify(makeIo(db, d));

    expect(RELEASE_PUSHES(d)).toHaveLength(1);
  });

  it('ett nyare släppdatum spänner om puffen', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedBevakadFilm(db, d);
    // Marker from an older release; the film has since gained a new digital date.
    await setDoc(doc(db, 'releaseNotifyState/500/notified/ida'), { notifiedDate: '2026-05-01' });
    d.releaseDates.set(500, seDigital(TODAY));

    await runAvailableNotify(makeIo(db, d));

    expect(RELEASE_PUSHES(d)).toHaveLength(1);
  });

  it('ett gammalt inkorgskort utan viaMarker sår markören i stället för att puffa igen', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedBevakadFilm(db, d);
    // A card written by pre-BIN-464 code: no marker anywhere, no viaMarker stamp.
    await setDoc(doc(db, 'users/ida/notifications/500-release'), { kind: 'digital_release', read: false });
    d.releaseDates.set(500, seDigital(TODAY));

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(RELEASE_PUSHES(d)).toHaveLength(0);
    expect(summary.releaseSeeded).toBe(1);
    expect((await readDoc(db, 'releaseNotifyState/500/notified/ida'))?.notifiedDate).toBe(TODAY);
  });

  it('ett kort som DEN HÄR koden skrev är inget gammalt kort — en återspänning puffar', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedBevakadFilm(db, d);
    // Same shape, but stamped by marker-era code. The marker has since been
    // reaped by retentionCleanup (30 days) while the card lives ~90 — without
    // the discriminator this would seed-suppress a genuinely new release.
    await setDoc(doc(db, 'users/ida/notifications/500-release'), { kind: 'digital_release', viaMarker: true, read: false });
    d.releaseDates.set(500, seDigital(TODAY));

    await runAvailableNotify(makeIo(db, d));

    expect(RELEASE_PUSHES(d)).toHaveLength(1);
  });

  it('rör bara bevakade FILMER — en serie i vill_se är inte releasefasens sak', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'tv', 500, 'vill_se', 'Serien');
    await seedUser(db, 'ida', [8]);
    d.flatrate.set('tv:500', []);
    d.releaseDates.set(500, seDigital(TODAY));

    await runAvailableNotify(makeIo(db, d));

    expect(countCalls(d, 'fetchReleaseDates')).toBe(0);
    expect(d.sent).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The cross-phase dedup — the worst failure this job can have
// ─────────────────────────────────────────────────────────────────────────────

describe('överlappsdagen', () => {
  /**
   * ida bevakar film 500, som släpps idag AND newly appears on a service she
   * subscribes to. bo has the same film in "mina" — no release claim — and the
   * same subscription.
   */
  async function seedOverlap(db: Firestore, d: Doubles): Promise<void> {
    await seedTitle(db, 'ida', 'movie', 500, 'vill_se', 'Filmen');
    await seedTitle(db, 'bo', 'movie', 500, 'mina', 'Filmen');
    await seedUser(db, 'ida', [337]);
    await seedUser(db, 'bo', [337]);
    await setDoc(doc(db, 'availableNotifyState/movie_500'), { lastFlatrate: [8] });
    d.flatrate.set('movie:500', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);
    d.releaseDates.set(500, seDigital(TODAY));
  }

  it('ger den som bevakar filmen exakt EN puff — släppet, inte tillgängligheten', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedOverlap(db, d);

    const summary = await runAvailableNotify(makeIo(db, d));

    const idasPushes = d.sent.filter((s) => s.uid === 'ida');
    expect(idasPushes).toHaveLength(1);
    expect(idasPushes[0].payload.title).toBe('Släpps idag');
    // Zero CALLS, not merely a missing card: the card is suppressed for reasons
    // unrelated to consent, so its absence proves nothing about the send.
    expect(await readDoc(db, 'users/ida/notifications/movie_500-337')).toBeNull();
    expect(summary.releaseOwned).toBe(1);
    // The skip is checked BEFORE the profile read, so a release-owned pair never
    // even constructs a push (#13's condition 6). ida's profile is read exactly
    // once — by the release phase — and never again in phase 2.
    expect(d.calls.filter((c) => c === 'readUserDoc:ida')).toHaveLength(1);
  });

  it('spärren är per användare — den som inte bevakar filmen får sin tillgänglighetspuff', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedOverlap(db, d);

    await runAvailableNotify(makeIo(db, d));

    const bosPushes = d.sent.filter((s) => s.uid === 'bo');
    expect(bosPushes).toHaveLength(1);
    expect(bosPushes[0].payload.title).toBe('Nu på din Disney+');
  });

  it('markören flyttas fram ändå, så överlappet inte fyrar igen imorgon', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedOverlap(db, d);

    await runAvailableNotify(makeIo(db, d));

    expect((await readDoc(db, 'availableNotifyState/movie_500'))?.lastFlatrate).toEqual([8, 337]);
  });

  it('spärren är nycklad på mediatyp — film 500 tystar inte serie 500', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedOverlap(db, d);
    // Same numeric id, unrelated title: TMDB's movie and TV ids are independent
    // namespaces, so a bare-tmdbId skip key would suppress this one.
    await seedTitle(db, 'ida', 'tv', 500, 'mina', 'Serien');
    await setDoc(doc(db, 'availableNotifyState/tv_500'), { lastFlatrate: [8] });
    d.flatrate.set('tv:500', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    await runAvailableNotify(makeIo(db, d));

    const idasAvailability = AVAILABILITY_PUSHES(d).filter((s) => s.uid === 'ida');
    expect(idasAvailability).toHaveLength(1);
    expect(idasAvailability[0].payload.tag).toBe('available-tv_500');
    expect(skipKey('ida', 'movie', 500)).not.toBe(skipKey('ida', 'tv', 500));
  });

  it('fas 1 är HELT klar innan fas 2 läser spärrlistan', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedOverlap(db, d);

    await runAvailableNotify(makeIo(db, d));

    // The dedup IS the sequencing: if any availability work started before the
    // release phase finished, an owner it had not yet claimed would get both
    // messages. Assert it on the call log rather than trusting the await.
    const lastRelease = Math.max(...d.calls.map((c, i) => (RELEASE_ONLY.includes(methodOf(c)) ? i : -1)));
    const firstAvailability = Math.min(...d.calls.map((c, i) => (AVAILABILITY_ONLY.includes(methodOf(c)) ? i : Infinity)));
    expect(lastRelease).toBeGreaterThan(-1);
    expect(firstAvailability).toBeLessThan(Infinity);
    expect(lastRelease).toBeLessThan(firstAvailability);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Error isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('felisolering', () => {
  it('en titels TMDB-fel stoppar inte syskontitlarna', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedTitle(db, 'ida', 'movie', 2, 'mina', 'Två');
    await seedUser(db, 'ida', [337]);
    for (const id of [1, 2]) await setDoc(doc(db, `availableNotifyState/movie_${id}`), { lastFlatrate: [8] });
    d.throwOn.add('fetchSeFlatrate:movie:1');
    d.flatrate.set('movie:2', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);

    const summary = await runAvailableNotify(makeIo(db, d));

    expect(summary.notified).toBe(1);
    expect(d.sent[0].payload.tag).toBe('available-movie_2');
  });

  it('en films releasefel stoppar varken systerfilmen eller tillgänglighetsfasen', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 500, 'vill_se', 'Trasig');
    await seedTitle(db, 'ida', 'movie', 501, 'vill_se', 'Hel');
    await seedUser(db, 'ida', [337]);
    d.throwOn.add('readReleaseCache:500');
    d.releaseDates.set(501, seDigital(TODAY));
    for (const id of [500, 501]) {
      await setDoc(doc(db, `availableNotifyState/movie_${id}`), { lastFlatrate: [8] });
      d.flatrate.set(`movie:${id}`, [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);
    }

    const summary = await runAvailableNotify(makeIo(db, d));

    // The sister film's release still fires...
    expect(RELEASE_PUSHES(d).map((s) => s.payload.tag)).toEqual(['release-501']);
    // ...and phase 2 still runs for BOTH films. 500 lost its release claim to the
    // failure, so it correctly falls through to the availability message.
    expect(AVAILABILITY_PUSHES(d).map((s) => s.payload.tag).sort()).toEqual(['available-movie_500']);
    expect(summary.releaseOwned).toBe(1);
  });

  it('en mottagares fel stoppar inte de andra, och markören flyttas fram ändå', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedTitle(db, 'bo', 'movie', 1, 'mina', 'Ett');
    await seedUser(db, 'ida', [337]);
    await seedUser(db, 'bo', [337]);
    await setDoc(doc(db, 'availableNotifyState/movie_1'), { lastFlatrate: [8] });
    d.flatrate.set('movie:1', [{ id: 8, name: 'Netflix' }, { id: 337, name: 'Disney+' }]);
    d.throwOn.add('writeNotification:ida:movie_1-337');

    await runAvailableNotify(makeIo(db, d));

    // A Promise.all here would reject on ida and abandon bo's send entirely.
    expect(d.sent.map((s) => s.uid)).toEqual(['bo']);
    // And the marker write sits AFTER the settle, so it runs regardless.
    expect((await readDoc(db, 'availableNotifyState/movie_1'))?.lastFlatrate).toEqual([8, 337]);
    // ONCE, and after the last send — not merely "at some point with the right
    // value". An extra write BEFORE the fan-out looks harmless (same value, and
    // every assertion above still passes), but it is precisely what the AFTER
    // ordering exists to prevent: a function that times out mid-fan-out would
    // have already marked the transition seen with nobody notified, and the
    // title never fires again. Caught by the test reviewer 2026-08-15, after I
    // had written that mutant off as equivalent.
    expect(d.calls.filter((c) => c === 'writeAvailableState:movie_1')).toHaveLength(1);
    const markerAt = d.calls.indexOf('writeAvailableState:movie_1');
    const lastSendAt = d.calls.reduce((acc, c, i) => (methodOf(c) === 'sendPush' ? i : acc), -1);
    expect(lastSendAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(lastSendAt);
  });

  it('en skanning som kastar avbryter körningen utan att skicka något', async () => {
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    const io = makeIo(db, d, {
      scanWatchlistPage: async () => { throw new Error('collection-group scan failed'); },
    });

    const summary = await runAvailableNotify(io);

    expect(summary.watchlistDocs).toBe(0);
    expect(d.sent).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The shape of the outer loop — the only thing bounding the TMDB request rate
// ─────────────────────────────────────────────────────────────────────────────

describe('loopens form', () => {
  it('titelloopen är sekventiell — en långsam TMDB-hämtning håller nästa titel kvar', async () => {
    // The outer loops bound this job's TMDB request rate, and nothing else does.
    // Turning the per-title loop into a Promise.all is invisible to every other
    // test in this file (the sends and markers all still come out right) while
    // multiplying the request rate by the number of bevakade titles — a quota
    // change smuggled inside a testability ticket. This is the only assertion
    // that sees it. Added 2026-08-15 after the test reviewer found the criterion
    // asserted in prose and nowhere else.
    const db = adminLikeDb();
    const d = makeDoubles();
    await seedTitle(db, 'ida', 'movie', 1, 'mina', 'Ett');
    await seedTitle(db, 'ida', 'movie', 2, 'mina', 'Två');
    await seedUser(db, 'ida', [8]);
    d.flatrate.set('movie:1', []);
    d.flatrate.set('movie:2', []);

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const io = makeIo(db, d, {
      fetchSeFlatrate: async (tmdbId, mediaType) => {
        d.calls.push(`fetchSeFlatrate:${mediaType}:${tmdbId}`);
        if (tmdbId === 1) await held;
        return d.flatrate.get(`${mediaType}:${tmdbId}`) ?? null;
      },
    });

    const run = runAvailableNotify(io);
    // A real timer, not a microtask flush: the loop awaits emulator I/O between
    // titles, so anything that COULD run in parallel would have started by now.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(d.calls).toContain('fetchSeFlatrate:movie:1');
    expect(d.calls).not.toContain('fetchSeFlatrate:movie:2');

    release();
    await run;
    expect(d.calls.filter((c) => c === 'fetchSeFlatrate:movie:2')).toHaveLength(1);
  });
});
