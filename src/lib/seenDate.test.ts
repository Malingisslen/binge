import { describe, it, expect } from 'vitest';
import { seenDate } from './seenDate';
import type { WatchStatus } from '@/types/domain';

const at = new Date('2026-08-25T12:00:00Z');
const item = (status: WatchStatus, watchedAt: Date | null) => ({ status, watchedAt });

describe('seenDate (BIN-689)', () => {
  it('returns the date when the title is currently marked sedd', () => {
    expect(seenDate(item('sedd', at))).toBe(at);
  });

  // This is the case that kills the mutant. BIN-593 stopped clearing watchedAt when a
  // title leaves 'sedd', so the date survives the status change — drop the gate and an
  // abandoned or re-listed film starts reporting a seen date on the diary, the library's
  // Sedd column, the stats page and the PUBLIC profile.
  it.each<WatchStatus>(['vill_se', 'mina', 'avbruten'])(
    'returns null for a %s title that still carries an old watchedAt',
    (status) => {
      expect(seenDate(item(status, at))).toBeNull();
    },
  );

  // The other half of #26's condition: this helper answers "which DATE", never "is it
  // seen". A sedd item with no date is still sedd, and the call sites that COUNT sedd
  // titles must not be routed through here — they would lose it.
  it('returns null for a sedd title that has no watchedAt yet', () => {
    expect(seenDate(item('sedd', null))).toBeNull();
  });
});
