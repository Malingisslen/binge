import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import type { UserDataSnapshots } from './userData';
import { buildUserExport, type BingeExport } from './dataExport';
import { collectUserDataSnapshots } from './userData';

/**
 * BIN-328 — GDPR export/delete completeness guard.
 *
 * `collectUserDataSnapshots` (userData.ts) is the single shared kernel that both
 * `buildUserExport` (Art. 20 export) and `deleteAccount` (Art. 17 erasure) read.
 * Its own comment says it's "den enda platsen att uppdatera" when a subcollection
 * is added — but until this test, nothing enforced that. The reporterUid omission
 * (BIN-277) is exactly the silent drift this guards against.
 *
 * ── SCOPE (honest, per stakeholder panel #5/#6/#27) ──────────────────────────
 * This test proves every KEY IN THE KERNEL (`keyof UserDataSnapshots`) is wired
 * into BOTH the export and the delete cascade. The `Record<keyof …>` below is a
 * COMPILE-TIME gate: adding a snap key without classifying it fails the build.
 *
 * It does NOT (and cannot) catch a brand-new `users/{uid}/<x>` subcollection that
 * never enters the helper at all — that collection never becomes a `keyof`, so
 * the compile gate never sees it. Guarding THAT class needs an emulator-backed
 * erasure assertion + a subcollection-enumeration cross-check against
 * firestore.rules paths — tracked as a follow-up ticket. The skip-set rationale
 * is mirrored in docs/data-retention-policy.md so the inventory is auditable
 * outside TypeScript.
 *
 * Likewise, the delete-cascade check is a STATIC `snaps.<key>` source grep: it
 * proves the snap is referenced in deleteAccount, not that the ref reaches
 * batch.delete(). It would currently pass through a `const { x } = snaps`
 * destructuring refactor — see the follow-up for the emulator variant.
 */

interface CoverageSpec {
  /** The BingeExport key this snap maps to, or null if intentionally export-excluded. */
  export: keyof BingeExport | null;
  /** Why this snap is excluded from the Art. 20 export (required when export === null). */
  exportSkipReason?: string;
  /** Whether deleteAccount's cascade erases this snap's data. */
  deleteCascade: boolean;
  /** Why this snap is NOT erased by the cascade (required when deleteCascade === false). */
  deleteSkipReason?: string;
}

// The exhaustive contract. `Record<keyof UserDataSnapshots, …>` forces every
// snapshot key to be classified — a new key in userData.ts fails to compile here
// until its export + delete wiring is declared.
const COVERAGE: Record<keyof UserDataSnapshots, CoverageSpec> = {
  profileSnap: { export: 'profile', deleteCascade: true },
  // BIN-505: public projection doc — exported (Art. 20) + erased (Art. 17, via
  // snaps.publicProfileSnap.ref in accountDeletion).
  publicProfileSnap: { export: 'publicProfile', deleteCascade: true },
  watchlistSnap: { export: 'watchlist', deleteCascade: true },
  watchlistTagsSnap: { export: 'watchlistTags', deleteCascade: true },
  // BIN-505: owner-only per-title notes — exported + erased with the account.
  watchlistNotesSnap: { export: 'watchlistNotes', deleteCascade: true },
  episodeProgressSnap: { export: 'episodeProgress', deleteCascade: true },
  notInterestedSnap: { export: 'notInterested', deleteCascade: true },
  notificationsSnap: { export: 'notifications', deleteCascade: true },
  blockedSnap: { export: 'blocked', deleteCascade: true },
  followingSnap: { export: 'following', deleteCascade: true },
  followersSnap: {
    export: 'followers',
    deleteCascade: false,
    deleteSkipReason:
      'Each inbound-follower doc is owned by the follower (rules: isOwner(followerUid)); ' +
      'the account holder cannot delete them. Dangling refs are filtered lazily on read ' +
      'and reaped by the weekly reclaimOrphanFollows sweep.',
  },
  friendsSnap: { export: 'friends', deleteCascade: true },
  friendRequestsSnap: { export: 'friendRequests', deleteCascade: true },
  friendRequestsSentSnap: { export: 'friendRequestsSent', deleteCascade: true },
  groupInvitesSnap: { export: 'groupInvites', deleteCascade: true },
  fcmTokensSnap: {
    export: null,
    exportSkipReason:
      'Device push tokens — system-generated operational identifiers, meaningless outside ' +
      'Firebase; not Art. 20 "provided" data. Still erased by the cascade.',
    deleteCascade: true,
  },
  reportMetaSnap: {
    export: null,
    exportSkipReason:
      'Report-throttle stamp (BIN-25) — operational rate-limit metadata (timestamp/counter), ' +
      'not user-provided content. Still erased by the cascade.',
    deleteCascade: true,
  },
  askBingeMetaSnap: {
    export: null,
    exportSkipReason:
      'Ask-Binge LLM-fallback throttle — operational rate-limit metadata, not user-provided ' +
      'content. Still erased by the cascade.',
    deleteCascade: true,
  },
  pauseHistorySnap: { export: 'pauseHistory', deleteCascade: true },
  listFollowsSnap: { export: 'listFollows', deleteCascade: true },
  reviewsSnap: { export: 'reviews', deleteCascade: true },
  reviewLikesSnap: { export: 'reviewLikes', deleteCascade: true },
  reviewCommentsSnap: { export: 'reviewComments', deleteCascade: true },
  episodeReactionsSnap: { export: 'episodeReactions', deleteCascade: true },
  listsSnap: { export: 'lists', deleteCascade: true },
  editableListsSnap: { export: 'editableLists', deleteCascade: true },
  sessionsSnap: { export: 'sessions', deleteCascade: true },
  groupsSnap: { export: 'groupMemberships', deleteCascade: true },
};

// The exact, intended exclusion sets. Asserting these explicitly locks them:
// widening a skip-set to make this test go green (the testing-honesty
// anti-pattern) requires editing these literals, which is a reviewable change —
// not a silent one. A UGC key sliding into a skip-set fails loudly here.
const EXPECTED_EXPORT_SKIP = new Set<keyof UserDataSnapshots>([
  'fcmTokensSnap',
  'reportMetaSnap',
  'askBingeMetaSnap',
]);
const EXPECTED_DELETE_SKIP = new Set<keyof UserDataSnapshots>(['followersSnap']);

// Non-collection scalar fields on BingeExport — not backed by a snapshot.
const EXPORT_METADATA_KEYS = new Set<keyof BingeExport>([
  'schemaVersion',
  'exportedAt',
  'userId',
  'readme',
  'tmdbAttribution',
  'justwatchAttribution',
]);

const coverageKeys = Object.keys(COVERAGE) as (keyof UserDataSnapshots)[];

// ── Fake snapshots so buildUserExport runs without Firebase ──────────────────
function fakeQuerySnap(): QuerySnapshot {
  return {
    docs: [{ id: 'doc1', data: () => ({ seeded: true }) }],
  } as unknown as QuerySnapshot;
}
function fakeDocSnap(): DocumentSnapshot {
  return {
    exists: () => true,
    data: () => ({ seeded: 'profile' }),
  } as unknown as DocumentSnapshot;
}

vi.mock('./userData', () => ({
  collectUserDataSnapshots: vi.fn(),
}));

// BIN-184: buildUserExport fetches group-scoped household contributions inline
// (dynamic import('./db')) — mock the kit so the export path flows without
// Firebase and the fake contribution surfaces in the payload.
vi.mock('./db', () => ({
  fsdb: vi.fn(async () => ({
    db: {},
    doc: vi.fn((_db: unknown, ...segs: string[]) => ({ path: segs.join('/') })),
    getDoc: vi.fn(async () => ({
      exists: () => true,
      data: () => ({ seeded: 'household' }),
    })),
  })),
}));

// BIN-184: BingeExport keys that are GROUP-scoped (groups/{gid}/household/{uid})
// and therefore deliberately NOT backed by a users/{uid}-shaped kernel snap —
// fetched inline in buildUserExport, deleted via literal refs in the
// accountDeletion groups-loop (emulator-asserted in account-deletion.test.ts).
// Adding a key here is a reviewable widening, same discipline as the skip-sets.
const GROUP_SCOPED_EXPORT_KEYS = new Set<keyof BingeExport>(['householdContributions']);

describe('GDPR export/delete completeness (BIN-328)', () => {
  let exported: BingeExport;

  beforeAll(async () => {
    const fakeSnaps = Object.fromEntries(
      coverageKeys.map(k => [
        k,
        (k === 'profileSnap' || k === 'publicProfileSnap') ? fakeDocSnap() : fakeQuerySnap(),
      ]),
    ) as unknown as UserDataSnapshots;
    vi.mocked(collectUserDataSnapshots).mockResolvedValue(fakeSnaps);
    exported = await buildUserExport('test-uid');
  });

  it('every export-mapped snap key actually surfaces (with data) in buildUserExport', () => {
    for (const key of coverageKeys) {
      const spec = COVERAGE[key];
      if (spec.export === null) continue;
      const value = exported[spec.export];
      expect(value, `${key} → BingeExport.${String(spec.export)} missing from export`).toBeDefined();
      if (spec.export === 'profile' || spec.export === 'publicProfile') {
        // profile + publicProfile are single docs, not arrays.
        expect(value, `${String(spec.export)} should carry the seeded doc data`).not.toBeNull();
      } else {
        // Array collections: assert the snapshot docs actually flowed through.
        expect(Array.isArray(value), `${String(spec.export)} should be an array`).toBe(true);
        expect((value as unknown[]).length, `${String(spec.export)} dropped its docs`).toBeGreaterThan(0);
      }
    }
  });

  it('every collection field in BingeExport has a backing snap (no orphan export field)', () => {
    const mappedTargets = new Set(
      coverageKeys.map(k => COVERAGE[k].export).filter((e): e is keyof BingeExport => e !== null),
    );
    const exportCollectionKeys = (Object.keys(exported) as (keyof BingeExport)[]).filter(
      k => !EXPORT_METADATA_KEYS.has(k) && !GROUP_SCOPED_EXPORT_KEYS.has(k),
    );
    for (const key of exportCollectionKeys) {
      expect(mappedTargets.has(key), `BingeExport.${String(key)} has no backing UserDataSnapshots key`).toBe(true);
    }
  });

  it('BIN-184: household contributions surface in the export and in BOTH deletion branches', () => {
    // Export: one contribution per (fake) group membership, carrying the doc data.
    expect(exported.householdContributions).toHaveLength(1);
    expect(exported.householdContributions[0]).toEqual({ id: 'doc1', data: { seeded: 'household' } });

    // Deletion: the group-scoped path can't be a kernel snap, so hold the
    // cascade to it by source reference — owner branch enumerates the household
    // collection; member branch pushes the literal own-doc ref. The emulator
    // test (account-deletion.test.ts) proves the actual erasure.
    const src = readFileSync(
      join(process.cwd(), 'src', 'lib', 'firebase', 'accountDeletion.ts'),
      'utf8',
    );
    expect(src.includes("'household'"), 'accountDeletion.ts no longer references household').toBe(true);
    // Owner branch derives household refs from MEMBER uids — never a list query,
    // which share-to-see rules deny for a non-sharing owner (xhigh 2026-07-05).
    expect(src.includes('householdUids'), 'owner branch lost its member-derived household refs').toBe(true);
    expect(src.includes("'household', id"), 'member branch lost its own-doc household ref').toBe(true);
  });

  it('export-skip set is exactly the intended operational-metadata keys', () => {
    const actualSkip = new Set(coverageKeys.filter(k => COVERAGE[k].export === null));
    expect([...actualSkip].sort()).toEqual([...EXPECTED_EXPORT_SKIP].sort());
    for (const key of actualSkip) {
      expect(COVERAGE[key].exportSkipReason, `${key} export-skip needs a documented reason`).toBeTruthy();
    }
  });

  it('every delete-cascaded snap is referenced in the deleteAccount cascade', () => {
    // The cascade was extracted from AuthContext.deleteAccount into the pure,
    // db-injectable collectDeletionRefs (BIN-347 Part 2) so it can be exercised
    // against the emulator — so the `snaps.<key>` references now live there.
    const src = readFileSync(
      join(process.cwd(), 'src', 'lib', 'firebase', 'accountDeletion.ts'),
      'utf8',
    );
    for (const key of coverageKeys) {
      if (!COVERAGE[key].deleteCascade) continue;
      expect(src.includes(`snaps.${key}`), `${key} is not referenced in deleteAccount cascade`).toBe(true);
    }
  });

  it('delete-skip set is exactly the intended follower-owned key, with a reason', () => {
    const actualSkip = new Set(coverageKeys.filter(k => !COVERAGE[k].deleteCascade));
    expect([...actualSkip].sort()).toEqual([...EXPECTED_DELETE_SKIP].sort());
    for (const key of actualSkip) {
      expect(COVERAGE[key].deleteSkipReason, `${key} delete-skip needs a documented reason`).toBeTruthy();
    }
  });
});
