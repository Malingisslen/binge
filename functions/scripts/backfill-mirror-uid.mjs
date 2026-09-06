#!/usr/bin/env node
// backfill-mirror-uid.mjs — one-time backfill for BIN-1063 step 2.
//
// WHAT IT DOES. Writes `uid` onto every existing `friends` and
// `friendRequestsSent` document that lacks it. The value is always the
// document's OWN id, which is the counterparty's uid — the row lives under one
// user's tree but is about the other one, and it is the other one whose
// departure must make it findable.
//
// WHY A SCRIPT AND NOT THE APP. `firestore.rules` sets `allow update: if false`
// on both collections, so an existing fieldless row can never heal itself
// through the client. Only an Admin-SDK write can add the field after the fact.
//
// WHY `update()` AND NEVER `set(..., {merge:true})`. A row can be deleted
// between this script's read and its write — an unfriend, a cancelled request.
// `update()` fails safely on a missing document; `set(merge:true)` would
// RESURRECT it as a phantom carrying only `uid` and no timestamp. That is a
// worse end state than the one being fixed.
//
// IT MUST NOT TOUCH THE TIMESTAMP. `since` / `sentAt` are the only other field
// on these rows, and re-stamping them is the failure this repo has already been
// bitten by: a stamp rewritten on every pass never matures. The write below
// names exactly one field.
//
// NOT AN ERASURE. This makes rows findable. Nothing here deletes anything, and
// "the mirror migration shipped" must not be read as "the residual traces are
// gone" — the delete pass is later work.
//
// `followers` is deliberately NOT in scope: reclaimOrphanFollows already
// reclaims it weekly by path, needing no field. Malin's scope decision
// 2026-09-06.
//
// Kors fran functions/, dar firebase-admin gar att resolva:
//   cd functions && node scripts/backfill-mirror-uid.mjs --project binge-nu --dry-run
//   cd functions && node scripts/backfill-mirror-uid.mjs --project binge-nu --apply

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';

import {
  COLLECTIONS,
  candidates,
  patchFor,
  projectFrom,
  refusalFor,
  stampText,
} from './backfill-mirror-uid.helpers.mjs';

const PAGE_SIZE = 300;



async function run({ apply, projectId }) {
  // The project is NAMED, never inferred. Application Default Credentials carry
  // whatever quota project the machine was last set up for — on 2026-09-06 the
  // first dry run of this script read a DIFFERENT project's database, succeeded,
  // and printed `0 scanned`, which is indistinguishable from a healthy no-op.
  // A whole-population writer must not decide for itself whose data it opens.
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  console.log(`${apply ? 'APPLY' : 'dry run'} against project ${projectId}`);

  let touched = 0;
  let scanned = 0;
  let skipped = 0;

  for (const collectionId of COLLECTIONS) {
    let cursor;
    for (;;) {
      let q = db.collectionGroup(collectionId).orderBy('__name__').limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      scanned += snap.size;

      const page = snap.docs.map((d) => ({ id: d.id, path: d.ref.path, data: d.data(), ref: d.ref }));
      for (const doc of candidates(page)) {
        const patch = patchFor(doc);
        // Log the before-value of the timestamp. The guarantee that it does not
        // move is patchFor naming exactly one field, which its test pins; this
        // line is the operator's record of what the row held going in.
        const stamp = collectionId === 'friends' ? 'since' : 'sentAt';
        console.log(
          `${apply ? 'WRITE' : 'would write'} ${doc.path}  uid=${patch.uid}  ${stamp}(before)=${stampText(doc.data[stamp])}`
        );
        if (apply) {
          try {
            await doc.ref.update(patch);
          } catch (err) {
            // The catch is broad: a row deleted between read and write, denied
            // credentials and a quota refusal all land here and all count as a
            // skip. The summary prints the count and run() exits non-zero on any
            // of them, so an operator reads the log rather than the exit code to
            // tell a concurrent unfriend from a broken run.
            console.log(`  skipped ${doc.path}: ${err && err.message ? err.message : 'unknown'}`);
            skipped++;
            continue;
          }
        }
        touched++;
      }

      if (snap.size < PAGE_SIZE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
  }

  // A run whose every write was refused (bad credentials, wrong project, quota)
  // must not end on a line that reads like a healthy no-op. The skip count is
  // always printed, and a non-empty one is a non-zero exit.
  console.log(
    `\n${apply ? `applied: ${touched} row(s) written` : `dry run: ${touched} row(s) need the field`}, `
    + `${skipped} skipped, ${scanned} scanned across ${COLLECTIONS.join(' + ')}`
  );
  if (!apply && touched > 0) console.log('re-run with --apply to write.');
  return skipped > 0 ? 1 : 0;
}

export async function main(argv = process.argv.slice(2)) {
  // The refusals live in the helpers, where a test can CALL them. A source scan
  // over this function can only see that a branch is written, not that it fires.
  const refusal = refusalFor(argv);
  if (refusal) {
    console.log(refusal);
    return 1;
  }
  return run({ apply: argv.includes('--apply'), projectId: projectFrom(argv) });
}

// The CLI runs ONLY as the entry point: imported by its test, this module must
// define functions and do nothing else, or it eats the test runner's argv.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    process.exitCode = code;
  });
}
