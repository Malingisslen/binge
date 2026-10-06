import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEW_ACCOUNT_NOTIFICATION_SETTINGS } from './notificationDefaults';

describe('NEW_ACCOUNT_NOTIFICATION_SETTINGS (BIN-1442)', () => {
  it('turns the weekly digest on and leaves push off', () => {
    expect(NEW_ACCOUNT_NOTIFICATION_SETTINGS.weeklyDigest).toBe(true);
    expect(NEW_ACCOUNT_NOTIFICATION_SETTINGS.pushEnabled).toBe(false);
    expect(NEW_ACCOUNT_NOTIFICATION_SETTINGS.priceChanges).toBe(false);
  });

  // Both creation sites — Google sign-in and register() — must write the shared
  // object; a literal at either one would let a new account miss the default.
  it('is what both profile-creation sites write', () => {
    const src = readFileSync(join(__dirname, '..', 'contexts', 'AuthContext.tsx'), 'utf8');
    expect(src.match(/notificationSettings: \{ \.\.\.NEW_ACCOUNT_NOTIFICATION_SETTINGS \}/g)).toHaveLength(2);
    expect(src).not.toMatch(/notificationSettings: \{\s*newEpisodes: true/);
  });
});
