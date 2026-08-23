// BIN-931 — the guard that replaced the regex source scans in
// `functions/src/streamingOffers/backfillIds.test.ts`.
//
// Driven through the REPO'S OWN eslint config rather than through RuleTester with a
// hand-built parser setup. Three things have to hold together for this guard to protect
// anything, and only running the real config proves all three at once:
//
//   1. the rule is WIRED into the config `npm run lint` and CI use — a rule file nothing
//      loads is the same as no rule (BIN-830: the router advises, the gate blocks, and
//      widening one never widens the other);
//   2. it survives the TypeScript parser, which is what actually parses these files;
//   3. it fires on the shapes the regexes could not see, and stays quiet on the real writer.
//
// The invalid cases below are lifted from the measured holes recorded in the regex guard's
// own comments before it was removed. Each one had, at some point, a fully green suite.

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const RULE = 'binge/no-bare-streaming-offers-id';

// Any path under the linted tree; `lintText` does not require the file to exist. Named as a
// probe so a stray copy on disk is obviously not production code.
const PROBE = 'functions/src/streamingOffers/__eslint-probe.ts';

let eslint;

// Loading the repo's flat config (Next's presets + the TypeScript parser) costs several
// seconds ONCE. Paid here rather than by whichever case happens to run first, which
// otherwise blows the default per-test timeout and fails a rule that works.
beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() });
  await eslint.lintText('const warmup = 1;\nexport default warmup;\n', { filePath: PROBE });
}, 120_000);

async function messagesFor(code) {
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  return result.messages.filter((m) => m.ruleId === RULE);
}

const PRELUDE = `
import { getFirestore } from 'firebase-admin/firestore';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';
import { streamingOffersDocId } from './logic';
const db = getFirestore();
`;

describe('binge/no-bare-streaming-offers-id', () => {
  describe('reports a bare id', () => {
    const cases = {
      // The primary shape BIN-523 was filed about.
      'chained off the collection': `
        export async function w(tmdbId: number) {
          await db.collection('streamingOffers').doc(String(tmdbId)).set({ tmdbId });
        }`,
      // The quote character was a whole hole on its own for one round: every scan was
      // single-quote-only, and nothing in eslint.config.mjs enforces quote style.
      'double-quoted collection name': `
        export async function w(tmdbId: number) {
          await db.collection("streamingOffers").doc(\`\${tmdbId}\`).set({ tmdbId });
        }`,
      // `[^;\\n]` stopped at the newline, and `(?:db\\.)?` required the dot to touch `db`.
      // Two separate newline holes in one regex; a chain broken across lines is this repo's
      // own dominant idiom.
      'chain broken across lines': `
        export async function w(tmdbId: number) {
          const ref = db
            .collection('streamingOffers')
            .doc(String(tmdbId));
          await ref.update({ tmdbId });
        }`,
      // Honest limit #1 of the regex guard, merely ASSERTED ABSENT: a regex follows one hop.
      'two-hop binding chain': `
        export async function w(tmdbId: number) {
          const c = db.collection('streamingOffers');
          const ref = c.doc(String(tmdbId));
          await ref.set({ tmdbId });
        }`,
      // Honest limit #2: the ref is an ARGUMENT, so neither the chained nor the bound scan
      // classified it as a write. Keyed on the binding, not on a hoped-for variable name —
      // `const wb = db.batch()` sailed through every scan.
      'batch write through an arbitrary binding': `
        export async function w(tmdbId: number) {
          const col = db.collection('streamingOffers');
          const wb = db.batch();
          wb.set(col.doc(String(tmdbId)), { tmdbId });
          await wb.commit();
        }`,
      // A transaction write is the same shape as a batch write and needs no extra handling.
      'transaction write': `
        export async function w(tmdbId: number) {
          const col = db.collection('streamingOffers');
          await db.runTransaction(async (tx) => {
            tx.update(col.doc(String(tmdbId)), { tmdbId });
          });
        }`,
      // The collection name behind a module constant — caught by the same deref that
      // follows a ref binding, so it needs no separate branch.
      'collection name behind a constant': `
        const COL = 'streamingOffers';
        export async function w(tmdbId: number) {
          await db.collection(COL).doc(String(tmdbId)).create({ tmdbId });
        }`,
      // An auto-generated id is not a namespaced one either: nothing would ever find the
      // document again by title.
      'auto-generated doc id': `
        export async function w(tmdbId: number) {
          await db.collection('streamingOffers').doc().set({ tmdbId });
        }`,
    };

    for (const [name, body] of Object.entries(cases)) {
      it(name, async () => {
        expect(await messagesFor(PRELUDE + body)).toHaveLength(1);
      });
    }
  });

  describe('stays quiet', () => {
    const cases = {
      'id built by streamingOffersDocId': `
        export async function w(mediaType: string, tmdbId: number) {
          await db.collection('streamingOffers').doc(streamingOffersDocId(mediaType, tmdbId)).set({ tmdbId });
        }`,
      'id built by mediaTypeDocId through a binding': `
        export async function w(mediaType: 'movie' | 'tv', tmdbId: number) {
          const col = db.collection('streamingOffers');
          const id = mediaTypeDocId(mediaType, tmdbId);
          await col.doc(id).set({ tmdbId });
        }`,
      // DELETES may address a bare id on purpose — that is the only mechanism that retires
      // the legacy documents. A guard that forbade bare ids outright would forbid the
      // cleanup BIN-565 exists to perform.
      'delete of a legacy bare doc': `
        export async function w(tmdbId: number) {
          const legacyRef = db.collection('streamingOffers').doc(String(tmdbId));
          if ((await legacyRef.get()).exists) await legacyRef.delete();
        }`,
      'read of a bare doc': `
        export async function w(tmdbId: number) {
          const snap = await db.collection('streamingOffers').doc(String(tmdbId)).get();
          return snap.exists;
        }`,
      // The guard must fire on the collection it owns and nothing else. A bare-id write to
      // another collection is not its business, and a guard that cries wolf is a guard
      // someone deletes — that is why the earlier scans kept having to be re-narrowed.
      'bare id on a DIFFERENT collection': `
        export async function w(tmdbId: number) {
          await db.collection('priceHistory').doc(String(tmdbId)).set({ tmdbId });
          const other = db.collection('motnBudget');
          await other.doc('current').update({ used: 1 });
        }`,
    };

    for (const [name, body] of Object.entries(cases)) {
      it(name, async () => {
        expect(await messagesFor(PRELUDE + body)).toEqual([]);
      });
    }
  });

  it('the real writer module passes', async () => {
    // The other direction of the same claim: the shipped code this guard watches must be
    // clean, or the rule would be reported "green" only because someone disabled it.
    const [result] = await eslint.lintFiles(['functions/src/streamingOffers/index.ts']);
    expect(result.messages.filter((m) => m.ruleId === RULE)).toEqual([]);
  });

  it('is enabled as an ERROR by the repo config, not a warning', async () => {
    // A warning does not fail `npm run lint`, so it would not block anything. Read off a
    // real report rather than off the config object, so this cannot pass against a rule
    // that is configured but never reached.
    const [message] = await messagesFor(`${PRELUDE}
      export async function w(tmdbId: number) {
        await db.collection('streamingOffers').doc(String(tmdbId)).set({ tmdbId });
      }`);
    expect(message.severity).toBe(2);
  });
});
