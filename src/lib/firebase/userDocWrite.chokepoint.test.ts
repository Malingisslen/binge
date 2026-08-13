import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * BIN-816 / ADR 0019 condition 1 — the guard that keeps the chokepoint a
 * chokepoint.
 *
 * The panel's objection was never "these particular writers are wrong". It was
 * that a per-call-site fix reopens the hole the moment someone adds another
 * writer, and the count kept going up while the ticket was open: the ticket
 * named two, #27 Database and the Archaeologist found seven in `AuthContext.tsx`
 * alone plus an eighth in `OnboardingFlow.tsx`, and building this turned up
 * `claimUsername` and the public projection as nine and ten.
 *
 * The first version of this file tried to detect WRITES — `setDoc(doc(db,
 * 'users', …))` and friends. All three reviews took it apart on 2026-08-13: a
 * hoisted `const ref = doc(db,'users',uid); await setDoc(ref, …)` sailed past
 * it, and so did `kit.doc(kit.db, …)`, the idiom `userDocWrite.ts` itself uses.
 * Detecting one spelling of a write is a losing game.
 *
 * So it is a whitelist over the REFERENCE instead. Naming `users` or
 * `publicProfiles` as a document path or a bare collection is rare — five files
 * in a 497-file tree — and every one of them is listed below with why it is
 * allowed to. A new file that names it fails this test, whatever it then does
 * with it. That is deliberately stricter than the rule it enforces: the cost is
 * one line in a list, and the alternative is a guard that only catches the
 * spellings someone thought of.
 *
 * Not total, and the docstring should not claim otherwise: a template-literal
 * path (`doc(db, \`users/${uid}\`)`) or a variable collection name still escapes.
 * Neither idiom exists anywhere in `src/` today — grepped 2026-08-13 — so the
 * guard is honest about the tree it guards.
 *
 * A guard test of the same family as `src/lib/design/consistency.test.ts`: it
 * reads source rather than behaviour, because the failure it prevents is a file
 * that does not exist yet.
 *
 * It scans raw text, so a COMMENT quoting the pattern trips it too. That is a
 * false positive and it is the right way round — it fails closed, and the
 * message says what to do. Reword the comment.
 */

const SRC = join(process.cwd(), 'src');

/** The module that owns the writes. Exempt by definition. */
const CHOKEPOINT = join('lib', 'firebase', 'userDocWrite.ts');

/**
 * Files allowed to build a profile-document reference themselves, because the
 * write belongs to a larger atomic batch or transaction that `mergeUserDoc`
 * cannot express. Every entry MUST call `assertProfileWritable` — asserted
 * below, so an entry added without the guard fails rather than quietly widening
 * the hole.
 */
const BATCH_WRITERS = [
  // `resumeProvider`: users/{uid} + a pauseHistory doc must land together, or the
  // pause and its history row disagree. Also `ensureUserProfile`'s create, which
  // is a transaction (BIN-535) and is guarded by its own early return.
  join('contexts', 'AuthContext.tsx'),
  // `claimUsername`: users/{uid}.username + the usernames/* reservation move must
  // be atomic, or a handle is reserved for a profile that does not name it.
  join('lib', 'firebase', 'username.ts'),
];

/**
 * Files that only READ the document.
 *
 * Note who is NOT here: `accountDeletion.ts`. It deletes the profile, but via
 * `snaps.profileSnap.ref` rather than by building a path — so it never names the
 * collection and never needed an exemption. That is the shape to copy.
 */
const READ_ONLY_FILES = [
  // collectUserDataSnapshots reads the profile for the export + the cascade.
  join('lib', 'firebase', 'userData.ts'),
  // getPublicProfileCard reads the projection; its WRITE goes through the
  // chokepoint's mergePublicProfileDoc.
  join('lib', 'firebase', 'publicProfile.ts'),
];

/**
 * `doc(db, 'users', uid)` — the profile document itself, not its
 * subcollections. The trailing `[^,)]*` draws that line: a path with a further
 * comma (`doc(db, 'users', uid, 'watchlist', id)`) is a different document with
 * its own rules, and gating those here would drag half the app through a guard
 * about consent records. `[\w.]+` for the db argument so `kit.doc(kit.db, …)`
 * counts — the form the chokepoint module itself uses.
 */
const PROFILE_DOC_REF = new RegExp([
  // doc(db, 'users', uid)
  /doc\(\s*[\w.]+\s*,\s*['"](?:users|publicProfiles)['"]\s*,\s*[^,)]*\)/.source,
  // const users = collection(db, 'users')  — the two-arg form, which then feeds
  // doc(users, uid). Naming the collection is enough to be listed here; the test
  // review found this shape slipping through on 4/4 green.
  /collection\(\s*[\w.]+\s*,\s*['"](?:users|publicProfiles)['"]\s*\)/.source,
].join('|'));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('users/{uid} write chokepoint (BIN-816, ADR 0019 c1)', () => {
  const files = walk(SRC).map(f => relative(SRC, f));
  const referencing = files.filter(rel => PROFILE_DOC_REF.test(readFileSync(join(SRC, rel), 'utf8')));

  it('bara de granskade filerna får ens NÄMNA users/{uid} eller publicProfiles/{uid}', () => {
    const allowed = new Set([CHOKEPOINT, ...BATCH_WRITERS, ...READ_ONLY_FILES]);
    const offenders = referencing
      .filter(rel => !allowed.has(rel))
      .map(rel => rel.split(sep).join('/'));

    // Om det här failar: routa skrivningen genom mergeUserDoc (eller
    // mergePublicProfileDoc) och rör aldrig dokumentet direkt. Måste den ligga i
    // en större atomisk batch — lägg filen i BATCH_WRITERS och anropa
    // assertProfileWritable först. Läser filen bara dokumentet — READ_ONLY_FILES,
    // med en rad om varför. Lägg ALDRIG till något i READ_ONLY_FILES för att bli
    // grön utan att ha läst vad filen faktiskt gör.
    expect(offenders).toEqual([]);
  });

  it('varje undantagen batch-skrivare anropar assertProfileWritable', () => {
    for (const rel of BATCH_WRITERS) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      // Utan det här påståendet vore BATCH_WRITERS bara en lista över filer
      // som slipper undan — dvs exakt det hål testet finns för att stänga.
      expect(source, `${rel} saknar assertProfileWritable`).toContain('assertProfileWritable(');
    }
  });

  it('varje post i undantagslistorna finns kvar OCH triggar mönstret', () => {
    // Ett mönster som slutat matcha (t.ex. för att koden formaterats om) skulle
    // annars göra testet ovan grönt genom att inte hitta någonting alls. Att de
    // kända filerna FORTFARANDE matchar är vad som håller det ärligt — och att
    // en post som blivit onödig failar i stället för att ruttna i listan.
    for (const rel of [CHOKEPOINT, ...BATCH_WRITERS, ...READ_ONLY_FILES]) {
      expect(
        referencing.includes(rel),
        `${rel} matchar inte längre PROFILE_DOC_REF — ta bort posten eller laga mönstret`,
      ).toBe(true);
    }
  });

  it('mönstret känner igen BÅDA skrivformerna, inte bara den ena', () => {
    // Alternationen för `collection(db, 'users')` var självo-pinnad: att ta bort
    // den lämnade 4/4 gröna, eftersom "varje undantag matchar fortfarande"
    // uppfylls av doc()-halvan för alla fem filerna. En senare regex-städning
    // hade tyst pensionerat precis den flyktväg runda 2 hittade.
    expect(PROFILE_DOC_REF.test("doc(db, 'users', uid)")).toBe(true);
    expect(PROFILE_DOC_REF.test("kit.doc(kit.db, 'publicProfiles', uid)")).toBe(true);
    expect(PROFILE_DOC_REF.test("const users = collection(db, 'users')")).toBe(true);
    expect(PROFILE_DOC_REF.test("collection(db, 'publicProfiles')")).toBe(true);
    // Och den träffar INTE en underkollektion — annars drogs halva appen in.
    expect(PROFILE_DOC_REF.test("doc(db, 'users', uid, 'watchlist', id)")).toBe(false);
    expect(PROFILE_DOC_REF.test("collection(db, 'users', uid, 'watchlist')")).toBe(false);
  });

  it('sveper faktiskt hela src/ — inte ett tomt eller halverat filset', () => {
    // Golvet (BIN-838:s lärdom — ett mönster som ersätter en lista behöver ett
    // golv). Satt strax under det verkliga antalet, inte på hälften: ett
    // katalogsteg som tyst slutar rekursera tar bort hundratals filer, och en
    // gräns på 200 mot 497 hade sovit igenom det.
    expect(files.length).toBeGreaterThan(450);
  });
});
