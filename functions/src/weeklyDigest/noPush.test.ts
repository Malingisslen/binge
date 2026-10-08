import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// BIN-1442. New accounts get the digest on by default, and the privacy page
// promises it reaches the app's bell only, "inte som e-post eller notis". This
// file is the whole delivery path, so a push call anywhere in it breaks that promise.
// A source scan, not a run: the entrypoint imports firebase-admin.
describe('weeklyDigestNotify (BIN-1442)', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');

  it('sends no push and no e-mail', () => {
    expect(src).not.toMatch(/sendPushToUser|from '\.\.\/push'|getMessaging|sendMail|nodemailer/);
  });

  it('still writes the inbox card for every user it processes', () => {
    expect(src).toMatch(/collection\('notifications'\)\.doc\(`weekly-digest-\$\{runDate\}`\)\.set\(\{\s*kind: 'weekly_digest'/);
  });
});
