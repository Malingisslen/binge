// BIN-1422 del 2 — moving one deleted account back from a restored backup database.
//
// WHY THIS EXISTS. A deleted account is gone from `(default)`, but the daily backup keeps it
// for a while. Malin decided 2026-10-07 that it may be brought back, on the owner's own
// request only. Restoring a whole backup over `(default)` would roll every OTHER user back
// too, so the backup is restored into a separate database and this moves one person's
// documents across.
//
// WHY A PORT. The loop below is what decides what moves, and it must be drivable from the
// root vitest and the Firestore emulator, where firebase-admin cannot be imported. So every
// read and write goes through an injected `io`; restore-account.mjs implements it with the
// Admin SDK, src/test/rules/restore-account-orchestrator.test.ts with the client SDK. Same
// pattern as functions/src/retentionCleanup/runCleanup.ts.
//
// Malin's decisions 2026-10-07, which this file carries:
//   1. Only on the owner's own request: the run names who asked, how, and why, and the
//      address that asked must be the account's own.
//   2. The restored person accepts the terms and the age question again, so the consent
//      stamps are never copied.
//   3. The restored copy is deleted the same day, at the latest after 7 days.
//   4. Friendships and follows come back on BOTH sides, and the other person gets a
//      notification with a way to remove the tie.

import { projectFrom, projectRefusal } from './projectArg.helpers.mjs';

export { projectFrom };

/** Subcollections under `users/{uid}` that belong to the person and are copied as they are. */
export const OWNED_SUBCOLLECTIONS = [
  'watchlist',
  'watchlistTags',
  'watchlistNotes',
  'episodeProgress',
  'notInterested',
  'pauseHistory',
  'blocked',
  'listFollows',
];

/** Relations: copied, and their mirror written in the other person's tree (decision 4). */
export const RELATION_SUBCOLLECTIONS = ['friends', 'following', 'followers'];

/**
 * Never copied. Push tokens point at devices that may belong to someone else by now,
 * notifications and the two meta docs are server state that rebuilds itself, and a pending
 * request or invite may have been answered or withdrawn while the account was gone.
 */
export const NEVER_COPIED_SUBCOLLECTIONS = [
  'fcmTokens',
  'notifications',
  'reportMeta',
  'askBingeMeta',
  'friendRequests',
  'friendRequestsSent',
  'groupInvites',
];

/** Where each relation's mirror lives in the other person's tree. */
export const MIRROR_OF = { friends: 'friends', following: 'followers', followers: 'following' };

/**
 * The fields of `users/{uid}` that come back. A list of what may come, never a copy minus
 * a blocklist: a field nobody thought about stays behind rather than slipping through.
 * Not here, on purpose: `isAdmin`, `termsAcceptedAt`, `ageConfirmedAt` and `termsVersion`
 * (decision 2), and anything about push tokens or deletion. `visibilitySyncPending` is
 * handled in `profileFor`.
 */
export const PROFILE_FIELDS = [
  'displayName',
  'email',
  'photoURL',
  'username',
  'bio',
  'defaultVisibility',
  'isPublic',
  'myProviders',
  'defaultView',
  'hideNonLatinTitles',
  'hiddenCountries',
  'providerCosts',
  'providerTiers',
  'providerCampaigns',
  'providerRenewalDays',
  'providerPauses',
  'pauseReminderNext',
  'calibrationGenres',
  'hemkommun',
  'createdAt',
  'secondWeekVisitAt',
  'onboardingCompletedAt',
  'lastNotificationsSeenAt',
  'notificationSettings',
  'rotationSchedule',
];

/** `publicProfiles/{uid}` is world-readable, so only the keys `isValidPublicProfile` allows come back. */
export const PUBLIC_PROFILE_FIELDS = ['displayName', 'username', 'photoURL', 'bio', 'isPublic', 'createdAt', 'updatedAt'];

export function publicProfileFor(source) {
  const out = {};
  for (const key of PUBLIC_PROFILE_FIELDS) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

export const LOG_COLLECTION = 'restoreLog';
const LOG_RETENTION_DAYS = 365;
export const COPY_DELETE_DEADLINE_DAYS = 7;
// How many creates are in flight at once; kept under Firestore's 500-write batch size.
export const WRITE_CHUNK = 450;

const DEFAULT_DB = '(default)';

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  const value = i === -1 ? undefined : argv[i + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

// The rules' own pattern for `usernames/{name}`. The Admin SDK bypasses the rules, so a
// value they would refuse is never claimed on their behalf.
const USERNAME_PATTERN = /^[a-z0-9]([a-z0-9_-]{1,18}[a-z0-9])?$/;

export function claimableUsername(name) {
  return typeof name === 'string' && name.length >= 3 && name.length <= 20 && USERNAME_PATTERN.test(name) ? name : null;
}

/** The parsed command line. Refusals are `refusalFor`'s job, not this one's. */
export function optionsFrom(argv) {
  return {
    projectId: projectFrom(argv),
    sourceDb: flagValue(argv, '--source-db'),
    targetDb: flagValue(argv, '--target-db') ?? DEFAULT_DB,
    uid: flagValue(argv, '--uid'),
    basis: flagValue(argv, '--basis'),
    requestedBy: flagValue(argv, '--requested-by'),
    evidence: flagValue(argv, '--evidence'),
    reason: flagValue(argv, '--reason'),
    operator: flagValue(argv, '--operator'),
    apply: argv.includes('--apply'),
    understandDefault: argv.includes('--i-understand-default'),
  };
}

/** Why the command line must not start a run, or null. Nothing has been read yet. */
export function refusalFor(argv) {
  const projectRefused = projectRefusal(argv);
  if (projectRefused) return projectRefused;
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    return 'refusing: pass --dry-run or --apply, not both';
  }
  const o = optionsFrom(argv);
  if (!o.sourceDb) return 'refusing: pass --source-db <the restored copy>';
  if (o.sourceDb === o.targetDb) return 'refusing: --source-db and --target-db are the same database';
  if (!o.uid) return 'refusing: pass --uid <uid>';
  if (o.uid.includes('/')) return 'refusing: --uid cannot contain /';
  // Decision 1: there is exactly one basis, and it has to be said out loud.
  if (o.basis !== 'owner-request') return 'refusing: pass --basis owner-request (the only basis Malin allowed)';
  if (!o.requestedBy) return 'refusing: pass --requested-by <the e-mail address that asked>';
  if (!o.evidence) return 'refusing: pass --evidence <where the request is, e.g. a support ticket id>';
  if (!o.reason) return 'refusing: pass --reason <why the account is restored>';
  if (!o.operator) return 'refusing: pass --operator <who runs this>';
  if (o.apply && o.targetDb === DEFAULT_DB && !o.understandDefault) {
    return 'refusing: --apply writes to the live database; add --i-understand-default';
  }
  return null;
}

/** Case-insensitive, whitespace-trimmed e-mail equality. A missing side never matches. */
export function sameEmail(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  return x.length > 0 && x === b.trim().toLowerCase();
}

/** The restored `users/{uid}`: the allowed fields only, plus the restore stamps. */
export function profileFor(source, stamps) {
  const out = {};
  for (const key of PROFILE_FIELDS) {
    if (key in source) out[key] = source[key];
  }
  // A repair trigger, not state (BIN-587): set, it makes the app re-mark every title to the
  // profile's visibility on the next sign-in. Dropping it would leave titles the person made
  // private readable by anyone, so it comes back when, and only when, it was set.
  if (source.visibilitySyncPending === true) out.visibilitySyncPending = true;
  return { ...out, ...stamps };
}

/** Field NAMES of the source profile that stay behind — names only, never values. */
export function droppedProfileFields(source) {
  return Object.keys(source)
    .filter(k => !PROFILE_FIELDS.includes(k) && !(k === 'visibilitySyncPending' && source[k] === true))
    .sort();
}

/** Source subcollections nobody has decided about. A non-empty answer stops the run. */
export function unknownSubcollections(ids) {
  const known = new Set([...OWNED_SUBCOLLECTIONS, ...RELATION_SUBCOLLECTIONS, ...NEVER_COPIED_SUBCOLLECTIONS]);
  return ids.filter(id => !known.has(id)).sort();
}

/**
 * A relation document in the shape `firestore.rules` gives it, so a restored row is one
 * the app itself could have written: `friends` is `{uid, since}`, the follow pair
 * `{followedAt}`. `docId` is the counterpart's uid for `friends`.
 */
export function relationShape(kind, docId, data, now) {
  if (kind === 'friends') return { uid: docId, since: data?.since ?? now };
  return { followedAt: data?.followedAt ?? now };
}

/** Run id: one per person per day, so a rerun the same day continues the same log entry. */
export function runIdFor(uid, now) {
  return `${now.toISOString().slice(0, 10)}-${uid}`;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The notification the other person gets (decision 4). Text approved by Malin 2026-10-07. */
export function counterpartNotification(profile) {
  const name = (typeof profile.displayName === 'string' && profile.displayName.trim())
    || (typeof profile.username === 'string' && profile.username)
    || 'En vän';
  return {
    kind: 'system',
    title: `${name} är tillbaka på Binge`,
    body: `${name} har fått tillbaka sitt raderade konto. Er vänskap och era följningar är tillbaka. `
      + `Vill du inte ha kvar dem kan du ta bort dem på ${name}s profil.`,
    actionUrl: claimableUsername(profile.username) ? `/user/${profile.username}/` : '/my/friends/',
    read: false,
  };
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Create every write that is not there yet. `create` and never `set`: a rerun after an
 * interruption skips what already landed, and nothing that exists is ever overwritten.
 */
async function createAll(io, writes, tally) {
  for (const part of chunks(writes, WRITE_CHUNK)) {
    const results = await Promise.all(part.map(w => io.target.create(w.path, w.data)));
    for (const r of results) {
      if (r === 'created') tally.created += 1;
      else tally.existed += 1;
    }
  }
}

/** Counted problems before anything is written. Each one stops the run. */
async function preflight(io, o) {
  const problems = [];
  const source = await io.source.get(`users/${o.uid}`);
  if (!source) return { problems: ['users/{uid} is missing in the source copy'], source: null };
  if (await io.target.get(`users/${o.uid}`)) {
    problems.push('users/{uid} already exists in the target; nothing is overwritten');
  }
  // Decision 1, and #4's condition: the request must come from the account's own address.
  if (!sameEmail(o.requestedBy, source.email)) {
    problems.push('--requested-by is not the e-mail address stored on the account');
  }
  const unknown = unknownSubcollections(await io.source.listSubcollections(`users/${o.uid}`));
  if (unknown.length > 0) problems.push(`unknown subcollections in the source: ${unknown.join(', ')}`);

  if (claimableUsername(source.username)) {
    const claim = await io.target.get(`usernames/${source.username}`);
    if (claim && claim.uid !== o.uid) problems.push('the username is taken by another account in the target');
  }

  const byEmail = typeof source.email === 'string' && source.email
    ? await io.auth.getUidByEmail(source.email)
    : null;
  if (byEmail && byEmail !== o.uid) problems.push('the e-mail address belongs to another sign-in account');

  return { problems, source };
}

/**
 * The relations that come back, both sides. A relation only counts when both halves are in
 * the source, so a half-deleted pair does not come back as something it never was. It is
 * skipped when the other person no longer exists, or when either has blocked the other.
 */
async function planRelations(io, uid, now) {
  const writes = [];
  const counterparts = new Set();
  const skipped = { unpaired: 0, counterpartGone: 0, blocked: 0 };
  const ownBlocked = new Set((await io.source.list(`users/${uid}/blocked`)).map(d => d.id));

  for (const kind of RELATION_SUBCOLLECTIONS) {
    const mirrorKind = MIRROR_OF[kind];
    for (const row of await io.source.list(`users/${uid}/${kind}`)) {
      const other = row.id;
      const mirror = await io.source.get(`users/${other}/${mirrorKind}/${uid}`);
      if (!mirror) { skipped.unpaired += 1; continue; }
      if (!(await io.target.get(`users/${other}`))) { skipped.counterpartGone += 1; continue; }
      if (ownBlocked.has(other) || (await io.target.get(`users/${other}/blocked/${uid}`))) {
        skipped.blocked += 1;
        continue;
      }
      writes.push({ path: `users/${uid}/${kind}/${other}`, data: relationShape(kind, other, row.data, now) });
      writes.push({ path: `users/${other}/${mirrorKind}/${uid}`, data: relationShape(mirrorKind, uid, mirror, now) });
      counterparts.add(other);
    }
  }
  return { writes, counterparts: [...counterparts].sort(), skipped };
}

/**
 * The whole move. Returns a report with counts only: no one else's name, title or address
 * ever reaches the output (#6's condition), and the counterparts' uids go to the log alone.
 */
export async function runRestore(io, o, now = new Date()) {
  const say = io.log;
  say(`${o.apply ? 'APPLY' : 'dry run'}: project ${o.projectId}, from ${o.sourceDb} to ${o.targetDb}`);

  const { problems, source } = await preflight(io, o);
  if (problems.length > 0) {
    for (const p of problems) say(`refused: ${p}`);
    return { ok: false, problems };
  }

  const runId = runIdFor(o.uid, now);
  const serverNow = io.serverTimestamp();
  const owned = [];
  const perCollection = {};
  for (const name of OWNED_SUBCOLLECTIONS) {
    const docs = await io.source.list(`users/${o.uid}/${name}`);
    perCollection[name] = docs.length;
    for (const d of docs) owned.push({ path: `users/${o.uid}/${name}/${d.id}`, data: d.data });
  }
  const publicProfile = await io.source.get(`publicProfiles/${o.uid}`);
  const relations = await planRelations(io, o.uid, now);
  const profile = profileFor(source, {
    restoredAt: serverNow,
    restoreBasis: o.basis,
    restoreRequestedBy: o.requestedBy,
    restoreSourceDb: o.sourceDb,
  });
  const notification = counterpartNotification(source);

  say(`profile fields left behind: ${droppedProfileFields(source).join(', ') || 'none'}`);
  for (const [name, n] of Object.entries(perCollection)) say(`${name}: ${n}`);
  say(`relations restored on both sides: ${relations.counterparts.length} people`);
  say(`relations skipped: ${relations.skipped.unpaired} unpaired in the source, `
    + `${relations.skipped.counterpartGone} other account gone, ${relations.skipped.blocked} blocked`);

  if (!o.apply) {
    say('dry run: nothing written. Re-run with --apply.');
    return { ok: true, applied: false, perCollection, relations: relations.counterparts.length, skipped: relations.skipped };
  }

  // The log first, outside users/: if anything below dies, the record of who asked and
  // why is already there. A rerun the same day lands on the same entry.
  await io.target.merge(`${LOG_COLLECTION}/${runId}`, {
    uid: o.uid,
    basis: o.basis,
    requestedBy: o.requestedBy,
    evidence: o.evidence,
    reason: o.reason,
    operator: o.operator,
    sourceDb: o.sourceDb,
    targetDb: o.targetDb,
    startedAt: serverNow,
    expireAt: addDays(now, LOG_RETENTION_DAYS),
  });

  const authResult = await io.auth.ensureUser({ uid: o.uid, email: source.email });
  say(authResult === 'created' ? 'sign-in account created (no password; use "Glömt lösenord")' : 'sign-in account already there');

  const tally = { created: 0, existed: 0 };
  try {
    await writeEverything();
  } catch (err) {
    // #27/#6: an interrupted run says what is left. Everything written stays and is never
    // overwritten, and the profile is written last, so the account is not usable yet.
    say(`interrupted after ${tally.created} written: ${err && err.message ? err.message : err}`);
    say('the profile is not written yet. Rerun the same command today.');
    throw err;
  }

  async function writeEverything() {
    // The username first: it is the step that can still refuse, so it runs before anything
    // is written into someone else's account. "Already there" counts only when the claim is
    // this account's own; someone may have taken the name after the preflight read.
    if (claimableUsername(source.username)) {
      await createAll(io, [{ path: `usernames/${source.username}`, data: { uid: o.uid, createdAt: serverNow } }], tally);
      const claim = await io.target.get(`usernames/${source.username}`);
      if (!claim || claim.uid !== o.uid) throw new Error('the username was taken by another account during the run');
    }
    await createAll(io, owned, tally);
    if (publicProfile) await createAll(io, [{ path: `publicProfiles/${o.uid}`, data: publicProfileFor(publicProfile) }], tally);
    await createAll(io, relations.writes, tally);
    await createAll(io, relations.counterparts.map(other => ({
      // One card per restored account, whatever day a rerun lands on.
      path: `users/${other}/notifications/restored-${o.uid}`,
      data: { ...notification, createdAt: serverNow },
    })), tally);
    // Last, so the account cannot be used before everything else is in place. The app keys
    // the consent screen on `restoredAt` without `termsAcceptedAt` (decision 2).
    const profileTally = { created: 0, existed: 0 };
    await createAll(io, [{ path: `users/${o.uid}`, data: profile }], profileTally);
    tally.created += profileTally.created;
    // A profile already there means someone signed in mid-run and the app made a fresh,
    // empty one. The restored profile did not land, so this run did not succeed.
    if (profileTally.existed > 0) throw new Error('users/{uid} appeared during the run; the restored profile was not written');
  }

  await io.target.merge(`${LOG_COLLECTION}/${runId}`, {
    finishedAt: serverNow,
    counterpartUids: relations.counterparts,
    counts: { ...perCollection, relations: relations.counterparts.length, created: tally.created, existed: tally.existed },
  });

  const deadline = addDays(now, COPY_DELETE_DEADLINE_DAYS).toISOString().slice(0, 10);
  say(`written: ${tally.created}, already there: ${tally.existed}`);
  say(`delete the copy today, at the latest ${deadline}:`);
  say(`  gcloud firestore databases delete --database=${o.sourceDb} --project=${o.projectId}`);
  say(`  gcloud firestore databases list --project=${o.projectId}   # the copy must be gone`);
  return { ok: true, applied: true, runId, perCollection, relations: relations.counterparts.length, skipped: relations.skipped, tally };
}

/** Log entries past their `expireAt`. The TTL policy in RUNBOOK §5b is the main path. */
export async function pruneExpiredLog(io, now = new Date()) {
  const expired = await io.target.listExpired(LOG_COLLECTION, now);
  for (const path of expired) await io.target.delete(path);
  return expired.length;
}
