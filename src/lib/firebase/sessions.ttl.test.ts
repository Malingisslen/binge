// BIN-1301: createSession sets `expiresAt` from SESSION_TTL_DAYS, and firestore.rules
// refuses a session whose `expiresAt` is past the create ceiling. Nothing else ties
// the two together — the rules suite's validSession() hard-codes its own date — so
// raising the app's value past the ceiling would refuse every new session with every
// other suite green. This reads both from source and compares them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');

function appTtlDays(): number {
  const src = readFileSync(resolve(root, 'src/lib/firebase/sessions.ts'), 'utf8');
  const m = src.match(/^const SESSION_TTL_DAYS = (\d+);/m);
  if (!m) throw new Error('SESSION_TTL_DAYS declaration not found in sessions.ts');
  return Number(m[1]);
}

function ruleCeilingDays(): number {
  const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
  const m = rules.match(/request\.resource\.data\.expiresAt <= request\.time \+ duration\.value\((\d+), 'd'\)/);
  if (!m) throw new Error('sessions expiresAt ceiling not found in firestore.rules');
  return Number(m[1]);
}

describe('Tillsammans session lifetime (BIN-1301)', () => {
  it('the app lifetime is the 7 days the privacy page promises', () => {
    expect(appTtlDays()).toBe(7);
  });

  it('the rules ceiling leaves room above the app lifetime for clock drift', () => {
    expect(ruleCeilingDays()).toBeGreaterThan(appTtlDays());
  });
});
