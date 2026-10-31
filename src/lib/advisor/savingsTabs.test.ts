import { describe, it, expect } from 'vitest';
import { SAVINGS_TABS, tabFromHash } from './savingsTabs';

describe('tabFromHash', () => {
  it('maps every tab id, with or without the leading #', () => {
    for (const t of SAVINGS_TABS) {
      expect(tabFromHash(`#${t.id}`)).toBe(t.id);
      expect(tabFromHash(t.id)).toBe(t.id);
    }
  });

  it('falls back to the first tab for an empty or unknown hash', () => {
    expect(tabFromHash('')).toBe('tjanster');
    expect(tabFromHash('#')).toBe('tjanster');
    expect(tabFromHash('#nope')).toBe('tjanster');
  });

  it('keeps tab ids ASCII', () => {
    for (const t of SAVINGS_TABS) expect(t.id).toMatch(/^[a-z]+$/);
  });
});
