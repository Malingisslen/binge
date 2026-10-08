#!/usr/bin/env node
// restore-account.mjs — BIN-1422 del 2: move one deleted account back from a restored backup.
//
// The decisions and what moves are in restore-account.helpers.mjs, where a test can call
// them. This file is only the Admin-SDK port. The full procedure, including restoring the
// backup into its own database first and deleting it afterwards, is docs/RUNBOOK.md §5b.
//
// Run from functions/, where firebase-admin resolves. Dry run first, always:
//   cd functions && node scripts/restore-account.mjs --project binge-nu --source-db <copy> --uid <uid> --basis owner-request --requested-by <e-mail> --evidence <ticket> --reason <why> --operator <you> --dry-run

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';

import { optionsFrom, pruneExpiredLog, refusalFor, runRestore, LOG_COLLECTION } from './restore-account.helpers.mjs';

// gRPC ALREADY_EXISTS, what `create()` throws when the document is there.
const ALREADY_EXISTS = 6;

function adminIo(projectId, sourceDb, targetDb) {
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const source = getFirestore(sourceDb);
  const target = getFirestore(targetDb);
  const auth = getAuth();

  const read = db => async path => {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() : null;
  };

  return {
    log: line => console.log(line),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    source: {
      get: read(source),
      list: async path => (await source.collection(path).get()).docs.map(d => ({ id: d.id, data: d.data() })),
      listSubcollections: async path => (await source.doc(path).listCollections()).map(c => c.id),
    },
    target: {
      get: read(target),
      create: async (path, data) => {
        try {
          await target.doc(path).create(data);
          return 'created';
        } catch (err) {
          if (err && err.code === ALREADY_EXISTS) return 'existed';
          throw err;
        }
      },
      merge: (path, data) => target.doc(path).set(data, { merge: true }),
      delete: path => target.doc(path).delete(),
      listExpired: async (collection, now) =>
        (await target.collection(collection).where('expireAt', '<', now).get()).docs.map(d => d.ref.path),
    },
    auth: {
      getUidByEmail: async email => {
        try {
          return (await auth.getUserByEmail(email)).uid;
        } catch (err) {
          if (err && err.code === 'auth/user-not-found') return null;
          throw err;
        }
      },
      // No password, no provider, no claims: the person signs in through "Glömt lösenord".
      ensureUser: async ({ uid, email }) => {
        try {
          await auth.getUser(uid);
          return 'existed';
        } catch (err) {
          if (!err || err.code !== 'auth/user-not-found') throw err;
        }
        await auth.createUser({ uid, email, emailVerified: false });
        return 'created';
      },
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const refusal = refusalFor(argv);
  if (refusal) {
    console.log(refusal);
    return 1;
  }
  const o = optionsFrom(argv);
  // Named before the first read, so a wrong project or database is visible at once.
  console.log(`project ${o.projectId}, source ${o.sourceDb}, target ${o.targetDb}`);
  const io = adminIo(o.projectId, o.sourceDb, o.targetDb);
  const report = await runRestore(io, o);
  if (!report.ok) return 1;
  if (o.apply) {
    const pruned = await pruneExpiredLog(io);
    if (pruned > 0) console.log(`${LOG_COLLECTION}: ${pruned} expired entr${pruned === 1 ? 'y' : 'ies'} deleted`);
  }
  return 0;
}

// Runs only as the entry point: imported by a test, this module must do nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    code => {
      process.exitCode = code;
    },
    err => {
      // Everything written so far stays and is never overwritten, so the way on is the
      // same command again, the same day (RUNBOOK §5b).
      console.error(`interrupted: ${err && err.message ? err.message : err}`);
      console.error('rerun the same command today; restoreLog/<date>-<uid> shows when it started');
      process.exitCode = 1;
    },
  );
}
