import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEVER_COPIED_SUBCOLLECTIONS,
  OWNED_SUBCOLLECTIONS,
  PROFILE_FIELDS,
  RELATION_SUBCOLLECTIONS,
  counterpartNotification,
  droppedProfileFields,
  optionsFrom,
  profileFor,
  pruneExpiredLog,
  refusalFor,
  relationShape,
  runIdFor,
  runRestore,
  sameEmail,
  WRITE_CHUNK,
  claimableUsername,
  publicProfileFor,
  unknownSubcollections,
} from './restore-account.helpers.mjs';

const HERE = join(fileURLToPath(import.meta.url), '..');
const SCRIPT = readFileSync(join(HERE, 'restore-account.mjs'), 'utf8');
const USER_DATA = readFileSync(join(HERE, '..', '..', 'src', 'lib', 'firebase', 'userData.ts'), 'utf8');

const FULL = [
  '--project', 'binge-test', '--source-db', 'restore-copy', '--uid', 'u1',
  '--basis', 'owner-request', '--requested-by', 'anna@example.se',
  '--evidence', 'mejl 2026-10-07', '--reason', 'raderade av misstag', '--operator', 'malin',
];
const without = (flag) => {
  const i = FULL.indexOf(flag);
  return [...FULL.slice(0, i), ...FULL.slice(i + 2)];
};

describe('refusalFor — what stops a run before anything is read', () => {
  it('accepts a complete dry run', () => {
    expect(refusalFor(FULL)).toBeNull();
  });

  it.each([
    ['--project', /--project/],
    ['--source-db', /--source-db/],
    ['--uid', /--uid/],
    ['--basis', /owner-request/],
    ['--requested-by', /--requested-by/],
    ['--evidence', /--evidence/],
    ['--reason', /--reason/],
    ['--operator', /--operator/],
  ])('refuses without %s', (flag, message) => {
    expect(refusalFor(without(flag))).toMatch(message);
  });

  it('refuses any basis other than the owner asking (decision 1)', () => {
    const argv = [...without('--basis'), '--basis', 'support-thinks-so'];
    expect(refusalFor(argv)).toMatch(/owner-request/);
  });

  it('refuses when the source and the target are the same database', () => {
    expect(refusalFor([...without('--source-db'), '--source-db', '(default)'])).toMatch(/same database/);
  });

  it('refuses --apply against the live database without the explicit acknowledgement', () => {
    expect(refusalFor([...FULL, '--apply'])).toMatch(/--i-understand-default/);
    expect(refusalFor([...FULL, '--apply', '--i-understand-default'])).toBeNull();
  });

  it('a dry run against the live database needs no acknowledgement, since it writes nothing', () => {
    expect(refusalFor([...FULL, '--dry-run'])).toBeNull();
  });

  it('refuses --apply together with --dry-run', () => {
    expect(refusalFor([...FULL, '--apply', '--dry-run', '--i-understand-default'])).toMatch(/not both/);
  });

  it('refuses a uid that would reach outside users/{uid}', () => {
    expect(refusalFor([...without('--uid'), '--uid', 'a/b'])).toMatch(/cannot contain/);
  });

  it('does not take the next flag as a value', () => {
    expect(optionsFrom(['--uid', '--apply']).uid).toBeUndefined();
  });

  it('is dry run unless --apply is given', () => {
    expect(optionsFrom(FULL).apply).toBe(false);
    expect(optionsFrom([...FULL, '--apply']).apply).toBe(true);
  });
});

describe('the subcollection lists', () => {
  // userData.ts imports the Firebase client, which this suite does not load, so the list is
  // read off its declaration. A user subcollection added there without a decision here
  // fails this test instead of being silently left behind (or silently copied).
  it('cover exactly the subcollections the app knows about', () => {
    const block = USER_DATA.match(/export const KNOWN_USER_SUBCOLLECTIONS = \[([\s\S]*?)\] as const;/);
    expect(block, 'the declaration was found').not.toBeNull();
    const known = [...block[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
    expect(known.length).toBeGreaterThan(10);
    const decided = [...OWNED_SUBCOLLECTIONS, ...RELATION_SUBCOLLECTIONS, ...NEVER_COPIED_SUBCOLLECTIONS];
    expect([...decided].sort()).toEqual([...known].sort());
    expect(new Set(decided).size).toBe(decided.length);
  });

  it('never copies push tokens, notifications, server meta, or pending requests and invites', () => {
    for (const name of ['fcmTokens', 'notifications', 'reportMeta', 'askBingeMeta', 'friendRequests', 'friendRequestsSent', 'groupInvites']) {
      expect(OWNED_SUBCOLLECTIONS).not.toContain(name);
      expect(RELATION_SUBCOLLECTIONS).not.toContain(name);
    }
  });

  it('names an unknown subcollection so the run stops', () => {
    expect(unknownSubcollections(['watchlist', 'friends', 'somethingNew'])).toEqual(['somethingNew']);
    expect(unknownSubcollections(['watchlist', 'fcmTokens'])).toEqual([]);
  });
});

describe('profileFor — the restored users/{uid}', () => {
  const source = {
    displayName: 'Anna', email: 'anna@example.se', username: 'anna', bio: 'hej',
    providerCosts: { 8: 99 }, notificationSettings: { pushEnabled: true },
    isAdmin: true,
    termsAcceptedAt: 'T', ageConfirmedAt: 'A', termsVersion: '2026-01',
    visibilitySyncPending: true,
    fcmLastToken: 'x',
    somethingUnreviewed: 1,
  };
  const stamps = { restoredAt: 'NOW', restoreBasis: 'owner-request', restoreRequestedBy: 'anna@example.se', restoreSourceDb: 'copy' };

  it('keeps the person\'s own settings and adds the restore stamps', () => {
    const p = profileFor(source, stamps);
    expect(p).toMatchObject({ displayName: 'Anna', email: 'anna@example.se', username: 'anna', bio: 'hej', providerCosts: { 8: 99 } });
    expect(p).toMatchObject(stamps);
  });

  it('never brings back admin rights, consent stamps, sync flags, push fields or unknown fields', () => {
    const p = profileFor(source, stamps);
    for (const key of ['isAdmin', 'termsAcceptedAt', 'ageConfirmedAt', 'termsVersion', 'fcmLastToken', 'somethingUnreviewed']) {
      expect(p, key).not.toHaveProperty(key);
    }
  });

  it('keeps the visibility repair trigger when it was set, so private titles get re-marked (BIN-587)', () => {
    expect(profileFor(source, stamps).visibilitySyncPending).toBe(true);
    expect(profileFor({ ...source, visibilitySyncPending: false }, stamps)).not.toHaveProperty('visibilitySyncPending');
    expect(profileFor({ displayName: 'Anna' }, stamps)).not.toHaveProperty('visibilitySyncPending');
  });

  it('the allowlist itself names none of them', () => {
    for (const key of ['isAdmin', 'termsAcceptedAt', 'ageConfirmedAt', 'termsVersion', 'visibilitySyncPending']) {
      expect(PROFILE_FIELDS).not.toContain(key);
    }
  });

  it('reports the names of the fields left behind, never their values', () => {
    const dropped = droppedProfileFields(source);
    expect(dropped).toEqual(['ageConfirmedAt', 'fcmLastToken', 'isAdmin', 'somethingUnreviewed', 'termsAcceptedAt', 'termsVersion']);
  });
});

describe('small rules', () => {
  it('brings back only the public-profile keys the rules allow', () => {
    expect(publicProfileFor({ displayName: 'Anna', username: 'anna', bio: 'hej', email: 'anna@example.se', legacy: 1 }))
      .toEqual({ displayName: 'Anna', username: 'anna', bio: 'hej' });
  });

  it('compares e-mail addresses without case or surrounding space, and never matches a missing one', () => {
    expect(sameEmail(' Anna@Example.se', 'anna@example.se ')).toBe(true);
    expect(sameEmail('anna@example.se', 'bertil@example.se')).toBe(false);
    expect(sameEmail('', '')).toBe(false);
    expect(sameEmail(undefined, 'anna@example.se')).toBe(false);
  });

  it('gives relations the shape firestore.rules allows', () => {
    expect(relationShape('friends', 'u2', { since: 'S', extra: 1 }, 'NOW')).toEqual({ uid: 'u2', since: 'S' });
    expect(relationShape('friends', 'u2', {}, 'NOW')).toEqual({ uid: 'u2', since: 'NOW' });
    expect(relationShape('following', 'u2', { followedAt: 'F', extra: 1 }, 'NOW')).toEqual({ followedAt: 'F' });
    expect(relationShape('followers', 'u2', {}, 'NOW')).toEqual({ followedAt: 'NOW' });
  });

  it('gives one run id per person per day', () => {
    expect(runIdFor('u1', new Date('2026-10-07T21:00:00Z'))).toBe('2026-10-07-u1');
  });

  it('writes the notification text Malin approved', () => {
    const n = counterpartNotification({ displayName: 'Anna', username: 'anna' });
    expect(n.title).toBe('Anna är tillbaka på Binge');
    expect(n.body).toBe('Anna har fått tillbaka sitt raderade konto. Er vänskap och era följningar är tillbaka. Vill du inte ha kvar dem kan du ta bort dem på Annas profil.');
    expect(n.actionUrl).toBe('/user/anna/');
    expect(n).toMatchObject({ kind: 'system', read: false });
  });

  it('claims only a username firestore.rules would accept', () => {
    expect(claimableUsername('anna_b')).toBe('anna_b');
    for (const bad of ['a', 'Anna', 'a/b', 'ab', '_anna', 'a'.repeat(21), null, 42]) {
      expect(claimableUsername(bad), String(bad)).toBeNull();
    }
  });

  it('falls back to the friends page when the account has no valid username', () => {
    expect(counterpartNotification({ displayName: 'Anna', username: null }).actionUrl).toBe('/my/friends/');
    expect(counterpartNotification({ displayName: 'Anna', username: '../admin' }).actionUrl).toBe('/my/friends/');
  });
});

// An in-memory port. The emulator test drives the same loop against a real Firestore;
// this one is for the refusals, which must write nothing at all.
function memoryIo({ source = {}, target = {}, authByEmail = {}, failCreate = null } = {}) {
  const writes = [];
  const lines = [];
  const events = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const list = (store, path) => Object.entries(store)
    .filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'))
    .map(([p, data]) => ({ id: p.slice(path.length + 1), data }));
  return {
    writes,
    lines,
    events,
    maxInFlight: () => maxInFlight,
    io: {
      log: l => { lines.push(l); events.push('log'); },
      serverTimestamp: () => 'NOW',
      source: {
        get: async p => { events.push('read'); return source[p] ?? null; },
        list: async p => { events.push('read'); return list(source, p); },
        listSubcollections: async p => [...new Set(Object.keys(source)
          .filter(k => k.startsWith(`${p}/`))
          .map(k => k.slice(p.length + 1).split('/')[0]))],
      },
      target: {
        get: async p => target[p] ?? null,
        create: async (p, d) => {
          if (failCreate && failCreate(p)) throw new Error('simulated interruption');
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Promise.resolve();
          inFlight -= 1;
          writes.push(['create', p]);
          if (target[p]) return 'existed';
          target[p] = d;
          return 'created';
        },
        merge: async (p, d) => { writes.push(['merge', p]); target[p] = { ...(target[p] ?? {}), ...d }; },
        delete: async p => { writes.push(['delete', p]); delete target[p]; },
        listExpired: async (c, now) => Object.entries(target)
          .filter(([p, d]) => p.startsWith(`${c}/`) && d.expireAt < now).map(([p]) => p),
      },
      auth: {
        getUidByEmail: async e => authByEmail[e] ?? null,
        ensureUser: async () => { writes.push(['auth']); return 'created'; },
      },
    },
  };
}

const OPTS = { ...optionsFrom(FULL), apply: true };
const SOURCE_USER = { 'users/u1': { email: 'anna@example.se', username: 'anna', displayName: 'Anna' } };

describe('runRestore — refusals write nothing', () => {
  it.each([
    ['the account is missing in the copy', {}, {}, {}, /missing in the source/],
    ['the account already exists in the target', SOURCE_USER, { 'users/u1': {} }, {}, /already exists/],
    ['the username is taken by someone else', SOURCE_USER, { 'usernames/anna': { uid: 'u9' } }, {}, /username is taken/],
    ['the e-mail belongs to another sign-in account', SOURCE_USER, {}, { 'anna@example.se': 'u9' }, /another sign-in account/],
    ['the copy has a subcollection nobody decided about', { ...SOURCE_USER, 'users/u1/somethingNew/x': {} }, {}, {}, /unknown subcollections/],
  ])('when %s', async (_name, source, target, authByEmail, message) => {
    const m = memoryIo({ source, target, authByEmail });
    const report = await runRestore(m.io, OPTS);
    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toMatch(message);
    expect(m.writes).toEqual([]);
  });

  it('when the request did not come from the account\'s own address (decision 1)', async () => {
    const m = memoryIo({ source: SOURCE_USER });
    const report = await runRestore(m.io, { ...OPTS, requestedBy: 'someone@else.se' });
    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toMatch(/not the e-mail address stored/);
    expect(m.writes).toEqual([]);
  });

  it('the same username claimed by the same uid is not a conflict, so a rerun can finish', async () => {
    const m = memoryIo({ source: SOURCE_USER, target: { 'usernames/anna': { uid: 'u1' } } });
    expect((await runRestore(m.io, OPTS)).ok).toBe(true);
  });

  it('a malformed username is neither checked nor claimed', async () => {
    const m = memoryIo({ source: { 'users/u1': { ...SOURCE_USER['users/u1'], username: 'Anna/x' } } });
    expect((await runRestore(m.io, OPTS)).ok).toBe(true);
    expect(m.writes.some(w => String(w[1]).startsWith('usernames/'))).toBe(false);
  });

  it('a profile that appears mid-run (the person signed in early) fails the run instead of passing as restored', async () => {
    const m = memoryIo({ source: SOURCE_USER });
    const create = m.io.target.create;
    m.io.target.create = async (p, d) => {
      if (p === 'users/u1') await create(p, { fresh: true });
      return create(p, d);
    };
    await expect(runRestore(m.io, OPTS)).rejects.toThrow('appeared during the run');
    expect(m.writes.some(w => w[0] === 'merge' && w[1].startsWith('restoreLog/'))).toBe(true);
    expect(m.lines.join('\n')).toContain('interrupted after');
  });

  it('a username someone else took during the run fails it instead of passing as claimed', async () => {
    const m = memoryIo({
      source: {
        ...SOURCE_USER,
        'users/u1/watchlist/movie_1': {},
        'users/u1/friends/u2': { since: 'S' },
        'users/u2/friends/u1': { since: 'S' },
        'publicProfiles/u1': { displayName: 'Anna' },
      },
      target: { 'users/u2': {} },
    });
    const create = m.io.target.create;
    m.io.target.create = async (p, d) => {
      if (p === 'usernames/anna') await create(p, { uid: 'u9' });
      return create(p, d);
    };
    await expect(runRestore(m.io, OPTS)).rejects.toThrow('username was taken');
    expect(m.writes.some(w => w[1] === 'users/u1')).toBe(false);
    // Nothing reached anyone else's account before the refusal.
    expect(m.writes.filter(w => w[0] === 'create').map(w => w[1])).toEqual(['usernames/anna', 'usernames/anna']);
  });

  it('a dry run reads but never writes', async () => {
    const m = memoryIo({ source: { ...SOURCE_USER, 'users/u1/watchlist/movie_1': { status: 'sedd' } } });
    const report = await runRestore(m.io, { ...OPTS, apply: false });
    expect(report).toMatchObject({ ok: true, applied: false, perCollection: { watchlist: 1 } });
    expect(m.writes).toEqual([]);
  });
});

describe('runRestore — order and output', () => {
  it('names the project and both databases before the first read', async () => {
    const m = memoryIo({ source: SOURCE_USER });
    await runRestore(m.io, OPTS);
    expect(m.lines[0]).toContain('project binge-test');
    expect(m.lines[0]).toContain('from restore-copy to (default)');
    expect(m.events[0]).toBe('log');
    expect(m.events).toContain('read');
  });

  it('never has more than one batch-sized round of writes in flight, and writes them all', async () => {
    expect(WRITE_CHUNK).toBeLessThanOrEqual(450);
    const source = { ...SOURCE_USER };
    const n = 2 * WRITE_CHUNK + 1;
    for (let i = 1; i <= n; i += 1) source[`users/u1/watchlist/movie_${i}`] = { tmdbId: i };
    const m = memoryIo({ source });
    const report = await runRestore(m.io, OPTS);
    expect(report.perCollection.watchlist).toBe(n);
    expect(m.writes.filter(w => w[0] === 'create' && w[1].startsWith('users/u1/watchlist/'))).toHaveLength(n);
    expect(m.maxInFlight()).toBeGreaterThan(1);
    expect(m.maxInFlight()).toBeLessThanOrEqual(WRITE_CHUNK);
  });

  it('an interrupted run says the profile is not written and to rerun today, and does not write the profile', async () => {
    const m = memoryIo({
      source: { ...SOURCE_USER, 'users/u1/watchlist/movie_1': {}, 'users/u1/watchlist/movie_2': {} },
      failCreate: p => p === 'users/u1/watchlist/movie_2',
    });
    await expect(runRestore(m.io, OPTS)).rejects.toThrow('simulated interruption');
    const out = m.lines.join('\n');
    expect(out).toContain('interrupted after');
    expect(out).toContain('the profile is not written yet. Rerun the same command today.');
    expect(m.writes.some(w => w[1] === 'users/u1')).toBe(false);
  });

  it('writes the log first and users/{uid} last', async () => {
    const m = memoryIo({ source: { ...SOURCE_USER, 'users/u1/watchlist/movie_1': {} } });
    await runRestore(m.io, OPTS, new Date('2026-10-07T12:00:00Z'));
    expect(m.writes[0]).toEqual(['merge', 'restoreLog/2026-10-07-u1']);
    const creates = m.writes.filter(w => w[0] === 'create').map(w => w[1]);
    expect(creates.at(-1)).toBe('users/u1');
    expect(m.writes.at(-1)).toEqual(['merge', 'restoreLog/2026-10-07-u1']);
  });

  it('prints the deletion command with the 7-day deadline (decision 3)', async () => {
    const m = memoryIo({ source: SOURCE_USER });
    await runRestore(m.io, OPTS, new Date('2026-10-07T12:00:00Z'));
    const out = m.lines.join('\n');
    expect(out).toContain('at the latest 2026-10-14');
    expect(out).toContain('gcloud firestore databases delete --database=restore-copy --project=binge-test');
    expect(out).toContain('gcloud firestore databases list --project=binge-test');
  });

  it('prints no one else\'s uid, name or address', async () => {
    const m = memoryIo({
      source: {
        ...SOURCE_USER,
        'users/u1/friends/u2': { since: 'S' },
        'users/u2/friends/u1': { since: 'S' },
        'users/u2': { email: 'bertil@example.se', displayName: 'Bertil' },
      },
      target: { 'users/u2': { email: 'bertil@example.se', displayName: 'Bertil' } },
    });
    await runRestore(m.io, OPTS);
    const out = m.lines.join('\n');
    expect(out).toContain('relations restored on both sides: 1 people');
    for (const leak of ['u2', 'Bertil', 'bertil@example.se']) expect(out).not.toContain(leak);
  });

  it('prunes log entries past their expiry, and only those', async () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const m = memoryIo({ target: {
      'restoreLog/old': { expireAt: new Date('2026-10-01T00:00:00Z') },
      'restoreLog/new': { expireAt: new Date('2027-10-01T00:00:00Z') },
    } });
    expect(await pruneExpiredLog(m.io, now)).toBe(1);
    expect(m.writes).toEqual([['delete', 'restoreLog/old']]);
  });
});

describe('restore-account.mjs — the Admin port', () => {
  // The runner imports firebase-admin, which the root suite cannot load, so what it DOES is
  // read off its source. Comments are stripped so the header's prose cannot satisfy a scan.
  const CODE = SCRIPT.replace(/^\s*\/\/.*$/gm, '');

  it('prints the project and databases before it opens anything', () => {
    const body = CODE.slice(CODE.indexOf('export async function main'));
    expect(body.indexOf('console.log(`project ${o.projectId}, source ${o.sourceDb}, target ${o.targetDb}`)')).toBeGreaterThan(-1);
    expect(body.indexOf('console.log(`project')).toBeLessThan(body.indexOf('adminIo('));
  });

  it('consults the refusals before it opens anything', () => {
    const body = CODE.slice(CODE.indexOf('export async function main'));
    expect(body.indexOf('refusalFor(argv)')).toBeGreaterThan(-1);
    expect(body.indexOf('refusalFor(argv)')).toBeLessThan(body.indexOf('adminIo('));
  });

  it('creates and never sets the documents it restores', () => {
    const create = CODE.slice(CODE.indexOf('create: async'), CODE.indexOf('merge:'));
    expect(create).toContain('.create(data)');
    expect(create).not.toContain('.set(');
  });

  it('creates the sign-in account with no password, unverified, and the same uid', () => {
    expect(CODE).toContain('auth.createUser({ uid, email, emailVerified: false })');
    expect(CODE).not.toMatch(/password\s*:/);
    expect(CODE).not.toContain('setCustomUserClaims');
  });
});
